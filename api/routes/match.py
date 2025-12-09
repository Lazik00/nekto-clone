from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from app.db import get_db
from app.deps import get_user_from_token
from app.models import User, BlockedUser
from app.schemas.match import MatchRequest, QueueStatus
from app.core.matchmaking import (
    add_to_queue,
    remove_from_queue,
    find_match,
    get_queue_position,
    store_match,
    is_user_in_queue
)
from app.core.notification import notification_manager

logger = logging.getLogger("matchmaking")

router = APIRouter()

# ======================================================
# 🔥 FIND — MATCHMAKING BOSHLANADI
# ======================================================
@router.post("/find", dependencies=[Depends(get_user_from_token)])
async def find_match_endpoint(
    request: MatchRequest,
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    logger.info(f"[FIND] user={current_user.id} | prefs={request.preferences}")

    # --------------------------------------------------------
    # 1) PENDING MATCH → frontend to‘g‘ri qabul qilishi shart
    # --------------------------------------------------------
    try:
        notifications = await notification_manager.get_notifications(current_user.id)
        logger.info(f"[FIND] pending notifications: {notifications}")

        for n in notifications:
            if isinstance(n, dict) and n.get("type") == "match_found":
                logger.warning(f"[FIND] Delivering pending match to {current_user.id}")

                return {
                    "status": "matched",
                    "session_id": n["session_id"],
                    "match": n["match"]
                }

    except Exception as e:
        logger.exception(f"[ERROR] Notification read failed → {e}")

    # --------------------------------------------------------
    # 2) Agar user allaqachon queue ichida bo‘lsa → queue-status qaytarish
    # --------------------------------------------------------
    if await is_user_in_queue(current_user.id):
        pos = await get_queue_position(current_user.id)
        logger.info(f"[FIND] user {current_user.id} already in queue at pos={pos}")

        return {
            "status": "queued",
            "position": pos,
            "wait_message": "Already searching..."
        }

    # --------------------------------------------------------
    # 3) Userni queue’ga qo‘shamiz
    # --------------------------------------------------------
    logger.info(f"[QUEUE] Add user={current_user.id}")
    await add_to_queue(current_user.id, request.preferences or {})

    # --------------------------------------------------------
    # 4) Darhol match borligini tekshiramiz
    # --------------------------------------------------------
    matched_user_id = await find_match(
        current_user.id,
        db,
        request.preferences or {}
    )

    logger.info(f"[MATCH] immediate result → {current_user.id} got={matched_user_id}")

    # --------------------------------------------------------
    # 5) Match topildi → session yaratamiz va qaytaramiz
    # --------------------------------------------------------
    if matched_user_id:
        stmt = select(User).where(User.id == matched_user_id)
        matched_user = (await db.execute(stmt)).scalar_one_or_none()

        if not matched_user:
            logger.error(f"[MATCH ERROR] matched user {matched_user_id} not found")
            return {"status": "queued"}

        # **CURRENT_USER → CALLER**
        # **MATCHED_USER → CALLEE**
        chat_session = await store_match(
            caller_id=current_user.id,
            callee_id=matched_user_id,
            db=db
        )

        logger.info(
            f"[MATCH SUCCESS] caller={current_user.id} callee={matched_user_id} session={chat_session.id}"
        )

        # CALLEE ga xabar yuborish
        await notification_manager.add_notification(
            matched_user_id,
            {
                "type": "match_found",
                "session_id": chat_session.id,
                "match": {
                    "match_id": chat_session.id,
                    "user_id": current_user.id,
                    "display_name": current_user.display_name,
                    "gender": current_user.gender,
                    "age": current_user.age,
                    "country": current_user.country,
                    "bio": current_user.bio,
                    "avatar_url": current_user.avatar_url,
                }
            }
        )

        logger.info(f"[NOTIFY] sent to callee={matched_user_id}")

        # CALLER uchun response
        return {
            "status": "matched",
            "session_id": chat_session.id,
            "match": {
                "match_id": chat_session.id,
                "user_id": matched_user.id,
                "display_name": matched_user.display_name,
                "gender": matched_user.gender,
                "age": matched_user.age,
                "country": matched_user.country,
                "bio": matched_user.bio,
                "avatar_url": matched_user.avatar_url,
            }
        }

    # --------------------------------------------------------
    # 6) Match topilmadi → queue’da kutadi
    # --------------------------------------------------------
    logger.info(f"[QUEUE] No match for {current_user.id} → waiting")

    return {
        "status": "queued",
        "wait_message": "Searching for a match..."
    }


# ======================================================
# 🔥 GET NOTIFICATIONS
# ======================================================
@router.get("/notifications", dependencies=[Depends(get_user_from_token)])
async def get_notifications_endpoint(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[NOTIFS] User {current_user.id} requested notifications")
    data = await notification_manager.get_notifications(current_user.id)
    return {"notifications": data}


# ======================================================
# 🔥 QUEUE STATUS
# ======================================================
@router.get("/queue-status", response_model=QueueStatus)
async def queue_status(
    current_user: User = Depends(get_user_from_token),
):
    logger.info(f"[QUEUE STATUS] Check for user {current_user.id}")

    pos = await get_queue_position(current_user.id)
    if pos < 0:
        raise HTTPException(404, "User not in queue")

    est = max(0, (pos - 1) * 10)

    return {
        "position": pos,
        "wait_time_seconds": est,
        "estimated_match_in": est,
    }


# ======================================================
# 🔥 CANCEL MATCHMAKING
# ======================================================
@router.post("/cancel")
async def cancel_matchmaking(
    current_user: User = Depends(get_user_from_token)
):
    logger.info(f"[QUEUE CANCEL] {current_user.id}")
    await remove_from_queue(current_user.id)

    return {"message": "Matchmaking canceled"}


# ======================================================
# 🔥 BLOCK USER
# ======================================================
@router.post("/block/{user_id}")
async def block_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot block yourself")

    stmt = select(User).where(User.id == user_id)
    target = (await db.execute(stmt)).scalar_one_or_none()

    if not target:
        raise HTTPException(404, "User not found")

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )

    if (await db.execute(stmt)).scalar_one_or_none():
        raise HTTPException(400, "Already blocked")

    rec = BlockedUser(
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )
    db.add(rec)
    current_user.blocked_users_count += 1
    db.add(current_user)

    await db.commit()
    return {"message": "User blocked successfully"}


# ======================================================
# 🔥 UNBLOCK
# ======================================================
@router.post("/unblock/{user_id}")
async def unblock_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )

    rec = (await db.execute(stmt)).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "User not blocked")

    await db.delete(rec)
    current_user.blocked_users_count = max(
        0, current_user.blocked_users_count - 1
    )
    db.add(current_user)

    await db.commit()
    return {"message": "User unblocked successfully"}


# ======================================================
# 🔥 BLOCKED LIST
# ======================================================
@router.get("/blocked-list")
async def blocked_list(
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(BlockedUser).where(BlockedUser.blocker_user_id == current_user.id)
    items = (await db.execute(stmt)).scalars().all()

    users = []
    for r in items:
        stmt = select(User).where(User.id == r.blocked_user_id)
        u = (await db.execute(stmt)).scalar_one_or_none()
        if u:
            users.append({
                "id": u.id,
                "display_name": u.display_name,
                "avatar_url": u.avatar_url,
                "blocked_at": r.created_at,
            })

    return {"blocked_users": users}

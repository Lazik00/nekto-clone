from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from app.db import get_db
from app.deps import get_user_from_token
from app.models import User, BlockedUser
from app.schemas.match import MatchRequest, QueueStatus
from app.core.matchmaking import (
    add_to_queue, remove_from_queue, find_match,
    get_queue_position, store_match
)
from app.core.notification import notification_manager

logger = logging.getLogger("matchmaking")

router = APIRouter()


# ==========================================
# 🔥 FIND MATCH (CALLER ALWAYS = current_user)
# ==========================================

@router.post("/find", dependencies=[Depends(get_user_from_token)])
async def find_match_endpoint(
    request: MatchRequest,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:

    logger.info(f"[FIND] User={current_user.id} requested match | Prefs={request.preferences}")

    # ----------------------------------------------------
    # 1) PENDING NOTIFICATION → USER OLDIN MATCH TOPGAN
    # ----------------------------------------------------
    try:
        notifications = await notification_manager.get_notifications(current_user.id)
        logger.info(f"[FIND] User={current_user.id} notifications={notifications}")

        for n in notifications:
            if isinstance(n, dict) and n.get("type") == "match_found":
                logger.warning(f"[FIND] Delivering PENDING MATCH → {current_user.id}")

                return {
                    "status": "matched",
                    "session_id": n["session_id"],
                    "match": n["match"]
                }

    except Exception as e:
        logger.exception(f"[FIND ERROR] Failed to check pending notifications → {e}")

    # ----------------------------------------------------
    # 2) Hali match topilmagan → queue'ga qo‘shamiz
    # ----------------------------------------------------
    logger.info(f"[QUEUE] Adding user {current_user.id} to queue")
    await add_to_queue(current_user.id, request.preferences or {})

    # ----------------------------------------------------
    # 3) IMMEDIATE MATCHING
    # ----------------------------------------------------
    matched_user_id = await find_match(
        current_user.id, session, request.preferences or {}
    )

    logger.info(
        f"[MATCH] Immediate matching result → user={current_user.id} got={matched_user_id}"
    )

    if matched_user_id:

        # opponent user data
        stmt = select(User).where(User.id == matched_user_id)
        matched_user = (await session.execute(stmt)).scalar_one_or_none()

        if matched_user:

            # *********************************************
            #   CURRENT_USER → CALLER (user_id_1)
            #   MATCHED_USER → CALLEE (user_id_2)
            # *********************************************
            chat_session = await store_match(
                caller_id=current_user.id,
                callee_id=matched_user_id,
                db=session
            )

            logger.info(
                f"[MATCH SUCCESS] caller={current_user.id}  callee={matched_user_id} | session={chat_session.id}"
            )

            # Notify opponent (callee)
            await notification_manager.add_notification(
                matched_user_id,
                {
                    "type": "match_found",
                    "session_id": chat_session.id,
                    "match": {
                        "match_id": chat_session.id,
                        "user_id": current_user.id,
                        "display_name": current_user.display_name,
                        "age": current_user.age,
                        "gender": current_user.gender,
                        "country": current_user.country,
                        "avatar_url": current_user.avatar_url,
                        "bio": current_user.bio,
                    }
                }
            )

            logger.info(
                f"[NOTIFY] Sent match notification → to callee={matched_user_id}"
            )

            # Caller tarafga qaytariladigan JSON
            return {
                "status": "matched",
                "session_id": chat_session.id,
                "match": {
                    "match_id": chat_session.id,
                    "user_id": matched_user.id,
                    "display_name": matched_user.display_name,
                    "age": matched_user.age,
                    "gender": matched_user.gender,
                    "country": matched_user.country,
                    "avatar_url": matched_user.avatar_url,
                    "bio": matched_user.bio,
                }
            }

    # ---------------------------------------------
    # 4) Hali match topilmadi → queue’da kutadi
    # ---------------------------------------------
    logger.info(f"[QUEUE] No match found → user={current_user.id} now waiting")

    return {"status": "queued", "wait_message": "Searching for a match..."}


# ==========================================
# 🔥 GET PENDING NOTIFICATIONS
# ==========================================

@router.get("/notifications", dependencies=[Depends(get_user_from_token)])
async def get_notifications_endpoint(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[NOTIFICATIONS] {current_user.id} → requested")
    data = await notification_manager.get_notifications(current_user.id)
    return {"notifications": data}


# ==========================================
# 🔥 QUEUE STATUS
# ==========================================

@router.get(
    "/queue-status",
    response_model=QueueStatus,
    dependencies=[Depends(get_user_from_token)]
)
async def get_queue_status(current_user: User = Depends(get_user_from_token)):

    logger.info(f"[QUEUE STATUS] Checking position → user={current_user.id}")
    pos = await get_queue_position(current_user.id)

    if pos < 0:
        logger.warning(f"[QUEUE STATUS] User {current_user.id} NOT in queue")
        raise HTTPException(404, "User not in queue")

    estimate = max(0, (pos - 1) * 10)

    return {
        "position": pos,
        "wait_time_seconds": estimate,
        "estimated_match_in": estimate,
    }


# ==========================================
# 🔥 CANCEL MATCHMAKING
# ==========================================

@router.post("/cancel", dependencies=[Depends(get_user_from_token)])
async def cancel_matchmaking(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[QUEUE CANCEL] {current_user.id}")
    await remove_from_queue(current_user.id)
    return {"message": "Matchmaking canceled"}


# ==========================================
# 🔥 BLOCK USER
# ==========================================

@router.post("/block/{user_id}", dependencies=[Depends(get_user_from_token)])
async def block_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
):

    if user_id == current_user.id:
        raise HTTPException(400, "Cannot block yourself")

    stmt = select(User).where(User.id == user_id)
    target = (await session.execute(stmt)).scalar_one_or_none()

    if not target:
        raise HTTPException(404, "User not found")

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )

    if (await session.execute(stmt)).scalar_one_or_none():
        raise HTTPException(400, "User already blocked")

    blocked = BlockedUser(
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )

    session.add(blocked)
    current_user.blocked_users_count += 1
    session.add(current_user)

    await session.commit()

    return {"message": "User blocked successfully"}


# ==========================================
# 🔥 UNBLOCK USER
# ==========================================

@router.post("/unblock/{user_id}", dependencies=[Depends(get_user_from_token)])
async def unblock_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
):

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )

    blocked = (await session.execute(stmt)).scalar_one_or_none()
    if not blocked:
        raise HTTPException(404, "User not blocked")

    session.delete(blocked)
    current_user.blocked_users_count = max(0, current_user.blocked_users_count - 1)
    session.add(current_user)

    await session.commit()
    return {"message": "User unblocked successfully"}


# ==========================================
# 🔥 BLOCKED LIST
# ==========================================

@router.get("/blocked-list", dependencies=[Depends(get_user_from_token)])
async def get_blocked_list(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
):

    stmt = select(BlockedUser).where(
        BlockedUser.blocker_user_id == current_user.id
    )
    records = (await session.execute(stmt)).scalars().all()

    users = []
    for r in records:
        stmt = select(User).where(User.id == r.blocked_user_id)
        u = (await session.execute(stmt)).scalar_one_or_none()

        if u:
            users.append({
                "id": u.id,
                "display_name": u.display_name,
                "avatar_url": u.avatar_url,
                "blocked_at": r.created_at,
            })

    return {"blocked_users": users}

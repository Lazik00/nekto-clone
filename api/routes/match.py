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
# 🔥 FIND MATCH
# ==========================================

@router.post("/find", dependencies=[Depends(get_user_from_token)])
async def find_match_endpoint(
    request: MatchRequest,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    logger.info(f"[FIND] User={current_user.id} requested match | Prefs={request.preferences}")

    # --- pending notifications ---
    try:
        notifications = await notification_manager.get_notifications(current_user.id)
        logger.info(f"[FIND] User={current_user.id} notifications={notifications}")

        if notifications:
            for n in notifications:
                if isinstance(n, dict) and n.get("type") == "match_found":
                    logger.warning(f"[FIND] Delivering PENDING MATCH to user {current_user.id}")
                    sess_id = n.get("session_id")
                    match_data = n.get("match", {})

                    return {
                        "status": "matched",
                        "session_id": sess_id,
                        "match": match_data
                    }
    except Exception as e:
        logger.exception(f"[FIND] Pending notification check FAILED → user={current_user.id}, error={e}")

    # --- add to queue ---
    logger.info(f"[QUEUE] Adding user {current_user.id} to matchmaking queue")
    await add_to_queue(current_user.id, request.preferences or {})

    # --- try immediate match ---
    matched_user_id = await find_match(current_user.id, session, request.preferences or {})
    logger.info(f"[MATCH] Immediate matching result → for {current_user.id} got={matched_user_id}")

    if matched_user_id:
        stmt = select(User).where(User.id == matched_user_id)
        matched_user = (await session.execute(stmt)).scalar_one_or_none()

        if matched_user:
            chat_session = await store_match(current_user.id, matched_user_id, session)

            logger.info(
                f"[MATCH SUCCESS] {current_user.id} <-> {matched_user_id} | session={chat_session.id}"
            )

            # send notification to opponent
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
            logger.info(f"[NOTIFY] Match notification sent → to={matched_user_id}")

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

    logger.info(f"[QUEUE] No match found → user={current_user.id} queued")
    return {"status": "queued", "wait_message": "Searching for a match..."}


# ==========================================
# 🔥 PENDING NOTIFICATIONS
# ==========================================

@router.get("/notifications", dependencies=[Depends(get_user_from_token)])
async def get_notifications_endpoint(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[NOTIFICATIONS] User={current_user.id} requested notifications")
    notifications = await notification_manager.get_notifications(current_user.id)
    logger.info(f"[NOTIFICATIONS] OUT → {notifications}")
    return {"notifications": notifications}


# ==========================================
# 🔥 QUEUE STATUS
# ==========================================

@router.get("/queue-status", response_model=QueueStatus, dependencies=[Depends(get_user_from_token)])
async def get_queue_status(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[QUEUE STATUS] Checking position for user={current_user.id}")

    position = await get_queue_position(current_user.id)

    if position < 0:
        logger.warning(f"[QUEUE STATUS] User {current_user.id} NOT IN QUEUE")
        raise HTTPException(404, "User not in queue")

    estimate = max(0, (position - 1) * 10)

    logger.info(
        f"[QUEUE STATUS] User={current_user.id} pos={position} wait={estimate}s"
    )

    return {
        "position": position,
        "wait_time_seconds": estimate,
        "estimated_match_in": estimate,
    }


# ==========================================
# 🔥 CANCEL MATCHMAKING
# ==========================================

@router.post("/cancel", dependencies=[Depends(get_user_from_token)])
async def cancel_matchmaking(current_user: User = Depends(get_user_from_token)):
    logger.info(f"[QUEUE CANCEL] Removing user {current_user.id} from queue")
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
    logger.warning(f"[BLOCK] User={current_user.id} → Blocking {user_id}")

    if user_id == current_user.id:
        logger.error("[BLOCK] User tried to block themself")
        raise HTTPException(400, "Cannot block yourself")

    stmt = select(User).where(User.id == user_id)
    target = (await session.execute(stmt)).scalar_one_or_none()
    if not target:
        logger.error(f"[BLOCK] Target user {user_id} not found")
        raise HTTPException(404, "User not found")

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )
    if (await session.execute(stmt)).scalar_one_or_none():
        logger.warning(f"[BLOCK] Duplicate block → {user_id}")
        raise HTTPException(400, "User already blocked")

    blocked = BlockedUser(
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )

    session.add(blocked)
    current_user.blocked_users_count += 1
    session.add(current_user)
    await session.commit()

    logger.info(f"[BLOCK] SUCCESS → {current_user.id} blocked {user_id}")

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
    logger.info(f"[UNBLOCK] User={current_user.id} → Unblocking {user_id}")

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )
    blocked = (await session.execute(stmt)).scalar_one_or_none()

    if not blocked:
        logger.warning(f"[UNBLOCK] No block found → {user_id}")
        raise HTTPException(404, "User not blocked")

    session.delete(blocked)
    current_user.blocked_users_count = max(0, current_user.blocked_users_count - 1)
    session.add(current_user)
    await session.commit()

    logger.info(f"[UNBLOCK] SUCCESS → {current_user.id} unblocked {user_id}")

    return {"message": "User unblocked successfully"}


# ==========================================
# 🔥 BLOCKED LIST
# ==========================================

@router.get("/blocked-list", dependencies=[Depends(get_user_from_token)])
async def get_blocked_list(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
):
    logger.info(f"[BLOCK LIST] Load for user={current_user.id}")

    stmt = select(BlockedUser).where(BlockedUser.blocker_user_id == current_user.id)
    blocked_records = (await session.execute(stmt)).scalars().all()

    users = []
    for record in blocked_records:
        stmt = select(User).where(User.id == record.blocked_user_id)
        user = (await session.execute(stmt)).scalar_one_or_none()

        if user:
            users.append({
                "id": user.id,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "blocked_at": record.created_at,
            })

    logger.info(f"[BLOCK LIST] Count={len(users)}")
    return {"blocked_users": users}

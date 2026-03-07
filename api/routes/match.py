import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.matchmaking import (
    add_to_queue,
    find_match,
    get_queue_position,
    is_user_in_queue,
    rate_limit_check,
    remove_from_queue,
    store_match,
)
from app.core.notification import notification_manager
from app.db import get_db
from app.deps import get_user_from_token
from app.models import BlockedUser, User
from app.schemas.match import MatchRequest, QueueStatus

logger = logging.getLogger("matchmaking")
router = APIRouter()


def _normalize_preferences(request: MatchRequest) -> dict:
    merged = dict(request.preferences or {})

    if request.gender_preference:
        merged["gender_preference"] = request.gender_preference
    if request.age_min is not None:
        merged["age_min"] = request.age_min
    if request.age_max is not None:
        merged["age_max"] = request.age_max
    if request.country_preference:
        merged["country_preference"] = request.country_preference

    return merged


@router.post("/find", dependencies=[Depends(get_user_from_token)])
async def find_match_endpoint(
    request: MatchRequest,
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    preferences = _normalize_preferences(request)
    logger.info("[FIND] user=%s | prefs=%s", current_user.id, preferences)

    try:
        notifications = await notification_manager.get_notifications(current_user.id)

        for notification in notifications:
            if isinstance(notification, dict) and notification.get("type") == "match_found":
                return {
                    "status": "matched",
                    "session_id": notification["session_id"],
                    "match": notification["match"],
                }

    except Exception as exc:
        logger.exception("[ERROR] Notification read failed: %s", exc)

    if await is_user_in_queue(current_user.id):
        position = await get_queue_position(current_user.id)
        return {
            "status": "queued",
            "position": position,
            "wait_message": "Already searching...",
        }

    if not await rate_limit_check(current_user.id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Try again later.",
        )

    await add_to_queue(current_user.id, preferences)

    matched_user_id = await find_match(
        current_user.id,
        db,
        preferences,
    )

    if matched_user_id:
        stmt = select(User).where(User.id == matched_user_id)
        matched_user = (await db.execute(stmt)).scalar_one_or_none()

        if not matched_user:
            logger.error("[MATCH ERROR] matched user %s not found", matched_user_id)
            return {"status": "queued"}

        chat_session = await store_match(
            caller_id=current_user.id,
            callee_id=matched_user_id,
            db=db,
        )

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
                },
            },
        )

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
            },
        }

    return {
        "status": "queued",
        "wait_message": "Searching for a match...",
    }


@router.get("/notifications", dependencies=[Depends(get_user_from_token)])
async def get_notifications_endpoint(current_user: User = Depends(get_user_from_token)):
    data = await notification_manager.get_notifications(current_user.id)
    return {"notifications": data}


@router.get("/queue-status", response_model=QueueStatus)
async def queue_status(
    current_user: User = Depends(get_user_from_token),
):
    position = await get_queue_position(current_user.id)
    if position < 0:
        raise HTTPException(404, "User not in queue")

    estimated = max(0, (position - 1) * 10)

    return {
        "position": position,
        "wait_time_seconds": estimated,
        "estimated_match_in": estimated,
    }


@router.post("/cancel")
async def cancel_matchmaking(
    current_user: User = Depends(get_user_from_token),
):
    await remove_from_queue(current_user.id)
    return {"message": "Matchmaking canceled"}


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
        (BlockedUser.blocker_user_id == current_user.id)
        & (BlockedUser.blocked_user_id == user_id)
    )

    if (await db.execute(stmt)).scalar_one_or_none():
        raise HTTPException(400, "Already blocked")

    record = BlockedUser(
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )
    db.add(record)
    current_user.blocked_users_count += 1
    db.add(current_user)

    await db.commit()
    return {"message": "User blocked successfully"}


@router.post("/unblock/{user_id}")
async def unblock_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id)
        & (BlockedUser.blocked_user_id == user_id)
    )

    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(404, "User not blocked")

    await db.delete(record)
    current_user.blocked_users_count = max(0, current_user.blocked_users_count - 1)
    db.add(current_user)

    await db.commit()
    return {"message": "User unblocked successfully"}


@router.get("/blocked-list")
async def blocked_list(
    current_user: User = Depends(get_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(BlockedUser, User)
        .join(User, User.id == BlockedUser.blocked_user_id)
        .where(BlockedUser.blocker_user_id == current_user.id)
        .order_by(BlockedUser.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    users = [
        {
            "id": blocked_user.id,
            "display_name": blocked_user.display_name,
            "avatar_url": blocked_user.avatar_url,
            "blocked_at": record.created_at,
        }
        for record, blocked_user in rows
    ]

    return {"blocked_users": users}

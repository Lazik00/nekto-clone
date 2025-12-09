from fastapi import APIRouter, HTTPException, status, Depends
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from app.db import get_db
from app.deps import get_user_from_token
from app.models import User, BlockedUser
from app.schemas.match import MatchRequest, MatchResponse, QueueStatus
from app.core.matchmaking import (
    add_to_queue, remove_from_queue, find_match,
    get_queue_position, rate_limit_check, store_match
)
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


from app.core.notification import notification_manager

# ... existing code ...

@router.post("/find", dependencies=[Depends(get_user_from_token)])
async def find_match_endpoint(
    request: MatchRequest,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Start matchmaking process"""

    # First check if there are any pending notifications for this user (e.g. a match_found)
    try:
        notifications = await notification_manager.get_notifications(current_user.id)
        if notifications:
            for n in notifications:
                if isinstance(n, dict) and n.get("type") == "match_found":
                    logger.info(f"Delivering pending match notification to user {current_user.id}")
                    sess_id = n.get("session_id") or (n.get("match") or {}).get("match_id")
                    match_data = n.get("match") or {}
                    return {
                        "status": "matched",
                        "session_id": sess_id,
                        "match": {
                            "match_id": match_data.get("match_id") or sess_id,
                            "user_id": match_data.get("user_id"),
                            "display_name": match_data.get("display_name"),
                            "age": match_data.get("age"),
                            "gender": match_data.get("gender"),
                            "country": match_data.get("country"),
                            "avatar_url": match_data.get("avatar_url"),
                            "bio": match_data.get("bio"),
                        }
                    }
    except Exception:
        # Keep silent on notification errors so matchmaking still proceeds
        logger.exception(f"Error checking notifications for user {current_user.id}")

    # Check rate limit
    # if not await rate_limit_check(current_user.id):
    #     raise HTTPException(
    #         status_code=status.HTTP_429_TOO_MANY_REQUESTS,
    #         detail="Too many matches in the last hour",
    #     )

    # Add to queue
    await add_to_queue(current_user.id, request.preferences or {})

    logger.info(f"User {current_user.id} added to matchmaking queue")

    # Try to find match immediately
    matched_user_id = await find_match(current_user.id, session, request.preferences or {})

    if matched_user_id:
        # Get matched user details
        stmt = select(User).where(User.id == matched_user_id)
        result = await session.execute(stmt)
        matched_user = result.scalar_one_or_none()

        if matched_user:
            # Create chat session
            chat_session = await store_match(current_user.id, matched_user_id, session)

            logger.info(f"Match found: {current_user.id} <-> {matched_user_id}")

            # Notify the matched user
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

            # Return match response to the current user
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

    return {
        "status": "queued",
        "wait_message": "Searching for a match...",
    }



@router.get("/notifications", dependencies=[Depends(get_user_from_token)])
async def get_notifications_endpoint(current_user: User = Depends(get_user_from_token)):
    """Get notifications for the current user"""
    notifications = await notification_manager.get_notifications(current_user.id)
    return {"notifications": notifications}




@router.get("/queue-status", response_model=QueueStatus, dependencies=[Depends(get_user_from_token)])
async def get_queue_status(
    current_user: User = Depends(get_user_from_token),
) -> dict:
    """Get current position in matchmaking queue"""

    position = await get_queue_position(current_user.id)

    if position < 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not in queue",
        )

    estimated_wait = max(0, (position - 1) * 10)  # Rough estimate: 10 seconds per person

    return {
        "position": position,
        "wait_time_seconds": estimated_wait,
        "estimated_match_in": estimated_wait,
    }


@router.post("/cancel", dependencies=[Depends(get_user_from_token)])
async def cancel_matchmaking(
    current_user: User = Depends(get_user_from_token),
) -> dict:
    """Cancel matchmaking"""

    await remove_from_queue(current_user.id)

    logger.info(f"User {current_user.id} canceled matchmaking")

    return {"message": "Matchmaking canceled"}


@router.post("/block/{user_id}", dependencies=[Depends(get_user_from_token)])
async def block_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Block a user"""

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot block yourself",
        )

    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Check if already blocked
    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )
    result = await session.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already blocked",
        )

    # Create block
    blocked = BlockedUser(
        blocker_user_id=current_user.id,
        blocked_user_id=user_id,
    )

    session.add(blocked)
    current_user.blocked_users_count += 1
    session.add(current_user)
    await session.commit()

    logger.info(f"User {current_user.id} blocked {user_id}")

    return {"message": "User blocked successfully"}


@router.post("/unblock/{user_id}", dependencies=[Depends(get_user_from_token)])
async def unblock_user(
    user_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Unblock a user"""

    stmt = select(BlockedUser).where(
        (BlockedUser.blocker_user_id == current_user.id) &
        (BlockedUser.blocked_user_id == user_id)
    )
    result = await session.execute(stmt)
    blocked = result.scalar_one_or_none()

    if not blocked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not blocked",
        )

    session.delete(blocked)
    current_user.blocked_users_count = max(0, current_user.blocked_users_count - 1)
    session.add(current_user)
    await session.commit()

    logger.info(f"User {current_user.id} unblocked {user_id}")

    return {"message": "User unblocked successfully"}


@router.get("/blocked-list", dependencies=[Depends(get_user_from_token)])
async def get_blocked_list(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get list of blocked users"""

    stmt = select(BlockedUser).where(BlockedUser.blocker_user_id == current_user.id)
    result = await session.execute(stmt)
    blocked_records = result.scalars().all()

    blocked_users = []
    for record in blocked_records:
        user_stmt = select(User).where(User.id == record.blocked_user_id)
        user_result = await session.execute(user_stmt)
        user = user_result.scalar_one_or_none()
        if user:
            blocked_users.append({
                "id": user.id,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "blocked_at": record.created_at,
            })

    return {"blocked_users": blocked_users}

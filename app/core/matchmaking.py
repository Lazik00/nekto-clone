import aioredis
import json
import logging
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

try:
    import aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    aioredis = None

from ..config import settings
from ..models import User, ChatSession

logger = logging.getLogger(__name__)

# Redis client
redis_client: Optional[any] = None

# Fallback in-memory cache for when Redis is unavailable
in_memory_cache: Dict = {
    "match_queue": {},
    "rate_limits": {},
    "sessions": {}
}


async def init_redis() -> None:
    """Initialize Redis connection with fallback"""
    global redis_client

    if not REDIS_AVAILABLE:
        logger.warning("Redis not available, using in-memory cache")
        return

    try:
        redis_client = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf8",
            decode_responses=True
        )
        # Test connection
        await redis_client.ping()
        logger.info("✅ Redis connected successfully")
    except Exception as e:
        logger.warning(f"⚠️ Redis connection failed: {str(e)}")
        logger.warning("Falling back to in-memory cache")
        redis_client = None


async def close_redis() -> None:
    """Close Redis connection"""
    global redis_client
    if redis_client:
        try:
            await redis_client.close()
            logger.info("Redis disconnected")
        except Exception as e:
            logger.warning(f"Error closing Redis: {str(e)}")
        finally:
            redis_client = None


async def get_redis() -> Optional[any]:
    """Get Redis client"""
    return redis_client


async def add_to_queue(user_id: str, preferences: Optional[Dict] = None) -> None:
    """Add user to matchmaking queue"""
    queue_key = "match_queue"

    user_data = {
        "user_id": user_id,
        "joined_at": datetime.utcnow().isoformat(),
        "preferences": preferences or {},
    }

    redis = await get_redis()

    if redis:
        try:
            await redis.zadd(
                queue_key,
                {json.dumps(user_data): datetime.utcnow().timestamp()}
            )
            await redis.expire(queue_key, settings.MATCH_TIMEOUT_SECONDS)
        except Exception as e:
            logger.error(f"Redis error adding to queue: {str(e)}")
            # Fallback to in-memory
            in_memory_cache[queue_key][user_id] = user_data
    else:
        # Use in-memory cache
        in_memory_cache[queue_key][user_id] = user_data


async def remove_from_queue(user_id: str) -> None:
    """Remove user from matchmaking queue"""
    queue_key = "match_queue"
    redis = await get_redis()

    if redis:
        try:
            members = await redis.zrange(queue_key, 0, -1)
            for member in members:
                data = json.loads(member)
                if data["user_id"] == user_id:
                    await redis.zrem(queue_key, member)
                    break
        except Exception as e:
            logger.error(f"Redis error removing from queue: {str(e)}")
            if user_id in in_memory_cache[queue_key]:
                del in_memory_cache[queue_key][user_id]
    else:
        # Use in-memory cache
        if user_id in in_memory_cache[queue_key]:
            del in_memory_cache[queue_key][user_id]


async def get_queue_position(user_id: str) -> int:
    """Get user's position in matchmaking queue"""
    queue_key = "match_queue"
    redis = await get_redis()

    if redis:
        try:
            members = await redis.zrange(queue_key, 0, -1)
            for idx, member in enumerate(members):
                data = json.loads(member)
                if data["user_id"] == user_id:
                    return idx
        except Exception as e:
            logger.error(f"Redis error getting queue position: {str(e)}")
            # Fallback to in-memory
            for idx, uid in enumerate(in_memory_cache[queue_key].keys()):
                if uid == user_id:
                    return idx
    else:
        # Use in-memory cache
        for idx, uid in enumerate(in_memory_cache[queue_key].keys()):
            if uid == user_id:
                return idx

    return -1


async def find_match(
    user_id: str,
    session: AsyncSession,
    preferences: Optional[Dict] = None
) -> Optional[str]:
    """
    Find a match for user from queue
    Returns matched user_id or None
    """
    queue_key = "match_queue"
    redis = await get_redis()
    members = []

    if redis:
        try:
            members = await redis.zrange(queue_key, 0, -1)
        except Exception as e:
            logger.error(f"Redis error in find_match: {str(e)}")
            members = list(in_memory_cache[queue_key].values())
    else:
        members = list(in_memory_cache[queue_key].values())

    logger.debug(f"find_match: Looking for match for {user_id}, queue size: {len(members)}")

    for member in members:
        if isinstance(member, str):
            data = json.loads(member)
        else:
            data = member

        candidate_id = data["user_id"]

        # Don't match with self
        if candidate_id == user_id:
            continue

        # Check if users are blocked
        if await is_blocked(user_id, candidate_id, session):
            logger.debug(f"Users {user_id} and {candidate_id} are blocked")
            continue

        # Check preferences
        if preferences:
            if not await check_preferences(candidate_id, preferences, session):
                logger.debug(f"Preferences mismatch between {user_id} and {candidate_id}")
                continue

        # Found a match!
        logger.info(f"Match found: {user_id} <-> {candidate_id}")
        await remove_from_queue(user_id)
        await remove_from_queue(candidate_id)

        return candidate_id

    logger.debug(f"No match found for {user_id}, keeping in queue")
    return None


async def is_blocked(user_id_1: str, user_id_2: str, session: AsyncSession) -> bool:
    """Check if users have blocked each other"""
    from ..models import BlockedUser

    stmt = select(BlockedUser).where(
        (
            (BlockedUser.blocker_user_id == user_id_1) &
            (BlockedUser.blocked_user_id == user_id_2)
        ) |
        (
            (BlockedUser.blocker_user_id == user_id_2) &
            (BlockedUser.blocked_user_id == user_id_1)
        )
    )

    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def check_preferences(
    user_id: str,
    preferences: Dict,
    session: AsyncSession
) -> bool:
    """Check if user matches preferences"""
    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        return False

    # Check gender preference
    if "gender_preference" in preferences and preferences["gender_preference"]:
        if user.gender != preferences["gender_preference"]:
            return False

    # Check age range
    if "age_min" in preferences and user.age and user.age < preferences["age_min"]:
        return False

    if "age_max" in preferences and user.age and user.age > preferences["age_max"]:
        return False

    return True


async def store_match(
    user_id_1: str,
    user_id_2: str,
    session: AsyncSession
) -> ChatSession:
    """Create a chat session for matched users"""
    chat_session = ChatSession(
        user_id_1=user_id_1,
        user_id_2=user_id_2,
        status="active"
    )

    session.add(chat_session)
    await session.commit()
    await session.refresh(chat_session)

    logger.info(f"Chat session created: {chat_session.id} between {user_id_1} and {user_id_2}")

    return chat_session


async def rate_limit_check(user_id: str) -> bool:
    """
    Check if user has exceeded rate limit for matches
    Returns True if allowed, False if rate limited
    """
    key = f"matches:{user_id}"
    redis = await get_redis()

    if redis:
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, 3600)
            return count <= settings.MAX_MATCHES_PER_HOUR
        except Exception as e:
            logger.error(f"Redis rate limit error: {str(e)}")
            # Fallback to in-memory
            if key not in in_memory_cache["rate_limits"]:
                in_memory_cache["rate_limits"][key] = {
                    "count": 1,
                    "expires_at": datetime.utcnow() + timedelta(hours=1)
                }
            else:
                cache_entry = in_memory_cache["rate_limits"][key]
                if cache_entry["expires_at"] > datetime.utcnow():
                    cache_entry["count"] += 1
                else:
                    cache_entry["count"] = 1
                    cache_entry["expires_at"] = datetime.utcnow() + timedelta(hours=1)

            return in_memory_cache["rate_limits"][key]["count"] <= settings.MAX_MATCHES_PER_HOUR
    else:
        # Use in-memory cache
        if key not in in_memory_cache["rate_limits"]:
            in_memory_cache["rate_limits"][key] = {
                "count": 1,
                "expires_at": datetime.utcnow() + timedelta(hours=1)
            }
        else:
            cache_entry = in_memory_cache["rate_limits"][key]
            if cache_entry["expires_at"] > datetime.utcnow():
                cache_entry["count"] += 1
            else:
                cache_entry["count"] = 1
                cache_entry["expires_at"] = datetime.utcnow() + timedelta(hours=1)

        return in_memory_cache["rate_limits"][key]["count"] <= settings.MAX_MATCHES_PER_HOUR



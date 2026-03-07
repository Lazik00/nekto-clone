import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ChatSession, User

logger = logging.getLogger(__name__)

QUEUE_ZSET_KEY = "match_queue"
QUEUE_PREF_KEY_PREFIX = "match_queue:pref:"
RATE_LIMIT_KEY_PREFIX = "matches:"

redis_client: Optional[Redis] = None

# In-memory fallback when Redis is unavailable
in_memory_cache: Dict = {
    "match_queue": {},  # user_id -> {joined_at, preferences}
    "rate_limits": {},
}


async def init_redis() -> None:
    """Initialize Redis connection with in-memory fallback."""
    global redis_client

    try:
        redis_client = Redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
        await redis_client.ping()
        logger.info("Redis connected successfully")
    except Exception as exc:
        logger.warning("Redis connection failed: %s", exc)
        logger.warning("Falling back to in-memory queue")
        redis_client = None


async def close_redis() -> None:
    """Close Redis connection."""
    global redis_client
    if redis_client:
        try:
            await redis_client.aclose()
            logger.info("Redis disconnected")
        except Exception as exc:
            logger.warning("Error closing Redis: %s", exc)
        finally:
            redis_client = None


async def get_redis() -> Optional[Redis]:
    return redis_client


def _cleanup_in_memory_queue() -> None:
    now = time.time()
    timeout = settings.MATCH_TIMEOUT_SECONDS

    expired_user_ids = [
        user_id
        for user_id, item in in_memory_cache["match_queue"].items()
        if now - item["joined_at"] > timeout
    ]

    for user_id in expired_user_ids:
        in_memory_cache["match_queue"].pop(user_id, None)


async def _cleanup_redis_queue(redis: Redis) -> None:
    stale_before = time.time() - settings.MATCH_TIMEOUT_SECONDS
    try:
        await redis.zremrangebyscore(QUEUE_ZSET_KEY, 0, stale_before)
    except Exception as exc:
        logger.error("Redis cleanup error: %s", exc)


async def _get_user_preferences(user_id: str, redis: Optional[Redis]) -> Dict:
    if redis:
        try:
            raw = await redis.get(f"{QUEUE_PREF_KEY_PREFIX}{user_id}")
            if not raw:
                return {}
            return json.loads(raw)
        except Exception as exc:
            logger.error("Redis preference read error: %s", exc)
            return {}

    return in_memory_cache["match_queue"].get(user_id, {}).get("preferences", {})


async def add_to_queue(user_id: str, preferences: Optional[Dict] = None) -> None:
    """Add user to matchmaking queue."""
    joined_at = time.time()
    payload = preferences or {}
    redis = await get_redis()

    if redis:
        try:
            pipe = redis.pipeline()
            pipe.zadd(QUEUE_ZSET_KEY, {user_id: joined_at})
            pipe.setex(
                f"{QUEUE_PREF_KEY_PREFIX}{user_id}",
                settings.MATCH_TIMEOUT_SECONDS,
                json.dumps(payload),
            )
            await pipe.execute()
            return
        except Exception as exc:
            logger.error("Redis error adding queue item: %s", exc)

    in_memory_cache["match_queue"][user_id] = {
        "joined_at": joined_at,
        "preferences": payload,
    }


async def remove_from_queue(user_id: str) -> None:
    """Remove user from matchmaking queue."""
    redis = await get_redis()

    if redis:
        try:
            pipe = redis.pipeline()
            pipe.zrem(QUEUE_ZSET_KEY, user_id)
            pipe.delete(f"{QUEUE_PREF_KEY_PREFIX}{user_id}")
            await pipe.execute()
        except Exception as exc:
            logger.error("Redis error removing queue item: %s", exc)

    in_memory_cache["match_queue"].pop(user_id, None)


async def get_queue_position(user_id: str) -> int:
    """Get user's queue position (1-based)."""
    redis = await get_redis()

    if redis:
        try:
            await _cleanup_redis_queue(redis)
            rank = await redis.zrank(QUEUE_ZSET_KEY, user_id)
            return -1 if rank is None else int(rank) + 1
        except Exception as exc:
            logger.error("Redis error getting queue position: %s", exc)

    _cleanup_in_memory_queue()
    for index, queued_user_id in enumerate(in_memory_cache["match_queue"].keys(), start=1):
        if queued_user_id == user_id:
            return index

    return -1


async def is_user_in_queue(user_id: str) -> bool:
    redis = await get_redis()

    if redis:
        try:
            await _cleanup_redis_queue(redis)
            return await redis.zscore(QUEUE_ZSET_KEY, user_id) is not None
        except Exception as exc:
            logger.error("Redis error checking queue membership: %s", exc)

    _cleanup_in_memory_queue()
    return user_id in in_memory_cache["match_queue"]


async def find_match(
    user_id: str,
    session: AsyncSession,
    preferences: Optional[Dict] = None,
) -> Optional[str]:
    """Find a compatible user from queue and return matched user_id."""
    redis = await get_redis()

    if redis:
        try:
            await _cleanup_redis_queue(redis)
            candidate_ids = await redis.zrange(QUEUE_ZSET_KEY, 0, -1)
        except Exception as exc:
            logger.error("Redis error in find_match: %s", exc)
            _cleanup_in_memory_queue()
            candidate_ids = list(in_memory_cache["match_queue"].keys())
    else:
        _cleanup_in_memory_queue()
        candidate_ids = list(in_memory_cache["match_queue"].keys())

    logger.debug("find_match queue size=%s user=%s", len(candidate_ids), user_id)

    for candidate_id in candidate_ids:
        if candidate_id == user_id:
            continue

        if await is_blocked(user_id, candidate_id, session):
            continue

        # Requesting user's filters must match candidate
        if preferences and not await check_preferences(candidate_id, preferences, session):
            continue

        # Candidate user's own filters should also match requester
        candidate_preferences = await _get_user_preferences(candidate_id, redis)
        if candidate_preferences and not await check_preferences(user_id, candidate_preferences, session):
            continue

        await remove_from_queue(user_id)
        await remove_from_queue(candidate_id)
        logger.info("Match found: %s <-> %s", user_id, candidate_id)
        return candidate_id

    return None


async def is_blocked(user_id_1: str, user_id_2: str, session: AsyncSession) -> bool:
    """Check if users have blocked each other."""
    from ..models import BlockedUser

    stmt = select(BlockedUser).where(
        (
            (BlockedUser.blocker_user_id == user_id_1)
            & (BlockedUser.blocked_user_id == user_id_2)
        )
        |
        (
            (BlockedUser.blocker_user_id == user_id_2)
            & (BlockedUser.blocked_user_id == user_id_1)
        )
    )

    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def check_preferences(user_id: str, preferences: Dict, session: AsyncSession) -> bool:
    """Check whether target user satisfies filters."""
    if not preferences:
        return True

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        return False

    gender_pref = preferences.get("gender_preference")
    if gender_pref and user.gender != gender_pref:
        return False

    age_min = preferences.get("age_min")
    if age_min is not None and user.age is not None and user.age < int(age_min):
        return False

    age_max = preferences.get("age_max")
    if age_max is not None and user.age is not None and user.age > int(age_max):
        return False

    country_pref = preferences.get("country_preference")
    if country_pref and user.country != country_pref:
        return False

    return True


async def store_match(caller_id: str, callee_id: str, db: AsyncSession) -> ChatSession:
    """Create chat session for matched users."""
    chat_session = ChatSession(
        user_id_1=caller_id,
        user_id_2=callee_id,
        status="active",
        started_at=datetime.utcnow(),
    )

    db.add(chat_session)
    await db.commit()
    await db.refresh(chat_session)

    logger.info(
        "[STORE MATCH] session=%s caller=%s callee=%s",
        chat_session.id,
        caller_id,
        callee_id,
    )
    return chat_session


async def rate_limit_check(user_id: str) -> bool:
    """Rate-limit matchmaking attempts per user per hour."""
    key = f"{RATE_LIMIT_KEY_PREFIX}{user_id}"
    redis = await get_redis()

    if redis:
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, 3600)
            return count <= settings.MAX_MATCHES_PER_HOUR
        except Exception as exc:
            logger.error("Redis rate limit error: %s", exc)

    cache_entry = in_memory_cache["rate_limits"].get(key)
    now = datetime.utcnow()

    if not cache_entry or cache_entry["expires_at"] <= now:
        in_memory_cache["rate_limits"][key] = {
            "count": 1,
            "expires_at": now + timedelta(hours=1),
        }
    else:
        cache_entry["count"] += 1

    return in_memory_cache["rate_limits"][key]["count"] <= settings.MAX_MATCHES_PER_HOUR

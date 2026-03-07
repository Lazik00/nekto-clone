import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import User

logger = logging.getLogger(__name__)

HASH_ALGORITHM = "pbkdf2_sha256"
LEGACY_HASH_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 390_000
SALT_LENGTH = 16


def get_password_hash(password: str) -> str:
    """Hash password with PBKDF2-HMAC-SHA256.

    Format: pbkdf2_sha256$iterations$salt_hex$hash_hex
    """
    if not password:
        raise ValueError("Password cannot be empty")

    salt = secrets.token_bytes(SALT_LENGTH)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return f"{HASH_ALGORITHM}${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_legacy_hash(plain_password: str, hashed_password: str) -> bool:
    """Backward compatibility with legacy format: sha256$salt$hash."""
    try:
        algorithm, salt_hex, stored_hash = hashed_password.split("$", 2)
        if algorithm != LEGACY_HASH_ALGORITHM:
            return False

        candidate_hash = hashlib.sha256((salt_hex + plain_password).encode("utf-8")).hexdigest()
        return secrets.compare_digest(candidate_hash, stored_hash)
    except (ValueError, AttributeError):
        return False


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against supported hash formats."""
    if not plain_password or not hashed_password:
        return False

    try:
        if hashed_password.startswith(f"{HASH_ALGORITHM}$"):
            algorithm, iterations_raw, salt_hex, stored_hash = hashed_password.split("$", 3)
            if algorithm != HASH_ALGORITHM:
                return False

            iterations = int(iterations_raw)
            salt = bytes.fromhex(salt_hex)
            digest = hashlib.pbkdf2_hmac(
                "sha256",
                plain_password.encode("utf-8"),
                salt,
                iterations,
            ).hex()
            return secrets.compare_digest(digest, stored_hash)

        return _verify_legacy_hash(plain_password, hashed_password)
    except (ValueError, TypeError) as exc:
        logger.warning("Password verification error: %s", exc)
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token."""
    if not data or "sub" not in data:
        raise ValueError("Token data must include 'sub' (user_id)")

    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )

    to_encode.update({"exp": expire, "type": "access"})

    return jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token(data: dict) -> str:
    """Create JWT refresh token."""
    if not data or "sub" not in data:
        raise ValueError("Token data must include 'sub' (user_id)")

    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})

    return jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def verify_token(token: str, token_type: str = "access") -> Optional[dict]:
    """Verify JWT token and return payload."""
    try:
        if not token:
            return None

        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )

        if payload.get("type") != token_type:
            logger.warning(
                "Token type mismatch: expected %s, got %s",
                token_type,
                payload.get("type"),
            )
            return None

        user_id: str = payload.get("sub")
        if not user_id:
            logger.warning("Token missing 'sub' claim")
            return None

        return payload
    except JWTError as exc:
        logger.debug("Token verification failed: %s", exc)
        return None
    except Exception as exc:  # pragma: no cover
        logger.error("Unexpected error in token verification: %s", exc)
        return None


async def get_current_user(token: str, session: AsyncSession) -> Optional[User]:
    """Get current user from JWT token."""
    payload = verify_token(token, token_type="access")
    if payload is None:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    try:
        stmt = select(User).where(User.id == user_id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if user is None:
            logger.warning("User not found: %s", user_id)
            return None

        if user.is_banned:
            logger.warning("Banned user attempting to authenticate: %s", user_id)
            return None

        return user
    except Exception as exc:
        logger.error("Error fetching user %s: %s", user_id, exc)
        return None


async def authenticate_user(email: str, password: str, session: AsyncSession) -> Optional[User]:
    """Authenticate user with email and password."""
    try:
        if not email or not password:
            return None

        stmt = select(User).where(User.email == email)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if user is None:
            logger.info("Login attempt with non-existent email: %s", email)
            return None

        if not verify_password(password, user.password_hash):
            logger.info("Failed login attempt for user: %s", email)
            return None

        if user.is_banned:
            logger.warning("Attempt to login as banned user: %s", email)
            return None

        return user
    except Exception as exc:
        logger.error("Authentication error for %s: %s", email, exc)
        return None

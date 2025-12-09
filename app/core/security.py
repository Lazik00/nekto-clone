import logging
from typing import Optional
from datetime import datetime, timedelta
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import hashlib
import secrets

from ..config import settings
from ..models import User

# Logging
logger = logging.getLogger(__name__)

# Password hashing constants
HASH_ALGORITHM = "sha256"
SALT_LENGTH = 32


def get_password_hash(password: str) -> str:
    """
    Hash a password with SHA256 + salt
    Format: algorithm$salt$hash
    """
    if not password:
        raise ValueError("Password cannot be empty")

    salt = secrets.token_hex(SALT_LENGTH // 2)  # Generate random salt
    hash_obj = hashlib.sha256((salt + password).encode())
    password_hash = hash_obj.hexdigest()
    return f"{HASH_ALGORITHM}${salt}${password_hash}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify password against hash
    Expected format: algorithm$salt$hash
    """
    try:
        if not plain_password or not hashed_password:
            return False

        algorithm, salt, stored_hash = hashed_password.split('$', 2)

        if algorithm != HASH_ALGORITHM:
            logger.warning(f"Invalid hash algorithm: {algorithm}")
            return False

        # Recalculate hash with same salt
        hash_obj = hashlib.sha256((salt + plain_password).encode())
        calculated_hash = hash_obj.hexdigest()

        # Constant-time comparison
        return secrets.compare_digest(calculated_hash, stored_hash)
    except (ValueError, AttributeError) as e:
        logger.warning(f"Password verification error: {str(e)}")
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token"""
    if not data or "sub" not in data:
        raise ValueError("Token data must include 'sub' (user_id)")

    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)

    to_encode.update({"exp": expire, "type": "access"})

    try:
        encoded_jwt = jwt.encode(
            to_encode,
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM
        )
        return encoded_jwt
    except Exception as e:
        logger.error(f"Token creation error: {str(e)}")
        raise


def create_refresh_token(data: dict) -> str:
    """Create JWT refresh token"""
    if not data or "sub" not in data:
        raise ValueError("Token data must include 'sub' (user_id)")

    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)

    to_encode.update({"exp": expire, "type": "refresh"})

    try:
        encoded_jwt = jwt.encode(
            to_encode,
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM
        )
        return encoded_jwt
    except Exception as e:
        logger.error(f"Refresh token creation error: {str(e)}")
        raise


def verify_token(token: str, token_type: str = "access") -> Optional[dict]:
    """Verify JWT token and return payload"""
    try:
        if not token:
            return None

        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )

        # Verify token type
        if payload.get("type") != token_type:
            logger.warning(f"Token type mismatch: expected {token_type}, got {payload.get('type')}")
            return None

        # Verify sub (user_id) exists
        user_id: str = payload.get("sub")
        if not user_id:
            logger.warning("Token missing 'sub' claim")
            return None

        return payload
    except JWTError as e:
        logger.debug(f"Token verification failed: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error in token verification: {str(e)}")
        return None


async def get_current_user(
    token: str,
    session: AsyncSession
) -> Optional[User]:
    """Get current user from JWT token"""
    payload = verify_token(token, token_type="access")

    if payload is None:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    try:
        # Get user from database
        stmt = select(User).where(User.id == user_id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if user is None:
            logger.warning(f"User not found: {user_id}")
            return None

        if user.is_banned:
            logger.warning(f"Banned user attempting to authenticate: {user_id}")
            return None

        return user
    except Exception as e:
        logger.error(f"Error fetching user {user_id}: {str(e)}")
        return None


async def authenticate_user(
    email: str,
    password: str,
    session: AsyncSession
) -> Optional[User]:
    """Authenticate user with email and password"""
    try:
        if not email or not password:
            return None

        stmt = select(User).where(User.email == email)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if user is None:
            logger.info(f"Login attempt with non-existent email: {email}")
            return None

        if not verify_password(password, user.password_hash):
            logger.info(f"Failed login attempt for user: {email}")
            return None

        if user.is_banned:
            logger.warning(f"Attempt to login as banned user: {email}")
            return None

        logger.info(f"User authenticated successfully: {email}")
        return user
    except Exception as e:
        logger.error(f"Authentication error for {email}: {str(e)}")
        return None


from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from .db import get_db
from .core.security import verify_token, get_current_user
from .models import User

logger = logging.getLogger(__name__)

# Security scheme for Swagger
security = HTTPBearer(description="JWT Bearer token")


async def get_user_from_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_db),
) -> User:
    """Extract user from JWT token - REQUIRED"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing credentials",
        )

    token = credentials.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token",
        )

    user = await get_current_user(token, session)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if user.is_banned:
        logger.warning(f"Banned user attempt: {user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is banned",
        )

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    session: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Get user from token if provided, otherwise None - OPTIONAL"""
    if not credentials:
        return None

    token = credentials.credentials
    if not token:
        return None

    user = await get_current_user(token, session)

    if user and not user.is_banned:
        return user

    return None


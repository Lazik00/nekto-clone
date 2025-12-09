from fastapi import APIRouter, HTTPException, status, Depends, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import timedelta
import logging

from app.db import get_db
from app.deps import get_user_from_token
from app.models import User
from app.schemas.auth import (
    UserRegister, UserLogin, UserResponse, TokenResponse,
    PasswordChangeRequest, UserUpdate, UserProfileResponse
)
from app.core.security import (
    get_password_hash, authenticate_user, create_access_token,
    create_refresh_token, verify_password, verify_token
)
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserRegister,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Register a new user"""

    # Validate input
    if not user_data.email or not user_data.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password are required",
        )

    # Check if email already exists
    if user_data.email:
        stmt = select(User).where(User.email == user_data.email)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

    # Check if username already exists
    if user_data.username:
        stmt = select(User).where(User.username == user_data.username)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken",
            )

    # Create new user
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        display_name=user_data.display_name or user_data.username,
        bio=user_data.bio,
        age=user_data.age,
        gender=user_data.gender,
        country=user_data.country,
    )

    session.add(new_user)
    await session.commit()
    await session.refresh(new_user)

    logger.info(f"New user registered: {new_user.id} ({new_user.email})")

    # Create tokens
    access_token = create_access_token(data={"sub": new_user.id})
    refresh_token = create_refresh_token(data={"sub": new_user.id})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
    }


@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Login user with email and password"""

    # Validate input
    if not credentials.email or not credentials.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password are required",
        )

    user = await authenticate_user(credentials.email, credentials.password, session)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Create tokens
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})

    logger.info(f"User logged in: {user.id} ({user.email})")

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
    }


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_token: str = Body(..., embed=True),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Refresh access token using refresh token"""

    # Validate input
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refresh token is required",
        )

    payload = verify_token(refresh_token, token_type="refresh")

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or banned",
        )

    # Create new tokens
    access_token = create_access_token(data={"sub": user.id})
    new_refresh_token = create_refresh_token(data={"sub": user.id})

    logger.info(f"Token refreshed for user: {user.id}")

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
    }


@router.get("/me", response_model=UserProfileResponse, dependencies=[Depends(get_user_from_token)])
async def get_me(
    current_user: User = Depends(get_user_from_token),
) -> User:
    """Get current user profile"""
    return current_user


@router.put("/me", response_model=UserResponse, dependencies=[Depends(get_user_from_token)])
async def update_profile(
    update_data: UserUpdate,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> User:
    """Update current user profile"""

    # Update fields - only non-null values
    if update_data.display_name:
        current_user.display_name = update_data.display_name

    if update_data.bio is not None:
        current_user.bio = update_data.bio

    if update_data.age:
        current_user.age = update_data.age

    if update_data.gender:
        current_user.gender = update_data.gender

    if update_data.country:
        current_user.country = update_data.country

    if update_data.avatar_url:
        current_user.avatar_url = update_data.avatar_url

    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)

    logger.info(f"User profile updated: {current_user.id}")

    return current_user


@router.post("/change-password", dependencies=[Depends(get_user_from_token)])
async def change_password(
    request: PasswordChangeRequest,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Change user password"""

    # Validate input
    if not request.current_password or not request.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current and new passwords are required",
        )

    # Verify current password
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Update password
    current_user.password_hash = get_password_hash(request.new_password)
    session.add(current_user)
    await session.commit()

    logger.info(f"User password changed: {current_user.id}")

    return {"message": "Password changed successfully"}


@router.get("/user/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    session: AsyncSession = Depends(get_db),
) -> User:
    """Get user by ID (public endpoint)"""

    # Validate input
    if not user_id or len(user_id.strip()) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User ID is required",
        )

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


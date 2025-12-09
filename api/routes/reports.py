from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
import logging

from app.db import get_db
from app.deps import get_user_from_token
from app.models import User, Report, ReportStatusEnum, ReportReasonEnum, ChatSession, BlockedUser

logger = logging.getLogger(__name__)

router = APIRouter()


class ReportCreate(BaseModel):
    reported_user_id: str
    reason: str = Field(..., pattern="^(harassment|hate_speech|explicit_content|spam|inappropriate_behavior|other)$")
    description: str = Field(None, max_length=1000)
    chat_session_id: str = None


class ReportResponse(BaseModel):
    id: str
    reason: str
    status: str
    created_at: str

    class Config:
        from_attributes = True


@router.post("/create", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    report_data: ReportCreate,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Create a report against a user"""

    # Cannot report yourself
    if report_data.reported_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot report yourself",
        )

    # Verify reported user exists
    stmt = select(User).where(User.id == report_data.reported_user_id)
    result = await session.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # If session_id provided, verify it exists and user is involved
    if report_data.chat_session_id:
        stmt = select(ChatSession).where(ChatSession.id == report_data.chat_session_id)
        result = await session.execute(stmt)
        chat_session = result.scalar_one_or_none()

        if not chat_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat session not found",
            )

        if current_user.id not in [chat_session.user_id_1, chat_session.user_id_2]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to report this session",
            )

    # Create report
    report = Report(
        reporter_id=current_user.id,
        reported_user_id=report_data.reported_user_id,
        reason=report_data.reason,
        description=report_data.description,
        chat_session_id=report_data.chat_session_id,
        status=ReportStatusEnum.PENDING,
    )

    # Automatically block the reported user
    existing_block = await session.execute(
        select(BlockedUser).where(
            (BlockedUser.blocker_user_id == current_user.id) &
            (BlockedUser.blocked_user_id == report_data.reported_user_id)
        )
    )

    if not existing_block.scalar_one_or_none():
        block = BlockedUser(
            blocker_user_id=current_user.id,
            blocked_user_id=report_data.reported_user_id,
            reason=f"Reported for: {report_data.reason}",
        )
        session.add(block)
        current_user.blocked_users_count += 1

    session.add(report)
    session.add(current_user)
    await session.commit()

    logger.info(f"Report created: {report.id} by {current_user.id} against {report_data.reported_user_id}")

    return {
        "id": report.id,
        "reason": report.reason,
        "status": report.status,
        "created_at": report.created_at.isoformat(),
    }


@router.get("/my-reports")
async def get_my_reports(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get reports created by current user"""

    stmt = select(Report).where(Report.reporter_id == current_user.id).order_by(Report.created_at.desc())
    result = await session.execute(stmt)
    reports = result.scalars().all()

    return {
        "reports": [
            {
                "id": r.id,
                "reported_user_id": r.reported_user_id,
                "reason": r.reason,
                "status": r.status,
                "created_at": r.created_at.isoformat(),
            }
            for r in reports
        ],
    }


@router.get("/pending")
async def get_pending_reports(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get pending reports against current user (for notification purposes)"""

    stmt = select(Report).where(
        (Report.reported_user_id == current_user.id) &
        (Report.status == ReportStatusEnum.PENDING)
    )
    result = await session.execute(stmt)
    reports = result.scalars().all()

    return {
        "pending_reports_count": len(reports),
        "reports": [
            {
                "id": r.id,
                "reason": r.reason,
                "created_at": r.created_at.isoformat(),
            }
            for r in reports
        ],
    }


@router.get("/{report_id}")
async def get_report(
    report_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get report details (only for reporter or admins)"""

    stmt = select(Report).where(Report.id == report_id)
    result = await session.execute(stmt)
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    if report.reporter_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this report",
        )

    return {
        "id": report.id,
        "reporter_id": report.reporter_id,
        "reported_user_id": report.reported_user_id,
        "reason": report.reason,
        "description": report.description,
        "status": report.status,
        "action_taken": report.action_taken,
        "created_at": report.created_at.isoformat(),
        "resolved_at": report.resolved_at.isoformat() if report.resolved_at else None,
    }


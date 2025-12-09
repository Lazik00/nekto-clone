from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Index, Enum, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from ..db import Base


class ReportStatusEnum(str, enum.Enum):
    PENDING = "pending"
    REVIEWING = "reviewing"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ReportReasonEnum(str, enum.Enum):
    HARASSMENT = "harassment"
    HATE_SPEECH = "hate_speech"
    EXPLICIT_CONTENT = "explicit_content"
    SPAM = "spam"
    INAPPROPRIATE_BEHAVIOR = "inappropriate_behavior"
    OTHER = "other"


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        Index("idx_report_status", "status"),
        Index("idx_report_reporter", "reporter_id"),
        Index("idx_report_created", "created_at"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Report details
    reason = Column(String(50), default=ReportReasonEnum.OTHER)
    description = Column(Text, nullable=True)
    status = Column(String(20), default=ReportStatusEnum.PENDING)

    # References
    reporter_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    reported_user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    chat_session_id = Column(String(36), ForeignKey("chat_sessions.id"), nullable=True)

    # Actions
    action_taken = Column(String(100), nullable=True)  # ban, warn, dismiss
    admin_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    resolved_at = Column(DateTime, nullable=True)

    # Relationships
    reporter = relationship("User", back_populates="reports_made", foreign_keys=[reporter_id])
    reported_user = relationship("User", foreign_keys=[reported_user_id])
    chat_session = relationship("ChatSession", back_populates="reports")

    def __repr__(self) -> str:
        return f"<Report {self.id} - {self.reason}>"



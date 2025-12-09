from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Index, Enum, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from ..db import Base


class ChatSessionStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    ENDED = "ended"
    REPORTED = "reported"


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("idx_session_status", "status"),
        Index("idx_session_started", "started_at"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Users involved
    user_id_1 = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    user_id_2 = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    # Status
    status = Column(String(20), default=ChatSessionStatusEnum.ACTIVE)
    is_reported = Column(Boolean, default=False)

    # Duration
    started_at = Column(DateTime, default=func.now())
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, default=0)

    # Connection info
    user1_socket_id = Column(String(100), nullable=True)
    user2_socket_id = Column(String(100), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    user1 = relationship("User", back_populates="chat_sessions", foreign_keys=[user_id_1])
    user2 = relationship("User", foreign_keys=[user_id_2])
    messages = relationship("Message", back_populates="chat_session", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="chat_session", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<ChatSession {self.id} between {self.user_id_1} and {self.user_id_2}>"


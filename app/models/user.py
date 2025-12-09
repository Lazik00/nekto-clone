from sqlalchemy import Column, String, Integer, DateTime, Boolean, Enum, Float, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from ..db import Base


class UserStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    BANNED = "banned"
    INACTIVE = "inactive"
    ONLINE = "online"
    OFFLINE = "offline"
    IN_CHAT = "in_chat"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("idx_user_status", "status"),)

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, nullable=True, index=True)
    email = Column(String(100), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=True)

    # Profile info
    display_name = Column(String(100), nullable=True)
    avatar_url = Column(String(255), nullable=True)
    bio = Column(String(500), nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String(20), nullable=True)  # male, female, other
    country = Column(String(100), nullable=True)

    # Status
    status = Column(String(20), default=UserStatusEnum.OFFLINE)
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(String(500), nullable=True)
    ban_until = Column(DateTime, nullable=True)

    # Stats
    total_matches = Column(Integer, default=0)
    blocked_users_count = Column(Integer, default=0)
    reports_count = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    last_online = Column(DateTime, default=func.now())

    # Relationships
    chat_sessions = relationship("ChatSession", back_populates="user1", foreign_keys="ChatSession.user_id_1")
    messages_sent = relationship("Message", back_populates="sender", foreign_keys="Message.sender_id")
    reports_made = relationship("Report", back_populates="reporter", foreign_keys="Report.reporter_id")
    blocked_by = relationship("BlockedUser", back_populates="blocked_user", foreign_keys="BlockedUser.blocked_user_id")
    blocking = relationship("BlockedUser", back_populates="blocker", foreign_keys="BlockedUser.blocker_user_id")

    def __repr__(self) -> str:
        return f"<User {self.username or self.id}>"


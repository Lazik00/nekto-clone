from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import uuid

from ..db import Base


class BlockedUser(Base):
    __tablename__ = "blocked_users"
    __table_args__ = (
        Index("idx_blocked_user_blocker", "blocker_user_id"),
        Index("idx_blocked_user_blocked", "blocked_user_id"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Users
    blocker_user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    blocked_user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    # Reason
    reason = Column(String(500), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    blocker = relationship("User", back_populates="blocking", foreign_keys=[blocker_user_id])
    blocked_user = relationship("User", back_populates="blocked_by", foreign_keys=[blocked_user_id])

    def __repr__(self) -> str:
        return f"<BlockedUser {self.blocker_user_id} blocked {self.blocked_user_id}>"


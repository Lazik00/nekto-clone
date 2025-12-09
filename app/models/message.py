from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import uuid

from ..db import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_message_session", "chat_session_id"),
        Index("idx_message_sender", "sender_id"),
        Index("idx_message_created", "created_at"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Message content
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")  # text, image, video, file

    # References
    chat_session_id = Column(String(36), ForeignKey("chat_sessions.id"), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    # Media
    media_url = Column(String(255), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    chat_session = relationship("ChatSession", back_populates="messages")
    sender = relationship("User", back_populates="messages_sent", foreign_keys=[sender_id])

    def __repr__(self) -> str:
        return f"<Message {self.id} in {self.chat_session_id}>"


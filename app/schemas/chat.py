from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class MessageCreate(BaseModel):
    content: str = Field(..., max_length=5000)
    message_type: str = Field("text", pattern="^(text|image|video|file)$")
    media_url: Optional[str] = None


class MessageResponse(BaseModel):
    id: str
    content: str
    message_type: str
    sender_id: str
    chat_session_id: str
    media_url: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class WebRTCSignal(BaseModel):
    type: str = Field(..., pattern="^(offer|answer|candidate)$")
    data: dict


class ICECandidate(BaseModel):
    candidate: str
    sdpMLineIndex: int
    sdpMid: Optional[str] = None


class ChatSessionInfo(BaseModel):
    session_id: str
    user_id: str
    opponent_id: str
    opponent_info: dict
    started_at: datetime
    duration_seconds: int

    class Config:
        from_attributes = True


class EndSession(BaseModel):
    reason: Optional[str] = None
    feedback: Optional[str] = None


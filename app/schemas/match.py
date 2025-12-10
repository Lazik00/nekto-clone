from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class MatchRequest(BaseModel):
    preferences: Optional[dict] = Field(None, description="Matching preferences")
    gender_preference: Optional[str] = None
    age_min: Optional[int] = Field(None, ge=13)
    age_max: Optional[int] = Field(None, le=120)
    country_preference: Optional[str] = None


class MatchResponse(BaseModel):
    match_id: str
    user_id: str
    display_name: Optional[str]
    age: Optional[int]
    gender: Optional[str]
    country: Optional[str]
    avatar_url: Optional[str]
    bio: Optional[str]

    class Config:
        from_attributes = True


class ChatSessionStart(BaseModel):
    match_id: str


class QueueStatus(BaseModel):
    position: int
    wait_time_seconds: int
    estimated_match_in: int


class StopMatchmaking(BaseModel):
    reason: Optional[str] = None


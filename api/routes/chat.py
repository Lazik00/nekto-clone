from fastapi import APIRouter, HTTPException, status, Depends, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import logging
from typing import Dict, Set

from app.db import get_db, async_session
from app.deps import get_user_from_token
from app.models import User, ChatSession, Message

from app.config import settings
from app.core.security import verify_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Store active WebSocket connections
active_connections: Dict[str, WebSocket] = {}
session_connections: Dict[str, Set[str]] = {}  # session_id -> set of user_ids


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.session_connections: Dict[str, Set[str]] = {}

    async def connect(self, user_id: str, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

        if session_id not in self.session_connections:
            self.session_connections[session_id] = set()

        self.session_connections[session_id].add(user_id)
        logger.info(f"User {user_id} connected to session {session_id}")

    async def disconnect(self, user_id: str, session_id: str):
        self.active_connections.pop(user_id, None)

        if session_id in self.session_connections:
            self.session_connections[session_id].discard(user_id)
            if not self.session_connections[session_id]:
                del self.session_connections[session_id]

        logger.info(f"User {user_id} disconnected from {session_id}")

    async def broadcast(self, session_id: str, message: dict, exclude: str = None):
        users = self.session_connections.get(session_id, set())

        for uid in users:
            if uid == exclude:
                continue
            ws = self.active_connections.get(uid)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception as e:
                    logger.error(f"WS send error → {uid}: {e}")


manager = ConnectionManager()


@router.websocket("/ws/{session_id}")
async def ws_handler(websocket: WebSocket, session_id: str, token: str = Query(...)):
    user_id = None

    try:
        # 1) TOKEN VERIFY
        payload = verify_token(token, token_type="access")
        if not payload:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

        user_id = payload.get("sub")

        # 2) DB VALIDATION (ONE TIME ONLY)
        async with async_session() as db:
            stmt = select(User).where(User.id == user_id)
            user = (await db.execute(stmt)).scalar_one_or_none()

            if not user or user.is_banned:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User banned")
                return

            stmt = select(ChatSession).where(ChatSession.id == session_id)
            chat = (await db.execute(stmt)).scalar_one_or_none()

            if not chat:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session not found")
                return

            # extract primitive values ONLY
            user1 = chat.user_id_1
            user2 = chat.user_id_2

            # user join rules
            if user_id not in [user1, user2]:
                if user2 is None and user_id != user1:
                    chat.user_id_2 = user_id
                    await db.commit()
                    user2 = user_id
                else:
                    await websocket.close(code=1008, reason="Not allowed in session")
                    return

        # 3) CONNECT WEBSOCKET
        await manager.connect(user_id, session_id, websocket)

        # Determine opponent (safe, primitive)
        opponent_id = user2 if user_id == user1 else user1

        # Notify opponent
        if opponent_id:
            await manager.broadcast(
                session_id,
                {"type": "user_connected", "user_id": user_id},
                exclude=user_id
            )

        # SEND STUN/TURN CONFIG
        await manager.send_to_user(user_id, {
            "type": "stun_turn",
            "stun": settings.STUN_SERVER,
            "turn": settings.TURN_SERVER,
            "turn_username": settings.TURN_USERNAME,
            "turn_password": settings.TURN_PASSWORD,
        })

        # 4) MAIN LOOP
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            mtype = msg.get("type")

            # TEXT CHAT
            if mtype in ["chat_message", "message"]:
                async with async_session() as db:
                    new_msg = Message(
                        chat_session_id=session_id,
                        sender_id=user_id,
                        content=msg.get("content", ""),
                        message_type="text",
                    )
                    db.add(new_msg)
                    await db.commit()
                    await db.refresh(new_msg)

                await manager.broadcast(session_id, {
                    "type": "chat_message",
                    "sender_id": user_id,
                    "content": new_msg.content,
                    "timestamp": new_msg.created_at.isoformat()
                })

            # WebRTC SIGNALING
            elif mtype in ["signal", "offer", "answer", "candidate"]:
                await manager.broadcast(session_id, {
                    "type": "webrtc_signal",
                    "signal_type": msg.get("signal_type", mtype),
                    "data": msg.get("data", msg.get("signal")),
                    "sender_id": user_id,
                }, exclude=user_id)

            # END SESSION
            elif mtype == "end_session":
                async with async_session() as db:
                    stmt = select(ChatSession).where(ChatSession.id == session_id)
                    sess = (await db.execute(stmt)).scalar_one_or_none()
                    if sess:
                        sess.status = "ended"
                        await db.commit()

                await manager.broadcast(session_id, {
                    "type": "session_ended",
                    "reason": msg.get("reason")
                })
                break

    except WebSocketDisconnect:
        await manager.disconnect(user_id, session_id)
        await manager.broadcast(session_id, {"type": "user_disconnected", "user_id": user_id})

    except Exception as e:
        logger.error(f"WS ERROR: {e}")
        await manager.disconnect(user_id, session_id)
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass


@router.get("/history/{session_id}", dependencies=[Depends(get_user_from_token)])
async def get_chat_history(
    session_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get chat history for a session"""

    # Verify user is part of this session
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await session.execute(stmt)
    chat_session = result.scalar_one_or_none()

    if not chat_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    if current_user.id not in [chat_session.user_id_1, chat_session.user_id_2]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this chat",
        )

    # Get messages
    stmt = select(Message).where(Message.chat_session_id == session_id).order_by(Message.created_at)
    result = await session.execute(stmt)
    messages = result.scalars().all()

    return {
        "session_id": session_id,
        "messages": [
            {
                "id": msg.id,
                "sender_id": msg.sender_id,
                "content": msg.content,
                "message_type": msg.message_type,
                "created_at": msg.created_at,
            }
            for msg in messages
        ],
    }


@router.get("/sessions", dependencies=[Depends(get_user_from_token)])
async def get_user_sessions(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get all chat sessions for current user"""

    stmt = select(ChatSession).where(
        (ChatSession.user_id_1 == current_user.id) |
        (ChatSession.user_id_2 == current_user.id)
    ).order_by(ChatSession.created_at.desc())

    result = await session.execute(stmt)
    sessions = result.scalars().all()

    sessions_data = []
    for sess in sessions:
        opponent_id = sess.user_id_2 if current_user.id == sess.user_id_1 else sess.user_id_1

        # Get opponent info
        opponent_stmt = select(User).where(User.id == opponent_id)
        opponent_result = await session.execute(opponent_stmt)
        opponent = opponent_result.scalar_one_or_none()

        sessions_data.append({
            "session_id": sess.id,
            "opponent": {
                "id": opponent.id,
                "display_name": opponent.display_name,
                "avatar_url": opponent.avatar_url,
            } if opponent else None,
            "started_at": sess.started_at,
            "ended_at": sess.ended_at,
            "status": sess.status,
        })

    return {"sessions": sessions_data}


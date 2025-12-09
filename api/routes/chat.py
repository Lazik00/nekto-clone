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
        if user_id in self.active_connections:
            del self.active_connections[user_id]

        if session_id in self.session_connections:
            self.session_connections[session_id].discard(user_id)
            if not self.session_connections[session_id]:
                del self.session_connections[session_id]

        logger.info(f"User {user_id} disconnected from session {session_id}")

    async def broadcast_to_session(self, session_id: str, message: dict, exclude_user: str = None):
        if session_id not in self.session_connections:
            return

        for user_id in self.session_connections[session_id]:
            if exclude_user and user_id == exclude_user:
                continue

            if user_id in self.active_connections:
                try:
                    await self.active_connections[user_id].send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message to {user_id}: {str(e)}")

    async def send_to_user(self, user_id: str, message: dict):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to {user_id}: {str(e)}")


manager = ConnectionManager()


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    """WebSocket endpoint for real-time chat and WebRTC signaling"""
    user_id = None
    chat_session = None

    try:
        # Verify token BEFORE accepting websocket connection
        logger.debug(f"Validating WebSocket connection for session {session_id}")
        payload = verify_token(token, token_type="access")

        if not payload:
            logger.error(f"Token verification failed for session {session_id}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

        user_id = payload.get("sub")
        if not user_id:
            logger.error(f"No user ID in token for session {session_id}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="No user ID in token")
            return

        # Verify user and session in database
        async with async_session() as db_session:
            # Verify user exists and not banned
            stmt = select(User).where(User.id == user_id)
            result = await db_session.execute(stmt)
            user = result.scalar_one_or_none()

            if not user or user.is_banned:
                logger.error(f"User {user_id} banned or not found for session {session_id}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User banned or not found")
                return

            # Verify chat session exists
            stmt = select(ChatSession).where(ChatSession.id == session_id)
            result = await db_session.execute(stmt)
            chat_session = result.scalar_one_or_none()

            if not chat_session:
                logger.error(f"Session {session_id} not found")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session not found")
                return

            # Check if user is a participant or can become one
            is_participant = (chat_session.user_id_1 == user_id) or \
                             (chat_session.user_id_2 == user_id)
            can_join = not chat_session.user_id_2 and chat_session.user_id_1 != user_id

            if not is_participant and not can_join:
                logger.error(f"User {user_id} cannot join session {session_id} - not participant or full")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not a participant or session is full")
                return

            # If user_id_2 is not set, and the current user is not user_id_1, set it
            if can_join:
                chat_session.user_id_2 = user_id
                db_session.add(chat_session)
                await db_session.commit()
                await db_session.refresh(chat_session)
                logger.info(f"User {user_id} has been assigned as user_id_2 for session {session_id}")

        # ALL VALIDATION PASSED - Now accept WebSocket connection
        logger.info(f"WebSocket validation passed for user {user_id} session {session_id}")
        await manager.connect(user_id, session_id, websocket)

        # Get opponent info
        opponent_id = chat_session.user_id_2 if user_id == chat_session.user_id_1 else chat_session.user_id_1

        # Notify opponent that user is connected
        if opponent_id:
            await manager.broadcast_to_session(
                session_id,
                {"type": "user_connected", "user_id": user_id},
                exclude_user=user_id
            )

        # Send TURN/STUN servers info
        await manager.send_to_user(user_id, {
            "type": "stun_turn_servers",
            "stun_server": settings.STUN_SERVER,
            "turn_server": settings.TURN_SERVER,
            "turn_username": settings.TURN_USERNAME,
            "turn_password": settings.TURN_PASSWORD,
        })

        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            message_type = message_data.get("type")

            if message_type == "message" or message_type == "chat_message":
                # Store message in database
                async with async_session() as msg_session:
                    new_message = Message(
                        chat_session_id=session_id,
                        sender_id=user_id,
                        content=message_data.get("content", ""),
                        message_type="text",
                    )
                    msg_session.add(new_message)
                    await msg_session.commit()
                    await msg_session.refresh(new_message)

                # Broadcast to session
                await manager.broadcast_to_session(
                    session_id,
                    {
                        "type": "chat_message",
                        "sender_id": user_id,
                        "content": new_message.content,
                        "timestamp": new_message.created_at.isoformat(),
                    },
                )

            elif message_type == "signal" or message_type in ["offer", "answer", "candidate"]:
                # WebRTC signaling
                await manager.broadcast_to_session(
                    session_id,
                    {
                        "type": "webrtc_signal",
                        "signal_type": message_data.get("signal_type", message_type),
                        "data": message_data.get("data", message_data.get("signal")),
                        "sender_id": user_id,
                    },
                    exclude_user=user_id,
                )

            elif message_type == "end_session":
                # End chat session
                async with async_session() as db_session_end:
                    stmt_end = select(ChatSession).where(ChatSession.id == session_id)
                    result_end = await db_session_end.execute(stmt_end)
                    sess = result_end.scalar_one_or_none()
                    if sess:
                        sess.status = "ended"
                        db_session_end.add(sess)
                        await db_session_end.commit()

                await manager.broadcast_to_session(
                    session_id,
                    {"type": "session_ended", "reason": message_data.get("reason")},
                )
                break

    except WebSocketDisconnect:
        if user_id and session_id:
            await manager.disconnect(user_id, session_id)
            logger.info(f"WebSocket disconnected for user {user_id}")
            # Notify other user
            await manager.broadcast_to_session(
                session_id,
                {"type": "user_disconnected", "user_id": user_id},
            )

    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        if user_id and session_id:
            await manager.disconnect(user_id, session_id)
        try:
            await websocket.close(code=status.WS_1011_SERVER_ERROR, reason=str(e))
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


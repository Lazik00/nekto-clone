# ==========================================
#   WEBSOCKET CHAT + DEBUG LOGGING (FULL)
# ==========================================

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, Set
import json
import logging

from app.db import async_session, get_db
from app.deps import get_user_from_token
from app.models import User, ChatSession, Message
from app.core.security import verify_token
from app.config import settings

logger = logging.getLogger("websocket")
router = APIRouter()

# Active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}
        self.sessions: Dict[str, Set[str]] = {}

    async def connect(self, user_id: str, session_id: str, ws: WebSocket):
        logger.info(f"WS ACCEPT → user={user_id} session={session_id}")
        await ws.accept()

        self.active[user_id] = ws
        self.sessions.setdefault(session_id, set()).add(user_id)

        logger.info(f"WS CONNECT OK → {user_id} joined {session_id}, total={len(self.sessions[session_id])}")

    async def disconnect(self, user_id: str, session_id: str):
        logger.warning(f"WS DISCONNECT → user={user_id} session={session_id}")

        self.active.pop(user_id, None)

        if session_id in self.sessions:
            self.sessions[session_id].discard(user_id)
            if not self.sessions[session_id]:
                logger.info(f"WS SESSION EMPTY → removing session {session_id}")
                del self.sessions[session_id]

    async def send(self, user_id: str, data: dict):
        ws = self.active.get(user_id)
        if not ws:
            logger.warning(f"WS SEND FAIL → user={user_id} not connected")
            return

        try:
            await ws.send_json(data)
        except Exception as e:
            logger.error(f"WS SEND ERROR → user={user_id}: {e}")

    async def broadcast(self, session_id: str, data: dict, exclude=None):
        users = self.sessions.get(session_id, set())
        logger.info(f"WS BROADCAST → session={session_id} users={list(users)} exclude={exclude}")

        for uid in users:
            if uid == exclude:
                continue
            await self.send(uid, data)


manager = ConnectionManager()

# ==========================================
#   WEBSOCKET ENTRY POINT
# ==========================================

@router.websocket("/ws/{session_id}")
async def ws_handler(ws: WebSocket, session_id: str, token: str = Query(...)):
    logger.info(f"WS CONNECT ATTEMPT → session={session_id}, token_len={len(token)}")

    user_id = None
    user1 = None
    user2 = None

    try:
        # ---------------------------
        # 1) TOKEN VALIDATION
        # ---------------------------
        payload = verify_token(token, token_type="access")

        if not payload:
            logger.error("WS TOKEN INVALID → closing 1008")
            await ws.close(code=1008, reason="Invalid token")
            return

        user_id = payload.get("sub")
        logger.info(f"WS TOKEN OK → user_id={user_id}")

        # ---------------------------
        # 2) DB VALIDATION
        # ---------------------------
        async with async_session() as db:
            # USER VALIDATION
            stmt = select(User).where(User.id == user_id)
            user = (await db.execute(stmt)).scalar_one_or_none()

            if not user or user.is_banned:
                logger.error(f"WS USER BLOCKED/NOT FOUND → {user_id}")
                await ws.close(code=1008, reason="User banned or missing")
                return

            # SESSION VALIDATION
            stmt = select(ChatSession).where(ChatSession.id == session_id)
            chat = (await db.execute(stmt)).scalar_one_or_none()

            if not chat:
                logger.error(f"WS INVALID SESSION → {session_id}")
                await ws.close(code=1008, reason="Session not found")
                return

            user1 = chat.user_id_1
            user2 = chat.user_id_2

            # JOIN RULES
            if user_id not in [user1, user2]:
                if user2 is None and user_id != user1:
                    logger.info(f"WS USER ASSIGNED AS USER2 → {user_id}")
                    chat.user_id_2 = user_id
                    await db.commit()
                    user2 = user_id
                else:
                    logger.error("WS JOIN DENIED → session full")
                    await ws.close(code=1008, reason="Not allowed into session")
                    return

        logger.info(f"WS VALIDATION OK → user={user_id} session={session_id} user1={user1} user2={user2}")

        # ---------------------------
        # 3) ACCEPT CONNECTION
        # ---------------------------
        await manager.connect(user_id, session_id, ws)

        opponent = user2 if user_id == user1 else user1
        logger.info(f"WS OPPONENT → {opponent}")

        if opponent:
            await manager.broadcast(session_id, {
                "type": "user_connected",
                "user_id": user_id
            }, exclude=user_id)

        # SEND STUN/TURN CONFIG
        logger.info("WS SENDING STUN/TURN CONFIG")
        await manager.send(user_id, {
            "type": "stun_turn",
            "stun": settings.STUN_SERVER,
            "turn": settings.TURN_SERVER,
            "turn_username": settings.TURN_USERNAME,
            "turn_password": settings.TURN_PASSWORD,
        })

        # ---------------------------
        # 4) MAIN RECV LOOP
        # ---------------------------
        while True:
            msg_raw = await ws.receive_text()
            msg = json.loads(msg_raw)

            logger.info(f"WS RECV MSG → {msg}")

            msg_type = msg.get("type")

            # CHAT
            if msg_type in ("chat_message", "message"):
                content = msg.get("content", "")
                logger.info(f"WS CHAT MSG → {user_id}: {content}")

                async with async_session() as db:
                    new_msg = Message(
                        chat_session_id=session_id,
                        sender_id=user_id,
                        content=content,
                        message_type="text"
                    )
                    db.add(new_msg)
                    await db.commit()
                    await db.refresh(new_msg)

                await manager.broadcast(session_id, {
                    "type": "chat_message",
                    "sender_id": user_id,
                    "content": content,
                    "timestamp": new_msg.created_at.isoformat()
                })

            # WEBRTC SIGNALING
            elif msg_type in ("offer", "answer", "candidate", "signal"):
                logger.info(f"WS WEBRTC SIGNAL → {msg_type} from {user_id}")
                await manager.broadcast(session_id, {
                    "type": "webrtc_signal",
                    "signal_type": msg.get("signal_type", msg_type),
                    "data": msg.get("data"),
                    "sender_id": user_id,
                }, exclude=user_id)

            # END SESSION
            elif msg_type == "end_session":
                logger.warning(f"WS END SESSION → {session_id}")
                async with async_session() as db:
                    stmt = select(ChatSession).where(ChatSession.id == session_id)
                    s = (await db.execute(stmt)).scalar_one_or_none()
                    if s:
                        s.status = "ended"
                        await db.commit()

                await manager.broadcast(session_id, {
                    "type": "session_ended",
                    "reason": msg.get("reason")
                })
                break

    except WebSocketDisconnect:
        logger.warning(f"WS DISCONNECT EVENT → user={user_id}")
        await manager.disconnect(user_id, session_id)
        await manager.broadcast(session_id, {
            "type": "user_disconnected",
            "user_id": user_id
        })

    except Exception as e:
        logger.error(f"WS ERROR → {e}", exc_info=True)
        await manager.disconnect(user_id, session_id)
        try:
            await ws.close(code=1011, reason=str(e))
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


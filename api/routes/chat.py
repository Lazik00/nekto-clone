import json
import logging
from typing import Dict, Set

from fastapi import (
    APIRouter,
    WebSocket,
    WebSocketDisconnect,
    Depends,
    HTTPException,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session, get_db
from app.deps import get_user_from_token
from app.models import User, ChatSession, Message
from app.core.security import verify_token
from app.config import settings

logger = logging.getLogger("websocket")
router = APIRouter()


# ==========================================
#   CONNECTION MANAGER
# ==========================================

class ConnectionManager:
    """
    WebSocket connection manager:
    - clients: user_id -> WebSocket
    - sessions: session_id -> {user_id1, user_id2}
    """

    def __init__(self) -> None:
        self.clients: Dict[str, WebSocket] = {}
        self.sessions: Dict[str, Set[str]] = {}

    async def connect(self, user_id: str, session_id: str, ws: WebSocket) -> None:
        logger.info(
            f"[WS CONNECT] Accepting WebSocket → user={user_id}, session={session_id}"
        )
        await ws.accept()

        self.clients[user_id] = ws
        self.sessions.setdefault(session_id, set()).add(user_id)

        logger.info(
            f"[WS CONNECTED] session={session_id} users={self.sessions[session_id]}"
        )

    async def disconnect(self, user_id: str, session_id: str) -> None:
        logger.warning(f"[WS DISCONNECT] user={user_id}, session={session_id}")

        self.clients.pop(user_id, None)

        if session_id in self.sessions:
            self.sessions[session_id].discard(user_id)

            # agar sessiyada user qolmasa → sessiyani ochirib tashlaymiz
            if len(self.sessions[session_id]) == 0:
                logger.info(f"[WS SESSION CLOSED] {session_id} (empty)")
                del self.sessions[session_id]

    async def send(self, user_id: str, data: dict) -> None:
        ws = self.clients.get(user_id)
        if not ws:
            logger.warning(f"[WS SEND FAIL] User {user_id} not connected")
            return

        try:
            await ws.send_json(data)
        except Exception as e:
            logger.error(f"[WS SEND ERROR] user={user_id} → {e}")

    async def broadcast(
        self, session_id: str, data: dict, exclude: str | None = None
    ) -> None:
        users = self.sessions.get(session_id, set())
        logger.info(
            f"[WS BROADCAST] session={session_id}, data={data}, users={users}"
        )

        for uid in users:
            if exclude and uid == exclude:
                continue
            await self.send(uid, data)


manager = ConnectionManager()


# ==========================================
#   WEBSOCKET ROUTE
# ==========================================

@router.websocket("/chat/ws/{session_id}")
async def websocket_chat(ws: WebSocket, session_id: str):
    """
    Asosiy WebSocket endpoint:
    - ?token=ACCESS_TOKEN orqali auth
    - chat sessiyani tekshiradi
    - STUN/TURN configni clientga yuboradi
    - chat_message / offer / answer / candidate / end_session eventlarini boshqaradi
    """

    # -----------------------------------------
    # 1) Token olish (?token=...)
    # -----------------------------------------
    token = ws.query_params.get("token")

    if not token:
        await ws.close(code=1008, reason="Missing token")
        return

    # -----------------------------------------
    # 2) Tokenni tekshirish
    # -----------------------------------------
    try:
        payload = verify_token(token, token_type="access")
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise ValueError("No sub in token")
    except Exception:
        logger.error("[WS AUTH ERROR] Invalid token", exc_info=True)
        await ws.close(code=1008, reason="Invalid token")
        return

    logger.info(f"[WS AUTH OK] user_id={user_id}")

    # -----------------------------------------
    # 3) User + ChatSession tekshirish
    # -----------------------------------------
    async with async_session() as db:
        # User tekshirish
        stmt = select(User).where(User.id == user_id)
        user = (await db.execute(stmt)).scalar_one_or_none()

        if not user or user.is_banned:
            await ws.close(code=1008, reason="User banned or not found")
            return

        # Chat session tekshirish
        stmt = select(ChatSession).where(ChatSession.id == session_id)
        chat = (await db.execute(stmt)).scalar_one_or_none()

        if not chat:
            await ws.close(code=1008, reason="Session not found")
            return

        user1 = chat.user_id_1
        user2 = chat.user_id_2

        # Agar user sessiya ishtirokchilari ro'yxatida bo'lmasa:
        if user_id not in [user1, user2]:
            # bo'sh slot bo'lsa user2 ga yozib qo'yamiz
            if user2 is None:
                chat.user_id_2 = user_id
                await db.commit()
                user2 = user_id
            else:
                # Ikkala slot to'la -> session full
                await ws.close(code=1008, reason="Session full")
                return

    # -----------------------------------------
    # 4) WebSocketni managerga ro'yxatdan o'tkazish
    # -----------------------------------------
    await manager.connect(user_id, session_id, ws)

    opponent = user2 if user_id == user1 else user1

    # Opponent ulangan bo‘lsa → unga "user_connected" jo‘natamiz
    if opponent:
        await manager.broadcast(
            session_id,
            {"type": "user_connected", "user_id": user_id},
            exclude=user_id,
        )

    # -----------------------------------------
    # 5) STUN/TURN konfiguratsiyasini yuborish
    #    (frontend EXACT shu formatni kutyapti)
    # -----------------------------------------
    await manager.send(
        user_id,
        {
            "type": "stun_turn",
            "stun_server": settings.STUN_SERVER,
            "turn_server": settings.TURN_SERVER,          # masalan: "turn:37.140.216.113:3478"
            "turn_username": settings.TURN_USERNAME,
            "turn_password": settings.TURN_PASSWORD,
        },
    )

    # -----------------------------------------
    # 6) MAIN MESSAGE LOOP
    # -----------------------------------------
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            # -------------------------
            # TEXT CHAT MESSAGE
            # -------------------------
            if msg_type == "chat_message":
                content = msg.get("content", "") or ""

                async with async_session() as db:
                    new_msg = Message(
                        chat_session_id=session_id,
                        sender_id=user_id,
                        content=content,
                        message_type="text",
                    )
                    db.add(new_msg)
                    await db.commit()
                    await db.refresh(new_msg)

                await manager.broadcast(
                    session_id,
                    {
                        "type": "chat_message",
                        "sender_id": user_id,
                        "content": content,
                        "timestamp": new_msg.created_at.isoformat(),
                    },
                    exclude=None,  # ikkalasiga ham ko'rsatamiz
                )

            # -------------------------
            # WEBRTC SIGNALING
            # -------------------------
            elif msg_type in ("offer", "answer", "candidate"):
                # Frontend handleWebRTCSignal quyidagi formatni kutyapti:
                # { type: 'webrtc_signal', signal_type: 'offer' | 'answer' | 'candidate', data: {...}, sender_id: ... }
                await manager.broadcast(
                    session_id,
                    {
                        "type": "webrtc_signal",
                        "signal_type": msg_type,
                        "data": msg.get("data"),
                        "sender_id": user_id,
                    },
                    exclude=user_id,
                )

            # -------------------------
            # SESSION END
            # -------------------------
            elif msg_type == "end_session":
                reason = msg.get("reason", "ended")
                await manager.broadcast(
                    session_id,
                    {
                        "type": "session_ended",
                        "reason": reason,
                    },
                    exclude=None,
                )
                break

            # Noma'lum type
            else:
                logger.warning(f"[WS UNKNOWN MESSAGE TYPE] {msg_type} → {msg}")

    except WebSocketDisconnect:
        logger.warning(f"[WS DISCONNECTED] user={user_id}")

    except Exception as e:
        logger.error(f"[WS ERROR] {e}", exc_info=True)

    finally:
        # Managerdan chiqaramiz
        await manager.disconnect(user_id, session_id)
        # Qolgan user(lar)ga xabar beramiz
        await manager.broadcast(
            session_id,
            {
                "type": "user_disconnected",
                "user_id": user_id,
            },
            exclude=user_id,
        )


# ==========================================
#   HTTP ENDPOINTS: HISTORY & SESSIONS
# ==========================================

@router.get("/history/{session_id}")
async def get_chat_history(
    session_id: str,
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """
    Mazkur user ishtirok etgan chat session tarixini qaytaradi.
    """

    # User bu sessiyada bormi?
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

    # Mesajlarni olish
    stmt = (
        select(Message)
        .where(Message.chat_session_id == session_id)
        .order_by(Message.created_at)
    )
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


@router.get("/sessions")
async def get_user_sessions(
    current_user: User = Depends(get_user_from_token),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """
    Joriy user qatnashgan barcha chat sessiyalar ro'yxati.
    """

    stmt = (
        select(ChatSession)
        .where(
            (ChatSession.user_id_1 == current_user.id)
            | (ChatSession.user_id_2 == current_user.id)
        )
        .order_by(ChatSession.created_at.desc())
    )

    result = await session.execute(stmt)
    sessions = result.scalars().all()

    sessions_data = []
    for sess in sessions:
        opponent_id = (
            sess.user_id_2 if current_user.id == sess.user_id_1 else sess.user_id_1
        )

        opponent = None
        if opponent_id:
            opponent_stmt = select(User).where(User.id == opponent_id)
            opponent_result = await session.execute(opponent_stmt)
            opponent = opponent_result.scalar_one_or_none()

        sessions_data.append(
            {
                "session_id": sess.id,
                "opponent": {
                    "id": opponent.id,
                    "display_name": opponent.display_name,
                    "avatar_url": opponent.avatar_url,
                }
                if opponent
                else None,
                "started_at": sess.started_at,
                "ended_at": sess.ended_at,
                "status": sess.status,
            }
        )

    return {"sessions": sessions_data}

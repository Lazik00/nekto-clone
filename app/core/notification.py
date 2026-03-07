import asyncio
from typing import Any, Dict, List


class NotificationManager:
    def __init__(self):
        self.user_notifications: Dict[str, List[Any]] = {}
        self._lock = asyncio.Lock()

    async def add_notification(self, user_id: str, notification: Any):
        async with self._lock:
            if user_id not in self.user_notifications:
                self.user_notifications[user_id] = []
            self.user_notifications[user_id].append(notification)

    async def get_notifications(self, user_id: str) -> List[Any]:
        async with self._lock:
            return self.user_notifications.pop(user_id, [])


notification_manager = NotificationManager()

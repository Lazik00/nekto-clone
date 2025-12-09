import asyncio
from typing import Dict, List, Any

class NotificationManager:
    def __init__(self):
        self.user_notifications: Dict[str, List[Any]] = {}

    async def add_notification(self, user_id: str, notification: Any):
        if user_id not in self.user_notifications:
            self.user_notifications[user_id] = []
        self.user_notifications[user_id].append(notification)

    async def get_notifications(self, user_id: str) -> List[Any]:
        notifications = self.user_notifications.pop(user_id, [])
        return notifications

notification_manager = NotificationManager()


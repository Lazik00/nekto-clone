import json
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Project
    PROJECT_NAME: str = "Nekto Clone"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # Database
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "nekto"
    POSTGRES_PASSWORD: str = "nekto_secure_password_123"
    POSTGRES_DB: str = "nekto"

    USE_SQLITE: bool = False
    SQLITE_DB_PATH: str = "nekto.db"

    @property
    def DATABASE_URL(self) -> str:
        if self.USE_SQLITE and self.ENVIRONMENT == "development":
            return f"sqlite+aiosqlite:///{self.SQLITE_DB_PATH}"

        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:"
            f"{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:"
            f"{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # Security
    JWT_SECRET: str = "change-me-in-production-at-least-32-characters"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7
    JWT_REFRESH_EXPIRE_DAYS: int = 30

    # STUN/TURN
    STUN_SERVER: str = "stun:stun.l.google.com:19302"
    TURN_SERVER: str = "turn:localhost:3478"
    TURN_USERNAME: str = "nekto"
    TURN_PASSWORD: str = "super_secret_password_123"

    # API security
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
    ]
    ALLOWED_HOSTS: List[str] = ["localhost", "127.0.0.1", "backend", "frontend"]
    WORKERS: int = 1

    # Matchmaking
    MATCH_TIMEOUT_SECONDS: int = 120
    MAX_MATCHES_PER_HOUR: int = 10
    MESSAGE_RETENTION_DAYS: int = 30

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    # Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    ADMIN_EMAIL: str = "admin@nekto.local"

    @field_validator("CORS_ORIGINS", "ALLOWED_HOSTS", mode="before")
    @classmethod
    def parse_list_value(cls, value):
        if value is None:
            return []

        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]

        if isinstance(value, str):
            trimmed = value.strip()
            if not trimmed:
                return []

            if trimmed.startswith("["):
                try:
                    decoded = json.loads(trimmed)
                    if isinstance(decoded, list):
                        return [str(item).strip() for item in decoded if str(item).strip()]
                except json.JSONDecodeError:
                    pass

            return [item.strip() for item in trimmed.split(",") if item.strip()]

        raise TypeError("Expected list or comma-separated string")

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="allow",
    )


settings = Settings()

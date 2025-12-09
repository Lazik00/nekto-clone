from pydantic_settings import BaseSettings
from typing import List
import os


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

    # Database URL - use SQLite for local development if no Docker
    USE_SQLITE: bool = True
    SQLITE_DB_PATH: str = "nekto.db"

    @property
    def DATABASE_URL(self) -> str:
        # Local development uses SQLite, Docker/Production uses PostgreSQL
        if self.USE_SQLITE and self.ENVIRONMENT == "development":
            return f"sqlite+aiosqlite:///{self.SQLITE_DB_PATH}"
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # Security & JWT
    JWT_SECRET: str = "your-super-secret-jwt-key-change-in-production-min-32-chars"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    JWT_REFRESH_EXPIRE_DAYS: int = 30

    # TURN/STUN Servers
    TURN_SERVER: str = "turn:turn:3478"
    TURN_USERNAME: str = "nekto"
    TURN_PASSWORD: str = "super_secret_password_123"
    STUN_SERVER: str = "stun:stun.l.google.com:19302"

    # API Settings
    CORS_ORIGINS: List[str] = [
        # Localhost HTTP
        "http://localhost:5174",
        "http://localhost:8000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
        # Localhost HTTPS
        "https://localhost:5173",
        "https://localhost:8443",
        "https://127.0.0.1:5173",
        "https://127.0.0.1:8443",
        # Network IP (192.168.x.x)
        "http://badgatewaydev.tech",
        "https://badgatewaydev.tech",
        "http://badgatewaydev.tech",
        "https://badgatewaydev.tech",
        # Allow all for development (remove in production)
        "*"
    ]
    ALLOWED_HOSTS: List[str] = ["*"]
    WORKERS: int = 4

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

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "allow"


settings = Settings()

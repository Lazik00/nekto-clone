from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # ----------------------------------
    # PROJECT INFO
    # ----------------------------------
    PROJECT_NAME: str = "Nekto Clone"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # ----------------------------------
    # DATABASE
    # ----------------------------------
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "nekto"
    POSTGRES_PASSWORD: str = "nekto_secure_password_123"
    POSTGRES_DB: str = "nekto"

    USE_SQLITE: bool = True
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

    # ----------------------------------
    # REDIS
    # ----------------------------------
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ----------------------------------
    # SECURITY / JWT
    # ----------------------------------
    JWT_SECRET: str = "your-super-secret-jwt-key-change-in-production-min-32-chars"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    JWT_REFRESH_EXPIRE_DAYS: int = 30

    # ----------------------------------
    # STUN / TURN — FULLY FIXED VERSION
    # ----------------------------------
    STUN_SERVER: str = "stun:stun.l.google.com:19302"

    # ❗ TURN_SERVER faqat IP:PORT bo‘lishi shart — hech qachon turn: prefix bilan emas!
    TURN_SERVER: str = "turn:37.140.216.113:3478"
    TURN_USERNAME: str = "nekto"
    TURN_PASSWORD: str = "super_secret_password_123"

    # ----------------------------------
    # CORS
    # ----------------------------------
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",

        "https://localhost:5173",
        "https://localhost:8443",
        "https://127.0.0.1:5173",
        "https://127.0.0.1:8443",

        "http://badgatewaydev.tech",
        "https://badgatewaydev.tech",

        "*",  # Dev only — remove in production!
    ]

    ALLOWED_HOSTS: List[str] = ["*"]
    WORKERS: int = 4

    # ----------------------------------
    # MATCHMAKING
    # ----------------------------------
    MATCH_TIMEOUT_SECONDS: int = 120
    MAX_MATCHES_PER_HOUR: int = 10
    MESSAGE_RETENTION_DAYS: int = 30

    # ----------------------------------
    # LOGGING
    # ----------------------------------
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    # ----------------------------------
    # EMAIL
    # ----------------------------------
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

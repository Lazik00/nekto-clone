from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from contextlib import asynccontextmanager
import logging

from .config import settings
from .db import init_db, close_db
from .core.logging import get_logger
from .core.matchmaking import init_redis, close_redis
from api.routes import auth, match, chat, reports

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup and shutdown"""
    # Startup
    logger.info("Starting up application...")
    await init_db()
    await init_redis()
    logger.info("Application started successfully")

    yield

    # Shutdown
    logger.info("Shutting down application...")
    await close_redis()
    await close_db()
    logger.info("Application shut down successfully")


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="A complete random video chat application",
    version="1.0.0",
    lifespan=lifespan,
)

# Middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix=settings.API_V1_PREFIX, tags=["Authentication"])
app.include_router(match.router, prefix=settings.API_V1_PREFIX, tags=["Matchmaking"])
app.include_router(chat.router, prefix=settings.API_V1_PREFIX, tags=["Chat"])
app.include_router(reports.router, prefix=settings.API_V1_PREFIX, tags=["Reports"])

# Configure Swagger UI with Bearer token support
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=settings.PROJECT_NAME,
        version="1.0.0",
        description="A complete random video chat application",
        routes=app.routes,
    )

    # Ensure components exists
    if "components" not in openapi_schema:
        openapi_schema["components"] = {}

    if "securitySchemes" not in openapi_schema["components"]:
        openapi_schema["components"]["securitySchemes"] = {}

    # Configure Bearer token security scheme
    openapi_schema["components"]["securitySchemes"]["Bearer"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "JWT Bearer token - Enter your access token",
    }

    # Add global security requirement so Authorize button appears
    openapi_schema["security"] = [{"Bearer": []}]

    # Add security requirement to protected endpoints
    for path in openapi_schema.get("paths", {}).values():
        for operation in path.values():
            if isinstance(operation, dict) and "tags" in operation:
                tags = operation.get("tags", [])
                # Add Bearer security to all non-public endpoints
                public_tags = ["Infrastructure"]
                is_public = any(tag in public_tags for tag in tags)

                if not is_public:
                    if "security" not in operation:
                        operation["security"] = [{"Bearer": []}]

    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

# Health check
@app.get("/health", tags=["Infrastructure"])
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "version": "1.0.0"
    }

@app.get("/", tags=["Infrastructure"])
async def root():
    """Root endpoint"""
    return {
        "message": "Welcome to Nekto Clone API",
        "docs": "/docs",
        "version": "1.0.0"
    }

import logging
import structlog
import json
from pathlib import Path
from pythonjsonlogger import jsonlogger

from ..config import settings

# Create logs directory
log_dir = Path(settings.LOG_FILE).parent
log_dir.mkdir(parents=True, exist_ok=True)

# Configure structlog
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

# Configure standard logging
logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

# File handler with JSON formatting
file_handler = logging.FileHandler(settings.LOG_FILE)
file_handler.setFormatter(jsonlogger.JsonFormatter())

root_logger = logging.getLogger()
root_logger.addHandler(file_handler)

# Get logger
logger = structlog.get_logger(__name__)


def get_logger(name: str):
    """Get a logger instance"""
    return structlog.get_logger(name)


def log_exception(logger_instance, exc: Exception, context: dict = None) -> None:
    """Log an exception with context"""
    logger_instance.exception(
        "Exception occurred",
        error=str(exc),
        error_type=type(exc).__name__,
        context=context or {}
    )


def log_api_call(method: str, path: str, status_code: int, duration: float) -> None:
    """Log API call"""
    logger.info(
        "api_call",
        method=method,
        path=path,
        status_code=status_code,
        duration=f"{duration:.2f}s"
    )


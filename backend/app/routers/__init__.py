"""FastAPI routers for AMDataWrap V4.5."""

from .analytics_router import analytics_router
from .external_router import external_router
from .proxy_router import proxy_router
from .system_router import system_router

__all__ = [
    "analytics_router",
    "external_router",
    "proxy_router",
    "system_router",
]

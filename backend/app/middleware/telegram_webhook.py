"""
Telegram Webhook 安全验证中间件

防止 Webhook 伪造攻击，验证请求是否真的来自 Telegram。

安全措施：
1. Secret Token 验证（Telegram setWebhook 时设置）
2. 常量时间比较（防止时序攻击）
3. IP 白名单（可选，需要反代信任链）

使用：
app.add_middleware(
    TelegramWebhookSecretMiddleware,
    path="/api/v1/telegram/webhook"
)
"""
import ipaddress
import secrets
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from app.database import SessionLocal
from app.models import SystemConfig
from app.logger import get_logger

logger = get_logger(__name__)

TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"
DEFAULT_CONFIG_KEY = "telegram_webhook_secret"

# Telegram 官方 IP 段
TELEGRAM_IP_RANGES = (
    ipaddress.ip_network("149.154.160.0/20"),
    ipaddress.ip_network("91.108.4.0/22"),
)


def _is_telegram_ip(ip: str) -> bool:
    """检查 IP 是否来自 Telegram 官方网段"""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in TELEGRAM_IP_RANGES)


class TelegramWebhookSecretMiddleware(BaseHTTPMiddleware):
    """Telegram Webhook Secret Token 验证中间件"""

    def __init__(
        self,
        app: ASGIApp,
        path: str,
        config_key: str = DEFAULT_CONFIG_KEY,
        cache_ttl_seconds: int = 60,
        enable_ip_allowlist: bool = False,
    ):
        super().__init__(app)
        self.path = path
        self.config_key = config_key
        self.cache_ttl_seconds = cache_ttl_seconds
        self.enable_ip_allowlist = enable_ip_allowlist
        self._cached_secret = ""
        self._cached_at = 0.0

    def _load_secret(self) -> str:
        """从数据库加载 secret（带缓存）"""
        now = time.time()
        if self._cached_secret and (now - self._cached_at) < self.cache_ttl_seconds:
            return self._cached_secret

        db = SessionLocal()
        try:
            cfg = db.query(SystemConfig).filter(SystemConfig.key == self.config_key).first()
            secret = cfg.value if cfg and cfg.value else ""
        finally:
            db.close()

        self._cached_secret = secret
        self._cached_at = now
        return secret

    async def dispatch(self, request, call_next):
        # 只处理 Telegram Webhook 路径
        if request.url.path != self.path:
            return await call_next(request)

        # 1. 检查 secret token 是否配置
        expected = self._load_secret()
        if not expected:
            logger.error("Telegram webhook secret not configured")
            return JSONResponse(
                status_code=503,
                content={"detail": "Telegram webhook secret not configured"}
            )

        # 2. 验证 secret token（常量时间比较，防止时序攻击）
        provided = request.headers.get(TELEGRAM_SECRET_HEADER, "")
        if not provided or not secrets.compare_digest(provided, expected):
            logger.warning("Telegram webhook secret mismatch", extra={
                "provided": bool(provided),
                "path": request.url.path,
                "remote": request.client.host if request.client else None
            })
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden"}
            )

        # 3. IP 白名单验证（可选）
        if self.enable_ip_allowlist:
            # 获取真实 IP（考虑反代）
            forwarded = request.headers.get("X-Forwarded-For")
            client_ip = forwarded.split(",")[0].strip() if forwarded else (
                request.client.host if request.client else ""
            )

            if client_ip and not _is_telegram_ip(client_ip):
                logger.warning("Telegram webhook IP not allowed", extra={
                    "remote_ip": client_ip
                })
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden"}
                )

        # 验证通过，继续处理
        return await call_next(request)

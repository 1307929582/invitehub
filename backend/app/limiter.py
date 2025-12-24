# API 限流配置
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse
import ipaddress

from app.config import settings


def _is_trusted_proxy(remote_ip: str) -> bool:
    """检查远程 IP 是否为受信任代理"""
    if not settings.TRUST_PROXY_HEADERS or not settings.TRUSTED_PROXY_IPS:
        return False

    try:
        remote_addr = ipaddress.ip_address(remote_ip)
        trusted_cidrs = [cidr.strip() for cidr in settings.TRUSTED_PROXY_IPS.split(",") if cidr.strip()]

        for cidr in trusted_cidrs:
            try:
                network = ipaddress.ip_network(cidr, strict=False)
                if remote_addr in network:
                    return True
            except ValueError:
                continue

        return False
    except ValueError:
        return False


def _parse_first_ip(header_value: str) -> str:
    """安全解析 IP 头第一个值"""
    if not header_value:
        return ""

    first_ip = header_value.split(",")[0].strip()
    try:
        ipaddress.ip_address(first_ip)
        return first_ip
    except ValueError:
        return ""


def get_real_ip(request: Request) -> str:
    """获取真实 IP（支持反向代理）"""
    remote_ip = get_remote_address(request)

    # 仅当直连 IP 为受信任代理时，才从头部提取
    if _is_trusted_proxy(remote_ip):
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            parsed_ip = _parse_first_ip(forwarded)
            if parsed_ip:
                return parsed_ip

        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            parsed_ip = _parse_first_ip(real_ip)
            if parsed_ip:
                return parsed_ip

    return remote_ip


# 创建限流器
limiter = Limiter(key_func=get_real_ip)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """限流超出处理"""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "请求过于频繁，请稍后再试",
            "retry_after": exc.detail
        }
    )

# 易支付服务
import hashlib
import hmac
import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from urllib.parse import urlencode
from sqlalchemy.orm import Session

from app.models import SystemConfig


def get_epay_config(db: Session) -> dict:
    """获取易支付配置"""
    config_keys = [
        "epay_enabled",
        "epay_gateway_url",
        "epay_api_url",  # 向后兼容
        "epay_pid",
        "epay_key",
        "epay_alipay_enabled",
        "epay_wxpay_enabled",
    ]

    configs = db.query(SystemConfig).filter(SystemConfig.key.in_(config_keys)).all()
    config_map = {c.key: c.value for c in configs}

    return {
        "enabled": config_map.get("epay_enabled", "").lower() == "true",
        "gateway_url": config_map.get("epay_gateway_url") or config_map.get("epay_api_url", ""),
        "pid": config_map.get("epay_pid", ""),
        "key": config_map.get("epay_key", ""),
        "alipay_enabled": config_map.get("epay_alipay_enabled", "").lower() == "true",
        "wxpay_enabled": config_map.get("epay_wxpay_enabled", "").lower() == "true",
    }


def generate_sign(params: dict, key: str) -> str:
    """
    生成易支付签名

    签名规则：
    1. 过滤空值和 sign、sign_type 参数
    2. 按参数名 ASCII 升序排序
    3. 拼接成 key=value&key=value... 格式
    4. 末尾拼接密钥
    5. MD5 加密
    """
    # 过滤空值和特殊参数，统一转字符串
    filtered = {
        str(k): str(v)
        for k, v in params.items()
        if k not in ("sign", "sign_type") and v is not None and str(v) != ""
    }

    # 按 key 排序
    sorted_params = sorted(filtered.items(), key=lambda x: x[0])

    # 拼接字符串
    sign_str = "&".join(f"{k}={v}" for k, v in sorted_params)
    sign_str += key

    # MD5 加密
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def verify_sign(params: dict, key: str) -> bool:
    """验证易支付回调签名（使用时序安全比较）"""
    if not key:
        return False
    sign = params.get("sign", "")
    if not sign:
        return False

    expected_sign = generate_sign(params, key)
    return hmac.compare_digest(str(sign).lower(), str(expected_sign).lower())


def create_payment_url(
    config: dict,
    order_no: str,
    amount: int,  # 分
    name: str,
    pay_type: str,  # alipay / wxpay
    notify_url: str,
    return_url: str,
) -> Optional[str]:
    """
    创建易支付支付链接

    Args:
        config: 易支付配置
        order_no: 订单号
        amount: 金额（分）
        name: 商品名称
        pay_type: 支付方式
        notify_url: 异步回调地址
        return_url: 同步跳转地址

    Returns:
        支付链接 URL，失败返回 None
    """
    if not config.get("enabled"):
        return None

    gateway_url = config.get("gateway_url", "").rstrip("/")
    pid = config.get("pid", "")
    key = config.get("key", "")

    if not all([gateway_url, pid, key]):
        return None

    # 金额转换为元（使用 Decimal 保证精度）
    money = str((Decimal(amount) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    params = {
        "pid": pid,
        "type": pay_type,
        "out_trade_no": order_no,
        "notify_url": notify_url,
        "return_url": return_url,
        "name": name,
        "money": money,
    }

    # 生成签名
    params["sign"] = generate_sign(params, key)
    params["sign_type"] = "MD5"

    # 拼接 URL
    return f"{gateway_url}/submit.php?{urlencode(params)}"


def generate_order_no() -> str:
    """生成订单号：时间戳 + 随机数"""
    import secrets
    timestamp = time.strftime("%Y%m%d%H%M%S")
    random_part = secrets.token_hex(4).upper()
    return f"{timestamp}{random_part}"

# LinuxDo 积分支付服务
import hashlib
import hmac
import httpx
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from urllib.parse import urlencode
from sqlalchemy.orm import Session

from app.models import SystemConfig
from app.logger import get_logger

logger = get_logger(__name__)


def get_linuxdo_config(db: Session) -> dict:
    """获取 LinuxDo 支付配置"""
    config_keys = [
        "linuxdo_enabled",
        "linuxdo_gateway_url",
        "linuxdo_pid",
        "linuxdo_key",
        "linuxdo_plan_ids",
    ]

    configs = db.query(SystemConfig).filter(SystemConfig.key.in_(config_keys)).all()
    config_map = {c.key: c.value for c in configs}

    # 解析可用套餐 ID 列表
    plan_ids_str = config_map.get("linuxdo_plan_ids", "")
    plan_ids = []
    if plan_ids_str:
        plan_ids = [int(x.strip()) for x in plan_ids_str.split(",") if x.strip().isdigit()]

    return {
        "enabled": config_map.get("linuxdo_enabled", "").lower() == "true",
        "gateway_url": config_map.get("linuxdo_gateway_url", "https://credit.linux.do/epay").rstrip("/"),
        "pid": config_map.get("linuxdo_pid", ""),
        "key": config_map.get("linuxdo_key", ""),
        "plan_ids": plan_ids,
    }


def generate_sign(params: dict, key: str) -> str:
    """
    生成 LinuxDo 支付签名（与易支付签名算法一致）

    签名规则：
    1. 过滤空值和 sign、sign_type 参数
    2. 按参数名 ASCII 升序排序
    3. 拼接成 key=value&key=value... 格式
    4. 末尾拼接密钥
    5. MD5 加密
    """
    filtered = {
        str(k): str(v)
        for k, v in params.items()
        if k not in ("sign", "sign_type") and v is not None and str(v) != ""
    }

    sorted_params = sorted(filtered.items(), key=lambda x: x[0])
    sign_str = "&".join(f"{k}={v}" for k, v in sorted_params)
    sign_str += key

    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def verify_sign(params: dict, key: str) -> bool:
    """验证 LinuxDo 回调签名（使用时序安全比较）"""
    if not key:
        return False
    sign = params.get("sign", "")
    if not sign:
        return False

    expected_sign = generate_sign(params, key)
    return hmac.compare_digest(str(sign).lower(), str(expected_sign).lower())


def create_payment_params(
    config: dict,
    order_no: str,
    amount: int,  # 分（积分 * 100）
    name: str,
    notify_url: str,
    return_url: str,
) -> Optional[dict]:
    """
    创建 LinuxDo 积分支付参数（用于 POST 表单提交）

    Args:
        config: LinuxDo 配置
        order_no: 订单号
        amount: 金额（分），将转换为积分
        name: 商品名称
        notify_url: 异步回调地址（仅参与签名）
        return_url: 同步跳转地址（仅参与签名）

    Returns:
        支付参数字典，包含 gateway_url 和 params，失败返回 None
    """
    if not config.get("enabled"):
        return None

    gateway_url = config.get("gateway_url", "").rstrip("/")
    pid = config.get("pid", "")
    key = config.get("key", "")

    if not all([gateway_url, pid, key]):
        return None

    # 金额转换为积分（保留2位小数）
    money = str((Decimal(amount) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    params = {
        "pid": pid,
        "type": "epay",
        "out_trade_no": order_no,
        "notify_url": notify_url,
        "return_url": return_url,
        "name": name,
        "money": money,
    }

    params["sign"] = generate_sign(params, key)
    params["sign_type"] = "MD5"

    return {
        "gateway_url": f"{gateway_url}/pay/submit.php",
        "params": params,
    }


async def query_order(config: dict, trade_no: str) -> Optional[dict]:
    """
    查询 LinuxDo 订单状态

    Args:
        config: LinuxDo 配置
        trade_no: 交易号

    Returns:
        订单信息，失败返回 None
    """
    gateway_url = config.get("gateway_url", "").rstrip("/")
    pid = config.get("pid", "")
    key = config.get("key", "")

    if not all([gateway_url, pid, key]):
        return None

    params = {
        "act": "order",
        "pid": pid,
        "key": key,
        "trade_no": trade_no,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{gateway_url}/api.php", params=params)
            if response.status_code == 200:
                data = response.json()
                if data.get("code") == 1:
                    return data
    except Exception:
        logger.exception("LinuxDo query_order failed: trade_no=%s", trade_no)

    return None

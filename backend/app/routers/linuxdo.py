# LinuxDo 积分支付 API（白标兑换专用）
import re
import secrets
import string
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field, field_validator

from app.database import get_db
from app.limiter import limiter
from app.models import Plan, Order, OrderStatus, RedeemCode, RedeemCodeType, SystemConfig
from app.services.linuxdo import (
    get_linuxdo_config,
    create_payment_params,
    verify_sign,
)
from app.services.email import send_email, is_email_configured
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/linuxdo", tags=["LinuxDo"])

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
ORDER_NO_REGEX = re.compile(r'^LD\d{14}[A-F0-9]{8}$')


# ============ 请求/响应模型 ============

class LinuxDoConfigResponse(BaseModel):
    """LinuxDo 配置"""
    enabled: bool


class LinuxDoPlanResponse(BaseModel):
    """LinuxDo 套餐信息（积分显示）"""
    id: int
    name: str
    credits: str  # 积分数量（字符串，保留2位小数）
    validity_days: int
    description: Optional[str]
    features: Optional[str]
    is_recommended: bool
    stock: Optional[int] = None  # 库存数量（NULL=无限）
    sold_count: int = 0  # 已售数量
    remaining_stock: Optional[int] = None  # 剩余库存


class LinuxDoCreateOrderRequest(BaseModel):
    plan_id: int = Field(..., ge=1)
    email: str = Field(..., min_length=5, max_length=100)

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_REGEX.match(v):
            raise ValueError('邮箱格式不正确')
        return v


class LinuxDoOrderResponse(BaseModel):
    order_no: str
    credits: str  # 积分数量
    gateway_url: str  # 支付网关地址
    pay_params: dict  # 支付参数（用于 POST 表单提交）
    expire_at: datetime


class LinuxDoOrderStatusResponse(BaseModel):
    order_no: str
    status: str
    credits: str
    email: Optional[str] = None
    redeem_code: Optional[str] = None
    plan_name: Optional[str] = None
    validity_days: Optional[int] = None
    created_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None


# ============ 工具函数 ============

def _generate_order_no() -> str:
    """生成订单号"""
    import time
    timestamp = time.strftime("%Y%m%d%H%M%S")
    random_part = secrets.token_hex(4).upper()
    return f"LD{timestamp}{random_part}"


def _generate_redeem_code(db: Session, validity_days: int, order_no: str) -> str:
    """生成兑换码（带唯一性约束重试，使用 savepoint 保护外层事务）"""
    for _ in range(10):
        code = 'LD_' + ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(12))

        # 使用 savepoint 隔离这次尝试，失败不影响外层事务
        savepoint = db.begin_nested()
        try:
            redeem_code = RedeemCode(
                code=code,
                code_type=RedeemCodeType.DIRECT,
                max_uses=1,
                used_count=0,
                validity_days=validity_days,
                is_active=True,
                note=f"LinuxDo订单: {order_no}",
            )
            db.add(redeem_code)
            db.flush()
            savepoint.commit()
            return code
        except IntegrityError:
            savepoint.rollback()
            continue

    raise HTTPException(status_code=500, detail="生成兑换码失败")


def _amount_to_credits(amount: int) -> str:
    """金额（分）转换为积分字符串"""
    return str((Decimal(amount) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


# ============ 公开 API ============

@router.get("/config", response_model=LinuxDoConfigResponse)
async def get_config(db: Session = Depends(get_db)):
    """获取 LinuxDo 配置状态"""
    config = get_linuxdo_config(db)
    return LinuxDoConfigResponse(enabled=config.get("enabled", False))


@router.get("/plans", response_model=List[LinuxDoPlanResponse])
async def get_plans(db: Session = Depends(get_db)):
    """获取 LinuxDo 可用套餐列表"""
    config = get_linuxdo_config(db)
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="LinuxDo 兑换未启用")

    # 查询所有 linuxdo 类型且已上架的套餐
    plans = db.query(Plan).filter(
        Plan.plan_type == "linuxdo",
        Plan.is_active == True,
    ).order_by(Plan.sort_order.asc(), Plan.id.asc()).all()

    return [
        LinuxDoPlanResponse(
            id=p.id,
            name=p.name,
            credits=_amount_to_credits(p.price),
            validity_days=p.validity_days,
            description=p.description,
            features=p.features,
            is_recommended=p.is_recommended,
            stock=p.stock,
            sold_count=p.sold_count or 0,
            remaining_stock=p.remaining_stock,
        )
        for p in plans
    ]


@router.post("/buy", response_model=LinuxDoOrderResponse)
@limiter.limit("10/minute")
async def create_order(
    data: LinuxDoCreateOrderRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """创建 LinuxDo 积分订单"""
    config = get_linuxdo_config(db)
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="LinuxDo 兑换未启用")

    # 获取套餐（必须是 LinuxDo 类型）
    plan = db.query(Plan).filter(
        Plan.id == data.plan_id,
        Plan.plan_type == "linuxdo",
        Plan.is_active == True,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在或已下架")

    # 检查库存
    if plan.stock is not None:
        remaining = plan.stock - (plan.sold_count or 0)
        if remaining <= 0:
            raise HTTPException(status_code=400, detail="该套餐已售罄")

    # 构建回调地址（notify_url 用主站域名，return_url 用用户访问的域名）
    site_url_cfg = db.query(SystemConfig).filter(SystemConfig.key == "site_url").first()
    site_url = (site_url_cfg.value or "").strip() if site_url_cfg else ""

    # 回调地址：必须用主站域名（服务器到服务器通信）
    if site_url.startswith(("http://", "https://")):
        notify_base_url = site_url.rstrip("/")
    else:
        notify_base_url = str(request.base_url).rstrip("/")

    # 跳转地址：用用户访问的域名
    return_base_url = str(request.base_url).rstrip("/")

    # 订单过期时间（15分钟）
    expire_at = datetime.utcnow() + timedelta(minutes=15)
    notify_url = f"{notify_base_url}/api/v1/linuxdo/notify"

    for _ in range(5):
        order_no = _generate_order_no()
        return_url = f"{return_base_url}/linuxdo/result?order_no={order_no}"

        payment_data = create_payment_params(
            config=config,
            order_no=order_no,
            amount=plan.price,
            name=f"{plan.name} - {plan.validity_days}天",
            notify_url=notify_url,
            return_url=return_url,
        )
        if not payment_data:
            raise HTTPException(status_code=500, detail="创建支付参数失败")

        order = Order(
            order_no=order_no,
            order_type="linuxdo",
            plan_id=plan.id,
            email=data.email,
            quantity=1,
            amount=plan.price,
            final_amount=plan.price,
            status=OrderStatus.PENDING,
            pay_type="linuxdo",
            expire_at=expire_at,
        )
        db.add(order)
        try:
            db.commit()
            logger.info(f"Created LinuxDo order: {order_no}, plan: {plan.name}, credits: {_amount_to_credits(plan.price)}")
            return LinuxDoOrderResponse(
                order_no=order_no,
                credits=_amount_to_credits(plan.price),
                gateway_url=payment_data["gateway_url"],
                pay_params=payment_data["params"],
                expire_at=expire_at,
            )
        except IntegrityError:
            db.rollback()
            continue

    raise HTTPException(status_code=500, detail="创建订单失败，请重试")


@router.get("/order/{order_no}", response_model=LinuxDoOrderStatusResponse)
@limiter.limit("60/minute")
async def get_order_status(
    order_no: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """查询 LinuxDo 订单状态"""
    if not ORDER_NO_REGEX.match(order_no):
        raise HTTPException(status_code=400, detail="订单号格式不正确")

    order = db.query(Order).filter(
        Order.order_no == order_no,
        Order.pay_type == "linuxdo"
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    plan = db.query(Plan).filter(Plan.id == order.plan_id).first()

    return LinuxDoOrderStatusResponse(
        order_no=order.order_no,
        status=order.status.value if isinstance(order.status, OrderStatus) else order.status,
        credits=_amount_to_credits(order.amount),
        email=order.email,
        redeem_code=order.redeem_code if order.status == OrderStatus.PAID else None,
        plan_name=plan.name if plan else None,
        validity_days=plan.validity_days if plan else None,
        created_at=order.created_at,
        paid_at=order.paid_at,
    )


@router.get("/notify", response_class=PlainTextResponse)
@router.post("/notify", response_class=PlainTextResponse)
@limiter.limit("120/minute")
async def payment_notify(request: Request, db: Session = Depends(get_db)):
    """
    LinuxDo 积分支付回调（支持 GET 和 POST）

    回调参数：
    - pid: 商户ID
    - trade_no: LinuxDo 订单号
    - out_trade_no: 商户订单号
    - type: epay
    - name: 商品名称
    - money: 积分数量
    - trade_status: TRADE_SUCCESS
    - sign: 签名
    - sign_type: MD5
    """
    if request.method == "GET":
        params = {k: str(v) for k, v in request.query_params.items()}
    else:
        form_data = await request.form()
        params = {k: str(v) for k, v in dict(form_data).items()}

    logger.info(
        "LinuxDo notify received: out_trade_no=%s trade_no=%s trade_status=%s money=%s",
        params.get("out_trade_no"),
        params.get("trade_no"),
        params.get("trade_status"),
        params.get("money"),
    )

    config = get_linuxdo_config(db)
    if not config.get("enabled"):
        logger.warning("LinuxDo notify received but linuxdo is disabled")
        return "fail"

    # 限定签名算法
    sign_type = (params.get("sign_type") or "").upper()
    if sign_type and sign_type != "MD5":
        logger.warning("LinuxDo notify unsupported sign_type: out_trade_no=%s sign_type=%s", params.get("out_trade_no"), sign_type)
        return "fail"

    # 验证签名
    if not verify_sign(params, config.get("key", "")):
        logger.warning("LinuxDo notify sign verification failed: out_trade_no=%s", params.get("out_trade_no"))
        return "fail"

    order_no = params.get("out_trade_no", "")
    trade_no = params.get("trade_no", "")
    trade_status = params.get("trade_status", "")
    pid = params.get("pid", "")
    money = params.get("money", "")

    if not order_no:
        logger.warning("LinuxDo notify missing out_trade_no")
        return "fail"

    if not ORDER_NO_REGEX.match(order_no):
        logger.warning("LinuxDo notify invalid out_trade_no format: out_trade_no=%s", order_no)
        return "fail"

    if not trade_no:
        logger.warning("LinuxDo notify missing trade_no: out_trade_no=%s", order_no)
        return "fail"

    # 校验 pid
    if pid and config.get("pid") and pid != config.get("pid"):
        logger.warning("LinuxDo notify pid mismatch: out_trade_no=%s", order_no)
        return "fail"

    # 只处理成功的交易
    if trade_status != "TRADE_SUCCESS":
        logger.info(f"LinuxDo notify trade_status is not SUCCESS: {trade_status}")
        return "success"

    # 查询订单（加锁）
    order = db.query(Order).filter(
        Order.order_no == order_no,
        Order.pay_type == "linuxdo"
    ).with_for_update().first()

    if not order:
        logger.warning(f"LinuxDo notify order not found: {order_no}")
        return "fail"

    # 幂等处理
    if order.status == OrderStatus.PAID:
        logger.info(f"LinuxDo order already paid, skipping: {order_no}")
        return "success"

    # 校验金额（积分）
    try:
        paid_money = Decimal(money).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        expected_money = (Decimal(order.amount) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError):
        logger.warning("LinuxDo notify money invalid: out_trade_no=%s money=%s", order_no, money)
        return "fail"

    if paid_money != expected_money:
        logger.warning(
            "LinuxDo notify money mismatch: out_trade_no=%s paid=%s expected=%s",
            order_no, str(paid_money), str(expected_money)
        )
        return "fail"

    # 防止回调复用
    if order.trade_no and trade_no and order.trade_no != trade_no:
        logger.warning("LinuxDo notify trade_no mismatch: out_trade_no=%s", order_no)
        return "fail"

    # 获取套餐（加锁，防止并发更新 sold_count）
    plan = db.query(Plan).filter(Plan.id == order.plan_id).with_for_update().first()
    if not plan:
        logger.error(f"Plan not found for LinuxDo order: {order_no}")
        return "fail"

    # 检查库存（再次校验，防止并发超卖）
    if plan.stock is not None:
        remaining = plan.stock - (plan.sold_count or 0)
        if remaining <= 0:
            logger.warning(f"LinuxDo order stock exhausted: {order_no}")
            return "fail"

    # 生成兑换码
    try:
        redeem_code = _generate_redeem_code(db, plan.validity_days, order_no)
    except HTTPException as e:
        logger.error(f"Failed to generate code for LinuxDo order {order_no}: {e.detail}")
        db.rollback()
        return "fail"

    # 更新订单状态
    order.status = OrderStatus.PAID
    order.trade_no = trade_no
    order.redeem_code = redeem_code
    order.paid_at = datetime.utcnow()

    # 增加已售数量
    plan.sold_count = (plan.sold_count or 0) + 1

    try:
        db.commit()
        logger.info(f"LinuxDo order paid: {order_no}, plan_sold: {plan.sold_count}")

        # 发送兑换码邮件（异步，失败不影响订单）
        try:
            if is_email_configured(db):
                _send_redeem_code_email(db, order.email, redeem_code, plan.name, plan.validity_days)
        except Exception as email_error:
            logger.error(f"Failed to send email for order {order_no}: {email_error}")

        return "success"
    except Exception as e:
        logger.error(f"Failed to update LinuxDo order {order_no}: {e}")
        db.rollback()
        return "fail"


def _send_redeem_code_email(db: Session, to_email: str, redeem_code: str, plan_name: str, validity_days: int) -> bool:
    """发送兑换码邮件"""
    subject = "LinuxDo 购买成功 - 您的兑换码"

    # 获取站点 URL
    site_url_cfg = db.query(SystemConfig).filter(SystemConfig.key == "site_url").first()
    site_url = (site_url_cfg.value or "https://mmw-team.zenscaleai.com").strip()
    redeem_url = f"{site_url}/linuxdo/result"

    content = f"""
    <div style="text-align: center;">
        <div style="margin-bottom: 24px;">
            <span style="display: inline-block; padding: 8px 16px; background: linear-gradient(135deg, #0066FF 0%, #0052CC 100%); color: #fff; border-radius: 20px; font-size: 13px; font-weight: 500;">LinuxDo L 币购买</span>
        </div>
        <p style="margin: 0 0 24px 0; color: #333; font-size: 15px;">感谢您的购买！以下是您的兑换码信息：</p>

        <div style="padding: 24px; background: linear-gradient(135deg, rgba(0, 102, 255, 0.08) 0%, rgba(0, 102, 255, 0.04) 100%); border-radius: 12px; margin: 0 0 24px 0; border: 1px solid rgba(0, 102, 255, 0.2);">
            <div style="margin-bottom: 16px;">
                <div style="color: #6b7280; font-size: 13px; margin-bottom: 8px;">兑换码</div>
                <span style="font-size: 32px; font-weight: 700; color: #0066FF; letter-spacing: 4px; font-family: 'SF Mono', Monaco, monospace;">{redeem_code}</span>
            </div>
            <div style="padding-top: 16px; border-top: 1px solid rgba(0, 102, 255, 0.1);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #6b7280; font-size: 14px;">套餐</span>
                    <span style="color: #1f2937; font-weight: 600; font-size: 14px;">{plan_name}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #6b7280; font-size: 14px;">有效期</span>
                    <span style="color: #1f2937; font-weight: 600; font-size: 14px;">{validity_days} 天</span>
                </div>
            </div>
        </div>

        <div style="padding: 16px; background: #fef3c7; border-radius: 8px; text-align: left; margin-bottom: 24px;">
            <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 500;">⏰ 使用说明</p>
            <p style="margin: 0 0 4px 0; color: #a16207; font-size: 12px;">• 有效期从首次使用开始计算</p>
            <p style="margin: 0 0 4px 0; color: #a16207; font-size: 12px;">• 请妥善保管您的兑换码</p>
            <p style="margin: 0; color: #a16207; font-size: 12px;">• 如有问题请联系客服</p>
        </div>

        <a href="{redeem_url}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #0066FF 0%, #0052CC 100%); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px;">
            立即兑换
        </a>
    </div>
    """

    return send_email(db, subject, content, to_email=to_email)

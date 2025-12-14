# 商店公开 API（购买、查询订单、支付回调）
import json
import re
import secrets
import string
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field, field_validator

from app.database import get_db
from app.limiter import limiter
from app.models import Plan, Order, OrderStatus, RedeemCode, RedeemCodeType, SystemConfig, Coupon, DiscountType
from app.services.epay import (
    get_epay_config,
    create_payment_url,
    verify_sign,
    generate_order_no,
)
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/shop", tags=["商店"])

# 邮箱格式校验正则
EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')


# ============ 请求/响应模型 ============

class PublicPlanResponse(BaseModel):
    """公开套餐信息"""
    id: int
    name: str
    price: int  # 分
    original_price: Optional[int]
    validity_days: int
    description: Optional[str]
    features: Optional[str]
    is_recommended: bool


class CreateOrderRequest(BaseModel):
    plan_id: int = Field(..., ge=1)
    email: str = Field(..., min_length=5, max_length=100)
    pay_type: Literal["alipay", "wxpay"] = "alipay"
    coupon_code: Optional[str] = Field(None, max_length=30, description="优惠码")

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_REGEX.match(v):
            raise ValueError('邮箱格式不正确')
        return v

    @field_validator('coupon_code')
    @classmethod
    def validate_coupon_code(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return v.strip().upper()
        return v


class CreateOrderResponse(BaseModel):
    order_no: str
    amount: int
    pay_url: str
    expire_at: datetime


class OrderStatusResponse(BaseModel):
    order_no: str
    status: str
    amount: int
    email: Optional[str] = None
    redeem_code: Optional[str] = None
    plan_name: Optional[str] = None
    validity_days: Optional[int] = None
    created_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None


class OrderListResponse(BaseModel):
    orders: List[OrderStatusResponse]
    total: int


class PaymentConfigResponse(BaseModel):
    enabled: bool
    alipay_enabled: bool
    wxpay_enabled: bool


class CouponCheckRequest(BaseModel):
    """优惠码验证请求"""
    code: str = Field(..., min_length=1, max_length=30)
    plan_id: int = Field(..., ge=1)
    amount: int = Field(..., ge=1, description="订单金额（分）")


class CouponCheckResponse(BaseModel):
    """优惠码验证响应"""
    valid: bool
    code: str
    discount_type: Optional[str] = None
    discount_value: Optional[int] = None
    discount_amount: int = 0       # 优惠金额（分）
    final_amount: int              # 最终金额（分）
    message: str


# ============ 优惠码验证逻辑 ============

def _calculate_discount(coupon: Coupon, amount: int) -> int:
    """计算优惠金额（分）"""
    if coupon.discount_type == DiscountType.FIXED:
        return min(coupon.discount_value, amount)
    elif coupon.discount_type == DiscountType.PERCENTAGE:
        discount = amount * coupon.discount_value // 100
        if coupon.max_discount is not None:
            return min(discount, coupon.max_discount)
        return discount
    return 0


def _validate_coupon(
    db: Session,
    code: str,
    plan_id: int,
    amount: int,
    lock: bool = False
) -> tuple[Coupon, int]:
    """
    验证优惠码并返回 (coupon, discount_amount)
    如果 lock=True，会对优惠码行加锁（用于下单时）
    """
    query = db.query(Coupon).filter(Coupon.code == code.upper())
    if lock:
        query = query.with_for_update()

    coupon = query.first()

    if not coupon or not coupon.is_active:
        raise HTTPException(status_code=400, detail="优惠码不存在或已失效")

    now = datetime.utcnow()
    if coupon.valid_from and now < coupon.valid_from:
        raise HTTPException(status_code=400, detail="优惠码尚未生效")
    if coupon.valid_until and now > coupon.valid_until:
        raise HTTPException(status_code=400, detail="优惠码已过期")

    if coupon.max_uses > 0 and coupon.used_count >= coupon.max_uses:
        raise HTTPException(status_code=400, detail="优惠码使用次数已达上限")

    if amount < coupon.min_amount:
        min_yuan = coupon.min_amount / 100
        raise HTTPException(status_code=400, detail=f"订单金额需满 {min_yuan:.2f} 元才能使用")

    if coupon.applicable_plan_ids:
        try:
            applicable_ids = json.loads(coupon.applicable_plan_ids)
            if plan_id not in applicable_ids:
                raise HTTPException(status_code=400, detail="该优惠码不适用于此套餐")
        except (json.JSONDecodeError, TypeError):
            pass

    discount = _calculate_discount(coupon, amount)
    return coupon, discount


# ============ 公开 API ============

@router.get("/config", response_model=PaymentConfigResponse)
async def get_payment_config(db: Session = Depends(get_db)):
    """获取支付配置（是否启用）"""
    config = get_epay_config(db)
    return PaymentConfigResponse(
        enabled=config.get("enabled", False),
        alipay_enabled=config.get("alipay_enabled", False),
        wxpay_enabled=config.get("wxpay_enabled", False),
    )


@router.get("/plans", response_model=List[PublicPlanResponse])
async def get_public_plans(db: Session = Depends(get_db)):
    """获取上架的套餐列表"""
    plans = db.query(Plan).filter(
        Plan.is_active == True
    ).order_by(Plan.sort_order.asc(), Plan.id.asc()).all()

    return [
        PublicPlanResponse(
            id=p.id,
            name=p.name,
            price=p.price,
            original_price=p.original_price,
            validity_days=p.validity_days,
            description=p.description,
            features=p.features,
            is_recommended=p.is_recommended,
        )
        for p in plans
    ]


@router.get("/coupon/check", response_model=CouponCheckResponse)
@limiter.limit("30/minute")
async def check_coupon(
    request: Request,
    code: str = Query(..., min_length=1, max_length=30),
    plan_id: int = Query(..., ge=1),
    amount: int = Query(..., ge=1, description="订单金额（分）"),
    db: Session = Depends(get_db),
):
    """验证优惠码"""
    code = code.strip().upper()

    try:
        coupon, discount_amount = _validate_coupon(db, code, plan_id, amount)
        return CouponCheckResponse(
            valid=True,
            code=coupon.code,
            discount_type=coupon.discount_type.value if isinstance(coupon.discount_type, DiscountType) else coupon.discount_type,
            discount_value=coupon.discount_value,
            discount_amount=discount_amount,
            final_amount=amount - discount_amount,
            message="优惠码有效",
        )
    except HTTPException as e:
        return CouponCheckResponse(
            valid=False,
            code=code,
            discount_amount=0,
            final_amount=amount,
            message=e.detail,
        )


@router.post("/buy", response_model=CreateOrderResponse)
@limiter.limit("10/minute")
async def create_order(
    data: CreateOrderRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """创建订单"""
    # 检查支付配置
    config = get_epay_config(db)
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="在线购买功能未启用")

    # 检查支付方式
    if data.pay_type == "alipay" and not config.get("alipay_enabled"):
        raise HTTPException(status_code=400, detail="支付宝支付未启用")
    if data.pay_type == "wxpay" and not config.get("wxpay_enabled"):
        raise HTTPException(status_code=400, detail="微信支付未启用")

    # 构建回调地址：优先使用 site_url 配置，避免 Host Header 注入
    site_url_cfg = db.query(SystemConfig).filter(SystemConfig.key == "site_url").first()
    site_url = (site_url_cfg.value or "").strip() if site_url_cfg else ""
    if site_url.startswith(("http://", "https://")):
        base_url = site_url.rstrip("/")
    else:
        base_url = str(request.base_url).rstrip("/")

    # 获取套餐
    plan = db.query(Plan).filter(Plan.id == data.plan_id, Plan.is_active == True).first()
    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在或已下架")

    # 计算金额（处理优惠码）
    original_amount = plan.price
    discount_amount = 0
    coupon_code_used = None

    if data.coupon_code:
        try:
            # 使用行锁验证优惠码，防止并发超用
            coupon, discount_amount = _validate_coupon(
                db, data.coupon_code, data.plan_id, original_amount, lock=True
            )
            coupon_code_used = coupon.code
            # 增加使用次数
            coupon.used_count = (coupon.used_count or 0) + 1
        except HTTPException as e:
            raise HTTPException(status_code=400, detail=f"优惠码错误：{e.detail}")

    final_amount = original_amount - discount_amount

    # 订单过期时间（15分钟）
    expire_at = datetime.utcnow() + timedelta(minutes=15)
    notify_url = f"{base_url}/api/v1/public/shop/notify"

    # 生成订单号可能极小概率冲突，做重试
    for _ in range(5):
        order_no = generate_order_no()
        return_url = f"{base_url}/pay/result?order_no={order_no}"

        pay_url = create_payment_url(
            config=config,
            order_no=order_no,
            amount=final_amount,  # 使用最终金额
            name=f"{plan.name} - {plan.validity_days}天",
            pay_type=data.pay_type,
            notify_url=notify_url,
            return_url=return_url,
        )
        if not pay_url:
            raise HTTPException(status_code=500, detail="创建支付链接失败")

        order = Order(
            order_no=order_no,
            plan_id=plan.id,
            email=data.email,
            amount=original_amount,      # 原始金额
            coupon_code=coupon_code_used,
            discount_amount=discount_amount,
            final_amount=final_amount,   # 实付金额
            status=OrderStatus.PENDING,
            pay_type=data.pay_type,
            expire_at=expire_at,
        )
        db.add(order)
        try:
            db.commit()
            logger.info(f"Created order: {order_no}, plan: {plan.name}, amount: {original_amount}, discount: {discount_amount}, final: {final_amount}")
            return CreateOrderResponse(
                order_no=order_no,
                amount=final_amount,  # 返回实付金额
                pay_url=pay_url,
                expire_at=expire_at,
            )
        except IntegrityError:
            db.rollback()
            continue

    raise HTTPException(status_code=500, detail="创建订单失败，请重试")


@router.get("/order/{order_no}", response_model=OrderStatusResponse)
@limiter.limit("60/minute")
async def get_order_status(
    order_no: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """查询订单状态"""
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    # 获取套餐信息
    plan = db.query(Plan).filter(Plan.id == order.plan_id).first()

    return OrderStatusResponse(
        order_no=order.order_no,
        status=order.status.value if isinstance(order.status, OrderStatus) else order.status,
        amount=order.amount,
        email=order.email if hasattr(order, 'email') else None,
        redeem_code=order.redeem_code if order.status == OrderStatus.PAID else None,
        plan_name=plan.name if plan else None,
        validity_days=plan.validity_days if plan else None,
        created_at=order.created_at,
        paid_at=order.paid_at,
    )


@router.get("/orders", response_model=OrderListResponse)
@limiter.limit("30/minute")
async def query_orders_by_email(
    request: Request,
    email: str = Query(..., min_length=5, max_length=100, description="查询邮箱"),
    db: Session = Depends(get_db)
):
    """按邮箱查询订单列表"""
    # 格式校验
    email = email.strip().lower()
    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    # 查询订单（按时间倒序）
    orders = db.query(Order).filter(
        Order.email == email
    ).order_by(Order.created_at.desc()).limit(50).all()

    result = []
    for order in orders:
        plan = db.query(Plan).filter(Plan.id == order.plan_id).first()
        result.append(OrderStatusResponse(
            order_no=order.order_no,
            status=order.status.value if isinstance(order.status, OrderStatus) else order.status,
            amount=order.amount,
            email=order.email,
            redeem_code=order.redeem_code if order.status == OrderStatus.PAID else None,
            plan_name=plan.name if plan else None,
            validity_days=plan.validity_days if plan else None,
            created_at=order.created_at,
            paid_at=order.paid_at,
        ))

    return OrderListResponse(orders=result, total=len(result))


@router.get("/notify", response_class=PlainTextResponse)
@router.post("/notify", response_class=PlainTextResponse)
async def payment_notify(request: Request, db: Session = Depends(get_db)):
    """
    易支付异步回调（支持 GET 和 POST）

    回调参数示例：
    - pid: 商户ID
    - trade_no: 易支付订单号
    - out_trade_no: 商户订单号
    - type: 支付方式
    - name: 商品名称
    - money: 金额
    - trade_status: 交易状态 (TRADE_SUCCESS)
    - sign: 签名
    - sign_type: 签名类型
    """
    # 获取回调参数（支持 GET query 和 POST form）
    if request.method == "GET":
        params = {k: str(v) for k, v in request.query_params.items()}
    else:
        form_data = await request.form()
        params = {k: str(v) for k, v in dict(form_data).items()}

    logger.info(
        "Payment notify received: out_trade_no=%s trade_no=%s trade_status=%s money=%s",
        params.get("out_trade_no"),
        params.get("trade_no"),
        params.get("trade_status"),
        params.get("money"),
    )

    # 获取配置
    config = get_epay_config(db)
    if not config.get("enabled"):
        logger.warning("Payment notify received but epay is disabled")
        return "fail"

    # 验证签名（必须先验签再做任何业务处理）
    if not verify_sign(params, config.get("key", "")):
        logger.warning("Payment notify sign verification failed: out_trade_no=%s", params.get("out_trade_no"))
        return "fail"

    # 获取订单号
    order_no = params.get("out_trade_no", "")
    trade_no = params.get("trade_no", "")
    trade_status = params.get("trade_status", "")
    pid = params.get("pid", "")
    pay_type = params.get("type", "")
    money = params.get("money", "")

    if not order_no:
        logger.warning("Payment notify missing out_trade_no")
        return "fail"

    # 校验 pid，避免配置串用
    if pid and config.get("pid") and pid != config.get("pid"):
        logger.warning("Payment notify pid mismatch: out_trade_no=%s", order_no)
        return "fail"

    # 只处理成功的交易
    if trade_status != "TRADE_SUCCESS":
        logger.info(f"Payment notify trade_status is not SUCCESS: {trade_status}")
        return "success"  # 返回 success 避免重复通知

    # 查询订单（使用行锁防止并发）
    order_query = db.query(Order).filter(Order.order_no == order_no)
    try:
        if db.bind and db.bind.dialect.name in ("postgresql", "mysql"):
            order_query = order_query.with_for_update()
    except Exception:
        pass

    order = order_query.first()
    if not order:
        logger.warning(f"Payment notify order not found: {order_no}")
        return "fail"

    # 幂等处理：已支付的订单不再处理
    if order.status == OrderStatus.PAID:
        logger.info(f"Order already paid, skipping: {order_no}")
        return "success"

    # 校验金额（易支付回调 money 是"元"）
    try:
        paid_money = Decimal(money).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        expected_money = (Decimal(order.amount) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError):
        logger.warning("Payment notify money invalid: out_trade_no=%s money=%s", order_no, money)
        return "fail"

    if paid_money != expected_money:
        logger.warning(
            "Payment notify money mismatch: out_trade_no=%s paid=%s expected=%s",
            order_no, str(paid_money), str(expected_money)
        )
        return "fail"

    # 校验支付方式
    if order.pay_type and pay_type and order.pay_type != pay_type:
        logger.warning("Payment notify pay_type mismatch: out_trade_no=%s", order_no)
        return "fail"

    # 防止回调复用/串单
    if order.trade_no and trade_no and order.trade_no != trade_no:
        logger.warning("Payment notify trade_no mismatch: out_trade_no=%s", order_no)
        return "fail"

    # 获取套餐信息
    plan = db.query(Plan).filter(Plan.id == order.plan_id).first()
    if not plan:
        logger.error(f"Plan not found for order: {order_no}")
        return "fail"

    # 生成兑换码
    redeem_code = _generate_redeem_code(db, plan.validity_days, order_no)

    # 更新订单状态
    order.status = OrderStatus.PAID
    order.trade_no = trade_no
    order.redeem_code = redeem_code
    order.paid_at = datetime.utcnow()

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Payment notify commit failed: out_trade_no=%s err=%s", order_no, str(e))
        return "fail"

    logger.info(f"Order paid successfully: {order_no}, redeem_code: {redeem_code}")

    return "success"


def _generate_redeem_code(db: Session, validity_days: int, order_no: str) -> str:
    """生成兑换码"""
    # 生成唯一兑换码（12位增强唯一性）
    while True:
        chars = string.ascii_uppercase + string.digits
        code_str = "BUY_" + "".join(secrets.choice(chars) for _ in range(12))

        redeem_code = RedeemCode(
            code=code_str,
            code_type=RedeemCodeType.DIRECT,
            max_uses=1,
            validity_days=validity_days,
            note=f"在线购买-订单:{order_no}",
            group_id=None,  # 不限分组
            is_active=True,
        )
        db.add(redeem_code)
        try:
            db.flush()
            return code_str
        except IntegrityError:
            db.rollback()
            continue

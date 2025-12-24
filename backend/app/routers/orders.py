# 订单管理 API（管理后台）
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc
from pydantic import BaseModel

from app.database import get_db
from app.models import Order, OrderStatus, Plan, User, UserRole
from app.services.auth import require_roles

router = APIRouter(prefix="/orders", tags=["订单管理"])


# ============ 响应模型 ============

class OrderResponse(BaseModel):
    id: int
    order_no: str
    plan_id: int
    plan_name: Optional[str] = None
    amount: int                                    # 原价（分）
    coupon_code: Optional[str] = None              # 优惠码
    discount_amount: int = 0                       # 优惠金额（分）
    final_amount: Optional[int] = None             # 实付金额（分）
    status: str
    redeem_code: Optional[str]
    trade_no: Optional[str]
    pay_type: Optional[str]
    paid_at: Optional[datetime]
    expire_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class OrderListResponse(BaseModel):
    orders: List[OrderResponse]
    total: int


class OrderStatsResponse(BaseModel):
    total_orders: int
    paid_orders: int
    pending_orders: int
    total_revenue: int  # 分
    today_orders: int
    today_revenue: int  # 分
    linuxdo_revenue: int = 0  # LinuxDo 订单总收入（分）
    linuxdo_orders: int = 0  # LinuxDo 订单总数


# ============ 管理后台 API ============

@router.get("", response_model=OrderListResponse)
async def list_orders(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """获取订单列表"""
    query = db.query(Order).options(joinedload(Order.plan))

    # 状态筛选
    if status:
        try:
            status_enum = OrderStatus(status)
            query = query.filter(Order.status == status_enum)
        except ValueError:
            pass

    # 总数
    total = query.count()

    # 分页
    orders = query.order_by(desc(Order.created_at)).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    # 转换响应
    result = []
    for order in orders:
        result.append(OrderResponse(
            id=order.id,
            order_no=order.order_no,
            plan_id=order.plan_id,
            plan_name=order.plan.name if order.plan else None,
            amount=order.amount,
            coupon_code=order.coupon_code,
            discount_amount=order.discount_amount or 0,
            final_amount=order.final_amount,
            status=order.status.value if isinstance(order.status, OrderStatus) else order.status,
            redeem_code=order.redeem_code,
            trade_no=order.trade_no,
            pay_type=order.pay_type,
            paid_at=order.paid_at,
            expire_at=order.expire_at,
            created_at=order.created_at,
        ))

    return OrderListResponse(orders=result, total=total)


@router.get("/stats", response_model=OrderStatsResponse)
async def get_order_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """获取订单统计"""
    from sqlalchemy import func
    from app.utils.timezone import get_today_range_utc8

    # 总订单数
    total_orders = db.query(Order).count()

    # 已支付订单数
    paid_orders = db.query(Order).filter(Order.status == OrderStatus.PAID).count()

    # 待支付订单数
    pending_orders = db.query(Order).filter(Order.status == OrderStatus.PENDING).count()

    # 总收入（使用实付金额）
    total_revenue = db.query(func.sum(
        func.coalesce(Order.final_amount, Order.amount)
    )).filter(
        Order.status == OrderStatus.PAID
    ).scalar() or 0

    # 今日订单
    today_start, today_end = get_today_range_utc8()
    today_orders = db.query(Order).filter(
        Order.created_at >= today_start,
        Order.created_at < today_end,
        Order.status == OrderStatus.PAID
    ).count()

    # 今日收入（使用实付金额）
    today_revenue = db.query(func.sum(
        func.coalesce(Order.final_amount, Order.amount)
    )).filter(
        Order.created_at >= today_start,
        Order.created_at < today_end,
        Order.status == OrderStatus.PAID
    ).scalar() or 0

    # LinuxDo 订单统计
    linuxdo_orders = db.query(Order).filter(
        Order.pay_type == "linuxdo",
        Order.status == OrderStatus.PAID
    ).count()

    linuxdo_revenue = db.query(func.sum(
        func.coalesce(Order.final_amount, Order.amount)
    )).filter(
        Order.pay_type == "linuxdo",
        Order.status == OrderStatus.PAID
    ).scalar() or 0

    return OrderStatsResponse(
        total_orders=total_orders,
        paid_orders=paid_orders,
        pending_orders=pending_orders,
        total_revenue=total_revenue,
        today_orders=today_orders,
        today_revenue=today_revenue,
        linuxdo_orders=linuxdo_orders,
        linuxdo_revenue=linuxdo_revenue,
    )


@router.get("/{order_no}", response_model=OrderResponse)
async def get_order(
    order_no: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """获取订单详情"""
    order = db.query(Order).options(joinedload(Order.plan)).filter(
        Order.order_no == order_no
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    return OrderResponse(
        id=order.id,
        order_no=order.order_no,
        plan_id=order.plan_id,
        plan_name=order.plan.name if order.plan else None,
        amount=order.amount,
        coupon_code=order.coupon_code,
        discount_amount=order.discount_amount or 0,
        final_amount=order.final_amount,
        status=order.status.value if isinstance(order.status, OrderStatus) else order.status,
        redeem_code=order.redeem_code,
        trade_no=order.trade_no,
        pay_type=order.pay_type,
        paid_at=order.paid_at,
        expire_at=order.expire_at,
        created_at=order.created_at,
    )

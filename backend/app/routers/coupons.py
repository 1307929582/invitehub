# 优惠码管理 API（管理后台）
import json
import secrets
import string
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator

from app.database import get_db
from app.models import Coupon, DiscountType, User, UserRole, Order, OrderStatus
from app.routers.auth import get_current_user
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/coupons", tags=["优惠码管理"])

# 排除易混淆字符的字符集
COUPON_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_coupon_code(prefix: str = "", length: int = 6) -> str:
    """生成优惠码"""
    random_part = "".join(secrets.choice(COUPON_CHARS) for _ in range(length))
    if prefix:
        return f"{prefix.upper()}-{random_part}"
    return random_part


# ============ 请求/响应模型 ============

class CouponCreate(BaseModel):
    """创建优惠码"""
    code: Optional[str] = Field(None, max_length=30, description="自定义优惠码，不填则自动生成")
    prefix: str = Field("", max_length=10, description="批量生成时的前缀")
    count: int = Field(1, ge=1, le=100, description="生成数量")
    discount_type: DiscountType
    discount_value: int = Field(..., ge=1, description="折扣值：固定金额（分）或百分比")
    min_amount: int = Field(0, ge=0, description="最低消费（分）")
    max_discount: Optional[int] = Field(None, ge=0, description="最大优惠（分），百分比用")
    max_uses: int = Field(0, ge=0, description="最大使用次数，0=无限")
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    applicable_plan_ids: Optional[List[int]] = Field(None, description="适用套餐ID列表，null=全部")
    note: Optional[str] = Field(None, max_length=255)

    @field_validator('discount_value')
    @classmethod
    def validate_discount_value(cls, v, info):
        discount_type = info.data.get('discount_type')
        if discount_type == DiscountType.PERCENTAGE and v > 100:
            raise ValueError('百分比折扣不能超过 100')
        return v


class CouponUpdate(BaseModel):
    """更新优惠码"""
    discount_type: Optional[DiscountType] = None
    discount_value: Optional[int] = Field(None, ge=1)
    min_amount: Optional[int] = Field(None, ge=0)
    max_discount: Optional[int] = Field(None, ge=0)
    max_uses: Optional[int] = Field(None, ge=0)
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    applicable_plan_ids: Optional[List[int]] = None
    is_active: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=255)


class CouponResponse(BaseModel):
    """优惠码响应"""
    id: int
    code: str
    discount_type: str
    discount_value: int
    min_amount: int
    max_discount: Optional[int]
    max_uses: int
    used_count: int
    valid_from: Optional[datetime]
    valid_until: Optional[datetime]
    applicable_plan_ids: Optional[List[int]]
    is_active: bool
    note: Optional[str]
    created_by: Optional[int]
    created_at: datetime

    @classmethod
    def from_orm(cls, coupon: Coupon) -> "CouponResponse":
        plan_ids = None
        if coupon.applicable_plan_ids:
            try:
                plan_ids = json.loads(coupon.applicable_plan_ids)
            except (json.JSONDecodeError, TypeError):
                pass

        return cls(
            id=coupon.id,
            code=coupon.code,
            discount_type=coupon.discount_type.value if isinstance(coupon.discount_type, DiscountType) else coupon.discount_type,
            discount_value=coupon.discount_value,
            min_amount=coupon.min_amount or 0,
            max_discount=coupon.max_discount,
            max_uses=coupon.max_uses or 0,
            used_count=coupon.used_count or 0,
            valid_from=coupon.valid_from,
            valid_until=coupon.valid_until,
            applicable_plan_ids=plan_ids,
            is_active=coupon.is_active,
            note=coupon.note,
            created_by=coupon.created_by,
            created_at=coupon.created_at,
        )


class CouponListResponse(BaseModel):
    """优惠码列表响应"""
    coupons: List[CouponResponse]
    total: int


class BatchCreateResponse(BaseModel):
    """批量创建响应"""
    created: List[str]
    count: int


# ============ 管理 API ============

@router.get("", response_model=CouponListResponse)
async def list_coupons(
    is_active: Optional[bool] = Query(None, description="筛选状态"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取优惠码列表"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    query = db.query(Coupon)
    if is_active is not None:
        query = query.filter(Coupon.is_active == is_active)

    total = query.count()
    coupons = query.order_by(Coupon.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return CouponListResponse(
        coupons=[CouponResponse.from_orm(c) for c in coupons],
        total=total,
    )


@router.post("", response_model=BatchCreateResponse)
async def create_coupons(
    data: CouponCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """创建优惠码（支持单个/批量）"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    created_codes = []
    applicable_json = json.dumps(data.applicable_plan_ids) if data.applicable_plan_ids else None

    # 自定义码
    if data.code and data.count == 1:
        code = data.code.strip().upper()
        existing = db.query(Coupon).filter(Coupon.code == code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"优惠码 {code} 已存在")

        coupon = Coupon(
            code=code,
            discount_type=data.discount_type,
            discount_value=data.discount_value,
            min_amount=data.min_amount,
            max_discount=data.max_discount,
            max_uses=data.max_uses,
            valid_from=data.valid_from,
            valid_until=data.valid_until,
            applicable_plan_ids=applicable_json,
            note=data.note,
            created_by=current_user.id,
        )
        db.add(coupon)
        db.commit()
        created_codes.append(code)
        logger.info(f"Coupon created: {code} by user {current_user.id}")
    else:
        # 批量生成
        for _ in range(data.count):
            for attempt in range(10):  # 重试机制
                code = generate_coupon_code(prefix=data.prefix)
                existing = db.query(Coupon).filter(Coupon.code == code).first()
                if not existing:
                    break
            else:
                continue  # 跳过无法生成的

            coupon = Coupon(
                code=code,
                discount_type=data.discount_type,
                discount_value=data.discount_value,
                min_amount=data.min_amount,
                max_discount=data.max_discount,
                max_uses=data.max_uses,
                valid_from=data.valid_from,
                valid_until=data.valid_until,
                applicable_plan_ids=applicable_json,
                note=data.note,
                created_by=current_user.id,
            )
            db.add(coupon)
            created_codes.append(code)

        db.commit()
        logger.info(f"Batch coupons created: {len(created_codes)} by user {current_user.id}")

    return BatchCreateResponse(created=created_codes, count=len(created_codes))


@router.get("/{coupon_id}", response_model=CouponResponse)
async def get_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取优惠码详情"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="优惠码不存在")

    return CouponResponse.from_orm(coupon)


@router.put("/{coupon_id}", response_model=CouponResponse)
async def update_coupon(
    coupon_id: int,
    data: CouponUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新优惠码"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="优惠码不存在")

    update_data = data.model_dump(exclude_unset=True)

    # 处理 applicable_plan_ids
    if 'applicable_plan_ids' in update_data:
        plan_ids = update_data.pop('applicable_plan_ids')
        coupon.applicable_plan_ids = json.dumps(plan_ids) if plan_ids else None

    for key, value in update_data.items():
        setattr(coupon, key, value)

    db.commit()
    db.refresh(coupon)
    logger.info(f"Coupon updated: {coupon.code} by user {current_user.id}")

    return CouponResponse.from_orm(coupon)


@router.delete("/{coupon_id}")
async def delete_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除优惠码"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可删除")

    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="优惠码不存在")

    if coupon.used_count > 0:
        raise HTTPException(status_code=400, detail="已使用的优惠码不能删除，请停用")

    db.delete(coupon)
    db.commit()
    logger.info(f"Coupon deleted: {coupon.code} by user {current_user.id}")

    return {"message": "删除成功"}


@router.put("/{coupon_id}/toggle")
async def toggle_coupon(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """启用/停用优惠码"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="优惠码不存在")

    coupon.is_active = not coupon.is_active
    db.commit()
    logger.info(f"Coupon toggled: {coupon.code} -> {'active' if coupon.is_active else 'inactive'}")

    return {"message": "操作成功", "is_active": coupon.is_active}


class CouponUsageRecord(BaseModel):
    """优惠码使用记录"""
    order_no: str
    email: str
    amount: int
    discount_amount: int
    final_amount: int
    status: str
    paid_at: Optional[datetime]
    created_at: datetime


class CouponUsageResponse(BaseModel):
    """优惠码使用记录响应"""
    code: str
    used_count: int
    records: List[CouponUsageRecord]


@router.get("/{coupon_id}/usage", response_model=CouponUsageResponse)
async def get_coupon_usage(
    coupon_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取优惠码使用记录"""
    if current_user.role not in [UserRole.ADMIN, UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="权限不足")

    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="优惠码不存在")

    # 查询使用此优惠码的订单
    orders = db.query(Order).filter(
        Order.coupon_code == coupon.code
    ).order_by(Order.created_at.desc()).limit(100).all()

    records = [
        CouponUsageRecord(
            order_no=o.order_no,
            email=o.email or "",
            amount=o.amount or 0,
            discount_amount=o.discount_amount or 0,
            final_amount=o.final_amount or o.amount or 0,
            status=o.status.value if isinstance(o.status, OrderStatus) else o.status,
            paid_at=o.paid_at,
            created_at=o.created_at,
        )
        for o in orders
    ]

    return CouponUsageResponse(
        code=coupon.code,
        used_count=coupon.used_count or 0,
        records=records,
    )

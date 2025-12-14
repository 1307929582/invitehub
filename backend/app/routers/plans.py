# 套餐管理 API（管理后台）
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Plan, User, UserRole
from app.services.auth import get_current_user, require_roles

router = APIRouter(prefix="/plans", tags=["套餐管理"])


# ============ 请求/响应模型 ============

class PlanCreate(BaseModel):
    name: str
    price: int  # 分
    original_price: Optional[int] = None
    validity_days: int
    description: Optional[str] = None
    features: Optional[str] = None  # JSON 字符串
    is_active: bool = True
    is_recommended: bool = False
    sort_order: int = 0


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[int] = None
    original_price: Optional[int] = None
    validity_days: Optional[int] = None
    description: Optional[str] = None
    features: Optional[str] = None
    is_active: Optional[bool] = None
    is_recommended: Optional[bool] = None
    sort_order: Optional[int] = None


class PlanResponse(BaseModel):
    id: int
    name: str
    price: int
    original_price: Optional[int]
    validity_days: int
    description: Optional[str]
    features: Optional[str]
    is_active: bool
    is_recommended: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============ 管理后台 API ============

@router.get("", response_model=List[PlanResponse])
async def list_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """获取所有套餐（管理后台）"""
    plans = db.query(Plan).order_by(Plan.sort_order.asc(), Plan.id.asc()).all()
    return plans


@router.post("", response_model=PlanResponse)
async def create_plan(
    data: PlanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """创建套餐"""
    plan = Plan(
        name=data.name,
        price=data.price,
        original_price=data.original_price,
        validity_days=data.validity_days,
        description=data.description,
        features=data.features,
        is_active=data.is_active,
        is_recommended=data.is_recommended,
        sort_order=data.sort_order,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """获取套餐详情"""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在")
    return plan


@router.put("/{plan_id}", response_model=PlanResponse)
async def update_plan(
    plan_id: int,
    data: PlanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """更新套餐"""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在")

    # 更新字段
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(plan, key, value)

    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """删除套餐"""
    from app.models import Order

    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在")

    # 检查是否有关联订单
    order_count = db.query(Order).filter(Order.plan_id == plan_id).count()
    if order_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该套餐有 {order_count} 个关联订单，无法删除。可以选择下架。"
        )

    db.delete(plan)
    db.commit()
    return {"message": "删除成功"}


@router.put("/{plan_id}/toggle")
async def toggle_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """上架/下架套餐"""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="套餐不存在")

    plan.is_active = not plan.is_active
    db.commit()

    return {
        "message": "已上架" if plan.is_active else "已下架",
        "is_active": plan.is_active
    }

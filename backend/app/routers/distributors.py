# 分销商管理路由
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.database import get_db
from app.models import User, UserRole, RedeemCode, InviteRecord, UserApprovalStatus
from app.services.auth import get_current_user, require_roles

router = APIRouter(prefix="/distributors", tags=["分销商管理"])


# ===== 响应模型 =====

class DistributorResponse(BaseModel):
    """分销商信息响应"""
    id: int
    username: str
    email: str
    approval_status: str
    created_at: str

    # 统计数据
    total_codes: int = 0
    active_codes: int = 0
    total_sales: int = 0  # 总销售次数

    class Config:
        from_attributes = True


class DistributorSummaryResponse(BaseModel):
    """分销商统计摘要"""
    total_codes_created: int
    active_codes: int
    inactive_codes: int
    total_sales: int  # 总销售次数（已使用的兑换次数）
    pending_invites: int  # 待接受的邀请数
    accepted_invites: int  # 已接受的邀请数
    total_revenue_estimate: float = 0  # 预估收益（需要单价配置）


class SalesRecordResponse(BaseModel):
    """销售记录响应"""
    code: str
    email: str
    team_name: str
    status: str
    created_at: str
    accepted_at: Optional[str] = None


# ===== 管理员端点 =====

@router.get("", response_model=List[DistributorResponse])
async def list_distributors(
    status: Optional[str] = None,  # approved, pending, rejected
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """
    获取所有分销商列表（管理员）

    可选过滤：
    - status: 审核状态（approved, pending, rejected）
    """
    query = db.query(User).filter(User.role == UserRole.DISTRIBUTOR)

    if status:
        try:
            approval_status = UserApprovalStatus(status)
            query = query.filter(User.approval_status == approval_status)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的状态参数")

    distributors = query.order_by(User.created_at.desc()).all()

    # 为每个分销商计算统计数据
    result = []
    for dist in distributors:
        # 统计兑换码
        codes_query = db.query(RedeemCode).filter(RedeemCode.created_by == dist.id)
        total_codes = codes_query.count()
        active_codes = codes_query.filter(RedeemCode.is_active == True).count()

        # 统计销售次数（所有兑换码的 used_count 总和）
        total_sales = db.query(
            func.coalesce(func.sum(RedeemCode.used_count), 0)
        ).filter(RedeemCode.created_by == dist.id).scalar()

        result.append(DistributorResponse(
            id=dist.id,
            username=dist.username,
            email=dist.email,
            approval_status=dist.approval_status.value,
            created_at=dist.created_at.isoformat() if dist.created_at else "",
            total_codes=total_codes,
            active_codes=active_codes,
            total_sales=int(total_sales)
        ))

    return result


# ===== 分销商端点 =====

@router.get("/me/summary", response_model=DistributorSummaryResponse)
async def get_my_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """
    获取当前分销商的统计摘要
    """
    # 统计兑换码
    codes_query = db.query(RedeemCode).filter(RedeemCode.created_by == current_user.id)
    total_codes = codes_query.count()
    active_codes = codes_query.filter(RedeemCode.is_active == True).count()
    inactive_codes = codes_query.filter(RedeemCode.is_active == False).count()

    # 统计总销售次数
    total_sales = db.query(
        func.coalesce(func.sum(RedeemCode.used_count), 0)
    ).filter(RedeemCode.created_by == current_user.id).scalar()

    # 获取该分销商所有兑换码
    my_codes = [c.code for c in codes_query.all()]

    # 统计邀请记录
    if my_codes:
        invite_query = db.query(InviteRecord).filter(
            InviteRecord.redeem_code.in_(my_codes)
        )

        from app.models import InviteStatus
        pending_invites = invite_query.filter(
            InviteRecord.status == InviteStatus.PENDING
        ).count()
        # InviteStatus 没有 ACCEPTED，使用 accepted_at 字段判断
        accepted_invites = invite_query.filter(
            InviteRecord.accepted_at.isnot(None)
        ).count()
    else:
        pending_invites = 0
        accepted_invites = 0

    # 预估收益（可以从系统配置读取单价）
    from app.models import SystemConfig
    unit_price_config = db.query(SystemConfig).filter(
        SystemConfig.key == "distributor_unit_price"
    ).first()

    unit_price = 0.0
    if unit_price_config and unit_price_config.value:
        try:
            unit_price = float(unit_price_config.value)
        except ValueError:
            pass

    total_revenue = float(total_sales) * unit_price

    return DistributorSummaryResponse(
        total_codes_created=total_codes,
        active_codes=active_codes,
        inactive_codes=inactive_codes,
        total_sales=int(total_sales),
        pending_invites=pending_invites,
        accepted_invites=accepted_invites,
        total_revenue_estimate=round(total_revenue, 2)
    )


@router.get("/me/sales", response_model=List[SalesRecordResponse])
async def get_my_sales(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """
    获取当前分销商的销售记录

    参数：
    - limit: 返回记录数量限制（默认100，最大1000）
    """
    if limit > 1000:
        limit = 1000

    # 获取该分销商的所有兑换码
    my_codes = db.query(RedeemCode.code).filter(
        RedeemCode.created_by == current_user.id
    ).all()
    my_codes_list = [c.code for c in my_codes]

    if not my_codes_list:
        return []

    # 查询使用这些兑换码的邀请记录
    from app.models import Team

    records = db.query(InviteRecord).filter(
        InviteRecord.redeem_code.in_(my_codes_list)
    ).order_by(InviteRecord.created_at.desc()).limit(limit).all()

    # 获取 Team 名称映射
    team_ids = [r.team_id for r in records if r.team_id]
    teams = {}
    if team_ids:
        team_list = db.query(Team).filter(Team.id.in_(team_ids)).all()
        teams = {t.id: t.name for t in team_list}

    return [
        SalesRecordResponse(
            code=r.redeem_code,
            email=r.email,
            team_name=teams.get(r.team_id, "未知"),
            status=r.status.value,
            created_at=r.created_at.isoformat() if r.created_at else "",
            accepted_at=r.accepted_at.isoformat() if r.accepted_at else None
        )
        for r in records
    ]


@router.get("/{distributor_id}/sales", response_model=List[SalesRecordResponse])
async def get_distributor_sales(
    distributor_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """
    管理员查看指定分销商的销售记录

    参数：
    - distributor_id: 分销商 ID
    - limit: 返回记录数量限制（默认100，最大1000）
    """
    if limit > 1000:
        limit = 1000

    # 验证分销商存在
    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    # 获取该分销商的所有兑换码
    codes = db.query(RedeemCode.code).filter(
        RedeemCode.created_by == distributor_id
    ).all()
    codes_list = [c.code for c in codes]

    if not codes_list:
        return []

    # 查询使用这些兑换码的邀请记录
    from app.models import Team

    records = db.query(InviteRecord).filter(
        InviteRecord.redeem_code.in_(codes_list)
    ).order_by(InviteRecord.created_at.desc()).limit(limit).all()

    # 获取 Team 名称映射
    team_ids = [r.team_id for r in records if r.team_id]
    teams = {}
    if team_ids:
        team_list = db.query(Team).filter(Team.id.in_(team_ids)).all()
        teams = {t.id: t.name for t in team_list}

    return [
        SalesRecordResponse(
            code=r.redeem_code,
            email=r.email,
            team_name=teams.get(r.team_id, "未知"),
            status=r.status.value,
            created_at=r.created_at.isoformat() if r.created_at else "",
            accepted_at=r.accepted_at.isoformat() if r.accepted_at else None
        )
        for r in records
    ]

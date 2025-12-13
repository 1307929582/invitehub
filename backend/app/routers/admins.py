# 管理员管理路由
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer, case, and_
from pydantic import BaseModel, EmailStr
from typing import List, Optional

from app.database import get_db
from app.models import User, UserRole, UserApprovalStatus, RedeemCode, InviteRecord, TeamMember, InviteStatus, SystemConfig
from app.services.auth import get_current_user, get_password_hash
from app.utils.timezone import get_today_range_utc8, get_week_range_utc8, get_month_range_utc8, to_beijing_iso

router = APIRouter(prefix="/admins", tags=["管理员管理"])


class AdminResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True


class AdminCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: str = "admin"


class AdminUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", response_model=List[AdminResponse])
async def list_admins(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有管理员列表"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以查看")
    
    users = db.query(User).filter(User.role.in_([UserRole.ADMIN, UserRole.OPERATOR])).all()
    return [AdminResponse(
        id=u.id,
        username=u.username,
        email=u.email,
        role=u.role.value,
        is_active=u.is_active,
        created_at=to_beijing_iso(u.created_at)
    ) for u in users]


@router.post("", response_model=AdminResponse)
async def create_admin(
    data: AdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新管理员"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以创建")
    
    # 检查用户名是否已存在
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    
    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")
    
    # 验证角色
    try:
        role = UserRole(data.role)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的角色")
    
    user = User(
        username=data.username.strip(),
        email=data.email.lower().strip(),
        hashed_password=get_password_hash(data.password),
        role=role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(db, "admin_created", username=user.username, role=data.role, operator=current_user.username)
    
    return AdminResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        created_at=to_beijing_iso(user.created_at)
    )


@router.put("/{admin_id}", response_model=AdminResponse)
async def update_admin(
    admin_id: int,
    data: AdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新管理员信息"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以修改")
    
    user = db.query(User).filter(User.id == admin_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    if data.email:
        existing = db.query(User).filter(User.email == data.email, User.id != admin_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="邮箱已被使用")
        user.email = data.email.lower().strip()
    
    if data.password:
        user.hashed_password = get_password_hash(data.password)
    
    if data.role:
        try:
            user.role = UserRole(data.role)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的角色")
    
    if data.is_active is not None:
        # 不能禁用自己
        if admin_id == current_user.id and not data.is_active:
            raise HTTPException(status_code=400, detail="不能禁用自己")
        user.is_active = data.is_active
    
    db.commit()
    db.refresh(user)
    
    return AdminResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        created_at=to_beijing_iso(user.created_at)
    )


@router.delete("/{admin_id}")
async def delete_admin(
    admin_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除管理员"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以删除")
    
    if admin_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    user = db.query(User).filter(User.id == admin_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    db.delete(user)
    db.commit()

    return {"message": "删除成功"}


# ===== 分销商审核相关 API =====

class DistributorPendingResponse(BaseModel):
    """待审核分销商响应"""
    id: int
    username: str
    email: str
    created_at: str
    approval_status: str
    rejection_reason: Optional[str] = None

    class Config:
        from_attributes = True


class DistributorRejectRequest(BaseModel):
    """拒绝分销商请求"""
    reason: Optional[str] = None


class DistributorCreateRequest(BaseModel):
    """手动创建分销商请求"""
    username: str
    email: EmailStr
    password: str


@router.get("/pending-distributors", response_model=List[DistributorPendingResponse])
async def list_pending_distributors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """查看待审核的分销商"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以查看")

    distributors = db.query(User).filter(
        User.role == UserRole.DISTRIBUTOR,
        User.approval_status != UserApprovalStatus.APPROVED
    ).order_by(User.created_at.asc()).all()

    return [
        DistributorPendingResponse(
            id=u.id,
            username=u.username,
            email=u.email,
            created_at=to_beijing_iso(u.created_at),
            approval_status=u.approval_status.value,
            rejection_reason=u.rejection_reason,
        )
        for u in distributors
    ]


@router.post("/distributors/{distributor_id}/approve")
async def approve_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批准分销商申请"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以审批")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    distributor.approval_status = UserApprovalStatus.APPROVED
    distributor.rejection_reason = None
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor approved: {distributor.username} by {current_user.username}")

    return {"message": "已通过审核", "distributor": distributor.username}


@router.post("/distributors/{distributor_id}/reject")
async def reject_distributor(
    distributor_id: int,
    payload: DistributorRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """拒绝分销商申请"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以审批")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    distributor.approval_status = UserApprovalStatus.REJECTED
    distributor.rejection_reason = payload.reason
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor rejected: {distributor.username} by {current_user.username}, reason: {payload.reason}")

    return {"message": "已拒绝申请", "distributor": distributor.username}


@router.delete("/distributors/{distributor_id}")
async def delete_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除分销商"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以删除分销商")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    username = distributor.username
    db.delete(distributor)
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor deleted: {username} by {current_user.username}")

    return {"message": "删除成功", "distributor": username}


@router.post("/distributors/create")
async def create_distributor(
    payload: DistributorCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手动创建分销商账号（管理员）

    创建的分销商自动批准，无需审核流程
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以创建分销商")

    # 检查用户名
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 检查邮箱
    if db.query(User).filter(User.email == payload.email.lower()).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")

    # 创建分销商（自动批准）
    distributor = User(
        username=payload.username.strip(),
        email=payload.email.lower().strip(),
        hashed_password=get_password_hash(payload.password),
        role=UserRole.DISTRIBUTOR,
        approval_status=UserApprovalStatus.APPROVED,
        is_active=True
    )
    db.add(distributor)
    db.commit()
    db.refresh(distributor)

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor created manually: {distributor.username} by {current_user.username}")

    return {
        "message": "分销商创建成功",
        "distributor": {
            "id": distributor.id,
            "username": distributor.username,
            "email": distributor.email
        }
    }


# ===== 分销商数据分析 API =====

class DistributorAnalyticsItem(BaseModel):
    """单个分销商的分析数据"""
    id: int
    username: str
    email: str
    approval_status: str
    created_at: str
    # 统计数据
    total_codes: int = 0
    active_codes: int = 0
    total_sales: int = 0  # 总销售次数（used_count 总和）
    today_sales: int = 0  # 今日销售
    week_sales: int = 0  # 本周销售
    month_sales: int = 0  # 本月销售
    active_members: int = 0  # 当前活跃成员数
    revenue_estimate: float = 0.0  # 预估收益

    class Config:
        from_attributes = True


class DistributorAnalyticsResponse(BaseModel):
    """分销商数据分析响应"""
    items: List[DistributorAnalyticsItem]
    total: int
    summary: dict  # 汇总数据


class DistributorDetailResponse(BaseModel):
    """单个分销商详情"""
    distributor: DistributorAnalyticsItem
    recent_sales: List[dict]  # 近期销售记录
    codes_summary: dict  # 兑换码统计


def get_distributor_unit_price(db: Session) -> float:
    """获取分销商单价配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == "distributor_unit_price").first()
    if config and config.value:
        try:
            return float(config.value)
        except ValueError:
            return 0.0
    # 回退到普通单价
    config = db.query(SystemConfig).filter(SystemConfig.key == "redeem_unit_price").first()
    if config and config.value:
        try:
            return float(config.value)
        except ValueError:
            return 0.0
    return 0.0


@router.get("/distributors/analytics", response_model=DistributorAnalyticsResponse)
async def get_distributors_analytics(
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "total_sales",  # total_sales, today_sales, created_at, active_members
    status: Optional[str] = None,  # approved, pending, rejected
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    管理员查看所有分销商的数据分析

    - 支持分页和排序
    - 支持按审核状态筛选
    - 统计使用 UTC+8 时区
    - 优化：使用批量聚合查询避免 N+1 问题
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可访问")

    # 获取时间范围（UTC+8）
    today_start, today_end = get_today_range_utc8()
    week_start, week_end = get_week_range_utc8()
    month_start, month_end = get_month_range_utc8()

    # 获取单价
    unit_price = get_distributor_unit_price(db)

    # 基础查询：获取所有分销商 ID
    query = db.query(User).filter(User.role == UserRole.DISTRIBUTOR)
    if status:
        try:
            approval_status = UserApprovalStatus(status)
            query = query.filter(User.approval_status == approval_status)
        except ValueError:
            pass

    distributors = query.all()

    if not distributors:
        return DistributorAnalyticsResponse(
            items=[],
            total=0,
            summary={
                "total_distributors": 0,
                "approved_count": 0,
                "pending_count": 0,
                "total_revenue": 0,
                "total_sales": 0,
                "today_sales": 0,
                "unit_price": unit_price
            }
        )

    dist_ids = [d.id for d in distributors]

    # 批量查询 1：兑换码统计（total_codes, active_codes, total_sales）
    code_stats = db.query(
        RedeemCode.created_by,
        func.count(RedeemCode.id).label("total_codes"),
        func.sum(func.cast(RedeemCode.is_active == True, Integer)).label("active_codes"),
        func.coalesce(func.sum(RedeemCode.used_count), 0).label("total_sales")
    ).filter(
        RedeemCode.created_by.in_(dist_ids)
    ).group_by(
        RedeemCode.created_by
    ).all()

    code_stats_map = {
        s.created_by: {
            "total_codes": s.total_codes or 0,
            "active_codes": int(s.active_codes or 0),
            "total_sales": int(s.total_sales or 0)
        }
        for s in code_stats
    }

    # 批量查询 2：获取每个分销商的兑换码列表（用于后续查询）
    all_codes = db.query(
        RedeemCode.created_by,
        RedeemCode.code
    ).filter(
        RedeemCode.created_by.in_(dist_ids)
    ).all()

    # 构建分销商 -> 兑换码列表映射
    codes_by_distributor = {}
    all_code_list = []
    for c in all_codes:
        if c.created_by not in codes_by_distributor:
            codes_by_distributor[c.created_by] = []
        codes_by_distributor[c.created_by].append(c.code)
        all_code_list.append(c.code)

    # 批量查询 3：销售统计（使用条件聚合）
    if all_code_list:
        sales_stats = db.query(
            InviteRecord.redeem_code,
            func.count(InviteRecord.id).filter(
                InviteRecord.status == InviteStatus.SUCCESS,
                InviteRecord.created_at >= today_start,
                InviteRecord.created_at < today_end
            ).label("today_sales"),
            func.count(InviteRecord.id).filter(
                InviteRecord.status == InviteStatus.SUCCESS,
                InviteRecord.created_at >= week_start,
                InviteRecord.created_at < week_end
            ).label("week_sales"),
            func.count(InviteRecord.id).filter(
                InviteRecord.status == InviteStatus.SUCCESS,
                InviteRecord.created_at >= month_start,
                InviteRecord.created_at < month_end
            ).label("month_sales")
        ).filter(
            InviteRecord.redeem_code.in_(all_code_list)
        ).group_by(
            InviteRecord.redeem_code
        ).all()

        # 构建兑换码 -> 销售统计映射
        sales_by_code = {
            s.redeem_code: {
                "today": s.today_sales or 0,
                "week": s.week_sales or 0,
                "month": s.month_sales or 0
            }
            for s in sales_stats
        }

        # 批量查询 4：活跃成员数（简化查询）
        active_members_stats = db.query(
            InviteRecord.redeem_code,
            func.count(func.distinct(TeamMember.id)).label("active_count")
        ).join(
            TeamMember, TeamMember.email == InviteRecord.email
        ).filter(
            InviteRecord.redeem_code.in_(all_code_list),
            InviteRecord.status == InviteStatus.SUCCESS
        ).group_by(
            InviteRecord.redeem_code
        ).all()

        active_members_by_code = {
            s.redeem_code: s.active_count or 0
            for s in active_members_stats
        }
    else:
        sales_by_code = {}
        active_members_by_code = {}

    # 聚合每个分销商的统计数据
    items = []
    total_revenue = 0.0
    total_sales_all = 0
    total_today_sales = 0

    for dist in distributors:
        dist_stats = code_stats_map.get(dist.id, {"total_codes": 0, "active_codes": 0, "total_sales": 0})
        dist_codes = codes_by_distributor.get(dist.id, [])

        # 聚合该分销商所有兑换码的销售数据
        today_sales = sum(sales_by_code.get(code, {}).get("today", 0) for code in dist_codes)
        week_sales = sum(sales_by_code.get(code, {}).get("week", 0) for code in dist_codes)
        month_sales = sum(sales_by_code.get(code, {}).get("month", 0) for code in dist_codes)
        active_members = sum(active_members_by_code.get(code, 0) for code in dist_codes)

        revenue = dist_stats["total_sales"] * unit_price

        items.append(DistributorAnalyticsItem(
            id=dist.id,
            username=dist.username,
            email=dist.email,
            approval_status=dist.approval_status.value,
            created_at=to_beijing_iso(dist.created_at),
            total_codes=dist_stats["total_codes"],
            active_codes=dist_stats["active_codes"],
            total_sales=dist_stats["total_sales"],
            today_sales=today_sales,
            week_sales=week_sales,
            month_sales=month_sales,
            active_members=active_members,
            revenue_estimate=round(revenue, 2)
        ))

        total_revenue += revenue
        total_sales_all += dist_stats["total_sales"]
        total_today_sales += today_sales

    # 排序（内存排序，因为聚合字段无法在 SQL 层排序）
    if sort_by == "total_sales":
        items.sort(key=lambda x: x.total_sales, reverse=True)
    elif sort_by == "today_sales":
        items.sort(key=lambda x: x.today_sales, reverse=True)
    elif sort_by == "active_members":
        items.sort(key=lambda x: x.active_members, reverse=True)
    elif sort_by == "created_at":
        items.sort(key=lambda x: x.created_at, reverse=True)

    # 分页
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return DistributorAnalyticsResponse(
        items=items[start:end],
        total=total,
        summary={
            "total_distributors": total,
            "approved_count": sum(1 for i in items if i.approval_status == "approved"),
            "pending_count": sum(1 for i in items if i.approval_status == "pending"),
            "total_revenue": round(total_revenue, 2),
            "total_sales": total_sales_all,
            "today_sales": total_today_sales,
            "unit_price": unit_price
        }
    )


@router.get("/distributors/{distributor_id}/detail", response_model=DistributorDetailResponse)
async def get_distributor_detail(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    管理员查看单个分销商的详细数据
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可访问")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    # 获取时间范围
    today_start, today_end = get_today_range_utc8()
    week_start, week_end = get_week_range_utc8()
    month_start, month_end = get_month_range_utc8()
    unit_price = get_distributor_unit_price(db)

    # 统计兑换码
    codes_query = db.query(RedeemCode).filter(RedeemCode.created_by == distributor.id)
    total_codes = codes_query.count()
    active_codes = codes_query.filter(RedeemCode.is_active == True).count()
    total_sales = db.query(func.coalesce(func.sum(RedeemCode.used_count), 0)).filter(
        RedeemCode.created_by == distributor.id
    ).scalar() or 0

    my_codes = [c.code for c in codes_query.all()]

    today_sales = 0
    week_sales = 0
    month_sales = 0
    active_members = 0
    recent_sales = []

    if my_codes:
        today_sales = db.query(func.count(InviteRecord.id)).filter(
            InviteRecord.redeem_code.in_(my_codes),
            InviteRecord.status == InviteStatus.SUCCESS,
            InviteRecord.created_at >= today_start,
            InviteRecord.created_at < today_end
        ).scalar() or 0

        week_sales = db.query(func.count(InviteRecord.id)).filter(
            InviteRecord.redeem_code.in_(my_codes),
            InviteRecord.status == InviteStatus.SUCCESS,
            InviteRecord.created_at >= week_start,
            InviteRecord.created_at < week_end
        ).scalar() or 0

        month_sales = db.query(func.count(InviteRecord.id)).filter(
            InviteRecord.redeem_code.in_(my_codes),
            InviteRecord.status == InviteStatus.SUCCESS,
            InviteRecord.created_at >= month_start,
            InviteRecord.created_at < month_end
        ).scalar() or 0

        active_members = db.query(func.count(TeamMember.id.distinct())).join(
            InviteRecord, TeamMember.email == InviteRecord.email
        ).filter(
            InviteRecord.redeem_code.in_(my_codes),
            InviteRecord.status == InviteStatus.SUCCESS
        ).scalar() or 0

        # 近期销售记录
        from app.models import Team
        records = db.query(InviteRecord).filter(
            InviteRecord.redeem_code.in_(my_codes)
        ).order_by(InviteRecord.created_at.desc()).limit(20).all()

        team_ids = [r.team_id for r in records if r.team_id]
        teams = {}
        if team_ids:
            team_list = db.query(Team).filter(Team.id.in_(team_ids)).all()
            teams = {t.id: t.name for t in team_list}

        recent_sales = [
            {
                "email": r.email,
                "redeem_code": r.redeem_code,
                "team_name": teams.get(r.team_id, "未知"),
                "status": r.status.value,
                "created_at": to_beijing_iso(r.created_at)
            }
            for r in records
        ]

    return DistributorDetailResponse(
        distributor=DistributorAnalyticsItem(
            id=distributor.id,
            username=distributor.username,
            email=distributor.email,
            approval_status=distributor.approval_status.value,
            created_at=to_beijing_iso(distributor.created_at),
            total_codes=total_codes,
            active_codes=active_codes,
            total_sales=int(total_sales),
            today_sales=today_sales,
            week_sales=week_sales,
            month_sales=month_sales,
            active_members=active_members,
            revenue_estimate=round(int(total_sales) * unit_price, 2)
        ),
        recent_sales=recent_sales,
        codes_summary={
            "total": total_codes,
            "active": active_codes,
            "inactive": total_codes - active_codes,
            "usage_rate": round((total_codes - active_codes) / total_codes * 100, 1) if total_codes > 0 else 0
        }
    )

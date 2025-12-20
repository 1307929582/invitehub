# 分销商管理路由
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer, update
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
import secrets
import string

from app.database import get_db
from app.models import (
    User, UserRole, RedeemCode, InviteRecord, UserApprovalStatus,
    Team, TeamMember, InviteStatus, Plan, Order, OrderStatus,
    RedeemCodeType, SystemConfig
)
from app.services.auth import get_current_user, require_roles
from app.utils.timezone import to_beijing_iso
from app.services.epay import get_epay_config, create_payment_url, generate_order_no

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

    if not distributors:
        return []

    # 批量获取所有分销商的统计数据（避免 N+1 查询）
    dist_ids = [d.id for d in distributors]

    # 单次聚合查询：total_codes, active_codes, total_sales
    stats = db.query(
        RedeemCode.created_by,
        func.count(RedeemCode.id).label("total_codes"),
        func.sum(func.cast(RedeemCode.is_active == True, Integer)).label("active_codes"),
        func.coalesce(func.sum(RedeemCode.used_count), 0).label("total_sales")
    ).filter(
        RedeemCode.created_by.in_(dist_ids)
    ).group_by(
        RedeemCode.created_by
    ).all()

    # 构建统计数据映射
    stats_map = {
        s.created_by: {
            "total_codes": s.total_codes or 0,
            "active_codes": int(s.active_codes or 0),
            "total_sales": int(s.total_sales or 0)
        }
        for s in stats
    }

    result = []
    for dist in distributors:
        dist_stats = stats_map.get(dist.id, {"total_codes": 0, "active_codes": 0, "total_sales": 0})
        result.append(DistributorResponse(
            id=dist.id,
            username=dist.username,
            email=dist.email,
            approval_status=dist.approval_status.value,
            created_at=to_beijing_iso(dist.created_at),
            total_codes=dist_stats["total_codes"],
            active_codes=dist_stats["active_codes"],
            total_sales=dist_stats["total_sales"]
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
            created_at=to_beijing_iso(r.created_at),
            accepted_at=to_beijing_iso(r.accepted_at) or None
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
            created_at=to_beijing_iso(r.created_at),
            accepted_at=to_beijing_iso(r.accepted_at) or None
        )
        for r in records
    ]


# ===== 分销商成员管理 API =====

class MemberResponse(BaseModel):
    """成员信息响应"""
    id: int
    email: str
    team_id: int
    team_name: str
    redeem_code: str
    joined_at: Optional[str] = None
    status: str  # active, removed


class RemoveMemberRequest(BaseModel):
    """移除成员请求"""
    email: EmailStr
    team_id: int
    reason: Optional[str] = None


class AddMemberRequest(BaseModel):
    """添加成员请求"""
    email: EmailStr
    team_id: int


@router.get("/me/members", response_model=List[MemberResponse])
async def get_my_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """
    获取分销商售出兑换码对应的所有成员

    返回该分销商创建的兑换码所邀请的所有成员
    """
    # 获取该分销商的所有兑换码
    my_codes = db.query(RedeemCode).filter(
        RedeemCode.created_by == current_user.id
    ).all()
    my_codes_list = [c.code for c in my_codes]

    if not my_codes_list:
        return []

    # 查询使用这些兑换码成功邀请的成员
    records = db.query(InviteRecord).filter(
        InviteRecord.redeem_code.in_(my_codes_list),
        InviteRecord.status == InviteStatus.SUCCESS
    ).all()

    # 获取 Team 名称映射
    team_ids = list(set([r.team_id for r in records if r.team_id]))
    teams = {}
    if team_ids:
        team_list = db.query(Team).filter(Team.id.in_(team_ids)).all()
        teams = {t.id: t.name for t in team_list}

    # 获取 TeamMember 信息判断成员是否仍在 team 中
    member_emails = [r.email for r in records]
    active_members = db.query(TeamMember).filter(
        TeamMember.email.in_(member_emails)
    ).all()
    active_member_set = set((m.email, m.team_id) for m in active_members)

    result = []
    for r in records:
        is_active = (r.email, r.team_id) in active_member_set
        result.append(MemberResponse(
            id=r.id,
            email=r.email,
            team_id=r.team_id,
            team_name=teams.get(r.team_id, "未知"),
            redeem_code=r.redeem_code,
            joined_at=to_beijing_iso(r.accepted_at) or None,
            status="active" if is_active else "removed"
        ))

    return result


@router.post("/me/members/remove")
async def remove_member(
    payload: RemoveMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """
    分销商移除成员

    - 验证该成员是通过分销商的兑换码邀请的
    - 调用 ChatGPT API 移除成员
    - 恢复兑换码使用次数（used_count - 1）
    """
    # 验证该成员是通过分销商的兑换码邀请的
    my_codes = db.query(RedeemCode.code).filter(
        RedeemCode.created_by == current_user.id
    ).all()
    my_codes_list = [c.code for c in my_codes]

    if not my_codes_list:
        raise HTTPException(status_code=400, detail="您没有创建任何兑换码")

    # 查找对应的邀请记录
    invite_record = db.query(InviteRecord).filter(
        InviteRecord.email == payload.email.lower(),
        InviteRecord.team_id == payload.team_id,
        InviteRecord.redeem_code.in_(my_codes_list),
        InviteRecord.status == InviteStatus.SUCCESS
    ).first()

    if not invite_record:
        raise HTTPException(status_code=404, detail="未找到该成员的邀请记录，或该成员不是通过您的兑换码邀请的")

    # 检查成员是否仍在 team 中
    team_member = db.query(TeamMember).filter(
        TeamMember.email == payload.email.lower(),
        TeamMember.team_id == payload.team_id
    ).first()

    if not team_member:
        raise HTTPException(status_code=400, detail="该成员已不在 Team 中")

    # 获取 Team 信息
    team = db.query(Team).filter(Team.id == payload.team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")

    # 调用 ChatGPT API 移除成员
    from app.services.chatgpt_api import ChatGPTAPI
    from app.logger import get_logger
    logger = get_logger(__name__)

    api = ChatGPTAPI(team.session_token)
    try:
        # 获取成员的 ChatGPT user_id
        if not team_member.chatgpt_user_id:
            raise HTTPException(status_code=400, detail="成员缺少 ChatGPT User ID，无法移除")

        result = await api.remove_member(team.account_id, team_member.chatgpt_user_id)
        if not result:
            raise HTTPException(status_code=500, detail="移除成员失败，请稍后重试")
    except HTTPException:
        raise
    except Exception as e:
        # 记录详细错误日志，但不向用户暴露内部错误信息
        logger.error(f"Failed to remove member {payload.email} from team {team.name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="移除成员失败，请稍后重试")

    # 从数据库删除成员记录
    db.delete(team_member)

    # 恢复兑换码使用次数（使用原子操作避免并发问题）
    db.execute(
        update(RedeemCode)
        .where(RedeemCode.code == invite_record.redeem_code)
        .where(RedeemCode.used_count > 0)
        .values(used_count=RedeemCode.used_count - 1)
    )

    # 更新邀请记录状态（标记为已移除）
    invite_record.status = InviteStatus.REMOVED
    invite_record.error_message = f"被分销商移除: {payload.reason or '无原因'}"

    db.commit()

    logger.info(f"Distributor {current_user.username} removed member {payload.email} from team {team.name}")

    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(
        db, "distributor_member_removed",
        distributor_name=current_user.username,
        email=payload.email,
        team_name=team.name,
        redeem_code=invite_record.redeem_code,
        reason=payload.reason or ""
    )

    return {
        "message": "成员移除成功",
        "email": payload.email,
        "team_name": team.name,
        "code_usage_restored": True
    }


@router.post("/me/members/add")
async def add_member(
    payload: AddMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """
    分销商重新邀请成员

    - 验证该成员之前是通过分销商的兑换码邀请的（且已被移除）
    - 创建新的邀请任务
    """
    # 验证该分销商的兑换码
    my_codes = db.query(RedeemCode).filter(
        RedeemCode.created_by == current_user.id
    ).all()
    my_codes_list = [c.code for c in my_codes]

    if not my_codes_list:
        raise HTTPException(status_code=400, detail="您没有创建任何兑换码")

    # 查找之前的邀请记录（被移除的）
    previous_invite = db.query(InviteRecord).filter(
        InviteRecord.email == payload.email.lower(),
        InviteRecord.team_id == payload.team_id,
        InviteRecord.redeem_code.in_(my_codes_list)
    ).order_by(InviteRecord.created_at.desc()).first()

    if not previous_invite:
        raise HTTPException(status_code=404, detail="未找到该成员之前的邀请记录")

    # 检查成员是否已在 team 中
    existing_member = db.query(TeamMember).filter(
        TeamMember.email == payload.email.lower(),
        TeamMember.team_id == payload.team_id
    ).first()

    if existing_member:
        raise HTTPException(status_code=400, detail="该成员已在 Team 中")

    # 获取 Team 信息
    team = db.query(Team).filter(Team.id == payload.team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")

    # 检查兑换码是否还有使用次数
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == previous_invite.redeem_code
    ).first()

    if not redeem_code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    if not redeem_code.is_active:
        raise HTTPException(status_code=400, detail="兑换码已停用")

    if redeem_code.max_uses > 0 and redeem_code.used_count >= redeem_code.max_uses:
        raise HTTPException(status_code=400, detail="兑换码使用次数已达上限")

    # 创建新的邀请记录
    new_invite = InviteRecord(
        email=payload.email.lower(),
        team_id=payload.team_id,
        redeem_code=previous_invite.redeem_code,
        status=InviteStatus.PENDING
    )
    db.add(new_invite)

    # 增加兑换码使用次数（使用原子操作避免并发问题）
    result = db.execute(
        update(RedeemCode)
        .where(RedeemCode.code == previous_invite.redeem_code)
        .where(
            (RedeemCode.max_uses == 0) |  # 不限量，或
            (RedeemCode.used_count < RedeemCode.max_uses)  # 未达上限
        )
        .values(used_count=RedeemCode.used_count + 1)
    )

    # 验证更新是否成功（如果已达上限，则不会更新）
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="兑换码使用次数已达上限")

    db.commit()
    db.refresh(new_invite)

    # 触发 Celery 邀请任务
    try:
        from app.tasks_celery import process_invite_task
        process_invite_task.delay(
            email=payload.email.lower(),
            redeem_code=previous_invite.redeem_code,
            group_id=redeem_code.group_id,
            is_rebind=False
        )
    except Exception as e:
        # 如果 Celery 不可用，回退到进程内异步队列
        from app.logger import get_logger
        logger = get_logger(__name__)
        logger.warning(f"Celery task dispatch failed, falling back to async queue: {e}")
        try:
            from app.tasks import enqueue_invite
            import asyncio
            asyncio.create_task(enqueue_invite(
                email=payload.email.lower(),
                redeem_code=previous_invite.redeem_code,
                group_id=redeem_code.group_id,
                is_rebind=False
            ))
        except Exception as fallback_err:
            logger.error(f"Fallback to async queue also failed: {fallback_err}")
            raise HTTPException(status_code=503, detail="服务暂时不可用，请稍后重试")

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor {current_user.username} re-invited {payload.email} to team {team.name}")

    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(
        db, "distributor_member_readded",
        distributor_name=current_user.username,
        email=payload.email,
        team_name=team.name,
        redeem_code=previous_invite.redeem_code
    )

    return {
        "message": "邀请任务已创建",
        "email": payload.email,
        "team_name": team.name,
        "invite_id": new_invite.id
    }


# ===== 分销商购买兑换码 =====

class DistributorCodePlanResponse(BaseModel):
    """分销商码包响应"""
    id: int
    name: str
    price: int  # 价格（分）
    original_price: Optional[int] = None
    code_count: int  # 包含的兑换码数量
    code_max_uses: int  # 每个码的可用次数
    validity_days: int  # 有效天数
    description: Optional[str] = None
    is_recommended: bool = False


class CreateDistributorCodeOrderRequest(BaseModel):
    """创建分销商码包订单请求"""
    plan_id: int
    quantity: int = 1  # 购买份数
    pay_type: str = "alipay"  # 支付方式


class CreateDistributorCodeOrderResponse(BaseModel):
    """创建分销商码包订单响应"""
    order_no: str
    amount: int
    pay_url: str
    expire_at: datetime


class DistributorCodeOrderResponse(BaseModel):
    """分销商码包订单响应"""
    order_no: str
    status: str
    amount: int
    final_amount: Optional[int] = None
    quantity: int
    delivered_count: int
    created_at: str
    paid_at: Optional[str] = None


@router.get("/me/code-plans", response_model=List[DistributorCodePlanResponse])
async def get_my_code_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """获取可购买的码包列表"""
    plans = db.query(Plan).filter(
        Plan.is_active == True,
        Plan.plan_type == "distributor_codes"
    ).order_by(Plan.sort_order.asc(), Plan.id.asc()).all()

    return [
        DistributorCodePlanResponse(
            id=p.id,
            name=p.name,
            price=p.price,
            original_price=p.original_price,
            code_count=p.code_count or 1,
            code_max_uses=p.code_max_uses or 1,
            validity_days=p.validity_days,
            description=p.description,
            is_recommended=p.is_recommended,
        )
        for p in plans
    ]


@router.post("/me/code-orders", response_model=CreateDistributorCodeOrderResponse)
async def create_my_code_order(
    data: CreateDistributorCodeOrderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """创建分销商码包订单"""
    if data.quantity < 1 or data.quantity > 100:
        raise HTTPException(status_code=400, detail="购买数量必须在 1-100 之间")

    # 获取码包套餐
    plan = db.query(Plan).filter(
        Plan.id == data.plan_id,
        Plan.is_active == True,
        Plan.plan_type == "distributor_codes"
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="码包不存在或已下架")

    # 检查总兑换码数量限制（防止回调超时）
    total_codes = (plan.code_count or 1) * data.quantity
    if total_codes > 5000:
        raise HTTPException(
            status_code=400,
            detail=f"单次订单最多生成 5000 个兑换码，当前为 {total_codes} 个。请减少购买份数。"
        )

    # 检查支付配置
    config = get_epay_config(db)
    if not config.get("enabled"):
        raise HTTPException(status_code=400, detail="在线支付未启用")

    # 检查支付方式
    if data.pay_type == "alipay" and not config.get("alipay_enabled"):
        raise HTTPException(status_code=400, detail="支付宝支付未启用")
    if data.pay_type == "wxpay" and not config.get("wxpay_enabled"):
        raise HTTPException(status_code=400, detail="微信支付未启用")

    # 计算金额
    total_amount = plan.price * data.quantity

    # 订单过期时间（15分钟）
    expire_at = datetime.utcnow() + timedelta(minutes=15)

    # 构建回调地址
    site_url_cfg = db.query(SystemConfig).filter(SystemConfig.key == "site_url").first()
    site_url = (site_url_cfg.value or "").strip() if site_url_cfg else ""
    if site_url.startswith(("http://", "https://")):
        base_url = site_url.rstrip("/")
    else:
        base_url = str(request.base_url).rstrip("/")

    notify_url = f"{base_url}/api/v1/public/shop/notify"

    # 生成订单号（重试机制）
    for _ in range(5):
        order_no = generate_order_no()
        return_url = f"{base_url}/distributor?order_no={order_no}"

        pay_url = create_payment_url(
            config=config,
            order_no=order_no,
            amount=total_amount,
            name=f"{plan.name} x{data.quantity}",
            pay_type=data.pay_type,
            notify_url=notify_url,
            return_url=return_url,
        )

        if not pay_url:
            raise HTTPException(status_code=500, detail="创建支付链接失败")

        order = Order(
            order_no=order_no,
            order_type="distributor_codes",  # 分销商订单
            plan_id=plan.id,
            email=current_user.email,
            buyer_user_id=current_user.id,  # 关联到分销商
            quantity=data.quantity,
            amount=total_amount,
            final_amount=total_amount,
            status=OrderStatus.PENDING,
            pay_type=data.pay_type,
            expire_at=expire_at,
        )
        db.add(order)

        try:
            db.commit()
            from app.logger import get_logger
            logger = get_logger(__name__)
            logger.info(f"Created distributor order: {order_no}, distributor: {current_user.username}, quantity: {data.quantity}")

            return CreateDistributorCodeOrderResponse(
                order_no=order_no,
                amount=total_amount,
                pay_url=pay_url,
                expire_at=expire_at,
            )
        except IntegrityError:
            db.rollback()
            continue

    raise HTTPException(status_code=500, detail="创建订单失败，请重试")


@router.get("/me/code-orders", response_model=List[DistributorCodeOrderResponse])
async def list_my_code_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """获取分销商码包订单列表"""
    orders = db.query(Order).filter(
        Order.buyer_user_id == current_user.id,
        Order.order_type == "distributor_codes"
    ).order_by(Order.created_at.desc()).limit(100).all()

    return [
        DistributorCodeOrderResponse(
            order_no=o.order_no,
            status=o.status.value if hasattr(o.status, 'value') else o.status,
            amount=o.amount,
            final_amount=o.final_amount,
            quantity=o.quantity or 1,
            delivered_count=o.delivered_count or 0,
            created_at=to_beijing_iso(o.created_at),
            paid_at=to_beijing_iso(o.paid_at) or None
        )
        for o in orders
    ]


# ===== 管理员赠送兑换码 =====

class GrantCodesRequest(BaseModel):
    """赠送兑换码请求"""
    count: int
    max_uses: int = 1
    validity_days: int = 30
    expires_days: Optional[int] = None
    note: Optional[str] = None


class GrantCodesResponse(BaseModel):
    """赠送兑换码响应"""
    count: int
    distributor_username: str
    message: str


@router.post("/{distributor_id}/grant-codes", response_model=GrantCodesResponse)
async def grant_codes_to_distributor(
    distributor_id: int,
    data: GrantCodesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN))
):
    """管理员赠送兑换码给分销商"""
    # 验证分销商存在
    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()

    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    if data.count < 1 or data.count > 1000:
        raise HTTPException(status_code=400, detail="赠送数量必须在 1-1000 之间")

    # 计算过期时间
    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)

    # 批量生成兑换码
    generated_codes = []
    max_retries_per_code = 10

    for i in range(data.count):
        retry_count = 0
        code_generated = False

        while retry_count < max_retries_per_code:
            chars = string.ascii_uppercase + string.digits
            code_str = f"GIFT_D{distributor_id}_" + "".join(secrets.choice(chars) for _ in range(8))

            redeem_code = RedeemCode(
                code=code_str,
                code_type=RedeemCodeType.DIRECT,
                max_uses=data.max_uses,
                expires_at=expires_at,
                validity_days=data.validity_days,
                note=f"{data.note or '管理员赠送'} (by:{current_user.username})",
                group_id=None,
                is_active=True,
                created_by=distributor_id,  # 关联到分销商
            )

            # 使用 savepoint 避免单个冲突回滚整个批次
            try:
                with db.begin_nested():  # 上下文管理器自动处理 savepoint
                    db.add(redeem_code)
                    db.flush()
                generated_codes.append(code_str)
                code_generated = True
                break
            except IntegrityError:
                # savepoint 自动回滚，不影响外层事务
                retry_count += 1

        if not code_generated:
            # 超过重试次数，抛出异常让整个操作回滚
            raise HTTPException(
                status_code=500,
                detail=f"生成第 {i+1} 个兑换码失败，已回滚所有操作，请重试"
            )

    # 记录操作日志（与生成码在同一事务中）
    from app.models import OperationLog
    log = OperationLog(
        user_id=current_user.id,
        action="grant_codes",
        target=f"distributor:{distributor.username}",
        details=f"赠送 {len(generated_codes)} 个兑换码, 有效期 {data.validity_days} 天"
    )
    db.add(log)

    # 一次性提交所有操作（生成码 + 日志）
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Admin {current_user.username} granted {data.count} codes to distributor {distributor.username}")

    return GrantCodesResponse(
        count=len(generated_codes),
        distributor_username=distributor.username,
        message=f"成功向分销商 {distributor.username} 赠送了 {len(generated_codes)} 个兑换码"
    )

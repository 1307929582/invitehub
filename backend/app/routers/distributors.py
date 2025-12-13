# 分销商管理路由
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

from app.database import get_db
from app.models import User, UserRole, RedeemCode, InviteRecord, UserApprovalStatus, Team, TeamMember, InviteStatus
from app.services.auth import get_current_user, require_roles
from app.utils.timezone import to_beijing_iso

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
            created_at=to_beijing_iso(dist.created_at),
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

    api = ChatGPTAPI(team.session_token)
    try:
        # 获取成员的 ChatGPT user_id
        if not team_member.chatgpt_user_id:
            raise HTTPException(status_code=400, detail="成员缺少 ChatGPT User ID，无法移除")

        result = api.remove_member(team.chatgpt_account_id, team_member.chatgpt_user_id)
        if not result:
            raise HTTPException(status_code=500, detail="调用 ChatGPT API 移除成员失败")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"移除成员失败: {str(e)}")

    # 从数据库删除成员记录
    db.delete(team_member)

    # 恢复兑换码使用次数
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == invite_record.redeem_code
    ).first()
    if redeem_code and redeem_code.used_count > 0:
        redeem_code.used_count -= 1

    # 更新邀请记录状态（标记为已移除）
    invite_record.status = InviteStatus.FAILED
    invite_record.error_message = f"被分销商移除: {payload.reason or '无原因'}"

    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
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

    # 增加兑换码使用次数
    redeem_code.used_count += 1

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
        # 如果 Celery 不可用，回退到同步处理
        from app.logger import get_logger
        logger = get_logger(__name__)
        logger.warning(f"Celery task dispatch failed, falling back to sync: {e}")

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

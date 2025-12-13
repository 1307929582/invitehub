# Dashboard 路由
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from app.database import get_db
from app.models import Team, TeamMember, InviteRecord, OperationLog, User, InviteStatus, RedeemCode, SystemConfig
from app.schemas import DashboardStats, OperationLogResponse, OperationLogListResponse
from app.services.auth import get_current_user
from app.utils.timezone import (
    get_today_range_utc8,
    get_week_range_utc8,
    get_month_range_utc8,
    get_recent_days_ranges_utc8,
    to_beijing_date_str
)

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


class DashboardSummaryResponse(BaseModel):
    """Dashboard 汇总数据"""
    kpi: dict
    team_status_distribution: List[dict]
    activity_trend: List[dict]
    attention_teams: List[dict]


class TeamSeatInfo(BaseModel):
    id: int
    name: str
    max_seats: int
    used_seats: int
    pending_seats: int
    available_seats: int


class SeatStatsResponse(BaseModel):
    total_seats: int
    used_seats: int
    pending_seats: int
    available_seats: int
    teams: List[TeamSeatInfo]


@router.get("/summary", response_model=DashboardSummaryResponse)
async def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dashboard 汇总数据（优化：一次调用，使用 UTC+8 时区）"""
    from app.services.seat_calculator import get_total_seat_stats
    from app.models import TeamStatus, RebindHistory

    seat_stats = get_total_seat_stats(db)
    total_teams = db.query(Team).count()

    # 使用 UTC+8 今日范围
    today_start, today_end = get_today_range_utc8()
    today_invites = db.query(func.count(InviteRecord.id)).filter(
        InviteRecord.created_at >= today_start,
        InviteRecord.created_at < today_end
    ).scalar() or 0
    today_rebinds = db.query(func.count(RebindHistory.id)).filter(
        RebindHistory.created_at >= today_start,
        RebindHistory.created_at < today_end
    ).scalar() or 0

    kpi = {
        "seat_utilization": {
            "percentage": round((seat_stats["confirmed_members"] / seat_stats["total_seats"] * 100), 1) if seat_stats["total_seats"] > 0 else 0,
            "used": seat_stats["confirmed_members"],
            "total": seat_stats["total_seats"]
        },
        "today_activity": {"new_users": today_invites, "rebinds": today_rebinds},
        "total_teams": total_teams
    }

    status_dist = db.query(Team.status, func.count(Team.id)).group_by(Team.status).all()
    team_status_distribution = [{"type": s.value, "value": c} for s, c in status_dist]

    # 使用 UTC+8 近 7 天范围
    recent_days = get_recent_days_ranges_utc8(7)
    activity_trend = []

    for date_str, start_utc, end_utc in recent_days:
        invite_count = db.query(func.count(InviteRecord.id)).filter(
            InviteRecord.created_at >= start_utc,
            InviteRecord.created_at < end_utc
        ).scalar() or 0
        rebind_count = db.query(func.count(RebindHistory.id)).filter(
            RebindHistory.created_at >= start_utc,
            RebindHistory.created_at < end_utc
        ).scalar() or 0
        activity_trend.append({"date": date_str, "value": invite_count, "category": "新增邀请"})
        activity_trend.append({"date": date_str, "value": rebind_count, "category": "换车次数"})

    attention_teams_query = db.query(Team).filter(Team.status.in_([TeamStatus.BANNED, TeamStatus.TOKEN_INVALID])).limit(10).all()
    member_counts = db.query(TeamMember.team_id, func.count(TeamMember.id)).filter(TeamMember.team_id.in_([t.id for t in attention_teams_query])).group_by(TeamMember.team_id).all()
    count_map = dict(member_counts)

    attention_teams = []
    for team in attention_teams_query:
        reason = "被封禁" if team.status == TeamStatus.BANNED else "Token 失效"
        member_count = count_map.get(team.id, 0)
        attention_teams.append({"id": team.id, "name": team.name, "status": team.status.value, "reason": reason, "members": f"{member_count}/{team.max_seats}"})

    return DashboardSummaryResponse(kpi=kpi, team_status_distribution=team_status_distribution, activity_trend=activity_trend, attention_teams=attention_teams)


@router.get("/stats")
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Dashboard 统计数据（使用 UTC+8 时区）"""
    # 总 Team 数
    total_teams = db.query(Team).filter(Team.is_active == True).count()

    # 活跃 Team 数（有成员的）
    active_teams = db.query(Team).join(TeamMember).filter(Team.is_active == True).distinct().count()

    # 总成员数
    total_members = db.query(TeamMember).count()

    # 使用 UTC+8 今日/本周范围
    today_start, today_end = get_today_range_utc8()
    week_start, week_end = get_week_range_utc8()

    # 今日邀请数（UTC+8）
    invites_today = db.query(InviteRecord).filter(
        InviteRecord.created_at >= today_start,
        InviteRecord.created_at < today_end
    ).count()

    # 本周邀请数（UTC+8）
    invites_this_week = db.query(InviteRecord).filter(
        InviteRecord.created_at >= week_start,
        InviteRecord.created_at < week_end
    ).count()

    # 近7天邀请趋势（UTC+8）
    recent_days = get_recent_days_ranges_utc8(7)
    invite_trend = []
    for date_str, start_utc, end_utc in recent_days:
        count = db.query(InviteRecord).filter(
            InviteRecord.created_at >= start_utc,
            InviteRecord.created_at < end_utc
        ).count()
        invite_trend.append({
            "date": date_str,
            "count": count
        })

    return {
        "total_teams": total_teams,
        "total_members": total_members,
        "invites_today": invites_today,
        "invites_this_week": invites_this_week,
        "active_teams": active_teams,
        "invite_trend": invite_trend
    }


@router.get("/seats", response_model=SeatStatsResponse)
async def get_seat_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取座位统计（优化：使用 SeatCalculator）"""
    from app.services.seat_calculator import get_all_teams_with_seats

    # 使用 SeatCalculator 一次性获取所有数据（已优化）
    teams_with_seats = get_all_teams_with_seats(db, only_active=True)

    total_seats = sum(t.max_seats for t in teams_with_seats)
    total_used = sum(t.confirmed_members for t in teams_with_seats)
    total_pending = sum(t.pending_invites for t in teams_with_seats)
    total_available = sum(t.available_seats for t in teams_with_seats)

    team_infos = [
        TeamSeatInfo(
            id=t.team_id,
            name=t.team_name,
            max_seats=t.max_seats,
            used_seats=t.confirmed_members,
            pending_seats=t.pending_invites,
            available_seats=t.available_seats
        )
        for t in teams_with_seats
    ]

    return SeatStatsResponse(
        total_seats=total_seats,
        used_seats=total_used,
        pending_seats=total_pending,
        available_seats=total_available,
        teams=team_infos
    )


# ========== 销售统计 API ==========
class DailyRevenue(BaseModel):
    date: str
    count: int
    revenue: float


class RevenueStats(BaseModel):
    today: float
    this_week: float
    this_month: float
    daily_trend: List[DailyRevenue]
    unit_price: float


def get_unit_price(db: Session) -> float:
    """获取兑换码单价配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == "redeem_unit_price").first()
    if config and config.value:
        try:
            return float(config.value)
        except ValueError:
            return 0.0
    return 0.0


@router.get("/revenue", response_model=RevenueStats)
async def get_revenue_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取销售统计数据（使用 UTC+8 时区）

    - 计算今日/本周/本月销售额（北京时间零点重置）
    - 生成近 7 天销售趋势数据
    """
    unit_price = get_unit_price(db)

    # 使用 UTC+8 时间范围
    today_start, today_end = get_today_range_utc8()
    week_start, week_end = get_week_range_utc8()
    month_start, month_end = get_month_range_utc8()

    # 今日激活的兑换码数量（UTC+8）
    today_count = db.query(RedeemCode).filter(
        RedeemCode.activated_at >= today_start,
        RedeemCode.activated_at < today_end
    ).count()

    # 本周激活的兑换码数量（UTC+8）
    week_count = db.query(RedeemCode).filter(
        RedeemCode.activated_at >= week_start,
        RedeemCode.activated_at < week_end
    ).count()

    # 本月激活的兑换码数量（UTC+8）
    month_count = db.query(RedeemCode).filter(
        RedeemCode.activated_at >= month_start,
        RedeemCode.activated_at < month_end
    ).count()

    # 近 7 天销售趋势（UTC+8）
    recent_days = get_recent_days_ranges_utc8(7)
    daily_trend = []
    for date_str, start_utc, end_utc in recent_days:
        count = db.query(RedeemCode).filter(
            RedeemCode.activated_at >= start_utc,
            RedeemCode.activated_at < end_utc
        ).count()
        daily_trend.append(DailyRevenue(
            date=date_str,
            count=count,
            revenue=count * unit_price
        ))

    return RevenueStats(
        today=today_count * unit_price,
        this_week=week_count * unit_price,
        this_month=month_count * unit_price,
        daily_trend=daily_trend,
        unit_price=unit_price
    )


@router.get("/logs", response_model=OperationLogListResponse)
async def get_operation_logs(
    limit: int = 50,
    team_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取操作日志"""
    query = db.query(OperationLog)
    
    if team_id:
        query = query.filter(OperationLog.team_id == team_id)
    
    logs = query.order_by(OperationLog.created_at.desc()).limit(limit).all()
    
    result = []
    for log in logs:
        log_dict = OperationLogResponse.model_validate(log).model_dump()
        # 添加用户名和 Team 名
        if log.user:
            log_dict["user_name"] = log.user.username
        if log.team:
            log_dict["team_name"] = log.team.name
        result.append(OperationLogResponse(**log_dict))
    
    total = query.count()
    return OperationLogListResponse(logs=result, total=total)

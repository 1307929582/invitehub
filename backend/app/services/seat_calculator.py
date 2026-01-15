# 座位计算器 - 精确计算 Team 可用座位数
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, not_

from app.models import Team, TeamMember, InviteRecord, InviteStatus, TeamStatus

logger = logging.getLogger(__name__)


# pending 邀请的有效窗口（小时）
PENDING_INVITE_WINDOW_HOURS = 24


@dataclass
class TeamSeatInfo:
    """Team 座位信息"""
    team_id: int
    team_name: str
    max_seats: int
    confirmed_members: int  # TeamMember 表中的数量
    pending_invites: int    # 24h 内的 InviteRecord 数量（去重后）
    available_seats: int    # max_seats - confirmed - pending
    
    # 额外信息用于处理
    session_token: str = ""
    device_id: str = ""
    account_id: str = ""
    group_id: Optional[int] = None
    
    @property
    def is_available(self) -> bool:
        """是否有可用座位"""
        return self.available_seats > 0


def get_pending_invite_cutoff() -> datetime:
    """获取 pending 邀请的截止时间"""
    return datetime.utcnow() - timedelta(hours=PENDING_INVITE_WINDOW_HOURS)


def get_team_available_seats(db: Session, team_id: int) -> TeamSeatInfo:
    """
    获取单个 Team 的可用座位数
    
    计算逻辑：
    1. 统计 TeamMember 表中的成员数（confirmed）
    2. 统计 24h 内 InviteRecord 中 status=SUCCESS 且 email 不在 TeamMember 中的数量（pending）
    3. available = max_seats - confirmed - pending
    
    Requirements: 1.1, 1.2, 1.3
    """
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise ValueError(f"Team {team_id} not found")
    
    # 1. 统计已确认成员数
    confirmed_count = db.query(func.count(TeamMember.id)).filter(
        TeamMember.team_id == team_id
    ).scalar() or 0
    
    # 2. 获取该 Team 的所有成员邮箱（用于去重）
    member_emails = db.query(TeamMember.email).filter(
        TeamMember.team_id == team_id
    ).all()
    member_email_set = {e[0].lower() for e in member_emails}
    
    # 3. 统计 pending 邀请数（24h 内，status=SUCCESS 或 RESERVED，email 不在 TeamMember 中）
    # RESERVED: 座位已预占，等待 Celery 处理（防止超员核心逻辑）
    cutoff_time = get_pending_invite_cutoff()

    pending_query = db.query(func.count(func.distinct(InviteRecord.email))).filter(
        InviteRecord.team_id == team_id,
        InviteRecord.status.in_([InviteStatus.SUCCESS, InviteStatus.RESERVED]),
        InviteRecord.created_at >= cutoff_time
    )
    
    # 排除已在 TeamMember 中的邮箱
    if member_email_set:
        pending_query = pending_query.filter(
            not_(func.lower(InviteRecord.email).in_(member_email_set))
        )
    
    pending_count = pending_query.scalar() or 0
    
    # 4. 计算可用座位
    available = max(0, team.max_seats - confirmed_count - pending_count)
    
    return TeamSeatInfo(
        team_id=team.id,
        team_name=team.name,
        max_seats=team.max_seats,
        confirmed_members=confirmed_count,
        pending_invites=pending_count,
        available_seats=available,
        session_token=team.session_token,
        device_id=team.device_id or "",
        account_id=team.account_id,
        group_id=team.group_id
    )


def get_all_teams_with_seats(
    db: Session, 
    group_id: Optional[int] = None,
    only_active: bool = True
) -> List[TeamSeatInfo]:
    """
    获取所有 Team 及其可用座位数
    
    使用优化的查询，一次性获取所有数据，避免 N+1 问题
    
    Args:
        db: 数据库会话
        group_id: 可选的分组 ID 过滤
        only_active: 是否只返回活跃的 Team
    
    Returns:
        List[TeamSeatInfo] 按 available_seats 降序排列
    
    Requirements: 2.1
    """
    # 1. 查询 Teams（统一可分配条件：is_active=true AND status=active）
    team_query = db.query(Team)
    if only_active:
        team_query = team_query.filter(
            Team.is_active == True,
            Team.status == TeamStatus.ACTIVE
        )
    if group_id:
        team_query = team_query.filter(Team.group_id == group_id)
    
    teams = team_query.all()
    
    if not teams:
        return []
    
    team_ids = [t.id for t in teams]
    
    # 2. 批量查询每个 Team 的成员数
    member_counts = db.query(
        TeamMember.team_id,
        func.count(TeamMember.id).label('count')
    ).filter(
        TeamMember.team_id.in_(team_ids)
    ).group_by(TeamMember.team_id).all()
    
    member_count_map = {row[0]: row[1] for row in member_counts}
    
    # 3. 批量查询每个 Team 的成员邮箱（用于去重）
    member_emails_query = db.query(
        TeamMember.team_id,
        func.lower(TeamMember.email)
    ).filter(
        TeamMember.team_id.in_(team_ids)
    ).all()
    
    team_member_emails = {}
    for team_id, email in member_emails_query:
        if team_id not in team_member_emails:
            team_member_emails[team_id] = set()
        team_member_emails[team_id].add(email)
    
    # 4. 批量查询 pending 邀请数（包含 SUCCESS 和 RESERVED 状态）
    # RESERVED: 座位已预占，等待 Celery 处理（防止超员核心逻辑）
    cutoff_time = get_pending_invite_cutoff()

    # 获取所有 24h 内的成功邀请或预占邀请
    pending_invites = db.query(
        InviteRecord.team_id,
        func.lower(InviteRecord.email).label('email')
    ).filter(
        InviteRecord.team_id.in_(team_ids),
        InviteRecord.status.in_([InviteStatus.SUCCESS, InviteStatus.RESERVED]),
        InviteRecord.created_at >= cutoff_time
    ).distinct().all()
    
    # 按 Team 分组并去重（排除已在 TeamMember 中的）
    pending_count_map = {}
    for team_id, email in pending_invites:
        member_set = team_member_emails.get(team_id, set())
        if email not in member_set:
            pending_count_map[team_id] = pending_count_map.get(team_id, 0) + 1
    
    # 5. 构建结果
    results = []
    for team in teams:
        confirmed = member_count_map.get(team.id, 0)
        pending = pending_count_map.get(team.id, 0)
        available = max(0, team.max_seats - confirmed - pending)
        
        results.append(TeamSeatInfo(
            team_id=team.id,
            team_name=team.name,
            max_seats=team.max_seats,
            confirmed_members=confirmed,
            pending_invites=pending,
            available_seats=available,
            session_token=team.session_token,
            device_id=team.device_id or "",
            account_id=team.account_id,
            group_id=team.group_id
        ))
    
    # 按 Team ID 升序排列（优先使用 ID 小的 Team）
    results.sort(key=lambda x: (x.available_seats <= 0, x.team_id))
    
    # 记录座位统计日志
    total_available = sum(t.available_seats for t in results)
    total_max = sum(t.max_seats for t in results)
    
    if total_available == 0:
        logger.warning(f"No available seats! Total capacity: {total_max}, "
                      f"Teams: {len(results)}")
    elif total_available < 5:
        logger.warning(f"Low seat availability: {total_available}/{total_max} "
                      f"across {len(results)} teams")
    
    return results


def get_total_seat_stats(
    db: Session,
    group_id: Optional[int] = None
) -> dict:
    """
    获取总体座位统计
    
    Returns:
        {
            "total_seats": int,
            "confirmed_members": int,
            "pending_invites": int,
            "available_seats": int
        }
    
    Requirements: 4.1, 4.2
    """
    teams = get_all_teams_with_seats(db, group_id=group_id)

    total_seats = sum(t.max_seats for t in teams)
    confirmed = sum(t.confirmed_members for t in teams)
    pending = sum(t.pending_invites for t in teams)
    available = sum(t.available_seats for t in teams)

    return {
        "total_seats": total_seats,
        "confirmed_members": confirmed,
        "pending_invites": pending,
        "available_seats": available
    }


def reserve_seat_atomically(
    db: Session,
    email: str,
    redeem_code: str,
    group_id: Optional[int] = None,
    is_rebind: bool = False
) -> Tuple[bool, Optional[int], Optional[str]]:
    """
    原子性座位预占（核心防超员逻辑）

    流程：
    1. 使用 SELECT FOR UPDATE 锁定候选 Team（按 ID 升序，避免死锁）
    2. 重新计算可用座位（锁内确保一致性）
    3. 找到第一个有空位的 Team，创建 RESERVED 状态的 InviteRecord
    4. 返回预占结果

    Args:
        db: 数据库会话
        email: 用户邮箱
        redeem_code: 兑换码
        group_id: 可选的分组 ID

    Returns:
        Tuple[成功标志, Team ID, Team 名称]
        失败时返回 (False, None, None)

    Note:
        - 调用者需要在事务内调用此函数
        - 成功后调用者负责提交事务
        - 失败时调用者负责回滚事务
    """
    # 1. 查询候选 Team（只查询健康的 Team）
    team_query = db.query(Team).filter(
        Team.is_active == True,
        Team.status == TeamStatus.ACTIVE
    )

    if group_id:
        team_query = team_query.filter(Team.group_id == group_id)

    # 按 ID 升序排列，避免并发时产生死锁
    team_query = team_query.order_by(Team.id.asc())

    # 2. 使用 FOR UPDATE 锁定所有候选 Team（按 ID 顺序，避免死锁）
    # PostgreSQL 支持 with_for_update()，MySQL 需要确保事务隔离级别
    teams = team_query.with_for_update().all()

    if not teams:
        logger.warning("No active teams available for seat reservation")
        return (False, None, None)

    team_ids = [t.id for t in teams]

    # 3. 批量获取各 Team 的成员数（锁内查询，保证一致性）
    member_counts = db.query(
        TeamMember.team_id,
        func.count(TeamMember.id).label('count')
    ).filter(
        TeamMember.team_id.in_(team_ids)
    ).group_by(TeamMember.team_id).all()

    member_count_map = {row[0]: row[1] for row in member_counts}

    # 4. 批量获取成员邮箱（用于排除已在 Team 中的 pending 邀请）
    member_emails_query = db.query(
        TeamMember.team_id,
        func.lower(TeamMember.email)
    ).filter(
        TeamMember.team_id.in_(team_ids)
    ).all()

    team_member_emails = {}
    for team_id, em in member_emails_query:
        if team_id not in team_member_emails:
            team_member_emails[team_id] = set()
        team_member_emails[team_id].add(em)

    # 5. 批量查询 pending 邀请数（包含 SUCCESS 和 RESERVED 状态）
    cutoff_time = get_pending_invite_cutoff()

    pending_invites = db.query(
        InviteRecord.team_id,
        func.lower(InviteRecord.email).label('email')
    ).filter(
        InviteRecord.team_id.in_(team_ids),
        InviteRecord.status.in_([InviteStatus.SUCCESS, InviteStatus.RESERVED]),
        InviteRecord.created_at >= cutoff_time
    ).distinct().all()

    # 按 Team 分组并计数（排除已在 TeamMember 中的）
    pending_count_map = {}
    for team_id, em in pending_invites:
        member_set = team_member_emails.get(team_id, set())
        if em not in member_set:
            pending_count_map[team_id] = pending_count_map.get(team_id, 0) + 1

    # 6. 遍历 Team，找到第一个有空位的
    selected_team = None
    for team in teams:
        confirmed = member_count_map.get(team.id, 0)
        pending = pending_count_map.get(team.id, 0)
        available = team.max_seats - confirmed - pending

        if available > 0:
            selected_team = team
            break

    if not selected_team:
        logger.warning(f"No available seats for reservation", extra={
            "email": email,
            "group_id": group_id
        })
        return (False, None, None)

    # 7. 创建 RESERVED 状态的 InviteRecord（预占座位）
    invite_record = InviteRecord(
        team_id=selected_team.id,
        email=email.lower().strip(),
        redeem_code=redeem_code,
        status=InviteStatus.RESERVED,
        is_rebind=is_rebind
    )
    db.add(invite_record)

    # 注意：不在这里 commit，让调用者决定
    # db.flush() 让记录可见但不提交
    db.flush()

    logger.info(f"Seat reserved successfully", extra={
        "email": email,
        "team_id": selected_team.id,
        "team_name": selected_team.name,
        "invite_record_id": invite_record.id
    })

    return (True, selected_team.id, selected_team.name)

"""
授权检测服务

用于统一判断成员是否为未授权成员（非系统邀请）
"""
from sqlalchemy.orm import Session
from app.models import InviteRecord, InviteStatus, User, SystemConfig, UserRole
from typing import Set
import logging

logger = logging.getLogger(__name__)


def check_is_unauthorized(
    email: str,
    team_id: int,
    role: str,
    db: Session
) -> bool:
    """
    检查成员是否为未授权成员

    逻辑：
    1. 管理员角色不检查 → False
    2. 精确邮箱白名单（authorized_email_whitelist）→ False
    3. 白名单后缀不检查 → False
    4. 系统管理员邮箱不检查 → False
    5. 不在当前 Team 的邀请记录中 → True（未授权）

    Args:
        email: 成员邮箱（应已规范化：lower + strip）
        team_id: Team ID
        role: 成员角色
        db: 数据库会话

    Returns:
        True: 未授权成员
        False: 授权成员
    """
    # 规范化邮箱
    normalized_email = email.lower().strip()
    normalized_role = role.lower().strip()

    # 1. 管理员角色不检查
    admin_roles = {"owner", "admin", "workspace_owner", "workspace_admin", "billing_admin"}
    if normalized_role in admin_roles:
        return False

    # 2. 检查精确邮箱白名单（管理员手动授权的邮箱）
    whitelist_email_config = db.query(SystemConfig).filter(
        SystemConfig.key == "authorized_email_whitelist"
    ).first()

    if whitelist_email_config and whitelist_email_config.value:
        whitelist_emails = {e.strip().lower() for e in whitelist_email_config.value.split(",") if e.strip()}
        if normalized_email in whitelist_emails:
            return False

    # 3. 检查白名单后缀
    whitelist_suffix_config = db.query(SystemConfig).filter(
        SystemConfig.key == "admin_email_suffix"
    ).first()

    if whitelist_suffix_config and whitelist_suffix_config.value:
        whitelist_suffixes = [s.strip().lower() for s in whitelist_suffix_config.value.split(",") if s.strip()]
        if any(normalized_email.endswith(suffix) for suffix in whitelist_suffixes):
            return False

    # 4. 检查是否为系统管理员（仅检查 Admin 角色的活跃用户）
    admin_emails = set()
    admins = db.query(User).filter(
        User.is_active == True,
        User.role == UserRole.ADMIN
    ).all()
    for admin in admins:
        admin_emails.add(admin.email.lower().strip())

    if normalized_email in admin_emails:
        return False

    # 5. 检查是否在当前 Team 的邀请记录中（限定 Team 维度）
    invite_record = db.query(InviteRecord).filter(
        InviteRecord.team_id == team_id,  # ← 关键：限定在当前 Team
        InviteRecord.email == normalized_email,
        InviteRecord.status == InviteStatus.SUCCESS
    ).first()

    # 有邀请记录 = 授权，无邀请记录 = 未授权
    return invite_record is None


def get_authorized_emails_for_team(team_id: int, db: Session) -> Set[str]:
    """
    获取指定 Team 的所有授权邮箱集合（用于批量检查）

    包括：
    1. 该 Team 的成功邀请记录
    2. 系统管理员邮箱
    3. 白名单后缀匹配的（需要单独检查）

    Returns:
        授权邮箱集合（已规范化）
    """
    authorized_emails = set()

    # 1. Team 的成功邀请记录
    invites = db.query(InviteRecord).filter(
        InviteRecord.team_id == team_id,
        InviteRecord.status == InviteStatus.SUCCESS
    ).all()

    for inv in invites:
        authorized_emails.add(inv.email.lower().strip())

    # 2. 系统管理员邮箱（仅 Admin 角色）
    admins = db.query(User).filter(
        User.is_active == True,
        User.role == UserRole.ADMIN
    ).all()
    for admin in admins:
        authorized_emails.add(admin.email.lower().strip())

    return authorized_emails

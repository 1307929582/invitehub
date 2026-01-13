# Pydantic Schemas
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from app.models import UserRole, InviteStatus, TeamStatus


# ========== Auth ==========
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.VIEWER


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# ========== Team ==========
class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None
    account_id: str
    session_token: str
    device_id: Optional[str] = None
    cookie: Optional[str] = None
    group_id: Optional[int] = None
    mailbox_id: Optional[str] = None
    mailbox_email: Optional[str] = None


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    session_token: Optional[str] = None
    device_id: Optional[str] = None
    cookie: Optional[str] = None
    is_active: Optional[bool] = None
    status: Optional[TeamStatus] = None
    group_id: Optional[int] = None
    max_seats: Optional[int] = None
    mailbox_id: Optional[str] = None
    mailbox_email: Optional[str] = None


class TeamResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    account_id: str
    is_active: bool
    status: TeamStatus = TeamStatus.ACTIVE
    status_message: Optional[str] = None
    status_changed_at: Optional[datetime] = None
    max_seats: int = 5
    token_expires_at: Optional[datetime]
    mailbox_id: Optional[str] = None
    mailbox_email: Optional[str] = None
    mailbox_synced_at: Optional[datetime] = None
    created_at: datetime
    member_count: Optional[int] = 0
    group_id: Optional[int] = None
    group_name: Optional[str] = None

    class Config:
        from_attributes = True


class TeamListResponse(BaseModel):
    teams: List[TeamResponse]
    total: int


class TeamBulkStatusUpdate(BaseModel):
    """批量更新 Team 状态"""
    team_ids: List[int]
    status: TeamStatus
    status_message: Optional[str] = None


class TeamBulkStatusResponse(BaseModel):
    """批量更新响应"""
    success_count: int
    failed_count: int
    failed_teams: List[dict] = []  # [{"team_id": int, "error": str}]


# ========== Team Member ==========
class TeamMemberResponse(BaseModel):
    id: int
    email: str
    name: Optional[str]
    role: str
    chatgpt_user_id: Optional[str]
    joined_at: Optional[datetime]
    synced_at: datetime
    is_unauthorized: bool = False  # 是否为未授权成员
    
    class Config:
        from_attributes = True


class TeamMemberListResponse(BaseModel):
    members: List[TeamMemberResponse]
    total: int
    team_name: str


# ========== Invite ==========
class InviteRequest(BaseModel):
    emails: List[EmailStr]


class InviteResult(BaseModel):
    email: str
    success: bool
    error: Optional[str] = None


class BatchInviteResponse(BaseModel):
    batch_id: str
    total: int
    success_count: int
    fail_count: int
    results: List[InviteResult]


class InviteRecordResponse(BaseModel):
    id: int
    email: str
    status: InviteStatus
    error_message: Optional[str]
    batch_id: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ========== Operation Log ==========
class OperationLogResponse(BaseModel):
    id: int
    action: str
    target: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: datetime
    user_name: Optional[str] = None
    team_name: Optional[str] = None
    
    class Config:
        from_attributes = True


class OperationLogListResponse(BaseModel):
    logs: List[OperationLogResponse]
    total: int


# ========== Dashboard ==========
class DashboardStats(BaseModel):
    total_teams: int
    total_members: int
    invites_today: int
    invites_this_week: int
    active_teams: int


# ========== Common ==========
class MessageResponse(BaseModel):
    message: str
    success: bool = True


# ========== Public Redeem API (Commercial) ==========
class RedeemRequest(BaseModel):
    """兑换请求"""
    email: EmailStr
    code: str


class RedeemResponse(BaseModel):
    """兑换响应"""
    success: bool
    message: str
    team_name: Optional[str] = None
    expires_at: Optional[datetime] = None
    remaining_days: Optional[int] = None
    # 方案 B: 座位满进入等待队列
    state: Optional[str] = None  # INVITE_QUEUED | WAITING_FOR_SEAT
    queue_position: Optional[int] = None  # 仅 WAITING_FOR_SEAT 时返回


# ========== Status Query API (Commercial) ==========
class StatusResponse(BaseModel):
    """用户状态查询响应
    
    Requirements: 8.1, 8.2, 8.3
    """
    found: bool
    email: Optional[str] = None
    team_name: Optional[str] = None
    team_active: Optional[bool] = None
    code: Optional[str] = None
    expires_at: Optional[datetime] = None
    remaining_days: Optional[int] = None
    can_rebind: Optional[bool] = None


# ========== Rebind API (Commercial) ==========
class RebindRequest(BaseModel):
    """换车请求（简化版：只需兑换码，邮箱从 bound_email 获取，默认仅一次机会）

    Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
    """
    code: str
    email: Optional[EmailStr] = None  # 可选，向后兼容旧版前端


class RebindResponse(BaseModel):
    """换车响应"""
    success: bool
    message: str
    new_team_name: Optional[str] = None


# ========== Export API ==========
class MemberExportItem(BaseModel):
    """成员导出项"""
    email: str
    name: Optional[str] = None
    team_id: int
    team_name: str
    role: str = "member"
    joined_at: Optional[datetime] = None


class MemberExportResponse(BaseModel):
    """成员导出响应"""
    emails: List[str]
    total: int
    teams: List[str]


class BulkExportRequest(BaseModel):
    """批量导出请求"""
    team_ids: Optional[List[int]] = None  # 指定 Team ID 列表
    status: Optional[TeamStatus] = None   # 按状态筛选


# ========== Migration API ==========
class MigrationPreviewRequest(BaseModel):
    """迁移预览请求"""
    source_team_ids: List[int]
    destination_team_id: int


class MigrationPreviewResponse(BaseModel):
    """迁移预览响应"""
    emails: List[str]
    total: int
    source_teams: List[str]
    destination_team: str
    destination_available_seats: int
    can_migrate: bool
    message: str


class MigrationExecuteRequest(BaseModel):
    """迁移执行请求"""
    source_team_ids: List[int]
    destination_team_id: int
    emails: Optional[List[str]] = None  # 可选：指定要迁移的邮箱，为空则迁移全部


class MigrationExecuteResponse(BaseModel):
    """迁移执行响应"""
    task_id: str
    message: str
    total_emails: int


class MigrationStatusResponse(BaseModel):
    """迁移状态响应"""
    task_id: str
    status: str  # pending, processing, completed, failed
    total: int
    success_count: int
    fail_count: int
    failed_emails: List[str] = []
    message: str

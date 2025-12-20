# 邀请管理路由
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models import Team, InviteRecord, OperationLog, User, InviteStatus, TeamStatus, UserRole
from app.schemas import (
    InviteRequest, BatchInviteResponse, InviteResult,
    InviteRecordResponse, MessageResponse
)
from app.services.auth import get_current_user, require_roles
from app.services.chatgpt_api import ChatGPTAPI, batch_invite
from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/teams/{team_id}/invites", tags=["邀请管理"])

# 自动分配路由（不需要 team_id）
auto_router = APIRouter(prefix="/invites", tags=["邀请管理"])


class AutoAllocateRequest(BaseModel):
    """自动分配邀请请求"""
    emails: List[EmailStr]
    group_id: Optional[int] = None  # 可选：限制在某个分组内分配


class AutoAllocateResult(BaseModel):
    """自动分配结果"""
    email: str
    success: bool
    team_name: Optional[str] = None
    error: Optional[str] = None


class AutoAllocateResponse(BaseModel):
    """自动分配响应"""
    batch_id: str
    total: int
    success_count: int
    fail_count: int
    unallocated_count: int  # 因座位不足未能分配的数量
    results: List[AutoAllocateResult]


@auto_router.post("/auto-allocate", response_model=AutoAllocateResponse)
async def auto_allocate_invites(
    data: AutoAllocateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR))
):
    """
    自动分配邀请到多个 Team（仅管理员/操作员可用）

    系统根据各 Team 的空位自动分配邮箱，优先填满 ID 小的 Team。
    可选：通过 group_id 限制在某个分组内分配。
    """
    from app.services.seat_calculator import get_all_teams_with_seats
    from app.services.batch_allocator import BatchAllocator, InviteTask

    if len(data.emails) > settings.MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"单次最多邀请 {settings.MAX_BATCH_SIZE} 人")

    # 去重处理（保留输入顺序）
    seen: set = set()
    normalized_emails: List[str] = []
    duplicate_emails: List[str] = []
    for email in data.emails:
        norm = str(email).lower().strip()
        if norm in seen:
            duplicate_emails.append(norm)
            continue
        seen.add(norm)
        normalized_emails.append(norm)

    if not normalized_emails:
        raise HTTPException(status_code=400, detail="没有有效的邮箱地址")

    batch_id = str(uuid.uuid4())[:8]

    # 1. 获取所有可用 Team 的座位信息
    teams_with_seats = get_all_teams_with_seats(
        db,
        group_id=data.group_id,
        only_active=True
    )

    if not teams_with_seats or all(t.available_seats <= 0 for t in teams_with_seats):
        raise HTTPException(status_code=400, detail="没有可用的 Team 座位")

    # 2. 创建邀请任务（使用去重后的列表）
    invite_tasks = [
        InviteTask(email=email, redeem_code="", group_id=data.group_id)
        for email in normalized_emails
    ]

    # 3. 使用 BatchAllocator 分配
    allocation = BatchAllocator.allocate(invite_tasks, teams_with_seats)

    # 4. 获取 Team 信息映射
    team_ids = list(allocation.allocated.keys())
    teams = {t.id: t for t in db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    # 5. 执行邀请
    results: List[AutoAllocateResult] = []
    success_count = 0
    fail_count = 0

    for team_id, tasks in allocation.allocated.items():
        team = teams.get(team_id)
        if not team:
            for task in tasks:
                results.append(AutoAllocateResult(
                    email=task.email,
                    success=False,
                    team_name=None,
                    error="Team 不存在"
                ))
                fail_count += 1
            continue

        # 执行批量邀请
        try:
            api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
            invite_results = await batch_invite(api, team.account_id, [t.email for t in tasks])

            for r in invite_results:
                email_val = str(r.get("email") or "").lower().strip()
                # 截断错误信息，避免泄露敏感信息
                err_msg = r.get("error")
                safe_err = str(err_msg)[:100] if err_msg else None

                if r["success"]:
                    success_count += 1
                    results.append(AutoAllocateResult(
                        email=email_val,
                        success=True,
                        team_name=team.name,
                        error=None
                    ))
                else:
                    fail_count += 1
                    results.append(AutoAllocateResult(
                        email=email_val,
                        success=False,
                        team_name=team.name,
                        error=safe_err or "邀请失败"
                    ))

                # 保存邀请记录
                record = InviteRecord(
                    team_id=team_id,
                    email=email_val,
                    status=InviteStatus.SUCCESS if r["success"] else InviteStatus.FAILED,
                    error_message=safe_err,
                    invited_by=current_user.id,
                    batch_id=batch_id
                )
                db.add(record)

        except Exception as e:
            # 整个 Team 邀请失败，隐藏内部错误详情
            logger.exception("Auto-allocate batch invite failed", extra={"team_id": team_id, "batch_id": batch_id})
            for task in tasks:
                fail_count += 1
                results.append(AutoAllocateResult(
                    email=task.email,
                    success=False,
                    team_name=team.name,
                    error="邀请失败，请稍后重试"
                ))

    # 6. 处理未分配的邀请
    for task in allocation.unallocated:
        results.append(AutoAllocateResult(
            email=task.email,
            success=False,
            team_name=None,
            error="座位不足，无法分配"
        ))

    # 6.5 处理重复邮箱
    for email in duplicate_emails:
        fail_count += 1
        results.append(AutoAllocateResult(
            email=email,
            success=False,
            team_name=None,
            error="重复邮箱"
        ))

    # 7. 记录操作日志
    log = OperationLog(
        user_id=current_user.id,
        team_id=None,
        action="auto_allocate_invite",
        target=f"{len(normalized_emails)} 人",
        details=f"成功: {success_count}, 失败: {fail_count}, 未分配: {len(allocation.unallocated)}, 重复: {len(duplicate_emails)}, 批次: {batch_id}"
    )
    db.add(log)
    db.commit()

    # 8. 发送通知
    try:
        from app.services.telegram import send_admin_notification
        await send_admin_notification(
            db, "batch_invite",
            team_name="自动分配",
            total=len(normalized_emails),
            success=success_count,
            fail=fail_count + len(allocation.unallocated),
            operator=current_user.username
        )
    except Exception:
        pass

    return AutoAllocateResponse(
        batch_id=batch_id,
        total=len(data.emails),
        success_count=success_count,
        fail_count=fail_count,
        unallocated_count=len(allocation.unallocated),
        results=results
    )


@router.post("", response_model=BatchInviteResponse)
async def invite_members(
    team_id: int,
    invite_data: InviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量邀请成员"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    if len(invite_data.emails) > settings.MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"单次最多邀请 {settings.MAX_BATCH_SIZE} 人")
    
    batch_id = str(uuid.uuid4())[:8]
    
    # 执行邀请
    api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
    results = await batch_invite(api, team.account_id, [str(e) for e in invite_data.emails])
    
    # 保存记录
    success_count = 0
    fail_count = 0
    
    for r in results:
        status = InviteStatus.SUCCESS if r["success"] else InviteStatus.FAILED
        if r["success"]:
            success_count += 1
        else:
            fail_count += 1
        
        record = InviteRecord(
            team_id=team_id,
            email=r["email"],
            status=status,
            error_message=r.get("error"),
            invited_by=current_user.id,
            batch_id=batch_id
        )
        db.add(record)
    
    # 记录操作日志
    log = OperationLog(
        user_id=current_user.id,
        team_id=team_id,
        action="batch_invite",
        target=f"{len(invite_data.emails)} 人",
        details=f"成功: {success_count}, 失败: {fail_count}, 批次: {batch_id}"
    )
    db.add(log)
    db.commit()
    
    # 发送邮件通知
    try:
        from app.services.email import send_new_invite_notification
        send_new_invite_notification(
            db, 
            team.name, 
            [str(e) for e in invite_data.emails], 
            success_count, 
            fail_count
        )
    except Exception as e:
        # 邮件发送失败不影响主流程
        pass
    
    # 发送 Telegram 通知
    try:
        from app.services.telegram import send_admin_notification
        await send_admin_notification(
            db, "batch_invite",
            team_name=team.name,
            total=len(invite_data.emails),
            success=success_count,
            fail=fail_count,
            operator=current_user.username
        )
    except Exception as e:
        # Telegram 发送失败不影响主流程
        pass
    
    return BatchInviteResponse(
        batch_id=batch_id,
        total=len(results),
        success_count=success_count,
        fail_count=fail_count,
        results=[InviteResult(**r) for r in results]
    )


@router.get("", response_model=List[InviteRecordResponse])
async def list_invite_records(
    team_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取邀请记录"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    records = db.query(InviteRecord).filter(
        InviteRecord.team_id == team_id
    ).order_by(InviteRecord.created_at.desc()).limit(limit).all()
    
    return [InviteRecordResponse.model_validate(r) for r in records]


@router.get("/pending")
async def get_pending_invites(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 ChatGPT 上待处理的邀请"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    try:
        api = ChatGPTAPI(team.session_token)
        result = await api.get_invites(team.account_id)
        invites = result.get("items", result.get("invites", []))
        return {"invites": invites, "total": len(invites)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

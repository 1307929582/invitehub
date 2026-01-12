# Team 管理路由
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import csv
import io

from app.database import get_db
from app.models import Team, TeamMember, User, TeamGroup, TeamStatus, InviteRecord, InviteStatus, SystemConfig
from app.schemas import (
    TeamCreate, TeamUpdate, TeamResponse, TeamListResponse,
    TeamMemberResponse, TeamMemberListResponse, MessageResponse,
    MemberExportResponse, BulkExportRequest,
    MigrationPreviewRequest, MigrationPreviewResponse,
    MigrationExecuteRequest, MigrationExecuteResponse,
    TeamBulkStatusUpdate, TeamBulkStatusResponse
)
from app.services.auth import get_current_user
from app.utils.timezone import to_beijing_iso
from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError, TokenInvalidError, TeamBannedError
from pydantic import BaseModel

router = APIRouter(prefix="/teams", tags=["Team 管理"])


@router.get("", response_model=TeamListResponse)
async def list_teams(
    include_inactive: bool = False,
    status_filter: Optional[TeamStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有 Team 列表

    Args:
        include_inactive: 是否包含非活跃的 Team
        status_filter: 按状态筛选
    """
    query = db.query(Team)

    if not include_inactive:
        query = query.filter(Team.is_active == True)

    if status_filter:
        query = query.filter(Team.status == status_filter)

    teams = query.all()

    # 获取分组名称映射
    group_ids = [t.group_id for t in teams if t.group_id]
    groups = {}
    if group_ids:
        group_list = db.query(TeamGroup).filter(TeamGroup.id.in_(group_ids)).all()
        groups = {g.id: g.name for g in group_list}

    result = []
    for team in teams:
        member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
        team_dict = {
            "id": team.id,
            "name": team.name,
            "description": team.description,
            "account_id": team.account_id,
            "is_active": team.is_active,
            "status": team.status if team.status else TeamStatus.ACTIVE,
            "status_message": team.status_message,
            "status_changed_at": team.status_changed_at,
            "max_seats": team.max_seats,
            "token_expires_at": team.token_expires_at,
            "mailbox_id": team.mailbox_id,
            "mailbox_email": team.mailbox_email,
            "mailbox_synced_at": team.mailbox_synced_at,
            "created_at": team.created_at,
            "member_count": member_count,
            "group_id": team.group_id,
            "group_name": groups.get(team.group_id) if team.group_id else None
        }
        result.append(TeamResponse(**team_dict))

    return TeamListResponse(teams=result, total=len(result))


@router.get("/unauthorized/all")
async def get_all_unauthorized_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有 Team 的未授权成员"""
    unauthorized = db.query(TeamMember).filter(TeamMember.is_unauthorized == True).all()
    
    result = []
    for m in unauthorized:
        team = db.query(Team).filter(Team.id == m.team_id).first()
        result.append({
            "id": m.id,
            "team_id": m.team_id,
            "team_name": team.name if team else "未知",
            "email": m.email,
            "name": m.name,
            "role": m.role,
            "chatgpt_user_id": m.chatgpt_user_id,
            "synced_at": to_beijing_iso(m.synced_at) or None
        })
    
    return {"members": result, "total": len(result)}


@router.post("", response_model=TeamResponse)
async def create_team(
    team_data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新 Team"""
    # 自动清理空格
    clean_data = team_data.model_dump()
    clean_data["account_id"] = clean_data["account_id"].strip()
    clean_data["session_token"] = clean_data["session_token"].strip()
    if clean_data.get("device_id"):
        clean_data["device_id"] = clean_data["device_id"].strip()
    
    # 验证 Token 是否有效
    try:
        api = ChatGPTAPI(clean_data["session_token"], clean_data.get("device_id") or "")
        await api.verify_token()
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"Token 验证失败: {e.message}")
    
    # 检查是否已存在（只检查活跃的）
    existing = db.query(Team).filter(
        Team.account_id == clean_data["account_id"],
        Team.is_active == True
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该 Account 已存在")
    
    team = Team(**clean_data)
    db.add(team)
    db.commit()
    db.refresh(team)
    
    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(db, "team_created", team_name=team.name, max_seats=team.max_seats, operator=current_user.username)
    
    return team


@router.post("/sync-all", response_model=MessageResponse)
async def sync_all_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量同步所有 Team 成员，同时检测封号和 Token 失效"""
    from app.services.telegram import send_admin_notification
    from app.services.authorization import check_is_unauthorized
    import asyncio

    teams_list = db.query(Team).filter(Team.is_active == True).all()
    success_count = 0
    fail_count = 0
    banned_teams = []
    token_invalid_teams = []

    all_unauthorized = {}  # team_name -> [emails]

    for team in teams_list:
        try:
            api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
            result = await api.get_members(team.account_id)
            members_data = result.get("items", result.get("users", []))

            # 如果之前是异常状态，恢复为正常
            if team.status != TeamStatus.ACTIVE:
                team.status = TeamStatus.ACTIVE
                team.status_message = None
                team.status_changed_at = datetime.utcnow()

            # 获取成员邮箱列表
            member_emails = set()
            for m in members_data:
                email = m.get("email", "").lower().strip()
                if email:
                    member_emails.add(email)
            
            # 更新邀请记录
            pending_invites = db.query(InviteRecord).filter(
                InviteRecord.team_id == team.id,
                InviteRecord.status == InviteStatus.SUCCESS,
                InviteRecord.accepted_at == None
            ).all()

            for invite in pending_invites:
                if invite.email.lower().strip() in member_emails:
                    invite.accepted_at = datetime.utcnow()

            # ✅ 保存旧的授权状态（防止同步覆盖管理员手动授权）
            old_members = db.query(TeamMember).filter(TeamMember.team_id == team.id).all()
            old_auth_state = {m.email.lower().strip(): m.is_unauthorized for m in old_members}

            # 清除旧成员数据
            db.query(TeamMember).filter(TeamMember.team_id == team.id).delete()

            # 插入新成员数据（去重），并检测未授权成员
            seen_emails = set()
            unauthorized_members = []

            for m in members_data:
                email = m.get("email", "").lower().strip()
                if not email or email in seen_emails:
                    continue
                seen_emails.add(email)

                role = m.get("role", "member")

                # ✅ 使用统一函数检查是否未授权（限定当前 Team）
                computed_unauthorized = check_is_unauthorized(
                    email=email,
                    team_id=team.id,
                    role=role,
                    db=db
                )

                # ✅ 保留已确认授权的状态（防止同步覆盖管理员手动授权）
                # 如果历史状态为 False（已授权），则保留，不被重新计算覆盖
                old_state = old_auth_state.get(email)
                if old_state is False:
                    is_unauthorized = False  # 保留管理员手动授权
                else:
                    is_unauthorized = computed_unauthorized

                if is_unauthorized:
                    unauthorized_members.append(email)

                member = TeamMember(
                    team_id=team.id,
                    email=email,
                    name=m.get("name", m.get("display_name", "")),
                    role=role,
                    chatgpt_user_id=m.get("id", m.get("user_id", "")),
                    synced_at=datetime.utcnow(),
                    is_unauthorized=is_unauthorized  # ✅ 正确设置
                )
                db.add(member)

            if unauthorized_members:
                all_unauthorized[team.name] = unauthorized_members

            db.commit()
            success_count += 1

        except TeamBannedError as e:
            # Team 被封禁
            member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            if team.status != TeamStatus.BANNED:
                team.status = TeamStatus.BANNED
                team.status_message = e.message
                team.status_changed_at = datetime.utcnow()
                db.commit()
                banned_teams.append(team.name)
                # 发送 TG 通知
                await send_admin_notification(
                    db, "team_banned",
                    team_name=team.name,
                    team_id=team.id,
                    member_count=member_count,
                    error_message=e.message
                )
            fail_count += 1

        except TokenInvalidError as e:
            # Token 失效
            if team.status != TeamStatus.TOKEN_INVALID:
                team.status = TeamStatus.TOKEN_INVALID
                team.status_message = e.message
                team.status_changed_at = datetime.utcnow()
                db.commit()
                token_invalid_teams.append(team.name)
                # 发送 TG 通知
                await send_admin_notification(
                    db, "token_invalid",
                    team_name=team.name,
                    team_id=team.id,
                    error_message=e.message
                )
            fail_count += 1

        except Exception:
            fail_count += 1

        # 每个 Team 间隔 1 秒
        await asyncio.sleep(1)

    # 发送未授权成员通知
    for team_name, members in all_unauthorized.items():
        await send_admin_notification(db, "unauthorized_members", team_name=team_name, members=members)

    # 构建返回消息
    msg = f"同步完成：成功 {success_count} 个，失败 {fail_count} 个"
    if banned_teams:
        msg += f"。检测到封禁: {', '.join(banned_teams)}"
    if token_invalid_teams:
        msg += f"。Token失效: {', '.join(token_invalid_teams)}"

    return MessageResponse(message=msg)


@router.get("/all-pending-invites")
async def get_all_pending_invites(
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有 Team 的待处理邀请（带缓存）"""
    from app.cache import cache_get, cache_set, CacheKeys, CacheTTL
    import asyncio
    
    # 尝试从缓存获取
    if not refresh:
        cached = cache_get(CacheKeys.ALL_PENDING_INVITES)
        if cached:
            print(f"[PendingInvites] 从缓存获取，共 {cached.get('total', 0)} 条")
            return cached

    # 只获取健康 Team 的待处理邀请（避免访问已封禁或 Token 失效的 Team）
    teams_list = db.query(Team).filter(
        Team.is_active == True,
        Team.status == TeamStatus.ACTIVE
    ).all()
    print(f"[PendingInvites] 开始获取 {len(teams_list)} 个 Team 的待处理邀请")
    all_invites = []
    errors = []
    
    for team in teams_list:
        try:
            api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
            result = await api.get_invites(team.account_id)
            items = result.get("items", [])
            print(f"[PendingInvites] Team {team.name}: 获取到 {len(items)} 条邀请")
            for item in items:
                item["team_id"] = team.id
                item["team_name"] = team.name
                all_invites.append(item)
        except ChatGPTAPIError as e:
            errors.append(f"{team.name}: {e.message}")
            print(f"[PendingInvites] Team {team.name} 获取失败: {e.message}")
        except Exception as e:
            errors.append(f"{team.name}: {str(e)}")
            print(f"[PendingInvites] Team {team.name} 获取异常: {str(e)}")
        # 避免请求过快
        await asyncio.sleep(0.5)
    
    # 按时间倒序
    all_invites.sort(key=lambda x: x.get("created_time", ""), reverse=True)
    
    result = {"items": all_invites, "total": len(all_invites), "errors": errors}
    print(f"[PendingInvites] 总共获取 {len(all_invites)} 条邀请，{len(errors)} 个错误")
    
    # 写入缓存
    cache_set(CacheKeys.ALL_PENDING_INVITES, result, CacheTTL.PENDING_INVITES)
    
    return result


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Team 详情"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
    team_dict = TeamResponse.model_validate(team).model_dump()
    team_dict["member_count"] = member_count
    return TeamResponse(**team_dict)


@router.put("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: int,
    team_data: TeamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新 Team 配置"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    update_data = team_data.model_dump(exclude_unset=True)
    
    # 自动清理空格
    if "session_token" in update_data:
        update_data["session_token"] = update_data["session_token"].strip()
    if "device_id" in update_data:
        update_data["device_id"] = update_data["device_id"].strip()
    if "account_id" in update_data:
        update_data["account_id"] = update_data["account_id"].strip()
    
    if update_data.get("session_token"):
        try:
            api = ChatGPTAPI(update_data["session_token"], update_data.get("device_id") or team.device_id or "")
            await api.verify_token()
        except ChatGPTAPIError as e:
            raise HTTPException(status_code=400, detail=f"Token 验证失败: {e.message}")

    # 处理状态更新时的联动逻辑
    if "status" in update_data:
        new_status = update_data["status"]
        if new_status == TeamStatus.PAUSED:
            update_data["is_active"] = False
        elif new_status == TeamStatus.ACTIVE:
            update_data["is_active"] = True
        # 记录状态变更时间
        update_data["status_changed_at"] = datetime.utcnow()

    for key, value in update_data.items():
        setattr(team, key, value)

    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}", response_model=MessageResponse)
async def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除 Team"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    team_name = team.name
    team.is_active = False
    db.commit()
    
    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(db, "team_deleted", team_name=team_name, operator=current_user.username)
    
    return MessageResponse(message="Team 已删除")


@router.get("/{team_id}/members", response_model=TeamMemberListResponse)
async def get_team_members(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Team 成员列表（从缓存）"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()
    return TeamMemberListResponse(
        members=[TeamMemberResponse.model_validate(m) for m in members],
        total=len(members),
        team_name=team.name
    )


@router.post("/{team_id}/sync", response_model=TeamMemberListResponse)
async def sync_team_members(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """从 ChatGPT 同步成员列表"""
    from app.models import InviteRecord, InviteStatus
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        result = await api.get_members(team.account_id)
        members_data = result.get("items", result.get("users", []))
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"同步失败: {e.message}")
    
    # 获取成员邮箱列表
    from datetime import datetime
    member_emails = set()
    for m in members_data:
        email = m.get("email", "").lower().strip()
        if email:
            member_emails.add(email)
    
    print(f"[Sync] Team {team.name}: 成员邮箱列表 = {member_emails}")
    
    # 更新邀请记录：如果邮箱已在成员列表中，标记为已接受
    pending_invites = db.query(InviteRecord).filter(
        InviteRecord.team_id == team_id,
        InviteRecord.status == InviteStatus.SUCCESS,
        InviteRecord.accepted_at == None
    ).all()
    
    print(f"[Sync] Team {team.name}: 待接受邀请 = {[(i.id, i.email) for i in pending_invites]}")
    
    updated_count = 0
    for invite in pending_invites:
        invite_email = invite.email.lower().strip()
        print(f"[Sync] 检查邀请 {invite.id}: '{invite_email}' in member_emails = {invite_email in member_emails}")
        if invite_email in member_emails:
            invite.accepted_at = datetime.utcnow()
            updated_count += 1
    
    print(f"[Sync] Team {team.name}: 更新了 {updated_count} 条邀请记录")

    # ✅ 保存旧的授权状态（防止同步覆盖管理员手动授权）
    old_members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()
    old_auth_state = {m.email.lower().strip(): m.is_unauthorized for m in old_members}

    # 清除旧成员数据
    db.query(TeamMember).filter(TeamMember.team_id == team_id).delete()

    # 插入新成员数据（去重），并检测未授权成员
    from app.services.authorization import check_is_unauthorized
    seen_emails = set()
    unauthorized_members = []

    for m in members_data:
        email = m.get("email", "").lower().strip()
        if not email or email in seen_emails:
            continue
        seen_emails.add(email)

        role = m.get("role", "member")

        # ✅ 使用统一函数检查是否未授权（限定当前 Team）
        computed_unauthorized = check_is_unauthorized(
            email=email,
            team_id=team_id,
            role=role,
            db=db
        )

        # ✅ 保留已确认授权的状态（防止同步覆盖管理员手动授权）
        # 如果历史状态为 False（已授权），则保留，不被重新计算覆盖
        old_state = old_auth_state.get(email)
        if old_state is False:
            is_unauthorized = False  # 保留管理员手动授权
        else:
            is_unauthorized = computed_unauthorized

        if is_unauthorized:
            unauthorized_members.append(email)

        member = TeamMember(
            team_id=team_id,
            email=email,
            name=m.get("name", m.get("display_name", "")),
            role=role,
            chatgpt_user_id=m.get("id", m.get("user_id", "")),
            synced_at=datetime.utcnow(),
            is_unauthorized=is_unauthorized  # ✅ 正确设置
        )
        db.add(member)

    db.commit()

    # 如果发现未授权成员，发送 Telegram 通知
    if unauthorized_members:
        print(f"[Sync] Team {team.name}: 发现 {len(unauthorized_members)} 个未授权成员: {unauthorized_members}")
        from app.services.telegram import send_admin_notification
        await send_admin_notification(db, "unauthorized_members", team_name=team.name, members=unauthorized_members)
    
    members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()
    return TeamMemberListResponse(
        members=[TeamMemberResponse.model_validate(m) for m in members],
        total=len(members),
        team_name=team.name
    )


@router.post("/{team_id}/verify-token", response_model=MessageResponse)
async def verify_team_token(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """验证 Team Token 是否有效"""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        await api.verify_token()
        return MessageResponse(message="Token 有效")
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"Token 无效: {e.message}")


@router.get("/{team_id}/subscription")
async def get_team_subscription(
    team_id: int,
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Team 订阅信息（带缓存）"""
    from app.cache import get_subscription_cache, set_subscription_cache
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    # 尝试从缓存获取
    if not refresh:
        cached = get_subscription_cache(team_id)
        if cached:
            return cached
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        result = await api.get_subscription(team.account_id)
        # 写入缓存
        set_subscription_cache(team_id, result)
        return result
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"获取失败: {e.message}")


@router.get("/{team_id}/pending-invites")
async def get_pending_invites(
    team_id: int,
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取待处理的邀请（带缓存）"""
    from app.cache import get_pending_invites_cache, set_pending_invites_cache
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    # 尝试从缓存获取
    if not refresh:
        cached = get_pending_invites_cache(team_id)
        if cached:
            return cached
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        result = await api.get_invites(team.account_id)
        # 写入缓存
        set_pending_invites_cache(team_id, result)
        return result
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"获取失败: {e.message}")


@router.delete("/{team_id}/members/{user_id}", response_model=MessageResponse)
async def remove_team_member(
    team_id: int,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """移除 Team 成员"""
    from app.cache import invalidate_team_cache
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    # 先获取成员邮箱用于通知
    member = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.chatgpt_user_id == user_id
    ).first()
    member_email = member.email if member else user_id
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        await api.remove_member(team.account_id, user_id)
        
        # 同时删除本地缓存
        db.query(TeamMember).filter(
            TeamMember.team_id == team_id,
            TeamMember.chatgpt_user_id == user_id
        ).delete()
        db.commit()
        
        # 清除 Redis 缓存
        invalidate_team_cache(team_id)
        
        # 发送 Telegram 通知
        from app.services.telegram import send_admin_notification
        await send_admin_notification(db, "member_removed", email=member_email, team_name=team.name, operator=current_user.username)
        
        return MessageResponse(message="成员已移除")
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"移除失败: {e.message}")


@router.delete("/{team_id}/invites", response_model=MessageResponse)
async def cancel_team_invite(
    team_id: int,
    email: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """取消待处理的邀请"""
    from app.cache import invalidate_team_cache
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    try:
        api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
        await api.cancel_invite(team.account_id, email)
        
        # 清除 Redis 缓存
        invalidate_team_cache(team_id)
        
        # 发送 Telegram 通知
        from app.services.telegram import send_admin_notification
        await send_admin_notification(db, "invite_cancelled", email=email, team_name=team.name, operator=current_user.username)
        
        return MessageResponse(message="邀请已取消")
    except ChatGPTAPIError as e:
        raise HTTPException(status_code=400, detail=f"取消失败: {e.message}")


@router.delete("/{team_id}/unauthorized-members", response_model=MessageResponse)
async def remove_unauthorized_members(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量删除 Team 的未授权成员"""
    import asyncio
    from app.cache import invalidate_team_cache
    from app.services.telegram import send_admin_notification
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")
    
    # 获取未授权成员
    unauthorized = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.is_unauthorized == True
    ).all()
    
    if not unauthorized:
        return MessageResponse(message="没有未授权成员需要删除")
    
    api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
    
    success_count = 0
    fail_count = 0
    removed_emails = []
    
    for member in unauthorized:
        # 如果没有 chatgpt_user_id，直接从数据库删除（无法验证的幽灵数据）
        if not member.chatgpt_user_id:
            removed_emails.append(member.email)
            db.delete(member)
            success_count += 1
            continue
        
        try:
            await api.remove_member(team.account_id, member.chatgpt_user_id)
            removed_emails.append(member.email)
            db.delete(member)
            success_count += 1
        except ChatGPTAPIError as e:
            # 如果是 404（成员不存在），也从数据库删除
            if e.status_code == 404:
                removed_emails.append(member.email)
                db.delete(member)
                success_count += 1
            else:
                fail_count += 1
        
        # 避免 API 限流
        await asyncio.sleep(1)
    
    db.commit()
    
    # 清除缓存
    invalidate_team_cache(team_id)
    
    # 发送通知
    if removed_emails:
        await send_admin_notification(
            db, "unauthorized_removed",
            team_name=team.name,
            count=success_count,
            emails=removed_emails,
            operator=current_user.username
        )
    
    return MessageResponse(message=f"已删除 {success_count} 个未授权成员，失败 {fail_count} 个")


class AuthorizeMemberRequest(BaseModel):
    """授权成员请求"""
    email: str
    add_to_whitelist: bool = False  # 是否同时加入白名单（永久授权）


@router.post("/{team_id}/members/authorize", response_model=MessageResponse)
async def authorize_member(
    team_id: int,
    data: AuthorizeMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    标记成员为已授权（仅管理员）

    管理员手动添加的成员可能被误标记为未授权，使用此 API 手动授权。
    可选：同时将邮箱加入白名单，使其在后续同步中自动保持授权状态。
    """
    from app.cache import invalidate_team_cache
    from app.models import UserRole

    # ✅ 权限检查：仅管理员可操作
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可执行此操作")

    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")

    email = data.email.lower().strip()

    # 查找成员
    member = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.email == email
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    # 更新授权状态
    member.is_unauthorized = False
    db.commit()

    # 如果需要加入白名单
    if data.add_to_whitelist:
        whitelist_config = db.query(SystemConfig).filter(
            SystemConfig.key == "authorized_email_whitelist"
        ).first()

        if whitelist_config:
            existing_emails = set(e.strip().lower() for e in whitelist_config.value.split(",") if e.strip())
            if email not in existing_emails:
                existing_emails.add(email)
                whitelist_config.value = ",".join(sorted(existing_emails))
        else:
            whitelist_config = SystemConfig(
                key="authorized_email_whitelist",
                value=email
            )
            db.add(whitelist_config)

        db.commit()

    # 清除缓存
    invalidate_team_cache(team_id)

    msg = f"成员 {email} 已授权"
    if data.add_to_whitelist:
        msg += "（已加入白名单）"

    return MessageResponse(message=msg)


# ========== 导出 API ==========

@router.get("/{team_id}/members/export")
async def export_team_members(
    team_id: int,
    format: str = Query("csv", regex="^(csv|json)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出单个 Team 的成员邮箱

    Args:
        team_id: Team ID
        format: 导出格式 (csv 或 json)
    """
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")

    members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()

    if format == "json":
        emails = [m.email for m in members]
        return MemberExportResponse(
            emails=emails,
            total=len(emails),
            teams=[team.name]
        )

    # CSV 格式
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["email", "name", "role", "team_name"])
    for member in members:
        writer.writerow([member.email, member.name or "", member.role, team.name])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=team_{team_id}_members.csv"}
    )


@router.post("/members/export/bulk")
async def export_bulk_members(
    request: BulkExportRequest,
    format: str = Query("csv", regex="^(csv|json)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量导出多个 Team 的成员邮箱

    可以指定 team_ids 或按 status 筛选
    """
    query = db.query(Team)

    if request.team_ids:
        query = query.filter(Team.id.in_(request.team_ids))
    elif request.status:
        query = query.filter(Team.status == request.status)
    else:
        raise HTTPException(status_code=400, detail="请指定 team_ids 或 status")

    teams = query.all()
    if not teams:
        raise HTTPException(status_code=404, detail="未找到符合条件的 Team")

    team_ids = [t.id for t in teams]
    team_names = {t.id: t.name for t in teams}

    members = db.query(TeamMember).filter(TeamMember.team_id.in_(team_ids)).all()

    # 去重邮箱
    unique_emails = sorted(list(set(m.email for m in members)))

    if format == "json":
        return MemberExportResponse(
            emails=unique_emails,
            total=len(unique_emails),
            teams=[t.name for t in teams]
        )

    # CSV 格式 - 包含详细信息
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["email", "name", "role", "team_id", "team_name"])
    for member in members:
        writer.writerow([
            member.email,
            member.name or "",
            member.role,
            member.team_id,
            team_names.get(member.team_id, "")
        ])

    output.seek(0)

    status_str = request.status.value if request.status else "selected"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=teams_{status_str}_members.csv"}
    )


@router.get("/members/export/emails-only")
async def export_emails_only(
    team_ids: str = Query(None, description="逗号分隔的 Team ID"),
    status: Optional[TeamStatus] = Query(None, description="按状态筛选"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """仅导出邮箱列表（纯文本，一行一个邮箱）

    适合快速复制粘贴
    """
    query = db.query(Team)

    if team_ids:
        ids = [int(x.strip()) for x in team_ids.split(",") if x.strip().isdigit()]
        if not ids:
            raise HTTPException(status_code=400, detail="无效的 team_ids")
        query = query.filter(Team.id.in_(ids))
    elif status:
        query = query.filter(Team.status == status)
    else:
        raise HTTPException(status_code=400, detail="请指定 team_ids 或 status")

    teams = query.all()
    if not teams:
        raise HTTPException(status_code=404, detail="未找到符合条件的 Team")

    team_ids_list = [t.id for t in teams]
    members = db.query(TeamMember).filter(TeamMember.team_id.in_(team_ids_list)).all()

    # 去重并排序
    unique_emails = sorted(list(set(m.email for m in members)))

    content = "\n".join(unique_emails)
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/plain",
        headers={"Content-Disposition": "attachment; filename=emails.txt"}
    )


# ========== 迁移 API ==========

@router.post("/migrate/preview", response_model=MigrationPreviewResponse)
async def preview_migration(
    request: MigrationPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """预览成员迁移

    返回待迁移的邮箱列表和目标 Team 的可用座位数
    """
    # 验证源 Team
    source_teams = db.query(Team).filter(Team.id.in_(request.source_team_ids)).all()
    if len(source_teams) != len(request.source_team_ids):
        raise HTTPException(status_code=404, detail="部分源 Team 不存在")

    # 验证目标 Team
    dest_team = db.query(Team).filter(Team.id == request.destination_team_id).first()
    if not dest_team:
        raise HTTPException(status_code=404, detail="目标 Team 不存在")

    if dest_team.status != TeamStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"目标 Team 状态异常: {dest_team.status.value}")

    # 获取源 Team 的所有成员
    source_members = db.query(TeamMember).filter(
        TeamMember.team_id.in_(request.source_team_ids)
    ).all()

    # 获取目标 Team 的现有成员
    dest_members = db.query(TeamMember).filter(
        TeamMember.team_id == request.destination_team_id
    ).all()
    dest_emails = {m.email.lower() for m in dest_members}

    # 过滤掉已在目标 Team 的成员，并去重
    emails_to_migrate = sorted(list(set(
        m.email for m in source_members
        if m.email.lower() not in dest_emails
    )))

    # 计算可用座位
    available_seats = dest_team.max_seats - len(dest_members)
    can_migrate = len(emails_to_migrate) <= available_seats

    message = "可以迁移" if can_migrate else f"目标 Team 座位不足（需要 {len(emails_to_migrate)}，可用 {available_seats}）"

    return MigrationPreviewResponse(
        emails=emails_to_migrate,
        total=len(emails_to_migrate),
        source_teams=[t.name for t in source_teams],
        destination_team=dest_team.name,
        destination_available_seats=available_seats,
        can_migrate=can_migrate,
        message=message
    )


@router.post("/migrate/execute", response_model=MigrationExecuteResponse)
async def execute_migration(
    request: MigrationExecuteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """执行成员迁移

    将源 Team 的成员邀请到目标 Team
    通过 Celery 后台任务异步执行
    """
    from app.models import RebindHistory
    from app.services.telegram import send_admin_notification
    import uuid

    # 验证源 Team
    source_teams = db.query(Team).filter(Team.id.in_(request.source_team_ids)).all()
    if len(source_teams) != len(request.source_team_ids):
        raise HTTPException(status_code=404, detail="部分源 Team 不存在")

    # 验证目标 Team
    dest_team = db.query(Team).filter(Team.id == request.destination_team_id).first()
    if not dest_team:
        raise HTTPException(status_code=404, detail="目标 Team 不存在")

    if dest_team.status != TeamStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"目标 Team 状态异常: {dest_team.status.value}")

    # 确定要迁移的邮箱
    if request.emails:
        emails_to_migrate = request.emails
    else:
        # 获取源 Team 的所有成员
        source_members = db.query(TeamMember).filter(
            TeamMember.team_id.in_(request.source_team_ids)
        ).all()

        # 获取目标 Team 的现有成员
        dest_members = db.query(TeamMember).filter(
            TeamMember.team_id == request.destination_team_id
        ).all()
        dest_emails = {m.email.lower() for m in dest_members}

        emails_to_migrate = list(set(
            m.email for m in source_members
            if m.email.lower() not in dest_emails
        ))

    if not emails_to_migrate:
        raise HTTPException(status_code=400, detail="没有需要迁移的成员")

    # 生成任务 ID
    task_id = str(uuid.uuid4())

    # 发送开始通知
    await send_admin_notification(
        db, "migration_started",
        source_teams=[t.name for t in source_teams],
        target_team=dest_team.name,
        email_count=len(emails_to_migrate),
        operator=current_user.username
    )

    # 提交 Celery 任务
    try:
        from app.tasks_celery import execute_migration_task
        execute_migration_task.delay(
            task_id=task_id,
            source_team_ids=request.source_team_ids,
            destination_team_id=request.destination_team_id,
            emails=emails_to_migrate,
            operator=current_user.username
        )
    except Exception as e:
        # Celery 不可用时，同步执行
        import asyncio
        asyncio.create_task(_execute_migration_sync(
            db, task_id, request.source_team_ids, request.destination_team_id,
            emails_to_migrate, current_user.username
        ))

    return MigrationExecuteResponse(
        task_id=task_id,
        message="迁移任务已提交，将在后台执行",
        total_emails=len(emails_to_migrate)
    )


async def _execute_migration_sync(
    db: Session,
    task_id: str,
    source_team_ids: List[int],
    destination_team_id: int,
    emails: List[str],
    operator: str
):
    """同步执行迁移（Celery 不可用时的回退方案）"""
    from app.models import RebindHistory
    from app.services.telegram import send_admin_notification
    import asyncio

    dest_team = db.query(Team).filter(Team.id == destination_team_id).first()
    source_teams = db.query(Team).filter(Team.id.in_(source_team_ids)).all()

    api = ChatGPTAPI(dest_team.session_token, dest_team.device_id or "", dest_team.cookie or "")

    success_count = 0
    fail_count = 0
    failed_emails = []

    for email in emails:
        try:
            await api.invite_members(dest_team.account_id, [email])

            # 记录迁移历史
            # 找到该邮箱对应的源 Team
            source_member = db.query(TeamMember).filter(
                TeamMember.email == email,
                TeamMember.team_id.in_(source_team_ids)
            ).first()

            if source_member:
                history = RebindHistory(
                    redeem_code="",
                    email=email,
                    from_team_id=source_member.team_id,
                    to_team_id=destination_team_id,
                    reason="admin_migration",
                    notes=f"批量迁移 by {operator}"
                )
                db.add(history)

            success_count += 1

        except ChatGPTAPIError as e:
            fail_count += 1
            failed_emails.append(email)

        # 避免 API 限流
        await asyncio.sleep(1)

    db.commit()

    # 发送完成通知
    await send_admin_notification(
        db, "migration_completed",
        source_teams=[t.name for t in source_teams],
        target_team=dest_team.name,
        success_count=success_count,
        fail_count=fail_count,
        operator=operator
    )


@router.patch("/{team_id}/status", response_model=MessageResponse)
async def update_team_status(
    team_id: int,
    status: TeamStatus,
    message: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动更新 Team 状态

    用于管理员手动标记 Team 为封禁/暂停等状态
    """
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team 不存在")

    old_status = team.status
    team.status = status
    team.status_message = message
    team.status_changed_at = datetime.utcnow()

    # 如果标记为暂停，同时设置 is_active = False
    if status == TeamStatus.PAUSED:
        team.is_active = False
    elif status == TeamStatus.ACTIVE:
        team.is_active = True

    db.commit()

    return MessageResponse(message=f"Team 状态已从 {old_status.value} 更新为 {status.value}")


@router.patch("/status/bulk", response_model=TeamBulkStatusResponse)
async def bulk_update_team_status(
    data: TeamBulkStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量更新 Team 状态

    允许管理员一次性修改多个 Team 的状态
    """
    success_count = 0
    failed_count = 0
    failed_teams = []

    for team_id in data.team_ids:
        try:
            team = db.query(Team).filter(Team.id == team_id).first()
            if not team:
                failed_count += 1
                failed_teams.append({
                    "team_id": team_id,
                    "error": "Team 不存在"
                })
                continue

            # 更新状态
            team.status = data.status
            team.status_message = data.status_message
            team.status_changed_at = datetime.utcnow()

            # 状态与 is_active 的联动
            if data.status == TeamStatus.PAUSED:
                team.is_active = False
            elif data.status == TeamStatus.ACTIVE:
                team.is_active = True

            success_count += 1

        except Exception as e:
            failed_count += 1
            failed_teams.append({
                "team_id": team_id,
                "error": str(e)
            })
            logger.exception(f"Failed to update team {team_id}: {e}")

    db.commit()

    return TeamBulkStatusResponse(
        success_count=success_count,
        failed_count=failed_count,
        failed_teams=failed_teams
    )

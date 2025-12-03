# 公开 API（用户自助申请）
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_db
from app.models import (
    Team, TeamMember, RedeemCode, RedeemCodeType, InviteRecord, InviteStatus, 
    SystemConfig, OperationLog
)
from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
from app.services.telegram import notify_new_invite
from app.limiter import limiter
from app.logger import get_logger

router = APIRouter(prefix="/public", tags=["public"])
logger = get_logger(__name__)

# 全局并发控制：最多同时处理 10 个兑换请求
import asyncio
_redeem_semaphore = asyncio.Semaphore(10)


def get_config(db: Session, key: str) -> Optional[str]:
    """获取系统配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config else None


async def send_invite_telegram_notify(db: Session, email: str, team_name: str, redeem_code: str, username: str = None):
    """发送邀请成功的 Telegram 通知"""
    try:
        tg_enabled = get_config(db, "telegram_enabled")
        notify_invite = get_config(db, "telegram_notify_invite")
        
        if tg_enabled != "true" or notify_invite != "true":
            return
        
        bot_token = get_config(db, "telegram_bot_token")
        chat_id = get_config(db, "telegram_chat_id")
        
        if bot_token and chat_id:
            await notify_new_invite(bot_token, chat_id, email, team_name, redeem_code, username)
    except Exception as e:
        logger.warning(f"Telegram notify failed: {e}")


# ========== 站点配置 ==========
class SiteConfig(BaseModel):
    site_title: str = "ChatGPT Team 自助上车"
    site_description: str = "使用兑换码加入 Team"
    home_notice: str = ""  # 首页公告
    success_message: str = "邀请已发送！请查收邮箱并接受邀请"
    footer_text: str = ""  # 页脚文字


@router.get("/site-config", response_model=SiteConfig)
async def get_site_config(db: Session = Depends(get_db)):
    """获取站点配置（公开，带缓存）"""
    from app.cache import get_site_config_cache, set_site_config_cache
    
    # 尝试从缓存获取
    cached = get_site_config_cache()
    if cached:
        return SiteConfig(**cached)
    
    # 从数据库获取
    result = SiteConfig(
        site_title=get_config(db, "site_title") or "ChatGPT Team 自助上车",
        site_description=get_config(db, "site_description") or "使用兑换码加入 Team",
        home_notice=get_config(db, "home_notice") or "",
        success_message=get_config(db, "success_message") or "邀请已发送！请查收邮箱并接受邀请",
        footer_text=get_config(db, "footer_text") or "",
    )
    
    # 写入缓存
    set_site_config_cache(result.model_dump())
    return result


def get_available_team(db: Session, group_id: Optional[int] = None, group_name: Optional[str] = None) -> Optional[Team]:
    """获取有空位的 Team（优化版，不锁表）
    
    使用子查询统计成员数，避免 N+1 查询和锁表
    """
    from sqlalchemy import func, and_
    
    team_query = db.query(Team).filter(Team.is_active == True)
    
    if group_id:
        team_query = team_query.filter(Team.group_id == group_id)
    elif group_name:
        from app.models import TeamGroup
        group = db.query(TeamGroup).filter(TeamGroup.name == group_name).first()
        if group:
            team_query = team_query.filter(Team.group_id == group.id)
        else:
            return None
    
    # 子查询统计每个 Team 的成员数
    member_count_subq = db.query(
        TeamMember.team_id,
        func.count(TeamMember.id).label('member_count')
    ).group_by(TeamMember.team_id).subquery()
    
    # 联合查询，找到有空位的 Team
    available_team = team_query.outerjoin(
        member_count_subq,
        Team.id == member_count_subq.c.team_id
    ).filter(
        func.coalesce(member_count_subq.c.member_count, 0) < Team.max_seats
    ).first()
    
    return available_team





# ========== 兑换码使用 ==========
class SeatStats(BaseModel):
    total_seats: int
    used_seats: int  # 已同步成员
    pending_seats: int  # 已邀请未接受
    available_seats: int  # 可用空位


@router.get("/seats", response_model=SeatStats)
async def get_seat_stats(db: Session = Depends(get_db)):
    """获取座位统计（公开，带缓存）
    
    使用本地缓存的成员数据，不实时调用 ChatGPT API
    """
    from app.cache import get_seat_stats_cache, set_seat_stats_cache
    
    # 尝试从缓存获取
    cached = get_seat_stats_cache()
    if cached:
        return SeatStats(**cached)
    
    # 从数据库获取
    teams = db.query(Team).filter(Team.is_active == True).all()
    
    total_seats = 0
    used_seats = 0
    
    for team in teams:
        total_seats += team.max_seats
        member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
        used_seats += member_count
    
    available_seats = max(0, total_seats - used_seats)
    
    result = SeatStats(
        total_seats=total_seats,
        used_seats=used_seats,
        pending_seats=0,
        available_seats=available_seats
    )
    
    # 写入缓存（30秒）
    set_seat_stats_cache(result.model_dump())
    return result


# ========== 直接链接兑换（无需登录）==========
class DirectRedeemRequest(BaseModel):
    email: EmailStr
    code: str


class DirectRedeemResponse(BaseModel):
    success: bool
    message: str
    team_name: Optional[str] = None


@router.get("/queue-status")
async def get_queue_status_api():
    """获取邀请队列状态"""
    from app.tasks import get_queue_status
    return await get_queue_status()


@router.get("/direct/{code}")
async def get_direct_code_info(code: str, db: Session = Depends(get_db)):
    """获取直接兑换码信息（验证是否有效）"""
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == code.strip().upper(),
        RedeemCode.code_type == RedeemCodeType.DIRECT,
        RedeemCode.is_active == True
    ).first()
    
    if not redeem_code:
        raise HTTPException(status_code=404, detail="兑换码无效或不存在")
    
    if redeem_code.expires_at and redeem_code.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="兑换码已过期")
    
    if redeem_code.used_count >= redeem_code.max_uses:
        raise HTTPException(status_code=400, detail="兑换码已用完")
    
    return {
        "valid": True,
        "remaining": redeem_code.max_uses - redeem_code.used_count,
        "expires_at": redeem_code.expires_at.isoformat() if redeem_code.expires_at else None
    }


@router.post("/direct-redeem", response_model=DirectRedeemResponse)
@limiter.limit("5/minute")  # 每分钟最多5次
async def direct_redeem(request: Request, data: DirectRedeemRequest, db: Session = Depends(get_db)):
    """直接兑换（无需登录，只需邮箱和兑换码）"""
    # 并发控制
    async with _redeem_semaphore:
        return await _do_direct_redeem(data, db)


async def _do_direct_redeem(data: DirectRedeemRequest, db: Session):
    """实际执行直接兑换逻辑 - 排队模式"""
    from app.tasks import enqueue_invite
    
    # 验证兑换码
    code = db.query(RedeemCode).filter(
        RedeemCode.code == data.code.strip().upper(),
        RedeemCode.code_type == RedeemCodeType.DIRECT,
        RedeemCode.is_active == True
    ).first()
    
    if not code:
        raise HTTPException(status_code=400, detail="兑换码无效")
    
    if code.expires_at and code.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="兑换码已过期")
    
    if code.used_count >= code.max_uses:
        raise HTTPException(status_code=400, detail="兑换码已用完")
    
    # 原子性增加使用次数
    from sqlalchemy import update
    result = db.execute(
        update(RedeemCode)
        .where(RedeemCode.id == code.id)
        .where(RedeemCode.used_count < RedeemCode.max_uses)
        .values(used_count=RedeemCode.used_count + 1)
    )
    
    if result.rowcount == 0:
        raise HTTPException(status_code=400, detail="兑换码已用完")
    
    db.commit()
    
    # 加入队列
    try:
        await enqueue_invite(
            email=data.email.lower().strip(),
            redeem_code=code.code,
            group_id=code.group_id
        )
        
        return DirectRedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请稍后查收邮箱",
            team_name=None
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ========== 商业版兑换 API ==========
from app.schemas import RedeemRequest, RedeemResponse


class RedeemError:
    """兑换错误码"""
    INVALID_CODE = "INVALID_CODE"
    CODE_EXPIRED = "CODE_EXPIRED"
    CODE_USED_UP = "CODE_USED_UP"
    EMAIL_MISMATCH = "EMAIL_MISMATCH"
    NO_AVAILABLE_TEAM = "NO_AVAILABLE_TEAM"
    USER_EXPIRED = "USER_EXPIRED"


@router.post("/redeem", response_model=RedeemResponse)
@limiter.limit("5/minute")
async def redeem(request: Request, data: RedeemRequest, db: Session = Depends(get_db)):
    """
    商业版兑换 API
    
    - 验证兑换码有效性
    - 首次使用时绑定邮箱、记录激活时间
    - 检查邮箱绑定一致性
    - 检查有效期
    - 发送邀请
    
    Requirements: 1.2, 2.1, 4.1, 4.2
    """
    async with _redeem_semaphore:
        return await _do_redeem(data, db)


async def _do_redeem(data: RedeemRequest, db: Session) -> RedeemResponse:
    """执行商业版兑换逻辑"""
    from app.tasks import enqueue_invite
    from sqlalchemy import update
    
    email = data.email.lower().strip()
    code_str = data.code.strip().upper()
    
    # 1. 查找兑换码
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == code_str,
        RedeemCode.is_active == True
    ).first()
    
    if not redeem_code:
        raise HTTPException(
            status_code=400, 
            detail={"error": RedeemError.INVALID_CODE, "message": "兑换码无效或不存在"}
        )
    
    # 2. 检查管理员设置的过期时间
    if redeem_code.expires_at and redeem_code.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail={"error": RedeemError.CODE_EXPIRED, "message": "兑换码已过期"}
        )
    
    # 3. 检查使用次数
    if redeem_code.used_count >= redeem_code.max_uses:
        raise HTTPException(
            status_code=400,
            detail={"error": RedeemError.CODE_USED_UP, "message": "兑换码已用完"}
        )
    
    # 4. 检查邮箱绑定一致性 (Requirements 4.1, 4.2)
    if redeem_code.bound_email:
        # 已绑定邮箱，检查是否匹配
        if redeem_code.bound_email.lower() != email:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": RedeemError.EMAIL_MISMATCH,
                    "message": f"此兑换码已绑定邮箱 {_mask_email(redeem_code.bound_email)}，请使用绑定的邮箱"
                }
            )
        
        # 5. 检查用户有效期 (Requirements 2.2)
        if redeem_code.is_user_expired:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": RedeemError.USER_EXPIRED,
                    "message": f"兑换码已于 {redeem_code.user_expires_at.strftime('%Y-%m-%d')} 过期"
                }
            )
    
    # 6. 首次使用：绑定邮箱和记录激活时间 (Requirements 2.1, 4.1)
    is_first_use = redeem_code.activated_at is None
    
    if is_first_use:
        # 原子性更新：绑定邮箱、激活时间、增加使用次数
        result = db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == redeem_code.id)
            .where(RedeemCode.used_count < RedeemCode.max_uses)
            .where(RedeemCode.activated_at == None)  # 确保是首次激活
            .values(
                used_count=RedeemCode.used_count + 1,
                activated_at=datetime.utcnow(),
                bound_email=email
            )
        )
        
        if result.rowcount == 0:
            # 并发情况下可能已被其他请求激活
            db.refresh(redeem_code)
            if redeem_code.bound_email and redeem_code.bound_email.lower() != email:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": RedeemError.EMAIL_MISMATCH,
                        "message": f"此兑换码已绑定邮箱 {_mask_email(redeem_code.bound_email)}"
                    }
                )
    else:
        # 非首次使用：只增加使用次数
        result = db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == redeem_code.id)
            .where(RedeemCode.used_count < RedeemCode.max_uses)
            .values(used_count=RedeemCode.used_count + 1)
        )
        
        if result.rowcount == 0:
            raise HTTPException(
                status_code=400,
                detail={"error": RedeemError.CODE_USED_UP, "message": "兑换码已用完"}
            )
    
    db.commit()
    db.refresh(redeem_code)
    
    # 7. 发送邀请
    try:
        await enqueue_invite(
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id
        )
        
        return RedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请查收邮箱",
            team_name=None,  # 队列模式下不知道具体 Team
            expires_at=redeem_code.user_expires_at,
            remaining_days=redeem_code.remaining_days
        )
    except Exception as e:
        logger.error(f"Enqueue invite failed: {e}")
        raise HTTPException(status_code=503, detail={"error": "QUEUE_ERROR", "message": str(e)})


def _mask_email(email: str) -> str:
    """遮蔽邮箱地址，只显示部分字符"""
    if not email or "@" not in email:
        return "***"
    
    local, domain = email.rsplit("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    
    return f"{masked_local}@{domain}"

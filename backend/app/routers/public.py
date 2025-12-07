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
from app.cache import get_redis
from app.services.distributed_limiter import DistributedLimiter
from app.services.redeem_limiter import RedeemLimiter

router = APIRouter(prefix="/public", tags=["public"])
logger = get_logger(__name__)

# 全局并发控制：基于 Redis 的分布式限流器（替代进程内 Semaphore）
def get_distributed_limiter() -> DistributedLimiter:
    """获取分布式限流器实例"""
    redis_client = get_redis()
    if not redis_client:
        # Redis 不可用时，回退到无限流（或抛出异常）
        logger.warning("Redis unavailable, distributed limiter disabled")
        # 返回一个临时的 mock 对象以避免破坏流程
        class NoOpLimiter:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
        return NoOpLimiter()

    return DistributedLimiter(
        redis_client,
        key="global:redeem:limiter",
        max_concurrent=10,
        timeout=60,
        acquire_timeout=30.0
    )


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
    """
    获取有空位的 Team（使用 SeatCalculator 精确计算）
    
    使用 SeatCalculator 统计成员数和 pending 邀请，避免超载
    
    Requirements: 1.1, 2.1
    """
    from app.services.seat_calculator import get_all_teams_with_seats
    from app.models import TeamGroup
    
    # 处理 group_name 转换为 group_id
    actual_group_id = group_id
    if not actual_group_id and group_name:
        group = db.query(TeamGroup).filter(TeamGroup.name == group_name).first()
        if group:
            actual_group_id = group.id
        else:
            return None
    
    # 使用 SeatCalculator 获取所有 Team 的精确座位信息
    teams_with_seats = get_all_teams_with_seats(
        db, 
        group_id=actual_group_id,
        only_active=True
    )
    
    # 返回第一个有空位的 Team
    for team_info in teams_with_seats:
        if team_info.available_seats > 0:
            # 返回实际的 Team 对象
            return db.query(Team).filter(Team.id == team_info.team_id).first()
    
    return None





# ========== 兑换码使用 ==========
class SeatStats(BaseModel):
    total_seats: int
    used_seats: int  # 已同步成员
    pending_seats: int  # 已邀请未接受
    available_seats: int  # 可用空位


@router.get("/seats", response_model=SeatStats)
async def get_seat_stats(db: Session = Depends(get_db)):
    """
    获取座位统计（公开，带缓存）
    
    使用 SeatCalculator 精确计算，包含 pending 邀请
    
    Requirements: 4.1, 4.2
    """
    from app.cache import get_seat_stats_cache, set_seat_stats_cache
    from app.services.seat_calculator import get_total_seat_stats
    
    # 尝试从缓存获取
    cached = get_seat_stats_cache()
    if cached:
        return SeatStats(**cached)
    
    # 使用 SeatCalculator 获取精确统计
    stats = get_total_seat_stats(db)
    
    result = SeatStats(
        total_seats=stats["total_seats"],
        used_seats=stats["confirmed_members"],
        pending_seats=stats["pending_invites"],
        available_seats=stats["available_seats"]
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
    # 分布式并发控制
    limiter_instance = get_distributed_limiter()
    async with limiter_instance:
        return await _do_direct_redeem(data, db)


async def _do_direct_redeem(data: DirectRedeemRequest, db: Session):
    """实际执行直接兑换逻辑 - Celery 异步模式"""
    from app.tasks_celery import process_invite_task
    from app.metrics import redeem_requests_total, errors_total

    # 验证兑换码
    code = db.query(RedeemCode).filter(
        RedeemCode.code == data.code.strip().upper(),
        RedeemCode.code_type == RedeemCodeType.DIRECT,
        RedeemCode.is_active == True
    ).first()

    if not code:
        errors_total.labels(error_type="invalid_code", endpoint="direct_redeem").inc()
        raise HTTPException(status_code=400, detail="兑换码无效")

    if code.expires_at and code.expires_at < datetime.utcnow():
        errors_total.labels(error_type="code_expired", endpoint="direct_redeem").inc()
        raise HTTPException(status_code=400, detail="兑换码已过期")

    # 使用 Redis 令牌桶扣减（避免数据库热点）
    redis_client = get_redis()
    if redis_client:
        limiter = RedeemLimiter(redis_client)

        # 尝试从 Redis 扣减
        if not limiter.try_redeem(code.code):
            # Redis 中余额不足，检查是否需要从数据库重新加载
            remaining = limiter.get_remaining(code.code)
            if remaining is None:
                # Redis 中不存在，从数据库初始化
                limiter.init_code(code.code, code.max_uses, code.used_count)
                if not limiter.try_redeem(code.code):
                    errors_total.labels(error_type="code_exhausted", endpoint="direct_redeem").inc()
                    raise HTTPException(status_code=400, detail="兑换码已用完")
            else:
                errors_total.labels(error_type="code_exhausted", endpoint="direct_redeem").inc()
                raise HTTPException(status_code=400, detail="兑换码已用完")

        # 异步回写数据库（Celery 会定时批量同步）
        from app.tasks_celery import sync_redeem_count_task
        sync_redeem_count_task.apply_async(args=[code.code], countdown=5)
    else:
        # Redis 不可用时回退到数据库（性能较低）
        from sqlalchemy import update
        result = db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == code.id)
            .where(RedeemCode.used_count < RedeemCode.max_uses)
            .values(used_count=RedeemCode.used_count + 1)
        )

        if result.rowcount == 0:
            errors_total.labels(error_type="code_exhausted", endpoint="direct_redeem").inc()
            raise HTTPException(status_code=400, detail="兑换码已用完")

        db.commit()

    # 提交 Celery 任务
    try:
        process_invite_task.delay(
            email=data.email.lower().strip(),
            redeem_code=code.code,
            group_id=code.group_id,
            is_rebind=False
        )

        redeem_requests_total.labels(status="success", code_type="direct").inc()

        return DirectRedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请稍后查收邮箱",
            team_name=None
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="direct_redeem").inc()
        logger.error(f"Failed to submit Celery task: {e}")
        raise HTTPException(status_code=503, detail=str(e))


# ========== 商业版兑换 API ==========
from app.schemas import RedeemRequest, RedeemResponse, StatusResponse, RebindRequest, RebindResponse


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
    limiter_instance = get_distributed_limiter()
    async with limiter_instance:
        return await _do_redeem(data, db)


async def _do_redeem(data: RedeemRequest, db: Session) -> RedeemResponse:
    """执行商业版兑换逻辑"""
    from app.tasks_celery import process_invite_task
    from sqlalchemy import update
    from app.metrics import redeem_requests_total, errors_total
    
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
        process_invite_task.delay(
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=False
        )

        redeem_requests_total.labels(status="success", code_type="linuxdo").inc()

        return RedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请查收邮箱",
            team_name=None,  # 队列模式下不知道具体 Team
            expires_at=redeem_code.user_expires_at,
            remaining_days=redeem_code.remaining_days
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="redeem").inc()
        logger.error(f"Failed to submit Celery task: {e}")
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


def _mask_code(code: str) -> str:
    """遮蔽兑换码，只显示前4位和后2位"""
    if not code or len(code) <= 6:
        return code[:2] + "***" if code else "***"
    return code[:4] + "*" * (len(code) - 6) + code[-2:]


# ========== 用户状态查询 API ==========
@router.get("/status", response_model=StatusResponse)
async def get_user_status(email: str, db: Session = Depends(get_db)):
    """
    用户状态查询 API
    
    根据邮箱查询绑定的兑换码，返回 Team 信息、有效期、换车可用性。
    
    Requirements: 8.1, 8.2, 8.3
    """
    normalized_email = email.lower().strip()
    
    if not normalized_email:
        return StatusResponse(found=False)
    
    # 查找绑定到该邮箱的兑换码
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.bound_email == normalized_email,
        RedeemCode.is_active == True
    ).first()
    
    if not redeem_code:
        # 没有找到绑定的兑换码 (Requirements 8.3)
        return StatusResponse(found=False)
    
    # 查找最近的邀请记录以获取 Team 信息
    invite_record = db.query(InviteRecord).filter(
        InviteRecord.email == normalized_email,
        InviteRecord.redeem_code == redeem_code.code,
        InviteRecord.status == InviteStatus.SUCCESS
    ).order_by(InviteRecord.created_at.desc()).first()
    
    team_name = None
    team_active = None
    can_rebind = False
    
    if invite_record and invite_record.team_id:
        team = db.query(Team).filter(Team.id == invite_record.team_id).first()
        if team:
            team_name = team.name
            team_active = team.is_active
            # 换车可用性：Team 不活跃且兑换码未过期 (Requirements 8.2)
            can_rebind = not team.is_active and not redeem_code.is_user_expired
    
    # 返回完整状态信息 (Requirements 8.1, 8.2)
    return StatusResponse(
        found=True,
        email=normalized_email,
        team_name=team_name,
        team_active=team_active,
        code=_mask_code(redeem_code.code),  # 遮蔽兑换码
        expires_at=redeem_code.user_expires_at,
        remaining_days=redeem_code.remaining_days,
        can_rebind=can_rebind
    )


# ========== 换车 API ==========
class RebindError:
    """换车错误码"""
    INVALID_CODE = "INVALID_CODE"
    EMAIL_MISMATCH = "EMAIL_MISMATCH"
    CODE_EXPIRED = "CODE_EXPIRED"
    TEAM_STILL_ACTIVE = "TEAM_STILL_ACTIVE"
    NO_AVAILABLE_TEAM = "NO_AVAILABLE_TEAM"
    NO_PREVIOUS_INVITE = "NO_PREVIOUS_INVITE"


@router.post("/rebind", response_model=RebindResponse)
@limiter.limit("3/minute")
async def rebind(request: Request, data: RebindRequest, db: Session = Depends(get_db)):
    """
    换车 API

    当用户所在 Team 被封或不可用时，使用同一兑换码重新分配到其他 Team。

    - 验证兑换码和邮箱
    - 检查当前 Team 是否不可用
    - 随机分配新 Team
    - 记录换车操作
    - 发送新邀请

    Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
    """
    limiter_instance = get_distributed_limiter()
    async with limiter_instance:
        return await _do_rebind(data, db)


async def _do_rebind(data: RebindRequest, db: Session) -> RebindResponse:
    """执行换车逻辑（支持自由换车）"""
    from app.tasks_celery import process_invite_task
    from app.metrics import rebind_requests_total, errors_total
    from app.models import RebindHistory
    from sqlalchemy import update

    email = data.email.lower().strip()
    code_str = data.code.strip().upper()

    # 1. 查找兑换码（使用悲观锁防止并发问题）
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == code_str,
        RedeemCode.is_active == True
    ).with_for_update().first()

    if not redeem_code:
        raise HTTPException(
            status_code=400,
            detail={"error": RebindError.INVALID_CODE, "message": "兑换码无效或不存在"}
        )

    # 2. 检查邮箱绑定一致性
    if not redeem_code.bound_email:
        raise HTTPException(
            status_code=400,
            detail={"error": RebindError.INVALID_CODE, "message": "此兑换码尚未激活，请先使用兑换功能"}
        )

    if redeem_code.bound_email.lower() != email:
        raise HTTPException(
            status_code=400,
            detail={
                "error": RebindError.EMAIL_MISMATCH,
                "message": f"邮箱与兑换码绑定邮箱不匹配"
            }
        )

    # 3. 检查用户有效期
    if redeem_code.is_user_expired:
        raise HTTPException(
            status_code=400,
            detail={
                "error": RebindError.CODE_EXPIRED,
                "message": f"兑换码已于 {redeem_code.user_expires_at.strftime('%Y-%m-%d')} 过期，无法换车"
            }
        )

    # 4. 检查换车次数限制（使用安全属性处理 NULL）
    if not redeem_code.can_rebind:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "REBIND_LIMIT_REACHED",
                "message": f"已达到换车次数上限（{redeem_code.safe_rebind_count}/{redeem_code.safe_rebind_limit}）"
            }
        )
    
    # 5. 查找最近的邀请记录（获取当前 Team）
    last_invite = db.query(InviteRecord).filter(
        InviteRecord.email == email,
        InviteRecord.redeem_code == redeem_code.code,
        InviteRecord.status == InviteStatus.SUCCESS
    ).order_by(InviteRecord.created_at.desc()).first()

    current_team_id = last_invite.team_id if last_invite else None
    current_team = db.query(Team).filter(Team.id == current_team_id).first() if current_team_id else None

    # 6. 分配新 Team（在同一分组内寻找可用 Team）
    new_team = get_available_team(db, group_id=redeem_code.group_id)

    if not new_team:
        raise HTTPException(
            status_code=400,
            detail={"error": RebindError.NO_AVAILABLE_TEAM, "message": "暂无可用的 Team，请稍后重试"}
        )

    # 7. 增加换车计数（使用悲观锁已在第1步获取）
    result = db.execute(
        update(RedeemCode)
        .where(RedeemCode.id == redeem_code.id)
        .where(RedeemCode.rebind_count < RedeemCode.rebind_limit)  # 再次检查
        .values(rebind_count=RedeemCode.rebind_count + 1)
    )

    if result.rowcount == 0:
        # 并发情况下可能已达上限
        raise HTTPException(
            status_code=400,
            detail={
                "error": "REBIND_LIMIT_REACHED",
                "message": "换车次数已达上限，请联系管理员"
            }
        )

    db.commit()
    db.refresh(redeem_code)

    # 8. 创建换车历史记录
    rebind_history = RebindHistory(
        redeem_code=redeem_code.code,
        email=email,
        from_team_id=current_team_id,
        to_team_id=None,  # 异步分配，暂时不知道
        reason="user_requested",
        notes=f"从 {current_team.name if current_team else 'unknown'} 换车"
    )
    db.add(rebind_history)
    db.commit()

    # 9. 发送新邀请
    try:
        process_invite_task.delay(
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=True  # 标记为换车操作
        )

        rebind_requests_total.labels(status="success").inc()

        logger.info(f"Rebind request queued", extra={
            "email": email,
            "code": redeem_code.code,
            "old_team": current_team.name if current_team else "unknown",
            "rebind_count": redeem_code.safe_rebind_count,
            "rebind_limit": redeem_code.safe_rebind_limit
        })

        return RebindResponse(
            success=True,
            message=f"换车请求已提交（{redeem_code.safe_rebind_count}/{redeem_code.safe_rebind_limit}），新邀请将在几秒内发送，请查收邮箱",
            new_team_name=None  # 队列模式下不知道具体分配到哪个 Team
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="rebind").inc()
        logger.error(f"Failed to submit rebind Celery task: {e}")
        raise HTTPException(
            status_code=503,
            detail={"error": "QUEUE_ERROR", "message": str(e)}
        )

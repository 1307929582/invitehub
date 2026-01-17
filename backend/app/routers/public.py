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
from app.services.email import send_waiting_queue_email
from app.utils.timezone import to_beijing_iso, now_beijing

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


def get_config_or_default(db: Session, key: str, default: str) -> str:
    """获取配置，若不存在则返回默认值（允许空字符串）"""
    value = get_config(db, key)
    return default if value is None else value


def _build_waiting_eta_message() -> str:
    """生成更友好的等待提示（北京时间）"""
    now = now_beijing()
    if 0 <= now.hour < 8:
        return "当前夜间车位释放较慢，预计今天上午 9 点左右可安排上车，我们会邮件通知您。"
    return "预计 30 分钟内会发送邀请邮件，请留意邮箱。"


def _build_waiting_message(queue_position: Optional[int] = None, is_rebind: bool = False) -> str:
    """组合排队提示语"""
    prefix = "已为您排队" if not is_rebind else "换车已为您排队"
    position = f"（第 {queue_position} 位）" if queue_position else ""
    return f"{prefix}{position}，{_build_waiting_eta_message()}"


def _count_inflight_requests(db: Session, code_str: str, is_rebind: bool) -> int:
    """统计某兑换码的在途请求数量（WAITING/PROCESSING/RESERVED/SUCCESS 未接受）"""
    from app.models import InviteQueue, InviteQueueStatus

    record_count = db.query(func.count(InviteRecord.id)).filter(
        InviteRecord.redeem_code == code_str,
        InviteRecord.status.in_([InviteStatus.RESERVED, InviteStatus.SUCCESS]),
        InviteRecord.accepted_at == None,
        InviteRecord.is_rebind == is_rebind
    ).scalar() or 0

    queue_count = db.query(func.count(InviteQueue.id)).filter(
        InviteQueue.redeem_code == code_str,
        InviteQueue.status.in_([
            InviteQueueStatus.WAITING,
            InviteQueueStatus.PROCESSING,
            InviteQueueStatus.PENDING
        ]),
        InviteQueue.is_rebind == is_rebind
    ).scalar() or 0

    return int(record_count + queue_count)


def _find_inflight_rebind(db: Session, code_str: str, email: str):
    """查找是否存在进行中的换车请求"""
    from app.models import InviteQueue, InviteQueueStatus

    existing_record = db.query(InviteRecord).filter(
        InviteRecord.redeem_code == code_str,
        func.lower(InviteRecord.email) == email.lower(),
        InviteRecord.is_rebind == True,
        InviteRecord.status.in_([InviteStatus.RESERVED, InviteStatus.SUCCESS]),
        InviteRecord.accepted_at == None
    ).order_by(InviteRecord.created_at.desc()).first()

    if existing_record:
        return ("reserved", existing_record, None)

    existing_queue = db.query(InviteQueue).filter(
        InviteQueue.redeem_code == code_str,
        func.lower(InviteQueue.email) == email.lower(),
        InviteQueue.is_rebind == True,
        InviteQueue.status.in_([
            InviteQueueStatus.WAITING,
            InviteQueueStatus.PROCESSING,
            InviteQueueStatus.PENDING
        ])
    ).order_by(InviteQueue.created_at.desc()).first()

    if existing_queue:
        return ("queue", None, existing_queue)

    return (None, None, None)


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
from typing import List
import json

# Features 配置限制
ALLOWED_FEATURE_ICONS = {
    "SafetyOutlined", "ThunderboltOutlined", "TeamOutlined",
    "CustomerServiceOutlined", "StarOutlined", "RocketOutlined",
}
MAX_FEATURES_JSON_CHARS = 10_000
MAX_FEATURES = 12
MAX_FEATURE_TEXT_LEN = 200
DEFAULT_SUPPORT_MESSAGE = "欢迎加入售后交流群，获取使用答疑与公告。"
DEFAULT_SUPPORT_TG_LINK = "https://t.me/+k9NwmID50XJmMzE9"
DEFAULT_SUPPORT_QQ_GROUP = "127743359"


class FeatureItem(BaseModel):
    """首页特性项"""
    icon: str = "StarOutlined"
    title: str = ""
    description: str = ""


class SiteConfig(BaseModel):
    site_title: str = "ChatGPT Team 自助上车"
    site_description: str = "使用兑换码加入 Team"
    home_notice: str = ""  # 首页公告
    success_message: str = "邀请已发送！请查收邮箱并接受邀请"
    footer_text: str = ""  # 页脚文字
    support_group_message: str = DEFAULT_SUPPORT_MESSAGE  # 上车/换车后弹窗文案
    support_tg_link: str = DEFAULT_SUPPORT_TG_LINK  # Telegram 群链接
    support_qq_group: str = DEFAULT_SUPPORT_QQ_GROUP  # QQ 群号
    is_simple_page: bool = False  # 是否为纯净页面（只显示兑换表单，不显示左侧广告）
    # 左侧面板配置
    hero_title: Optional[str] = None  # 大标题
    hero_subtitle: Optional[str] = None  # 副标题
    features: Optional[List[FeatureItem]] = None  # 特性列表


def _parse_features(features_json: Optional[str]) -> Optional[List[FeatureItem]]:
    """解析 features JSON 字符串（带安全限制）"""
    if not features_json:
        return None

    # 长度限制
    if len(features_json) > MAX_FEATURES_JSON_CHARS:
        logger.warning("features JSON too large; ignored")
        return None

    try:
        data = json.loads(features_json)
    except json.JSONDecodeError:
        return None

    if not isinstance(data, list):
        return None

    items: List[FeatureItem] = []
    for raw in data[:MAX_FEATURES]:
        if not isinstance(raw, dict):
            continue

        # 图标白名单
        icon = str(raw.get("icon") or "StarOutlined").strip()
        if icon not in ALLOWED_FEATURE_ICONS:
            icon = "StarOutlined"

        # 文本长度限制
        title = str(raw.get("title") or "").strip()[:MAX_FEATURE_TEXT_LEN]
        description = str(raw.get("description") or "").strip()[:MAX_FEATURE_TEXT_LEN]

        if not title or not description:
            continue

        items.append(FeatureItem(icon=icon, title=title, description=description))

    return items or None


@router.get("/site-config", response_model=SiteConfig)
async def get_site_config(request: Request, db: Session = Depends(get_db)):
    """获取站点配置（公开，带缓存）"""
    from app.cache import get_site_config_cache, set_site_config_cache

    # 检测是否是纯净页面域名
    hostname = (request.url.hostname or "").strip().lower().rstrip('.')

    # 从配置获取纯净页面域名列表（逗号分隔）
    simple_domains_str = get_config(db, "simple_page_domains") or ""
    simple_domains = [d.strip().lower() for d in simple_domains_str.split(",") if d.strip()]

    # 判断当前域名是否在纯净页面列表中
    is_simple = hostname in simple_domains

    # 纯净页面不使用缓存（因为需要动态判断域名）
    if is_simple:
        result = SiteConfig(
            site_title=get_config(db, "site_title") or "ChatGPT Team 自助上车",
            site_description=get_config(db, "site_description") or "使用兑换码加入 Team",
            home_notice=get_config(db, "home_notice") or "",
            success_message=get_config(db, "success_message") or "邀请已发送！请查收邮箱并接受邀请",
            footer_text=get_config(db, "footer_text") or "",
            support_group_message=get_config_or_default(db, "support_group_message", DEFAULT_SUPPORT_MESSAGE),
            support_tg_link=get_config_or_default(db, "support_tg_link", DEFAULT_SUPPORT_TG_LINK),
            support_qq_group=get_config_or_default(db, "support_qq_group", DEFAULT_SUPPORT_QQ_GROUP),
            is_simple_page=True,  # 纯净页面：只显示兑换表单
            hero_title=get_config(db, "hero_title"),
            hero_subtitle=get_config(db, "hero_subtitle"),
            features=_parse_features(get_config(db, "features"))
        )
        return result

    # 普通页面：尝试从缓存获取
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
        support_group_message=get_config_or_default(db, "support_group_message", DEFAULT_SUPPORT_MESSAGE),
        support_tg_link=get_config_or_default(db, "support_tg_link", DEFAULT_SUPPORT_TG_LINK),
        support_qq_group=get_config_or_default(db, "support_qq_group", DEFAULT_SUPPORT_QQ_GROUP),
        is_simple_page=False,  # 普通页面：完整显示
        hero_title=get_config(db, "hero_title"),
        hero_subtitle=get_config(db, "hero_subtitle"),
        features=_parse_features(get_config(db, "features"))
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


# ========== 直接链接兑换（商业版，支持邮箱绑定和有效期）==========
class DirectRedeemRequest(BaseModel):
    email: EmailStr
    code: str


class DirectRedeemResponse(BaseModel):
    success: bool
    message: str
    team_name: Optional[str] = None
    # 商业版新增字段
    expires_at: Optional[datetime] = None  # 用户到期时间
    remaining_days: Optional[int] = None  # 剩余天数
    is_first_use: Optional[bool] = None  # 是否首次使用
    # 方案 B: 座位满进入等待队列
    state: Optional[str] = None  # INVITE_QUEUED | WAITING_FOR_SEAT
    queue_position: Optional[int] = None  # 仅 WAITING_FOR_SEAT 时返回


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

    # 检查使用次数（max_uses == 0 表示不限量）
    if redeem_code.max_uses > 0:
        inflight = _count_inflight_requests(db, redeem_code.code, is_rebind=False)
        if redeem_code.used_count + inflight >= redeem_code.max_uses:
            raise HTTPException(status_code=400, detail="兑换码已用完")

    return {
        "valid": True,
        "remaining": (redeem_code.max_uses - redeem_code.used_count - inflight) if redeem_code.max_uses > 0 else -1,
        "expires_at": to_beijing_iso(redeem_code.expires_at) or None
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
    """
    直接兑换逻辑 - 商业版（支持邮箱绑定和有效期）

    核心规则：
    1. 一个兑换码只能绑定一个邮箱
    2. 首次使用时绑定邮箱并开始计算有效期
    3. 非首次使用时校验邮箱一致性
    4. 检查用户有效期（30天）
    5. 【P0-1 防超员】使用 DB 预占方案，确保座位可用后才返回成功
    """
    from app.tasks_celery import process_invite_task
    from app.metrics import redeem_requests_total, errors_total, waiting_queue_total
    from app.services.seat_calculator import reserve_seat_atomically
    from sqlalchemy import update

    email = data.email.lower().strip()
    code_str = data.code.strip().upper()

    # 1. 验证兑换码
    code = db.query(RedeemCode).filter(
        RedeemCode.code == code_str,
        RedeemCode.code_type == RedeemCodeType.DIRECT,
        RedeemCode.is_active == True
    ).with_for_update().first()

    if not code:
        errors_total.labels(error_type="invalid_code", endpoint="direct_redeem").inc()
        raise HTTPException(status_code=400, detail="兑换码无效")

    # 2. 检查管理员设置的过期时间
    if code.expires_at and code.expires_at < datetime.utcnow():
        errors_total.labels(error_type="code_expired", endpoint="direct_redeem").inc()
        raise HTTPException(status_code=400, detail="兑换码已过期")

    # 3. 检查邮箱绑定一致性（核心规则：一个码只能绑定一个邮箱）
    if code.bound_email:
        # 已绑定邮箱，检查是否匹配
        if code.bound_email.lower() != email:
            errors_total.labels(error_type="email_mismatch", endpoint="direct_redeem").inc()
            raise HTTPException(
                status_code=400,
                detail=f"此兑换码已绑定邮箱 {_mask_email(code.bound_email)}，请使用绑定的邮箱"
            )

        # 4. 检查用户有效期（30天）
        if code.is_user_expired:
            errors_total.labels(error_type="user_expired", endpoint="direct_redeem").inc()
            raise HTTPException(
                status_code=400,
                detail=f"兑换码已于 {code.user_expires_at.strftime('%Y-%m-%d')} 过期，请联系管理员续期"
            )

    # 5. 检查兑换码剩余额度（已使用 + 在途）
    if code.max_uses > 0:
        inflight = _count_inflight_requests(db, code.code, is_rebind=False)
        if code.used_count + inflight >= code.max_uses:
            errors_total.labels(error_type="code_exhausted", endpoint="direct_redeem").inc()
            raise HTTPException(status_code=400, detail="兑换码已用完")

    # 6. 首次使用仅绑定邮箱（不消耗次数、不激活）
    bound_now = False
    if not code.bound_email:
        result = db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == code.id)
            .where(RedeemCode.bound_email == None)
            .values(bound_email=email)
        )
        if result.rowcount > 0:
            bound_now = True
            db.refresh(code)
        else:
            db.refresh(code)
            if code.bound_email and code.bound_email.lower() != email:
                errors_total.labels(error_type="email_mismatch", endpoint="direct_redeem").inc()
                raise HTTPException(
                    status_code=400,
                    detail=f"此兑换码已绑定邮箱 {_mask_email(code.bound_email)}，请使用绑定的邮箱"
                )

    # ========== P0-1 核心修改：座位预占 ==========
    # 在继续处理之前，先原子性预占座位
    # 方案 B：如果座位已满，则进入 WAITING 队列等待空位
    seat_reserved, team_id, team_name = reserve_seat_atomically(
        db=db,
        email=email,
        redeem_code=code.code,
        group_id=code.group_id,
        is_rebind=False
    )

    queued_for_seat = not seat_reserved
    if queued_for_seat:
        # 座位满，进入等待队列（不消耗次数）
        team_id = None
        team_name = None

        # 幂等检查：如果已经在等待队列中，直接返回（不增加 used_count）
        queue_record, is_new = _get_or_create_waiting_queue(
            db=db,
            email=email,
            redeem_code=code.code,
            group_id=code.group_id,
            is_rebind=False
        )

        if not is_new:
            queue_position = _get_queue_position(db, queue_record, group_id=code.group_id)
            logger.info(f"User {email} already in queue, position {queue_position} (idempotent)")

            return DirectRedeemResponse(
                success=True,
                message=_build_waiting_message(queue_position=queue_position, is_rebind=False),
                team_name=None,
                expires_at=code.user_expires_at,
                remaining_days=code.remaining_days,
                is_first_use=bound_now,
                state="WAITING_FOR_SEAT",
                queue_position=queue_position
            )

    # 方案 B：座位满时进入等待队列 - 新记录处理（queue_record 在前面已创建）
    if queued_for_seat:
        # queue_record 已在前面的幂等检查中创建（is_new=True 时）
        # 这里只需提交并返回
        db.commit()
        db.refresh(queue_record)

        queue_position = _get_queue_position(db, queue_record, group_id=code.group_id)
        waiting_message = _build_waiting_message(queue_position=queue_position, is_rebind=False)

        # 记录 metrics
        waiting_queue_total.labels(code_type="direct").inc()
        logger.info(f"User {email} queued for seat, position {queue_position}")

        # 邮件提醒（可配置开关）
        send_waiting_queue_email(
            db,
            to_email=email,
            queue_position=queue_position,
            eta_message=_build_waiting_eta_message(),
            is_rebind=False
        )

        return DirectRedeemResponse(
            success=True,
            message=waiting_message,
            team_name=None,
            expires_at=code.user_expires_at,
            remaining_days=code.remaining_days,
            is_first_use=bound_now,
            state="WAITING_FOR_SEAT",
            queue_position=queue_position
        )

    # 8. 提交 Celery 邀请任务（座位已预占，状态为 RESERVED）
    db.commit()
    try:
        process_invite_task.delay(
            email=email,
            redeem_code=code.code,
            group_id=code.group_id,
            is_rebind=False,
            used_redis=False,
            consume_immediately=False,
            reserved_team_id=team_id  # 传递预占的 Team ID
        )

        redeem_requests_total.labels(status="success", code_type="direct").inc()

        return DirectRedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请查收邮箱",
            team_name=team_name,
            expires_at=code.user_expires_at,
            remaining_days=code.remaining_days,
            is_first_use=bound_now,
            state="INVITE_QUEUED",
            queue_position=None
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="direct_redeem").inc()
        logger.error(f"Failed to submit Celery task: {e}")

        # 尝试回退到进程内异步队列
        try:
            from app.tasks import enqueue_invite
            import asyncio
            asyncio.create_task(enqueue_invite(
                email=email,
                redeem_code=code.code,
                group_id=code.group_id,
                is_rebind=False,
                consume_immediately=False
            ))
            logger.info(f"Fallback to async queue succeeded for {email}")

            return DirectRedeemResponse(
                success=True,
                message="已加入队列，邀请将在几秒内发送，请查收邮箱",
                team_name=team_name,
                expires_at=code.user_expires_at,
                remaining_days=code.remaining_days,
                is_first_use=bound_now,
                state="INVITE_QUEUED",
                queue_position=None
            )
        except Exception as fallback_err:
            logger.error(f"Fallback to async queue also failed: {fallback_err}")

            # 回滚（补偿事务）- 删除 RESERVED 记录释放座位
            try:
                # 删除 RESERVED 记录
                db.query(InviteRecord).filter(
                    InviteRecord.email == email,
                    InviteRecord.redeem_code == code.code,
                    InviteRecord.status == InviteStatus.RESERVED,
                    InviteRecord.team_id == team_id
                ).delete()
                db.commit()
                logger.info(f"Rolled back reserved record for code {code.code}")
            except Exception as rollback_error:
                logger.error(f"Failed to rollback code {code.code}: {rollback_error}")

            raise HTTPException(status_code=503, detail="服务暂时不可用，请稍后重试")


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
    """
    执行商业版兑换逻辑

    核心规则（与 _do_direct_redeem 一致）：
    1. 一个兑换码只能绑定一个邮箱
    2. 首次使用时绑定邮箱并开始计算有效期
    3. 非首次使用时校验邮箱一致性
    4. 检查用户有效期（30天）
    5. 【P0-1 防超员】使用 DB 预占方案，确保座位可用后才返回成功
    """
    from app.tasks_celery import process_invite_task
    from sqlalchemy import update
    from app.metrics import redeem_requests_total, errors_total, waiting_queue_total
    from app.services.seat_calculator import reserve_seat_atomically

    email = data.email.lower().strip()
    code_str = data.code.strip().upper()

    # 1. 查找兑换码
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == code_str,
        RedeemCode.is_active == True
    ).with_for_update().first()

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

    # 3. 检查使用次数（max_uses == 0 表示不限量）
    if redeem_code.max_uses > 0:
        inflight = _count_inflight_requests(db, redeem_code.code, is_rebind=False)
        if redeem_code.used_count + inflight >= redeem_code.max_uses:
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

    # 6. 首次使用仅绑定邮箱（不消耗次数、不激活）
    bound_now = False
    if not redeem_code.bound_email:
        result = db.execute(
            update(RedeemCode)
            .where(RedeemCode.id == redeem_code.id)
            .where(RedeemCode.bound_email == None)
            .values(bound_email=email)
        )
        if result.rowcount > 0:
            bound_now = True
            db.refresh(redeem_code)
        else:
            db.refresh(redeem_code)
            if redeem_code.bound_email and redeem_code.bound_email.lower() != email:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": RedeemError.EMAIL_MISMATCH,
                        "message": f"此兑换码已绑定邮箱 {_mask_email(redeem_code.bound_email)}"
                    }
                )

    # ========== P0-1 核心修改：座位预占 ==========
    # 在继续处理之前，先原子性预占座位
    # 方案 B：如果座位已满，则进入 WAITING 队列等待空位
    seat_reserved, team_id, team_name = reserve_seat_atomically(
        db=db,
        email=email,
        redeem_code=redeem_code.code,
        group_id=redeem_code.group_id,
        is_rebind=False
    )

    queued_for_seat = not seat_reserved
    if queued_for_seat:
        # 座位满，进入队列（不立即返回错误）
        team_id = None
        team_name = None

        # 幂等检查：如果已经在等待队列中，直接返回（不增加 used_count）
        queue_record, is_new = _get_or_create_waiting_queue(
            db=db,
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=False
        )

        if not is_new:
            # 已有记录，直接返回现有位置
            queue_position = _get_queue_position(db, queue_record, group_id=redeem_code.group_id)
            logger.info(f"User {email} already in queue, position {queue_position} (idempotent)")

            return RedeemResponse(
                success=True,
                message=_build_waiting_message(queue_position=queue_position, is_rebind=False),
                team_name=None,
                expires_at=redeem_code.user_expires_at,
                remaining_days=redeem_code.remaining_days,
                state="WAITING_FOR_SEAT",
                queue_position=queue_position
            )

    # 方案 B：座位满时进入等待队列 - 新记录处理（queue_record 在前面已创建）
    if queued_for_seat:
        # queue_record 已在前面的幂等检查中创建（is_new=True 时）
        # 这里只需提交并返回
        db.commit()
        db.refresh(queue_record)

        queue_position = _get_queue_position(db, queue_record, group_id=redeem_code.group_id)
        waiting_message = _build_waiting_message(queue_position=queue_position, is_rebind=False)

        # 记录 metrics
        waiting_queue_total.labels(code_type="linuxdo").inc()
        logger.info(f"User {email} queued for seat, position {queue_position}")

        send_waiting_queue_email(
            db,
            to_email=email,
            queue_position=queue_position,
            eta_message=_build_waiting_eta_message(),
            is_rebind=False
        )

        return RedeemResponse(
            success=True,
            message=waiting_message,
            team_name=None,
            expires_at=redeem_code.user_expires_at,
            remaining_days=redeem_code.remaining_days,
            state="WAITING_FOR_SEAT",
            queue_position=queue_position
        )

    # 9. 提交 Celery 邀请任务（座位已预占，状态为 RESERVED）
    db.commit()
    try:
        process_invite_task.delay(
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=False,
            used_redis=False,  # redeem 接口不使用 Redis 令牌桶
            consume_immediately=False,
            reserved_team_id=team_id  # 传递预占的 Team ID
        )

        redeem_requests_total.labels(status="success", code_type="linuxdo").inc()

        return RedeemResponse(
            success=True,
            message="已加入队列，邀请将在几秒内发送，请查收邮箱",
            team_name=team_name,  # P0-1: 现在知道具体 Team（座位预占）
            expires_at=redeem_code.user_expires_at,
            remaining_days=redeem_code.remaining_days,
            state="INVITE_QUEUED",
            queue_position=None
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="redeem").inc()
        logger.error(f"Failed to submit Celery task: {e}")

        # 尝试回退到进程内异步队列
        try:
            from app.tasks import enqueue_invite
            import asyncio
            asyncio.create_task(enqueue_invite(
                email=email,
                redeem_code=redeem_code.code,
                group_id=redeem_code.group_id,
                is_rebind=False,
                consume_immediately=False
            ))
            logger.info(f"Fallback to async queue succeeded for {email}")

            return RedeemResponse(
                success=True,
                message="已加入队列，邀请将在几秒内发送，请查收邮箱",
                team_name=team_name,  # P0-1: 现在知道具体 Team
                expires_at=redeem_code.user_expires_at,
                remaining_days=redeem_code.remaining_days,
                state="INVITE_QUEUED",
                queue_position=None
            )
        except Exception as fallback_err:
            logger.error(f"Fallback to async queue also failed: {fallback_err}")

            # 回滚（补偿事务）- 删除 RESERVED 记录释放座位
            try:
                # 删除 RESERVED 记录
                db.query(InviteRecord).filter(
                    InviteRecord.email == email,
                    InviteRecord.redeem_code == redeem_code.code,
                    InviteRecord.status == InviteStatus.RESERVED,
                    InviteRecord.team_id == team_id
                ).delete()
                db.commit()
                logger.info(f"Rolled back reserved record for code ***{redeem_code.code[-4:]} after all failures")
            except Exception as rollback_error:
                logger.error(f"Failed to rollback redeem code: {rollback_error}")

            raise HTTPException(status_code=503, detail={"error": "QUEUE_ERROR", "message": "服务暂时不可用，请稍后重试"})


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


def _get_or_create_waiting_queue(
    db: Session,
    email: str,
    redeem_code: str,
    group_id: Optional[int],
    is_rebind: bool,
    old_team_id: Optional[int] = None,
    old_team_chatgpt_user_id: Optional[str] = None,
    consume_immediately: bool = False
) -> tuple["InviteQueue", bool]:
    """
    幂等获取或创建等待队列记录

    Returns:
        (queue_record, is_new): 队列记录和是否是新创建的标志
    """
    from app.models import InviteQueue, InviteQueueStatus

    # 查找现有的 WAITING/PENDING/PROCESSING 状态记录
    existing = db.query(InviteQueue).filter(
        InviteQueue.email == email,
        InviteQueue.redeem_code == redeem_code,
        InviteQueue.is_rebind == is_rebind,
        InviteQueue.status.in_([
            InviteQueueStatus.WAITING,
            InviteQueueStatus.PENDING,
            InviteQueueStatus.PROCESSING
        ])
    ).first()

    if existing:
        # 已有记录，直接返回（幂等）
        return existing, False

    # 创建新记录
    queue_record = InviteQueue(
        email=email,
        redeem_code=redeem_code,
        group_id=group_id,
        is_rebind=is_rebind,
        old_team_id=old_team_id,
        old_team_chatgpt_user_id=old_team_chatgpt_user_id,
        consume_immediately=consume_immediately,
        status=InviteQueueStatus.WAITING,
        error_message="所有 Team 已满，等待空位",
        processed_at=None
    )
    db.add(queue_record)
    db.flush()  # 获取 id，但不提交（由调用方统一提交）
    return queue_record, True


def _get_queue_position(db: Session, record: "InviteQueue", group_id: Optional[int] = None) -> int:
    """
    计算等待队列中的位置（FIFO，按 group_id 分组）

    使用 id 而非 created_at 做稳定排序，避免同秒并发时位置不稳定
    """
    from app.models import InviteQueue, InviteQueueStatus

    query = db.query(InviteQueue).filter(
        InviteQueue.status == InviteQueueStatus.WAITING,
        InviteQueue.id < record.id  # 使用 id 做稳定排序
    )

    # 按 group_id 分组（NULL 统一处理）
    if group_id is not None:
        query = query.filter(InviteQueue.group_id == group_id)
    else:
        query = query.filter(InviteQueue.group_id.is_(None))

    position = query.count()
    return position + 1  # 位置从 1 开始


# ========== 用户状态查询 API ==========
@router.get("/status", response_model=StatusResponse)
async def get_user_status(
    email: Optional[str] = None,
    code: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    用户状态查询 API

    支持两种查询方式（至少提供一个）：
    - 通过邮箱查询：返回该邮箱绑定的兑换码信息
    - 通过兑换码查询：返回该兑换码的绑定信息

    Requirements: 8.1, 8.2, 8.3
    """
    # 至少需要提供一个查询参数
    if not email and not code:
        raise HTTPException(status_code=400, detail="请提供邮箱或兑换码")

    redeem_code = None
    query_email = None

    if code:
        # 通过兑换码查询
        normalized_code = code.strip().upper()
        redeem_code = db.query(RedeemCode).filter(
            RedeemCode.code == normalized_code,
            RedeemCode.is_active == True
        ).first()

        if redeem_code and redeem_code.bound_email:
            query_email = redeem_code.bound_email

    if email and not redeem_code:
        # 通过邮箱查询
        query_email = email.lower().strip()
        redeem_code = db.query(RedeemCode).filter(
            RedeemCode.bound_email == query_email,
            RedeemCode.is_active == True
        ).first()

    if not redeem_code:
        return StatusResponse(found=False)

    # 确定用于查询邀请记录的邮箱
    if not query_email and redeem_code.bound_email:
        query_email = redeem_code.bound_email

    # 查找最近的邀请记录以获取 Team 信息
    team_name = None
    team_active = None
    # 仅一次换车机会：只要已绑定且未过期、未用完次数，即允许申请
    can_rebind = bool(redeem_code.bound_email) and redeem_code.can_rebind

    if query_email:
        invite_record = db.query(InviteRecord).filter(
            InviteRecord.email == query_email,
            InviteRecord.redeem_code == redeem_code.code,
            InviteRecord.status == InviteStatus.SUCCESS
        ).order_by(InviteRecord.created_at.desc()).first()

        if invite_record and invite_record.team_id:
            team = db.query(Team).filter(Team.id == invite_record.team_id).first()
            if team:
                team_name = team.name
                team_active = team.is_active

    # 返回完整状态信息 (Requirements 8.1, 8.2)
    return StatusResponse(
        found=True,
        email=redeem_code.bound_email,  # 返回绑定的邮箱（可能为空）
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
    REBIND_WINDOW_EXPIRED = "REBIND_WINDOW_EXPIRED"  # 超过换车窗口
    TEAM_STILL_ACTIVE = "TEAM_STILL_ACTIVE"  # Team 正常运行，不允许换车
    NO_AVAILABLE_TEAM = "NO_AVAILABLE_TEAM"
    NO_PREVIOUS_INVITE = "NO_PREVIOUS_INVITE"  # 首次使用，无邀请记录
    TEAM_NOT_BANNED = "TEAM_NOT_BANNED"  # Team 未封禁（保留旧错误码）


@router.post("/rebind", response_model=RebindResponse)
@limiter.limit("3/minute")
async def rebind(request: Request, data: RebindRequest, db: Session = Depends(get_db)):
    """
    换车 API

    当用户需要更换 Team 时，使用同一兑换码重新分配到其他 Team。
    （仅一次换车机会，建议确认当前 Team 已封禁后再使用）

    - 验证兑换码和邮箱
    - 校验当前 Team 信息
    - 随机分配新 Team
    - 记录换车操作
    - 发送新邀请

    Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
    """
    limiter_instance = get_distributed_limiter()
    async with limiter_instance:
        return await _do_rebind(data, db)


# ========== 邀请状态查询 API ==========
from app.models import InviteQueue, InviteQueueStatus


class InviteStatusResponse(BaseModel):
    """邀请状态响应"""
    found: bool
    email: Optional[str] = None
    status: Optional[str] = None  # pending, processing, success, failed, waiting
    status_message: Optional[str] = None
    team_name: Optional[str] = None
    created_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None
    retry_count: Optional[int] = None
    can_retry: Optional[bool] = None  # True 表示会自动重试或自动处理（WAITING/FAILED）
    queue_position: Optional[int] = None  # 队列位置（仅 WAITING 状态）


@router.get("/invite-status", response_model=InviteStatusResponse)
async def get_invite_status(email: str, db: Session = Depends(get_db)):
    """
    查询邀请状态 API

    用户可以通过邮箱查询自己的邀请是否成功。

    返回：
    - 最近的邀请记录状态（成功/失败/处理中）
    - 如果失败，显示是否可以自动重试
    - 如果成功，显示所在的 Team
    """
    normalized_email = email.lower().strip()

    if not normalized_email:
        return InviteStatusResponse(found=False)

    # 1. 先查询 InviteRecord（成功的邀请）
    invite_record = db.query(InviteRecord).filter(
        func.lower(InviteRecord.email) == normalized_email
    ).order_by(InviteRecord.created_at.desc()).first()

    if invite_record and invite_record.status == InviteStatus.SUCCESS:
        # 获取 Team 名称
        team = db.query(Team).filter(Team.id == invite_record.team_id).first()
        return InviteStatusResponse(
            found=True,
            email=normalized_email,
            status="success",
            status_message="邀请已发送成功，请查收邮箱并接受邀请",
            team_name=team.name if team else None,
            created_at=invite_record.created_at,
            processed_at=invite_record.created_at,
            retry_count=0,
            can_retry=False
        )

    # 2. 查询 InviteQueue（队列中的记录，包括失败的）
    queue_record = db.query(InviteQueue).filter(
        func.lower(InviteQueue.email) == normalized_email
    ).order_by(InviteQueue.created_at.desc()).first()

    if queue_record:
        status_map = {
            InviteQueueStatus.PENDING: ("pending", "邀请正在排队中，请稍候"),
            InviteQueueStatus.PROCESSING: ("processing", "邀请正在处理中，请稍候"),
            InviteQueueStatus.SUCCESS: ("success", "邀请已发送成功，请查收邮箱"),
            InviteQueueStatus.FAILED: ("failed", f"邀请发送失败: {queue_record.error_message or '未知错误'}"),
            InviteQueueStatus.WAITING: ("waiting", "waiting")
        }

        status, message = status_map.get(
            queue_record.status,
            ("unknown", "状态未知")
        )

        # 判断是否可以重试（仅 FAILED 状态可以重试，WAITING 状态会自动处理）
        can_retry = (
            queue_record.status == InviteQueueStatus.FAILED and
            queue_record.retry_count < 5
        )

        # 自动处理标志（WAITING 状态会自动处理）
        will_auto_process = queue_record.status == InviteQueueStatus.WAITING

        # 计算队列位置（仅 WAITING 状态）
        queue_position = _get_queue_position(db, queue_record, group_id=queue_record.group_id) if will_auto_process else None

        # 根据状态生成消息
        if status == "failed" and can_retry:
            display_message = f"{message}（系统将自动重试）"
        elif status == "waiting":
            display_message = _build_waiting_message(
                queue_position=queue_position,
                is_rebind=getattr(queue_record, "is_rebind", False)
            )
        else:
            display_message = message

        return InviteStatusResponse(
            found=True,
            email=normalized_email,
            status=status,
            status_message=display_message,
            team_name=None,
            created_at=queue_record.created_at,
            processed_at=queue_record.processed_at,
            retry_count=queue_record.retry_count,
            can_retry=can_retry or will_auto_process,  # WAITING 状态也标记为会自动处理
            queue_position=queue_position
        )

    # 3. 如果 InviteRecord 有失败记录
    if invite_record and invite_record.status == InviteStatus.FAILED:
        return InviteStatusResponse(
            found=True,
            email=normalized_email,
            status="failed",
            status_message=f"邀请发送失败: {invite_record.error_message or '未知错误'}",
            team_name=None,
            created_at=invite_record.created_at,
            processed_at=invite_record.created_at,
            retry_count=0,
            can_retry=False
        )

    # 4. 如果 InviteRecord 显示成员被移除
    if invite_record and invite_record.status == InviteStatus.REMOVED:
        return InviteStatusResponse(
            found=True,
            email=normalized_email,
            status="removed",
            status_message=invite_record.error_message or "成员已被移除",
            team_name=None,
            created_at=invite_record.created_at,
            processed_at=invite_record.created_at,
            retry_count=0,
            can_retry=False
        )

    # 5. 没有找到任何记录
    return InviteStatusResponse(found=False)


async def _do_rebind(data: RebindRequest, db: Session) -> RebindResponse:
    """执行换车逻辑（支持自由换车，简化版只需兑换码）"""
    from app.tasks_celery import process_invite_task
    from app.metrics import rebind_requests_total, errors_total
    from app.models import RebindHistory
    from sqlalchemy import update

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

    # 2. 获取邮箱：优先使用请求中的邮箱，否则使用绑定邮箱
    if data.email:
        email = data.email.lower().strip()
    elif redeem_code.bound_email:
        email = redeem_code.bound_email.lower().strip()
    else:
        raise HTTPException(
            status_code=400,
            detail={"error": RebindError.INVALID_CODE, "message": "此兑换码尚未激活，请先使用兑换功能"}
        )

    # 3. 检查邮箱绑定一致性（如果请求中提供了邮箱）
    if data.email and redeem_code.bound_email and redeem_code.bound_email.lower() != email:
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

    # 3.5 检查换车窗口（激活后 15 天内）
    if redeem_code.is_rebind_window_expired:
        raise HTTPException(
            status_code=400,
            detail={
                "error": RebindError.REBIND_WINDOW_EXPIRED,
                "message": "换车需在兑换码激活后 15 天内完成"
            }
        )

    # 4. 查找最近的邀请记录（获取当前 Team）
    last_invite = db.query(InviteRecord).filter(
        InviteRecord.email == email,
        InviteRecord.redeem_code == redeem_code.code,
        InviteRecord.status == InviteStatus.SUCCESS
    ).order_by(InviteRecord.created_at.desc()).first()

    current_team_id = last_invite.team_id if last_invite else None
    current_team = db.query(Team).filter(Team.id == current_team_id).first() if current_team_id else None

    # 5. 获取原 Team 信息（仅一次换车机会，任意状态均可申请）
    old_team_chatgpt_user_id = None

    if not current_team:
        logger.info(f"Rebind without current team (first time or lost record)", extra={
            "email": email,
            "redeem_code": redeem_code.code
        })
    else:
        logger.info(f"Rebind from team", extra={
            "email": email,
            "team": current_team.name,
            "team_status": current_team.status.value
        })

        # 获取用户在原 Team 的 chatgpt_user_id（用于踢人）
        member = db.query(TeamMember).filter(
            TeamMember.team_id == current_team_id,
            TeamMember.email == email
        ).first()
        if member:
            old_team_chatgpt_user_id = member.chatgpt_user_id

    # 6. 检查换车次数限制（仅一次机会）
    if redeem_code.safe_rebind_count >= redeem_code.safe_rebind_limit:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "REBIND_LIMIT_REACHED",
                "message": f"已达到换车次数上限（{redeem_code.safe_rebind_count}/{redeem_code.safe_rebind_limit}）"
            }
        )

    # 6.1 幂等处理：若已有进行中的换车请求，直接返回状态
    inflight_type, inflight_record, inflight_queue = _find_inflight_rebind(db, redeem_code.code, email)
    if inflight_type == "reserved":
        return RebindResponse(
            success=True,
            message="换车请求已在处理中，请稍候查收邀请邮件",
            new_team_name=None,
            state="INVITE_QUEUED",
            queue_position=None,
            email=email
        )
    if inflight_type == "queue" and inflight_queue:
        queue_position = _get_queue_position(db, inflight_queue, group_id=redeem_code.group_id)
        return RebindResponse(
            success=True,
            message=_build_waiting_message(queue_position=queue_position, is_rebind=True),
            new_team_name=None,
            state="WAITING_FOR_SEAT",
            queue_position=queue_position,
            email=email
        )

    # 7. 原子性预占座位（无空位则入队）
    from app.services.seat_calculator import reserve_seat_atomically
    seat_reserved, team_id, team_name = reserve_seat_atomically(
        db=db,
        email=email,
        redeem_code=redeem_code.code,
        group_id=redeem_code.group_id,
        is_rebind=True
    )

    queued_for_seat = not seat_reserved
    if queued_for_seat:
        queue_record, is_new = _get_or_create_waiting_queue(
            db=db,
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=True,
            old_team_id=current_team_id,
            old_team_chatgpt_user_id=old_team_chatgpt_user_id
        )

        if not is_new:
            queue_position = _get_queue_position(db, queue_record, group_id=redeem_code.group_id)
            return RebindResponse(
                success=True,
                message=_build_waiting_message(queue_position=queue_position, is_rebind=True),
                new_team_name=None,
                state="WAITING_FOR_SEAT",
                queue_position=queue_position,
                email=email
            )

        # 写入换车历史记录
        rebind_history = RebindHistory(
            redeem_code=redeem_code.code,
            email=email,
            from_team_id=current_team_id,
            to_team_id=None,
            reason="user_requested",
            notes=f"从 {current_team.name if current_team else 'unknown'} 换车（排队中）"
        )
        db.add(rebind_history)
        db.commit()

        queue_position = _get_queue_position(db, queue_record, group_id=redeem_code.group_id)
        send_waiting_queue_email(
            db,
            to_email=email,
            queue_position=queue_position,
            eta_message=_build_waiting_eta_message(),
            is_rebind=True
        )

        return RebindResponse(
            success=True,
            message=_build_waiting_message(queue_position=queue_position, is_rebind=True),
            new_team_name=None,
            state="WAITING_FOR_SEAT",
            queue_position=queue_position,
            email=email
        )

    # 8. 有空位：记录换车历史并提交任务
    rebind_history = RebindHistory(
        redeem_code=redeem_code.code,
        email=email,
        from_team_id=current_team_id,
        to_team_id=None,
        reason="user_requested",
        notes=f"从 {current_team.name if current_team else 'unknown'} 换车（排队中）"
    )
    db.add(rebind_history)
    db.commit()

    try:
        process_invite_task.delay(
            email=email,
            redeem_code=redeem_code.code,
            group_id=redeem_code.group_id,
            is_rebind=True,
            consume_rebind_count=False,
            old_team_id=current_team_id,
            old_team_chatgpt_user_id=old_team_chatgpt_user_id,
            used_redis=False,
            consume_immediately=False,
            reserved_team_id=team_id
        )

        rebind_requests_total.labels(status="success").inc()
        logger.info(f"Rebind request queued", extra={
            "email": email,
            "code": redeem_code.code,
            "old_team": current_team.name if current_team else "unknown"
        })

        return RebindResponse(
            success=True,
            message="换车请求已提交，邀请将在几秒内发送，请查收邮箱",
            new_team_name=None,
            state="INVITE_QUEUED",
            queue_position=None,
            email=email
        )
    except Exception as e:
        errors_total.labels(error_type="celery_error", endpoint="rebind").inc()
        logger.error(f"Failed to submit rebind Celery task: {e}")

        # 尝试回退到进程内异步队列
        try:
            from app.tasks import enqueue_invite
            import asyncio
            asyncio.create_task(enqueue_invite(
                email=email,
                redeem_code=redeem_code.code,
                group_id=redeem_code.group_id,
                is_rebind=True,
                consume_immediately=False,
                old_team_id=current_team_id,
                old_team_chatgpt_user_id=old_team_chatgpt_user_id
            ))
            logger.info(f"Fallback to async queue succeeded for rebind {email}")

            return RebindResponse(
                success=True,
                message="换车请求已提交，邀请将在几秒内发送，请查收邮箱",
                new_team_name=None,
                state="INVITE_QUEUED",
                queue_position=None,
                email=email
            )
        except Exception as fallback_err:
            logger.error(f"Fallback to async queue also failed for rebind: {fallback_err}")
            # 回滚（补偿事务）- 删除 RESERVED 记录释放座位
            try:
                db.query(InviteRecord).filter(
                    InviteRecord.email == email,
                    InviteRecord.redeem_code == redeem_code.code,
                    InviteRecord.status == InviteStatus.RESERVED,
                    InviteRecord.team_id == team_id
                ).delete()
                db.commit()
                logger.info(f"Rolled back reserved record for rebind code {redeem_code.code}")
            except Exception as rollback_error:
                logger.error(f"Failed to rollback rebind reserved record: {rollback_error}")
            raise HTTPException(
                status_code=503,
                detail={"error": "QUEUE_ERROR", "message": "服务暂时不可用，请稍后重试"}
            )

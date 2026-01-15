# FastAPI 主入口
import asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.database import init_db, SessionLocal
from app.routers import auth, teams, invites, dashboard, public, redeem, config, setup, groups, invite_records, admins, notifications, telegram_bot, distributors, plans, orders, shop, coupons, linuxdo
from app.logger import setup_logging, get_logger
from app.limiter import limiter, rate_limit_exceeded_handler

# 初始化日志
setup_logging(level="INFO" if not settings.DEBUG else "DEBUG")
logger = get_logger(__name__)


async def sync_all_teams():
    """定时同步所有 Team 成员（仅同步健康的 Team）"""
    from app.models import Team, TeamMember, InviteRecord, InviteStatus, TeamStatus
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.services.authorization import check_is_unauthorized
    from datetime import datetime
    from app.models import RedeemCode
    from sqlalchemy import or_

    db = SessionLocal()
    try:
        # 只同步健康的 Team（is_active=True AND status=ACTIVE）
        teams_list = db.query(Team).filter(
            Team.is_active == True,
            Team.status == TeamStatus.ACTIVE
        ).all()

        for team in teams_list:
            try:
                api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
                result = await api.get_members(team.account_id)
                members_data = result.get("items", result.get("users", []))

                # 获取成员邮箱列表
                member_emails = set()
                for m in members_data:
                    email = m.get("email", "").lower().strip()
                    if email:
                        member_emails.add(email)

                # 更新邀请记录：如果邮箱已在成员列表中，标记为已接受
                pending_invites = db.query(InviteRecord).filter(
                    InviteRecord.team_id == team.id,
                    InviteRecord.status == InviteStatus.SUCCESS,
                    or_(
                        InviteRecord.accepted_at == None,
                        InviteRecord.consumed_at == None
                    )
                ).all()

                for invite in pending_invites:
                    if invite.email.lower().strip() in member_emails:
                        now = datetime.utcnow()
                        if invite.accepted_at is None:
                            invite.accepted_at = now

                        # 兑换/换车次数消耗：仅在加入成功时处理
                        if invite.redeem_code and not invite.consumed_at:
                            code = db.query(RedeemCode).filter(
                                RedeemCode.code == invite.redeem_code
                            ).with_for_update().first()
                            if code:
                                if invite.is_rebind:
                                    if code.safe_rebind_count < code.safe_rebind_limit:
                                        code.rebind_count = (code.rebind_count or 0) + 1
                                    else:
                                        logger.warning("Rebind count exceeded on consume", extra={
                                            "code": invite.redeem_code,
                                            "email": invite.email
                                        })
                                else:
                                    if code.max_uses == 0 or code.used_count < code.max_uses:
                                        code.used_count = (code.used_count or 0) + 1
                                    else:
                                        logger.warning("Used count exceeded on consume", extra={
                                            "code": invite.redeem_code,
                                            "email": invite.email
                                        })
                                    if not code.activated_at:
                                        code.activated_at = now
                                    if not code.bound_email:
                                        code.bound_email = invite.email.lower().strip()

                                invite.consumed_at = now

                # ✅ 保存旧的授权状态（防止同步覆盖管理员手动授权）
                old_members = db.query(TeamMember).filter(TeamMember.team_id == team.id).all()
                old_auth_state = {m.email.lower().strip(): m.is_unauthorized for m in old_members}

                # 清除旧成员数据
                db.query(TeamMember).filter(TeamMember.team_id == team.id).delete()

                # 插入新成员数据（去重）并正确设置 is_unauthorized
                seen_emails = set()
                for m in members_data:
                    email = m.get("email", "").lower().strip()
                    if not email or email in seen_emails:
                        continue
                    seen_emails.add(email)

                    role = m.get("role", "member")

                    # ✅ 使用统一函数检查是否未授权
                    computed_unauthorized = check_is_unauthorized(
                        email=email,
                        team_id=team.id,
                        role=role,
                        db=db
                    )

                    # ✅ 保留已确认授权的状态（防止同步覆盖管理员手动授权）
                    old_state = old_auth_state.get(email)
                    if old_state is False:
                        is_unauthorized = False  # 保留管理员手动授权
                    else:
                        is_unauthorized = computed_unauthorized

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

                db.commit()

                # 清除座位缓存
                from app.cache import invalidate_seat_cache
                invalidate_seat_cache()

                logger.info("Team sync completed", extra={
                    "team": team.name,
                    "member_count": len(members_data)
                })

            except ChatGPTAPIError as e:
                logger.error("Team sync failed", extra={
                    "team": team.name,
                    "error": e.message
                })
            except Exception as e:
                logger.exception("Team sync exception", extra={
                    "team": team.name,
                    "error": str(e)
                })

            # 每个 Team 间隔 2 秒，避免请求过快
            await asyncio.sleep(2)

    finally:
        db.close()


async def check_and_send_alerts():
    """检查预警并发送邮件（仅检查健康的 Team）"""
    from app.models import Team, TeamMember, TeamGroup, TeamStatus
    from app.services.email import (
        send_alert_email,
        get_notification_settings,
        send_token_expiring_notification,
        send_seat_warning_notification,
        send_group_seat_warning
    )
    from datetime import datetime, timedelta
    from sqlalchemy import func

    db = SessionLocal()
    try:
        # 获取通知设置
        settings = get_notification_settings(db)
        if not settings.get("enabled"):
            logger.info("Notifications disabled, skipping alert check")
            return

        token_expiring_days = settings.get("token_expiring_days", 7)
        seat_warning_threshold = settings.get("seat_warning_threshold", 80)
        group_seat_warning_threshold = settings.get("group_seat_warning_threshold", 5)  # 分组剩余座位预警阈值

        alerts = []
        # 只检查健康的 Team（is_active=True AND status=ACTIVE）
        teams_list = db.query(Team).filter(
            Team.is_active == True,
            Team.status == TeamStatus.ACTIVE
        ).all()
        
        for team in teams_list:
            # 检查成员数量和座位使用率
            member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            max_seats = team.max_seats or 5
            usage_percent = (member_count / max_seats * 100) if max_seats > 0 else 0
            
            if member_count >= max_seats:
                alerts.append({
                    "type": "error",
                    "team": team.name,
                    "message": f"座位已满！当前 {member_count}/{max_seats} 人，无法继续邀请。"
                })
                send_seat_warning_notification(db, team.name, member_count, max_seats)
            elif usage_percent >= seat_warning_threshold:
                alerts.append({
                    "type": "warning",
                    "team": team.name,
                    "message": f"座位使用率 {usage_percent:.0f}%（{member_count}/{max_seats}），接近上限。"
                })
                send_seat_warning_notification(db, team.name, member_count, max_seats)
            
            # 检查 Token 过期
            if team.token_expires_at:
                days_left = (team.token_expires_at - datetime.utcnow()).days
                if days_left <= 0:
                    alerts.append({
                        "type": "error",
                        "team": team.name,
                        "message": "Token 已过期，请尽快更新"
                    })
                    send_token_expiring_notification(db, team.name, days_left)
                elif days_left <= token_expiring_days:
                    alerts.append({
                        "type": "warning",
                        "team": team.name,
                        "message": f"Token 将在 {days_left} 天后过期"
                    })
                    send_token_expiring_notification(db, team.name, days_left)
        
        # 检查分组座位情况（使用每个分组自己的阈值）
        groups = db.query(TeamGroup).all()
        for group in groups:
            # 获取分组的预警阈值，0 表示不预警
            group_threshold = group.alert_threshold if group.alert_threshold is not None else 5
            if group_threshold == 0:
                continue  # 该分组不需要预警
            
            # 获取该分组下所有健康的 Team 的座位统计
            group_teams = db.query(Team).filter(
                Team.group_id == group.id,
                Team.is_active == True,
                Team.status == TeamStatus.ACTIVE
            ).all()
            
            if not group_teams:
                continue
            
            total_seats = sum(t.max_seats or 5 for t in group_teams)
            used_seats = 0
            for t in group_teams:
                used_seats += db.query(TeamMember).filter(TeamMember.team_id == t.id).count()
            
            available_seats = total_seats - used_seats
            
            # 分组座位预警：剩余座位少于该分组的阈值
            if available_seats <= 0:
                alerts.append({
                    "type": "error",
                    "team": f"分组: {group.name}",
                    "message": f"分组座位已满！（{used_seats}/{total_seats}）"
                })
                send_group_seat_warning(db, group.name, used_seats, total_seats, available_seats)
            elif available_seats <= group_threshold:
                alerts.append({
                    "type": "warning",
                    "team": f"分组: {group.name}",
                    "message": f"分组仅剩 {available_seats} 个空位（{used_seats}/{total_seats}，阈值: {group_threshold}）"
                })
                send_group_seat_warning(db, group.name, used_seats, total_seats, available_seats)
        
        if alerts:
            send_alert_email(db, alerts)
            logger.info(f"Sent {len(alerts)} alerts via email")
            
    except Exception as e:
        logger.exception("Alert check error", extra={"error": str(e)})
    finally:
        db.close()


async def periodic_sync():
    """定时任务：每 5 分钟同步一次 Team 成员"""
    alert_counter = 0  # 每小时检查一次预警
    while True:
        await asyncio.sleep(300)  # 5 分钟
        try:
            logger.info("Starting periodic sync")
            await sync_all_teams()
            
            # 每小时检查一次预警（12 * 5分钟 = 60分钟）
            alert_counter += 1
            if alert_counter >= 12:
                await check_and_send_alerts()
                alert_counter = 0
            
            logger.info("Periodic sync completed")
        except Exception as e:
            logger.exception("Periodic sync error", extra={"error": str(e)})


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    import os
    from app.tasks import start_task_worker, stop_task_worker

    logger.info("Application starting", extra={
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "pid": os.getpid()
    })
    # 启动时初始化数据库
    init_db()

    # 初始化 Redis 令牌桶（用于旧版兑换码限流，默认关闭）
    if settings.REDEEM_REDIS_LIMITER_ENABLED:
        try:
            from app.cache import get_redis
            from app.services.redeem_limiter import RedeemLimiter
            from app.models import RedeemCode

            redis_client = get_redis()
            if redis_client:
                limiter = RedeemLimiter(redis_client)
                db = SessionLocal()
                try:
                    codes = db.query(RedeemCode).filter(RedeemCode.is_active == True).all()
                    limiter.batch_init_codes([
                        (c.code, c.max_uses, c.used_count) for c in codes
                    ])
                    logger.info(f"Initialized {len(codes)} redeem codes in Redis token bucket")
                finally:
                    db.close()
        except Exception as e:
            logger.warning(f"Failed to initialize Redis token bucket: {e}")

    # 启动异步任务 worker
    await start_task_worker()

    # 只在主 worker 中启动定时任务（通过文件锁实现）
    sync_task = None
    lock_file = "/tmp/team_sync.lock"
    lock_acquired = False

    try:
        # 尝试获取锁（非阻塞）
        import fcntl
        lock_fd = open(lock_file, 'w')
        fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock_acquired = True
        lock_fd.write(str(os.getpid()))
        lock_fd.flush()
        logger.info("Acquired sync lock, starting periodic sync task", extra={"pid": os.getpid()})
        sync_task = asyncio.create_task(periodic_sync())
    except (IOError, OSError):
        logger.info("Another worker has sync lock, skipping periodic sync", extra={"pid": os.getpid()})

    yield

    # 关闭时取消任务
    logger.info("Application shutting down")
    await stop_task_worker()
    if sync_task:
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass
    if lock_acquired:
        lock_fd.close()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="ChatGPT Team 集中管理平台 API",
    lifespan=lifespan
)

# 添加限流器
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Telegram Webhook 安全验证中间件（防止伪造攻击）
try:
    from app.middleware.telegram_webhook import TelegramWebhookSecretMiddleware
    app.add_middleware(
        TelegramWebhookSecretMiddleware,
        path=f"{settings.API_PREFIX}/telegram/webhook",
        enable_ip_allowlist=False  # IP 白名单可选，需要反代配置可信
    )
    logger.info("Telegram Webhook security middleware enabled")
except ImportError as e:
    logger.warning(f"Telegram Webhook middleware not available: {e}")


# 请求日志中间件
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """记录请求日志"""
    import time
    start_time = time.time()
    
    response = await call_next(request)
    
    process_time = time.time() - start_time
    
    # 只记录 API 请求，跳过静态资源
    if request.url.path.startswith("/api"):
        logger.info("API request", extra={
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(process_time * 1000, 2),
            "client_ip": request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
        })
    
    return response

# 公开 API（无需认证）
app.include_router(setup.router, prefix=settings.API_PREFIX)
app.include_router(public.router, prefix=settings.API_PREFIX)
app.include_router(shop.router, prefix=f"{settings.API_PREFIX}/public")  # 商店公开 API
app.include_router(linuxdo.router, prefix=settings.API_PREFIX)  # LinuxDo 积分兑换

# 管理员 API（需要认证）
app.include_router(auth.router, prefix=settings.API_PREFIX)
app.include_router(teams.router, prefix=settings.API_PREFIX)
app.include_router(invites.router, prefix=settings.API_PREFIX)
app.include_router(invites.auto_router, prefix=settings.API_PREFIX)  # 自动分配邀请
app.include_router(dashboard.router, prefix=settings.API_PREFIX)
app.include_router(redeem.router, prefix=settings.API_PREFIX)
app.include_router(config.router, prefix=settings.API_PREFIX)
app.include_router(groups.router, prefix=settings.API_PREFIX)
app.include_router(invite_records.router, prefix=settings.API_PREFIX)
app.include_router(admins.router, prefix=settings.API_PREFIX)
app.include_router(distributors.router, prefix=settings.API_PREFIX)
app.include_router(notifications.router, prefix=settings.API_PREFIX)
app.include_router(plans.router, prefix=settings.API_PREFIX)    # 套餐管理
app.include_router(orders.router, prefix=settings.API_PREFIX)   # 订单管理
app.include_router(coupons.router, prefix=settings.API_PREFIX)  # 优惠码管理

# Telegram Bot Webhook（公开，但有权限验证）
app.include_router(telegram_bot.router, prefix=settings.API_PREFIX)

# Prometheus 监控端点
try:
    from prometheus_client import make_asgi_app
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)
    logger.info("Prometheus metrics endpoint enabled at /metrics")
except ImportError:
    logger.warning("prometheus-client not installed, metrics endpoint disabled")


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}

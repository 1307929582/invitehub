# 邮件通知服务
import smtplib
import json
import hashlib
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from sqlalchemy.orm import Session

from app.models import SystemConfig
from app.cache import get_redis
from app.database import SessionLocal
from app.utils.timezone import now_beijing
from app.logger import get_logger

logger = get_logger(__name__)

EMAIL_BASIC_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# 通知类型
class NotificationType:
    TOKEN_EXPIRING = "token_expiring"      # Token 即将过期
    TOKEN_EXPIRED = "token_expired"        # Token 已过期
    SEAT_WARNING = "seat_warning"          # 座位容量预警
    SEAT_FULL = "seat_full"                # 座位已满
    NEW_INVITE = "new_invite"              # 新邀请发送
    INVITE_ACCEPTED = "invite_accepted"    # 邀请已接受
    DAILY_REPORT = "daily_report"          # 每日报告
    USER_QUEUE = "user_queue"              # 用户进入等待队列
    USER_INVITE_READY = "user_invite_ready"  # 邀请已发送提醒（用户）


SMTP_ACCOUNTS_KEY = "smtp_accounts"
SMTP_FROM_NAME_KEY = "smtp_from_name"
SMTP_RR_INDEX_KEY_PREFIX = "smtp_rr_index"
SMTP_USAGE_KEY_PREFIX = "smtp_usage"
SMTP_USAGE_TTL_SECONDS = 172800  # 2 天


def get_config(db: Session, key: str) -> Optional[str]:
    """获取系统配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config else None


def set_config(db: Session, key: str, value: str, description: str = None):
    """设置系统配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config:
        config.value = value
        if description:
            config.description = description
    else:
        config = SystemConfig(key=key, value=value, description=description)
        db.add(config)
    db.commit()


def get_notification_settings(db: Session) -> Dict[str, Any]:
    """获取通知设置"""
    settings_str = get_config(db, "notification_settings")
    if settings_str:
        try:
            return json.loads(settings_str)
        except:
            pass
    
    # 默认设置
    return {
        "enabled": False,
        "token_expiring_days": 7,      # Token 过期提前几天提醒
        "seat_warning_threshold": 80,  # 座位使用率预警阈值（百分比）
        "group_seat_warning_threshold": 5,  # 分组剩余座位预警阈值
        "notify_new_invite": True,     # 是否通知新邀请
        "notify_invite_accepted": False,  # 是否通知邀请接受
        "notify_waiting_queue": True,  # 用户进入等待队列邮件提醒
        "notify_invite_ready": True,   # 邀请已发送邮件提醒
        "daily_report_enabled": False,    # 是否发送每日报告
        "daily_report_hour": 9,           # 每日报告发送时间（小时）
    }


def save_notification_settings(db: Session, settings: Dict[str, Any]):
    """保存通知设置"""
    set_config(db, "notification_settings", json.dumps(settings), "邮件通知设置")


def is_email_configured(db: Session) -> bool:
    """检查邮件是否已配置"""
    pool = _get_smtp_accounts(db)
    if pool:
        return True
    smtp_host = get_config(db, "smtp_host")
    smtp_port = get_config(db, "smtp_port")
    smtp_user = get_config(db, "smtp_user")
    smtp_password = get_config(db, "smtp_password")
    admin_email = get_config(db, "admin_email")
    return all([smtp_host, smtp_port, smtp_user, smtp_password, admin_email])


def _parse_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value)
    except Exception:
        return default


def _parse_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ["true", "1", "yes", "y"]
    return default


def _get_today_key() -> str:
    return now_beijing().strftime("%Y-%m-%d")


def _build_account_id(host: str, port: int, user: str) -> str:
    raw = f"{host}:{port}:{user}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:12]


def _load_smtp_accounts(db: Session) -> List[Dict[str, Any]]:
    raw = get_config(db, SMTP_ACCOUNTS_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        logger.warning("smtp_accounts parse failed, skip")
        return []
    if not isinstance(data, list):
        return []
    return data


def _normalize_smtp_account(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    host = str(raw.get("host") or raw.get("smtp_host") or "").strip()
    port = _parse_int(raw.get("port") or raw.get("smtp_port"))
    user = str(raw.get("user") or raw.get("smtp_user") or "").strip()
    password = str(raw.get("password") or raw.get("smtp_password") or "").strip()
    enabled = _parse_bool(raw.get("enabled", True), True)
    daily_limit = _parse_int(raw.get("daily_limit") or raw.get("limit"))

    if not enabled:
        return None
    if not host or not port or not user or not password:
        return None

    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "daily_limit": daily_limit,
        "account_id": _build_account_id(host, port, user),
    }


def _get_smtp_accounts(db: Session) -> List[Dict[str, Any]]:
    accounts = []
    for raw in _load_smtp_accounts(db):
        if not isinstance(raw, dict):
            continue
        normalized = _normalize_smtp_account(raw)
        if normalized:
            accounts.append(normalized)
    return accounts


def _get_usage_key(account_id: str, date_key: str) -> str:
    return f"{SMTP_USAGE_KEY_PREFIX}:{date_key}:{account_id}"


def _get_rr_key(date_key: str) -> str:
    return f"{SMTP_RR_INDEX_KEY_PREFIX}:{date_key}"


def _get_usage_count(account_id: str, date_key: str) -> int:
    redis = get_redis()
    key = _get_usage_key(account_id, date_key)
    if redis:
        value = redis.get(key)
        return _parse_int(value, 0) or 0
    session = SessionLocal()
    try:
        config = session.query(SystemConfig).filter(SystemConfig.key == key).first()
        return _parse_int(config.value, 0) if config else 0
    finally:
        session.close()


def _increment_usage(account_id: str, date_key: str) -> None:
    redis = get_redis()
    key = _get_usage_key(account_id, date_key)
    if redis:
        redis.incr(key)
        redis.expire(key, SMTP_USAGE_TTL_SECONDS)
        return
    session = SessionLocal()
    try:
        config = session.query(SystemConfig).filter(SystemConfig.key == key).first()
        if config:
            current = _parse_int(config.value, 0) or 0
            config.value = str(current + 1)
        else:
            session.add(SystemConfig(
                key=key,
                value="1",
                description="SMTP daily usage"
            ))
        session.commit()
    finally:
        session.close()


def _next_rr_index(date_key: str, total: int) -> int:
    if total <= 0:
        return 0
    redis = get_redis()
    key = _get_rr_key(date_key)
    if redis:
        idx = redis.incr(key) - 1
        redis.expire(key, SMTP_USAGE_TTL_SECONDS)
        return idx % total
    session = SessionLocal()
    try:
        config = session.query(SystemConfig).filter(SystemConfig.key == key).first()
        current = _parse_int(config.value, 0) if config else 0
        next_val = (current or 0) + 1
        if config:
            config.value = str(next_val)
        else:
            session.add(SystemConfig(
                key=key,
                value=str(next_val),
                description="SMTP RR index"
            ))
        session.commit()
        return (current or 0) % total
    finally:
        session.close()


def _get_from_name(db: Session) -> str:
    return str(get_config(db, SMTP_FROM_NAME_KEY) or "").strip()


def _build_from_header(from_name: str, from_email: str) -> str:
    if not from_name:
        return from_email
    return formataddr((str(Header(from_name, "utf-8")), from_email))


def _is_basic_email(email: str) -> bool:
    return bool(email and EMAIL_BASIC_RE.match(email))


def _classify_send_error(error: str) -> str:
    text = (error or "").lower()
    rate_keywords = [
        "rate", "throttle", "too many", "quota", "exceeded", "try again later",
        "temporarily deferred", "4.7.0", "4.7.1", "4.7.2", "4.5.3", "421", "429", "450", "451", "452"
    ]
    invalid_keywords = [
        "user unknown", "no such user", "mailbox unavailable", "invalid recipient",
        "unknown recipient", "invalid address", "address rejected", "recipient address rejected",
        "recipient not found", "bad recipient", "no mailbox", "5.1.1", "5.1.0", "5.1.2", "5.1.3"
    ]
    reject_keywords = [
        "rejected", "denied", "blocked", "spam", "policy", "blacklist", "not permitted", "refused", "5.7.1", "5.7.0"
    ]

    if any(k in text for k in rate_keywords):
        return "rate_limit"
    if any(k in text for k in invalid_keywords):
        return "invalid"
    if any(k in text for k in reject_keywords):
        return "reject"
    return "other"


def _send_via_account_with_reason(
    account: Dict[str, Any],
    subject: str,
    content: str,
    to_email: str,
    from_name: str
) -> Tuple[bool, str]:
    smtp_host = account["host"]
    smtp_port = account["port"]
    smtp_user = account["user"]
    smtp_password = account["password"]

    msg = MIMEMultipart()
    msg["From"] = _build_from_header(from_name, smtp_user)
    msg["To"] = to_email
    msg["Subject"] = f"[ZenScale AI] {subject}"

    html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="color-scheme" content="light">
            <meta name="supported-color-schemes" content="light">
        </head>
        <body style="margin:0; padding:0; background:#f4f6fb;">
            <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
                {subject}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb; padding:32px 16px 48px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px; width:100%;">
                            <tr>
                                <td style="padding:4px 8px 20px 8px; text-align:left;">
                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="vertical-align:middle; padding-right:12px;">
                                                <img src="https://cloudflare-imgbed-a20.pages.dev/file/1768695485044_image.png" alt="ZenScale AI" width="36" height="36" style="border-radius:9px; display:block;" />
                                            </td>
                                            <td style="vertical-align:middle;">
                                                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; font-size:14px; color:#111827; font-weight:600; letter-spacing:0.2px;">
                                                    ZenScale AI
                                                </div>
                                                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; font-size:12px; color:#6b7280;">
                                                    Updates & Support
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <tr>
                                <td>
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border:1px solid #e5e7eb; border-radius:18px; box-shadow:0 10px 30px rgba(15,23,42,0.06);">
                                        <tr>
                                            <td style="padding:32px 36px;">
                                                <div style="margin:0 0 14px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; font-size:20px; line-height:1.4; color:#111827; font-weight:600;">
                                                    {subject}
                                                </div>
                                                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; font-size:15px; line-height:1.75; color:#334155;">
                                                    {content}
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <tr>
                                <td style="padding:22px 8px 0 8px; text-align:center; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
                                    <div style="color:#94a3b8; font-size:12px; margin-bottom:8px;">
                                        此邮件由系统自动发送，请勿直接回复
                                    </div>
                                    <div style="color:#94a3b8; font-size:12px;">
                                        <a href="https://mmw-team.zenscaleai.com/faq" style="color:#64748b; text-decoration:none;">常见问题</a>
                                        &nbsp;·&nbsp;
                                        <a href="https://mmw-team.zenscaleai.com/legal" style="color:#64748b; text-decoration:none;">服务条款</a>
                                        &nbsp;·&nbsp;
                                        <a href="mailto:contact@zenscaleai.com" style="color:#64748b; text-decoration:none;">联系我们</a>
                                    </div>
                                    <div style="margin-top:12px; color:#cbd5e1; font-size:11px;">
                                        © 2025 ZenScale AI. All rights reserved.
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        """

    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        port = int(smtp_port)
        if port == 465:
            server = smtplib.SMTP_SSL(smtp_host, port, timeout=10)
        else:
            server = smtplib.SMTP(smtp_host, port, timeout=10)
            server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_user, to_email, msg.as_string())
        server.quit()
        return True, ""
    except Exception as e:
        logger.error(f"SMTP send failed ({smtp_user}@{smtp_host}): {e}")
        return False, str(e)


def _send_via_account(
    account: Dict[str, Any],
    subject: str,
    content: str,
    to_email: str,
    from_name: str
) -> bool:
    ok, _ = _send_via_account_with_reason(account, subject, content, to_email, from_name)
    return ok


def send_email_with_reason(
    db: Session,
    subject: str,
    content: str,
    to_email: Optional[str] = None
) -> Tuple[bool, str, str]:
    """发送邮件并返回失败原因类型"""
    admin_email = to_email or get_config(db, "admin_email")
    if not admin_email:
        return False, "invalid", "Email target not configured"
    if not _is_basic_email(admin_email):
        return False, "invalid", "Invalid email format"

    from_name = _get_from_name(db)
    accounts = _get_smtp_accounts(db)
    date_key = _get_today_key()

    if accounts:
        usage_map = {
            account["account_id"]: _get_usage_count(account["account_id"], date_key)
            for account in accounts
        }
        available = []
        for account in accounts:
            limit = account.get("daily_limit")
            used = usage_map.get(account["account_id"], 0)
            if limit is not None and limit > 0 and used >= limit:
                continue
            available.append(account)

        if not available:
            return False, "rate_limit", "SMTP pool quota exceeded"

        start_index = _next_rr_index(date_key, len(available))
        last_error = ""
        for offset in range(len(available)):
            account = available[(start_index + offset) % len(available)]
            ok, err = _send_via_account_with_reason(account, subject, content, admin_email, from_name)
            if ok:
                _increment_usage(account["account_id"], date_key)
                logger.info(f"Email sent: {subject} -> {admin_email} via {account['user']}")
                return True, "ok", ""
            if err:
                last_error = err
        return False, _classify_send_error(last_error), last_error or "SMTP send failed"

    smtp_host = get_config(db, "smtp_host")
    smtp_port = get_config(db, "smtp_port")
    smtp_user = get_config(db, "smtp_user")
    smtp_password = get_config(db, "smtp_password")
    if not all([smtp_host, smtp_port, smtp_user, smtp_password]):
        return False, "other", "Email not configured"

    account = {
        "host": smtp_host,
        "port": _parse_int(smtp_port, 587),
        "user": smtp_user,
        "password": smtp_password,
    }
    ok, err = _send_via_account_with_reason(account, subject, content, admin_email, from_name)
    if ok:
        logger.info(f"Email sent: {subject} -> {admin_email} via {smtp_user}")
        return True, "ok", ""
    return False, _classify_send_error(err), err or "SMTP send failed"


def send_email(
    db: Session,
    subject: str,
    content: str,
    to_email: Optional[str] = None
) -> bool:
    """发送邮件"""
    admin_email = to_email or get_config(db, "admin_email")
    if not admin_email:
        logger.warning("Email target not configured, skipping notification")
        return False

    from_name = _get_from_name(db)
    accounts = _get_smtp_accounts(db)
    date_key = _get_today_key()

    if accounts:
        usage_map = {
            account["account_id"]: _get_usage_count(account["account_id"], date_key)
            for account in accounts
        }
        available = []
        for account in accounts:
            limit = account.get("daily_limit")
            used = usage_map.get(account["account_id"], 0)
            if limit is not None and limit > 0 and used >= limit:
                continue
            available.append(account)

        if not available:
            logger.warning("SMTP pool quota exceeded, no account available")
            return False

        start_index = _next_rr_index(date_key, len(available))
        for offset in range(len(available)):
            account = available[(start_index + offset) % len(available)]
            if _send_via_account(account, subject, content, admin_email, from_name):
                _increment_usage(account["account_id"], date_key)
                logger.info(f"Email sent: {subject} -> {admin_email} via {account['user']}")
                return True
        logger.error("All SMTP accounts failed to send email")
        return False

    smtp_host = get_config(db, "smtp_host")
    smtp_port = get_config(db, "smtp_port")
    smtp_user = get_config(db, "smtp_user")
    smtp_password = get_config(db, "smtp_password")
    if not all([smtp_host, smtp_port, smtp_user, smtp_password]):
        logger.warning("Email not configured, skipping notification")
        return False

    account = {
        "host": smtp_host,
        "port": _parse_int(smtp_port, 587),
        "user": smtp_user,
        "password": smtp_password,
    }
    if _send_via_account(account, subject, content, admin_email, from_name):
        logger.info(f"Email sent: {subject} -> {admin_email} via {smtp_user}")
        return True
    return False


def send_alert_email(db: Session, alerts: List[dict]) -> bool:
    """发送预警邮件"""
    if not alerts:
        return False
    
    # 检查通知是否启用
    settings = get_notification_settings(db)
    if not settings.get("enabled"):
        logger.info("Notifications disabled, skipping alert email")
        return False
    
    content_items = []
    for alert in alerts:
        alert_type = "🔴 严重" if alert.get("type") == "error" else "🟡 警告"
        bg_color = '#fee2e2' if alert.get('type') == 'error' else '#fef3c7'
        content_items.append(f"""
        <div style="padding: 15px; margin: 10px 0; background: {bg_color}; border-radius: 8px;">
            <strong>{alert_type}</strong> - <strong>{alert.get('team', '系统')}</strong><br>
            {alert.get('message', '')}
        </div>
        """)
    
    content = "".join(content_items)
    content += """
    <p style="margin-top: 20px;">
        <a href="#" style="display: inline-block; padding: 10px 20px; background: #1a1a2e; color: white; text-decoration: none; border-radius: 8px;">
            登录管理后台查看
        </a>
    </p>
    """
    
    return send_email(db, f"发现 {len(alerts)} 个预警", content)


def send_token_expiring_notification(db: Session, team_name: str, days_left: int) -> bool:
    """发送 Token 即将过期通知"""
    settings = get_notification_settings(db)
    if not settings.get("enabled"):
        return False
    
    if days_left <= 0:
        subject = f"⚠️ Token 已过期 - {team_name}"
        content = f"""
        <div style="padding: 20px; background: #fee2e2; border-radius: 8px; border-left: 4px solid #ef4444;">
            <h3 style="margin: 0 0 10px 0; color: #dc2626;">Token 已过期</h3>
            <p style="margin: 0;">Team <strong>{team_name}</strong> 的 Token 已过期，请尽快更新以恢复正常功能。</p>
        </div>
        """
    else:
        subject = f"⏰ Token 即将过期 - {team_name}"
        content = f"""
        <div style="padding: 20px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <h3 style="margin: 0 0 10px 0; color: #d97706;">Token 即将过期</h3>
            <p style="margin: 0;">Team <strong>{team_name}</strong> 的 Token 将在 <strong>{days_left} 天</strong>后过期，请及时更新。</p>
        </div>
        """
    
    return send_email(db, subject, content)


def send_seat_warning_notification(db: Session, team_name: str, used: int, total: int) -> bool:
    """发送座位容量预警通知"""
    settings = get_notification_settings(db)
    if not settings.get("enabled"):
        return False
    
    percentage = round(used / total * 100) if total > 0 else 0
    
    if used >= total:
        subject = f"🚨 座位已满 - {team_name}"
        bg_color = "#fee2e2"
        border_color = "#ef4444"
        title_color = "#dc2626"
        title = "座位已满"
        message = f"Team <strong>{team_name}</strong> 的座位已满（{used}/{total}），无法继续邀请新成员。"
    else:
        subject = f"⚠️ 座位容量预警 - {team_name}"
        bg_color = "#fef3c7"
        border_color = "#f59e0b"
        title_color = "#d97706"
        title = "座位容量预警"
        message = f"Team <strong>{team_name}</strong> 的座位使用率已达 <strong>{percentage}%</strong>（{used}/{total}），请注意容量。"
    
    content = f"""
    <div style="padding: 20px; background: {bg_color}; border-radius: 8px; border-left: 4px solid {border_color};">
        <h3 style="margin: 0 0 10px 0; color: {title_color};">{title}</h3>
        <p style="margin: 0;">{message}</p>
        <div style="margin-top: 15px; background: #fff; border-radius: 4px; overflow: hidden;">
            <div style="height: 8px; background: {border_color}; width: {percentage}%;"></div>
        </div>
    </div>
    """
    
    return send_email(db, subject, content)


def send_new_invite_notification(db: Session, team_name: str, emails: List[str], success_count: int, fail_count: int) -> bool:
    """发送新邀请通知"""
    settings = get_notification_settings(db)
    if not settings.get("enabled") or not settings.get("notify_new_invite"):
        return False
    
    subject = f"📨 新邀请已发送 - {team_name}"
    
    email_list = "".join([f"<li>{email}</li>" for email in emails[:10]])
    if len(emails) > 10:
        email_list += f"<li>...还有 {len(emails) - 10} 个</li>"
    
    content = f"""
    <div style="padding: 20px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">
        <h3 style="margin: 0 0 10px 0; color: #059669;">邀请已发送</h3>
        <p style="margin: 0 0 15px 0;">Team <strong>{team_name}</strong> 已发送 {len(emails)} 个邀请</p>
        <div style="display: flex; gap: 20px; margin-bottom: 15px;">
            <div style="padding: 10px 15px; background: #d1fae5; border-radius: 6px;">
                <span style="color: #059669; font-weight: bold;">{success_count}</span> 成功
            </div>
            <div style="padding: 10px 15px; background: #fee2e2; border-radius: 6px;">
                <span style="color: #dc2626; font-weight: bold;">{fail_count}</span> 失败
            </div>
        </div>
        <p style="margin: 0 0 5px 0; font-weight: bold;">邀请邮箱：</p>
        <ul style="margin: 0; padding-left: 20px; color: #666;">
            {email_list}
        </ul>
    </div>
    """
    
    return send_email(db, subject, content)


def _should_notify_user(db: Session, key: str) -> bool:
    settings = get_notification_settings(db)
    return settings.get("enabled") and settings.get(key, False)


def send_waiting_queue_email(
    db: Session,
    to_email: str,
    queue_position: Optional[int],
    eta_message: str,
    is_rebind: bool = False
) -> bool:
    """发送等待队列提醒给用户"""
    if not to_email or not _should_notify_user(db, "notify_waiting_queue"):
        return False

    title = "换车已加入等待队列" if is_rebind else "已加入等待队列"
    position_text = f"当前排队位置：第 {queue_position} 位。" if queue_position else "我们已为你排队处理中。"
    content = f"""
    <div style="padding: 20px; background: #fff7ed; border-radius: 12px; border-left: 4px solid #fb923c;">
        <h3 style="margin: 0 0 12px 0; color: #c2410c;">{title}</h3>
        <p style="margin: 0 0 8px 0;">{position_text}</p>
        <p style="margin: 0 0 8px 0;">{eta_message}</p>
        <p style="margin: 0; color: #6b7280;">系统会在有空位时自动处理，无需重复提交。</p>
    </div>
    """
    return send_email(db, title, content, to_email=to_email)


def send_invite_ready_email(
    db: Session,
    to_email: str,
    team_name: Optional[str],
    is_rebind: bool = False
) -> bool:
    """发送邀请已发送提醒给用户"""
    if not to_email or not _should_notify_user(db, "notify_invite_ready"):
        return False

    title = "换车邀请已发送" if is_rebind else "上车邀请已发送"
    team_text = f"分配 Team：{team_name}" if team_name else "我们已为你发送邀请"
    content = f"""
    <div style="padding: 20px; background: #ecfdf5; border-radius: 12px; border-left: 4px solid #10b981;">
        <h3 style="margin: 0 0 12px 0; color: #059669;">{title}</h3>
        <p style="margin: 0 0 8px 0;">{team_text}</p>
        <p style="margin: 0;">请尽快查收邮箱并接受邀请，以免名额被释放。</p>
    </div>
    """
    return send_email(db, title, content, to_email=to_email)


def send_daily_report(db: Session, stats: Dict[str, Any]) -> bool:
    """发送每日报告"""
    settings = get_notification_settings(db)
    if not settings.get("enabled") or not settings.get("daily_report_enabled"):
        return False
    
    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"📊 每日报告 - {today}"
    
    content = f"""
    <div style="padding: 20px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
        <h3 style="margin: 0 0 20px 0; color: #0284c7;">每日数据报告</h3>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px;">
            <div style="padding: 15px; background: white; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #1a1a2e;">{stats.get('total_teams', 0)}</div>
                <div style="color: #666; font-size: 14px;">Team 总数</div>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #1a1a2e;">{stats.get('total_members', 0)}</div>
                <div style="color: #666; font-size: 14px;">成员总数</div>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #10b981;">{stats.get('invites_today', 0)}</div>
                <div style="color: #666; font-size: 14px;">今日邀请</div>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #f59e0b;">{stats.get('pending_invites', 0)}</div>
                <div style="color: #666; font-size: 14px;">待接受邀请</div>
            </div>
        </div>
        
        <div style="padding: 15px; background: white; border-radius: 8px;">
            <h4 style="margin: 0 0 10px 0; color: #333;">座位使用情况</h4>
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>已使用</span>
                <span>{stats.get('used_seats', 0)} / {stats.get('total_seats', 0)}</span>
            </div>
            <div style="background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                <div style="height: 8px; background: #10b981; width: {stats.get('seat_usage_percent', 0)}%;"></div>
            </div>
        </div>
    </div>
    """
    
    return send_email(db, subject, content)


def send_group_seat_warning(db: Session, group_name: str, used: int, total: int, available: int) -> bool:
    """发送分组座位预警通知"""
    settings = get_notification_settings(db)
    if not settings.get("enabled"):
        return False
    
    percentage = round(used / total * 100) if total > 0 else 0
    
    if available <= 0:
        subject = f"🚨 分组座位已满 - {group_name}"
        bg_color = "#fee2e2"
        border_color = "#ef4444"
        title_color = "#dc2626"
        title = "分组座位已满"
        message = f"分组 <strong>{group_name}</strong> 的座位已全部占用（{used}/{total}），无法继续邀请新成员！"
    elif available <= 3:
        subject = f"⚠️ 分组座位即将满 - {group_name}"
        bg_color = "#fef3c7"
        border_color = "#f59e0b"
        title_color = "#d97706"
        title = "分组座位即将满"
        message = f"分组 <strong>{group_name}</strong> 仅剩 <strong>{available}</strong> 个空位（{used}/{total}），请及时处理。"
    else:
        subject = f"📊 分组座位预警 - {group_name}"
        bg_color = "#fef3c7"
        border_color = "#f59e0b"
        title_color = "#d97706"
        title = "分组座位预警"
        message = f"分组 <strong>{group_name}</strong> 座位使用率已达 <strong>{percentage}%</strong>（{used}/{total}），剩余 {available} 个空位。"
    
    content = f"""
    <div style="padding: 20px; background: {bg_color}; border-radius: 8px; border-left: 4px solid {border_color};">
        <h3 style="margin: 0 0 10px 0; color: {title_color};">{title}</h3>
        <p style="margin: 0;">{message}</p>
        <div style="margin-top: 15px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px;">
                <span>座位使用情况</span>
                <span>{used} / {total} (剩余 {available})</span>
            </div>
            <div style="background: #fff; border-radius: 4px; overflow: hidden;">
                <div style="height: 10px; background: {border_color}; width: {percentage}%;"></div>
            </div>
        </div>
    </div>
    """
    
    return send_email(db, subject, content)


def test_email_connection(db: Session) -> Dict[str, Any]:
    """测试邮件连接"""
    accounts = _get_smtp_accounts(db)
    if accounts:
        account = accounts[0]
        try:
            port = int(account["port"])
            if port == 465:
                server = smtplib.SMTP_SSL(account["host"], port, timeout=10)
            else:
                server = smtplib.SMTP(account["host"], port, timeout=10)
                server.starttls()
            server.login(account["user"], account["password"])
            server.quit()
            return {"success": True, "message": f"SMTP 连接成功（{account['user']}）"}
        except Exception as e:
            return {"success": False, "message": f"连接失败（{account['user']}）: {str(e)}"}

    smtp_host = get_config(db, "smtp_host")
    smtp_port = get_config(db, "smtp_port")
    smtp_user = get_config(db, "smtp_user")
    smtp_password = get_config(db, "smtp_password")

    if not all([smtp_host, smtp_port, smtp_user, smtp_password]):
        return {"success": False, "message": "SMTP 配置不完整"}

    try:
        port = int(smtp_port)
        if port == 465:
            server = smtplib.SMTP_SSL(smtp_host, port, timeout=10)
        else:
            server = smtplib.SMTP(smtp_host, port, timeout=10)
            server.starttls()

        server.login(smtp_user, smtp_password)
        server.quit()

        return {"success": True, "message": "SMTP 连接成功"}
    except Exception as e:
        return {"success": False, "message": f"连接失败: {str(e)}"}


def send_test_email_with_account(
    db: Session,
    account: Dict[str, Any],
    to_email: Optional[str] = None
) -> Dict[str, Any]:
    """使用指定 SMTP 账号发送测试邮件"""
    normalized = _normalize_smtp_account(account)
    if not normalized:
        return {"success": False, "message": "SMTP 账号信息不完整"}

    target_email = to_email or get_config(db, "admin_email")
    if not target_email:
        return {"success": False, "message": "请先配置管理员邮箱"}

    date_key = _get_today_key()
    limit = normalized.get("daily_limit")
    used = _get_usage_count(normalized["account_id"], date_key)
    if limit is not None and limit > 0 and used >= limit:
        return {"success": False, "message": "该账号今日发送量已达上限"}

    subject = "测试邮件 - 指定账号"
    content = """
    <div style="padding: 20px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">
        <h3 style="margin: 0 0 10px 0; color: #059669;">测试邮件</h3>
        <p style="margin: 0;">如果您收到这封邮件，说明该 SMTP 账号配置正确。</p>
    </div>
    """
    from_name = _get_from_name(db)
    if _send_via_account(normalized, subject, content, target_email, from_name):
        _increment_usage(normalized["account_id"], date_key)
        return {"success": True, "message": "测试邮件已发送"}
    return {"success": False, "message": "发送失败，请检查账号或网络"}


def send_verification_code_email(db: Session, to_email: str, code: str) -> bool:
    """发送分销商注册验证码"""
    subject = "注册验证码"
    content = f"""
    <div style="text-align: center;">
        <div style="margin-bottom: 24px;">
            <span style="display: inline-block; padding: 8px 16px; background: #ecfdf5; color: #059669; border-radius: 20px; font-size: 13px; font-weight: 500;">分销商注册</span>
        </div>
        <p style="margin: 0 0 24px 0; color: #333; font-size: 15px;">您正在注册分销商账号，请使用以下验证码完成注册：</p>
        <div style="padding: 24px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; margin: 0 0 24px 0;">
            <span style="font-size: 36px; font-weight: 700; color: #0284c7; letter-spacing: 8px; font-family: 'SF Mono', Monaco, monospace;">{code}</span>
        </div>
        <div style="padding: 16px; background: #fef3c7; border-radius: 8px; text-align: left;">
            <p style="margin: 0 0 8px 0; color: #92400e; font-size: 13px; font-weight: 500;">⏰ 验证码有效期为 10 分钟</p>
            <p style="margin: 0; color: #a16207; font-size: 12px;">请勿将验证码分享给他人，如非本人操作请忽略此邮件。</p>
        </div>
    </div>
    """
    return send_email(db, subject, content, to_email=to_email)

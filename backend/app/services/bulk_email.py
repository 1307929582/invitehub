import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import RedeemCode
from app.utils.timezone import now_beijing, to_beijing_date_str, BEIJING_TZ, UTC_TZ

TARGET_EXPIRING = "expiring"
TARGET_EXPIRED = "expired"
TARGET_ALL = "all"


def _normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def _to_beijing(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC_TZ)
    return dt.astimezone(BEIJING_TZ)


def _days_left(expires_at: Optional[datetime], now_bj: datetime) -> Optional[int]:
    expires_bj = _to_beijing(expires_at)
    if not expires_bj:
        return None
    return (expires_bj.date() - now_bj.date()).days


def _should_include(expires_at: Optional[datetime], now_bj: datetime, now_utc: datetime, target: str, days: Optional[int]) -> bool:
    if target == TARGET_ALL:
        return True
    if not expires_at:
        return False
    if target == TARGET_EXPIRED:
        return expires_at < now_utc
    if target == TARGET_EXPIRING:
        if days is None:
            return False
        expires_bj = _to_beijing(expires_at)
        if not expires_bj:
            return False
        diff_days = (expires_bj.date() - now_bj.date()).days
        return 0 <= diff_days <= days
    return False


def _pick_record(existing: Dict, candidate: Dict, target: str) -> Dict:
    existing_expires = existing.get("expires_at")
    candidate_expires = candidate.get("expires_at")

    if not existing_expires:
        return candidate
    if not candidate_expires:
        return existing

    if target == TARGET_EXPIRED:
        return candidate if candidate_expires > existing_expires else existing
    return candidate if candidate_expires < existing_expires else existing


def collect_recipients(db: Session, target: str, days: Optional[int]) -> List[Dict[str, Optional[str]]]:
    now_bj = now_beijing()
    now_utc = now_bj.astimezone(UTC_TZ).replace(tzinfo=None)
    codes = db.query(RedeemCode).filter(
        RedeemCode.bound_email != None,
        RedeemCode.activated_at != None,
        RedeemCode.is_active == True
    ).all()

    recipients: Dict[str, Dict] = {}

    for code in codes:
        email = _normalize_email(code.bound_email)
        if not email:
            continue
        expires_at = code.user_expires_at
        if not _should_include(expires_at, now_bj, now_utc, target, days):
            continue

        record = {
            "email": email,
            "code": code.code,
            "expires_at": expires_at,
        }

        if email in recipients:
            recipients[email] = _pick_record(recipients[email], record, target)
        else:
            recipients[email] = record

    result: List[Dict[str, Optional[str]]] = []
    for record in recipients.values():
        expires_at = record.get("expires_at")
        result.append({
            "email": record.get("email"),
            "code": record.get("code") or "",
            "expires_at": expires_at,
            "expires_at_str": to_beijing_date_str(expires_at) if expires_at else "",
            "days_left": _days_left(expires_at, now_bj),
        })

    return result


def build_template_context(record: Dict[str, Optional[str]]) -> Dict[str, str]:
    return {
        "email": record.get("email") or "",
        "code": record.get("code") or "",
        "expires_at": record.get("expires_at_str") or "",
        "days_left": str(record.get("days_left") or 0),
    }


def render_template(text: str, context: Dict[str, str]) -> str:
    if not text:
        return ""
    rendered = text
    for key, value in context.items():
        rendered = re.sub(r"{{\s*" + re.escape(key) + r"\s*}}", value or "", rendered)
    return rendered

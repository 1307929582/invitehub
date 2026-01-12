# 临时邮箱 API 集成（用于封禁邮件检测）
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.logger import get_logger
from app.models import SystemConfig

logger = get_logger(__name__)


DEFAULT_API_BASE = "https://mail.xmdbd.com/api"
DEFAULT_DOMAIN = "xmdbd.com"
DEFAULT_PREFIX = "xygpt+"
DEFAULT_SENDER_KEYWORDS = "openai,openai.com,chatgpt"
DEFAULT_BAN_KEYWORDS = (
    "banned,suspended,terminated,disabled,access deactivated,account has been,"
    "violated,restricted,not permitted under our policies,terms and policies"
)

# 硬编码开关与默认值（按需修改）
HARD_CODE_MAIL_SETTINGS = True
HARD_CODE_API_KEY = "mk_In074JlxGKR6s5aDaOaB8rgY_wU1Smva"
HARD_CODE_TEAM_ID_REGEX = r"^xygpt\+(\d+)@xmdbd\.com$"


def _get_config(db: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config and config.value is not None else default


def _set_config(db: Session, key: str, value: str, description: Optional[str] = None) -> None:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config:
        config.value = value
        if description:
            config.description = description
    else:
        config = SystemConfig(key=key, value=value, description=description)
        db.add(config)
    db.commit()


def _parse_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    parts = re.split(r"[,\n\r]+", value)
    return [p.strip().lower() for p in parts if p.strip()]


def get_mail_settings(db: Session) -> Dict[str, Any]:
    if HARD_CODE_MAIL_SETTINGS:
        return {
            "enabled": True,
            "api_base": DEFAULT_API_BASE,
            "api_key": HARD_CODE_API_KEY,
            "domain": DEFAULT_DOMAIN,
            "address_prefix": DEFAULT_PREFIX,
            "team_id_regex": HARD_CODE_TEAM_ID_REGEX,
            "sender_keywords": _parse_list(DEFAULT_SENDER_KEYWORDS),
            "ban_keywords": _parse_list(DEFAULT_BAN_KEYWORDS),
        }

    enabled = _get_config(db, "mail_api_enabled", "false") == "true"
    return {
        "enabled": enabled,
        "api_base": (_get_config(db, "mail_api_base", DEFAULT_API_BASE) or DEFAULT_API_BASE).rstrip("/"),
        "api_key": _get_config(db, "mail_api_key"),
        "domain": _get_config(db, "mail_domain", DEFAULT_DOMAIN) or DEFAULT_DOMAIN,
        "address_prefix": _get_config(db, "mail_address_prefix", DEFAULT_PREFIX) or DEFAULT_PREFIX,
        "team_id_regex": _get_config(db, "mail_team_id_regex"),
        "sender_keywords": _parse_list(_get_config(db, "mail_sender_keywords", DEFAULT_SENDER_KEYWORDS)),
        "ban_keywords": _parse_list(_get_config(db, "mail_ban_keywords", DEFAULT_BAN_KEYWORDS)),
    }


def _request(settings: Dict[str, Any], method: str, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if not settings.get("enabled"):
        return None
    api_key = settings.get("api_key")
    if not api_key:
        logger.warning("mail_api: missing api_key, skip request")
        return None
    url = f"{settings['api_base']}{path}"
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.request(method, url, headers=headers, params=params)
            if resp.status_code >= 400:
                logger.warning(f"mail_api: {method} {url} -> {resp.status_code}: {resp.text[:200]}")
                return None
            return resp.json()
    except Exception as e:
        logger.warning(f"mail_api request failed: {e}")
        return None


def _extract_items(payload: Dict[str, Any], keys: Iterable[str]) -> List[Dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _extract_next_cursor(payload: Dict[str, Any]) -> Optional[str]:
    return payload.get("nextCursor") or payload.get("next_cursor") or payload.get("cursor")


def list_emails(settings: Dict[str, Any], cursor: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    params = {"cursor": cursor} if cursor else None
    data = _request(settings, "GET", "/emails", params=params)
    if not data:
        return [], None
    items = _extract_items(data, ("emails", "data", "items", "results"))
    return items, _extract_next_cursor(data)


def list_messages(settings: Dict[str, Any], email_id: str, cursor: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    params = {"cursor": cursor} if cursor else None
    data = _request(settings, "GET", f"/emails/{email_id}", params=params)
    if not data:
        return [], None
    items = _extract_items(data, ("messages", "data", "items", "results"))
    return items, _extract_next_cursor(data)


def get_message(settings: Dict[str, Any], email_id: str, message_id: str) -> Optional[Dict[str, Any]]:
    return _request(settings, "GET", f"/emails/{email_id}/{message_id}")


def extract_email_fields(item: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    email_id = item.get("id") or item.get("emailId") or item.get("email_id")
    address = item.get("address") or item.get("email") or item.get("emailAddress") or item.get("name")
    return email_id, address


def extract_message_fields(item: Dict[str, Any]) -> Tuple[Optional[str], str, str, str]:
    message_id = item.get("id") or item.get("messageId") or item.get("message_id")
    subject = item.get("subject") or item.get("title") or ""
    sender = item.get("from") or item.get("sender") or item.get("fromAddress") or item.get("from_email") or ""
    snippet = item.get("snippet") or item.get("preview") or item.get("text") or ""
    return message_id, str(subject), str(sender), str(snippet)


def extract_body(message: Dict[str, Any]) -> str:
    for key in ("text", "body", "content", "html"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def extract_team_suffix_from_address(address: str, settings: Dict[str, Any]) -> Optional[str]:
    if not address:
        return None
    addr = address.strip().lower()
    regex = settings.get("team_id_regex")
    if regex:
        try:
            match = re.search(regex, addr)
            if match:
                return match.group(1)
        except Exception:
            logger.warning("mail_api: invalid team_id_regex")

    domain = settings.get("domain")
    prefix = settings.get("address_prefix") or ""
    if domain and not addr.endswith(f"@{domain.lower()}"):
        return None
    local_part = addr.split("@", 1)[0]
    if not local_part.startswith(prefix.lower()):
        return None
    suffix = local_part[len(prefix):]
    return suffix or None


def extract_team_id_from_address(address: str, settings: Dict[str, Any]) -> Optional[int]:
    suffix = extract_team_suffix_from_address(address, settings)
    if suffix and suffix.isdigit():
        return int(suffix)
    return None


def is_ban_message(sender: str, subject: str, body: str, settings: Dict[str, Any]) -> bool:
    text = f"{subject}\n{body}".lower()
    sender_text = (sender or "").lower()

    sender_keywords = settings.get("sender_keywords") or []
    ban_keywords = settings.get("ban_keywords") or []

    if sender_keywords:
        if not any(k in sender_text for k in sender_keywords):
            return False

    if ban_keywords:
        return any(k in text for k in ban_keywords)
    return False


def get_mail_cursor(db: Session, email_id: str) -> Optional[str]:
    return _get_config(db, f"mail_cursor:{email_id}")


def set_mail_cursor(db: Session, email_id: str, cursor: str) -> None:
    _set_config(db, f"mail_cursor:{email_id}", cursor, "临时邮箱消息游标")

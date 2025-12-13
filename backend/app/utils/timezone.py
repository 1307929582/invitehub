# UTC+8 时区工具模块
# 用于统计时间边界按北京时间计算

from datetime import datetime, timedelta, timezone

# 北京时区 (UTC+8)
BEIJING_TZ = timezone(timedelta(hours=8))
UTC_TZ = timezone.utc


def now_beijing() -> datetime:
    """获取当前北京时间（带时区信息）"""
    return datetime.now(BEIJING_TZ)


def now_utc() -> datetime:
    """获取当前 UTC 时间（不带时区信息，用于数据库存储）"""
    return datetime.utcnow()


def get_today_range_utc8() -> tuple:
    """
    获取 UTC+8 今日的时间范围（返回 naive UTC 时间用于数据库查询）

    北京时间今日 00:00:00 对应 UTC 前一天 16:00:00

    Returns:
        (start_utc, end_utc): 元组，用于 filter(column >= start, column < end)
    """
    now = datetime.now(BEIJING_TZ)
    # 北京时间今日零点
    start_beijing = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # 转换为 UTC（去掉时区信息，因为数据库存储的是 naive datetime）
    start_utc = start_beijing.astimezone(UTC_TZ).replace(tzinfo=None)
    end_utc = (start_beijing + timedelta(days=1)).astimezone(UTC_TZ).replace(tzinfo=None)
    return start_utc, end_utc


def get_week_range_utc8() -> tuple:
    """
    获取 UTC+8 本周的时间范围（周一为起点）

    Returns:
        (start_utc, end_utc): 元组
    """
    now = datetime.now(BEIJING_TZ)
    # 本周一零点
    days_since_monday = now.weekday()
    start_beijing = (now - timedelta(days=days_since_monday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    start_utc = start_beijing.astimezone(UTC_TZ).replace(tzinfo=None)
    end_utc = (start_beijing + timedelta(days=7)).astimezone(UTC_TZ).replace(tzinfo=None)
    return start_utc, end_utc


def get_month_range_utc8() -> tuple:
    """
    获取 UTC+8 本月的时间范围

    Returns:
        (start_utc, end_utc): 元组
    """
    now = datetime.now(BEIJING_TZ)
    # 本月一日零点
    start_beijing = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # 下月一日
    if now.month == 12:
        end_beijing = start_beijing.replace(year=now.year + 1, month=1)
    else:
        end_beijing = start_beijing.replace(month=now.month + 1)

    start_utc = start_beijing.astimezone(UTC_TZ).replace(tzinfo=None)
    end_utc = end_beijing.astimezone(UTC_TZ).replace(tzinfo=None)
    return start_utc, end_utc


def get_recent_days_ranges_utc8(days: int = 7) -> list:
    """
    获取最近 N 天的日期范围列表（UTC+8）

    Args:
        days: 天数，默认7天

    Returns:
        list of (date_str, start_utc, end_utc) 元组，从最早到最近排序
    """
    result = []
    now = datetime.now(BEIJING_TZ)

    for i in range(days - 1, -1, -1):
        day_beijing = (now - timedelta(days=i)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        date_str = day_beijing.strftime("%Y-%m-%d")
        start_utc = day_beijing.astimezone(UTC_TZ).replace(tzinfo=None)
        end_utc = (day_beijing + timedelta(days=1)).astimezone(UTC_TZ).replace(tzinfo=None)
        result.append((date_str, start_utc, end_utc))

    return result


def to_beijing_str(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """
    将 UTC datetime 转换为北京时间字符串

    Args:
        dt: UTC datetime（naive 或 aware）
        fmt: 输出格式

    Returns:
        北京时间格式化字符串
    """
    if dt is None:
        return ""

    # 如果是 naive datetime，假定为 UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC_TZ)

    beijing_dt = dt.astimezone(BEIJING_TZ)
    return beijing_dt.strftime(fmt)


def to_beijing_date_str(dt: datetime) -> str:
    """将 UTC datetime 转换为北京时间日期字符串 (YYYY-MM-DD)"""
    return to_beijing_str(dt, "%Y-%m-%d")

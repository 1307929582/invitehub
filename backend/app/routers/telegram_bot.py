# Telegram Bot 命令处理
from fastapi import APIRouter, Request
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Team, TeamMember, RedeemCode, SystemConfig, InviteRecord
from app.services.telegram import send_telegram_message
from datetime import datetime, timedelta
import logging

router = APIRouter(prefix="/telegram", tags=["telegram-bot"])
logger = logging.getLogger(__name__)


def get_config(db: Session, key: str) -> str:
    """获取系统配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config and config.value else ""


def is_authorized(chat_id: str, db: Session) -> bool:
    """检查是否有权限操作"""
    allowed_chat_id = get_config(db, "telegram_chat_id")
    return str(chat_id) == str(allowed_chat_id)


def make_circle_bar(percent: int, length: int = 10) -> str:
    """生成圆形进度条"""
    filled = round(percent / (100 / length))
    filled = min(filled, length)
    return "●" * filled + "○" * (length - filled)


async def handle_command(text: str, chat_id: str, db: Session, bot_token: str):
    """处理 Bot 命令"""
    text = text.strip()
    
    # /start - 欢迎信息
    if text == "/start" or text == "/help":
        msg = """
<b>🤖 ChatGPT Team 管理助手</b>

<i>━━━━━ 命令列表 ━━━━━</i>

📊  /status  <i>系统概览</i>
💺  /seats   <i>座位统计</i>
👥  /teams   <i>Team 列表</i>
⚠️  /alerts  <i>查看预警</i>
🔄  /sync    <i>同步成员</i>
📈  /stats   <i>今日统计</i>

<i>━━━━━ 管理命令 ━━━━━</i>

🔍  /search  <i>搜索用户</i>
📋  /pending <i>待处理邀请</i>
🕐  /recent  <i>最近加入</i>
➕  /newteam <i>创建 Team</i>
"""
        await send_telegram_message(bot_token, chat_id, msg.strip())
        return
    
    # /status - 系统状态
    if text == "/status":
        teams = db.query(Team).filter(Team.is_active == True).all()
        total_seats = sum(t.max_seats for t in teams)
        used_seats = sum(
            db.query(TeamMember).filter(TeamMember.team_id == t.id).count()
            for t in teams
        )
        active_codes = db.query(RedeemCode).filter(RedeemCode.is_active == True).count()
        
        usage_percent = int((used_seats / total_seats * 100)) if total_seats > 0 else 0
        
        # 根据使用率选择颜色
        if usage_percent >= 90:
            status_icon = "🔴"
        elif usage_percent >= 70:
            status_icon = "🟡"
        else:
            status_icon = "🟢"
        
        msg = f"""
<b>📊 系统概览</b>

<i>━━━━━━━━━━━━━━━━━━━━</i>

{status_icon} <b>运行状态</b>: 正常

<b>💺 座位使用</b>
    {make_circle_bar(usage_percent)}
    <code>{used_seats}</code> / <code>{total_seats}</code>  ·  <code>{usage_percent}%</code>

<b>📋 统计数据</b>
   • Team 数量: <code>{len(teams)}</code>
   • 有效兑换码: <code>{active_codes}</code>
"""
        await send_telegram_message(bot_token, chat_id, msg.strip())
        return
    
    # /seats - 座位统计
    if text == "/seats":
        teams = db.query(Team).filter(Team.is_active == True).all()
        
        msg = "<b>💺 座位统计</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        
        total_used = 0
        total_max = 0
        
        for team in teams:
            member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            total_used += member_count
            total_max += team.max_seats
            
            percent = int((member_count / team.max_seats) * 100) if team.max_seats > 0 else 0
            
            # 状态图标
            if member_count >= team.max_seats:
                status = "🔴"
                status_text = "已满"
            elif member_count >= team.max_seats - 2:
                status = "🟡"
                status_text = "即将满"
            else:
                status = "🟢"
                status_text = "可用"
            
            # 进度条 - 用圆形更好看
            filled = round(percent / 10)
            bar = "●" * filled + "○" * (10 - filled)
            
            msg += f"{status} <b>{team.name}</b>\n"
            msg += f"    {bar} <code>{percent}%</code>\n"
            msg += f"    <i>{member_count}/{team.max_seats} · {status_text}</i>\n\n"
        
        # 总计
        total_percent = int((total_used / total_max * 100)) if total_max > 0 else 0
        msg += "<i>━━━━━━━━━━━━━━━━━━━━</i>\n"
        msg += f"<b>📈 总计</b>: {total_used}/{total_max} (<code>{total_percent}%</code>)"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return

    # /teams - Team 列表
    if text == "/teams":
        teams = db.query(Team).filter(Team.is_active == True).all()
        
        msg = "<b>👥 Team 列表</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        
        for i, team in enumerate(teams, 1):
            member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            available = team.max_seats - member_count
            
            if available <= 0:
                badge = "🔴 <code>已满</code>"
            elif available <= 2:
                badge = f"🟡 <code>剩{available}位</code>"
            else:
                badge = f"🟢 <code>剩{available}位</code>"
            
            msg += f"<b>{i}.</b> {team.name}\n"
            msg += f"    💺 <code>{member_count}/{team.max_seats}</code>  {badge}\n\n"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /alerts - 查看预警
    if text == "/alerts":
        teams = db.query(Team).filter(Team.is_active == True).all()
        alerts = []
        
        for team in teams:
            member_count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            
            if member_count >= team.max_seats:
                alerts.append(f"🔴 <b>{team.name}</b>\n    <i>座位已满，无法邀请新成员</i>")
            elif member_count >= team.max_seats - 2:
                left = team.max_seats - member_count
                alerts.append(f"🟡 <b>{team.name}</b>\n    <i>仅剩 {left} 个座位</i>")
            
            unauthorized = db.query(TeamMember).filter(
                TeamMember.team_id == team.id,
                TeamMember.is_unauthorized == True
            ).count()
            if unauthorized > 0:
                alerts.append(f"🚨 <b>{team.name}</b>\n    <i>发现 {unauthorized} 个未授权成员!</i>")
        
        msg = "<b>⚠️ 系统预警</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        
        if alerts:
            msg += "\n\n".join(alerts)
        else:
            msg += "✅ <b>一切正常</b>\n\n<i>没有需要关注的问题</i>"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /stats - 今日统计
    if text == "/stats":
        today = datetime.utcnow().date()
        today_start = datetime.combine(today, datetime.min.time())
        
        today_invites = db.query(InviteRecord).filter(
            InviteRecord.created_at >= today_start
        ).count()
        
        today_joined = db.query(InviteRecord).filter(
            InviteRecord.created_at >= today_start,
            InviteRecord.status == "joined"
        ).count()
        
        today_codes = db.query(RedeemCode).filter(
            RedeemCode.used_at >= today_start
        ).count()
        
        week_start = today_start - timedelta(days=today.weekday())
        week_invites = db.query(InviteRecord).filter(
            InviteRecord.created_at >= week_start
        ).count()
        week_joined = db.query(InviteRecord).filter(
            InviteRecord.created_at >= week_start,
            InviteRecord.status == "joined"
        ).count()
        
        msg = f"""
<b>📈 数据统计</b>

<i>━━━━━━━━━━━━━━━━━━━━</i>

<b>📅 今日 ({today.strftime('%m/%d')})</b>
<code>┌──────────────────┐</code>
<code>│ 📨 邀请    {today_invites:>5} │</code>
<code>│ ✅ 加入    {today_joined:>5} │</code>
<code>│ 🎫 兑换码  {today_codes:>5} │</code>
<code>└──────────────────┘</code>

<b>📆 本周</b>
<code>┌──────────────────┐</code>
<code>│ 📨 邀请    {week_invites:>5} │</code>
<code>│ ✅ 加入    {week_joined:>5} │</code>
<code>└──────────────────┘</code>
"""
        await send_telegram_message(bot_token, chat_id, msg.strip())
        return
    
    # /sync - 同步所有成员
    if text == "/sync":
        await send_telegram_message(bot_token, chat_id, "🔄 <b>同步中...</b>\n\n<i>正在同步所有 Team 成员，请稍候</i>")
        
        from app.services.chatgpt_api import ChatGPTAPI
        
        teams = db.query(Team).filter(Team.is_active == True).all()
        results = []
        
        for team in teams:
            try:
                api = ChatGPTAPI(team.session_token, team.device_id or "")
                result = await api.get_members(team.account_id)
                members_data = result.get("items", result.get("users", []))
                
                db.query(TeamMember).filter(TeamMember.team_id == team.id).delete()
                
                for m in members_data:
                    email = m.get("email", "").lower().strip()
                    if email:
                        member = TeamMember(
                            team_id=team.id,
                            email=email,
                            name=m.get("name", ""),
                            role=m.get("role", "member"),
                            chatgpt_user_id=m.get("id", ""),
                            synced_at=datetime.utcnow()
                        )
                        db.add(member)
                
                db.commit()
                results.append(f"✅ <b>{team.name}</b>: <code>{len(members_data)}</code> 成员")
            except Exception as e:
                logger.error(f"Sync {team.name} failed: {e}")
                results.append(f"❌ <b>{team.name}</b>: <i>同步失败</i>")
        
        msg = "<b>🔄 同步完成</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        msg += "\n".join(results)
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /search <邮箱> - 搜索用户
    if text.startswith("/search"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            msg = "❓ <b>用法</b>: <code>/search 邮箱</code>\n\n<i>例如: /search test@example.com</i>"
            await send_telegram_message(bot_token, chat_id, msg)
            return
        
        keyword = parts[1].strip().lower()
        
        # 搜索成员
        members = db.query(TeamMember).filter(
            TeamMember.email.ilike(f"%{keyword}%")
        ).all()
        
        # 搜索邀请记录
        invites = db.query(InviteRecord).filter(
            InviteRecord.email.ilike(f"%{keyword}%")
        ).order_by(InviteRecord.created_at.desc()).limit(5).all()
        
        msg = f"<b>🔍 搜索结果</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        msg += f"关键词: <code>{keyword}</code>\n\n"
        
        if members:
            msg += "<b>👥 已加入的 Team</b>\n"
            for m in members:
                team = db.query(Team).filter(Team.id == m.team_id).first()
                team_name = team.name if team else "未知"
                status = "🚨 未授权" if m.is_unauthorized else "✅"
                msg += f"  {status} <code>{m.email}</code>\n"
                msg += f"      → {team_name}\n"
        else:
            msg += "<i>未找到已加入的成员</i>\n"
        
        if invites:
            msg += "\n<b>📨 邀请记录</b>\n"
            for inv in invites:
                team = db.query(Team).filter(Team.id == inv.team_id).first()
                team_name = team.name if team else "未知"
                status_map = {"pending": "⏳", "joined": "✅", "cancelled": "❌", "expired": "⌛"}
                status = status_map.get(inv.status, "❓")
                msg += f"  {status} <code>{inv.email}</code>\n"
                msg += f"      → {team_name} · {inv.status}\n"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /pending - 待处理邀请
    if text == "/pending":
        pending = db.query(InviteRecord).filter(
            InviteRecord.status == "pending"
        ).order_by(InviteRecord.created_at.desc()).limit(20).all()
        
        msg = "<b>📋 待处理邀请</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        
        if pending:
            for inv in pending:
                team = db.query(Team).filter(Team.id == inv.team_id).first()
                team_name = team.name if team else "未知"
                time_ago = datetime.utcnow() - inv.created_at
                if time_ago.days > 0:
                    time_str = f"{time_ago.days}天前"
                elif time_ago.seconds > 3600:
                    time_str = f"{time_ago.seconds // 3600}小时前"
                else:
                    time_str = f"{time_ago.seconds // 60}分钟前"
                
                msg += f"⏳ <code>{inv.email}</code>\n"
                msg += f"    → {team_name} · <i>{time_str}</i>\n\n"
            
            msg += f"<i>共 {len(pending)} 条待处理</i>"
        else:
            msg += "✅ <b>没有待处理的邀请</b>"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /recent - 最近加入
    if text == "/recent":
        recent = db.query(InviteRecord).filter(
            InviteRecord.status == "joined"
        ).order_by(InviteRecord.updated_at.desc()).limit(10).all()
        
        msg = "<b>🕐 最近加入</b>\n\n<i>━━━━━━━━━━━━━━━━━━━━</i>\n\n"
        
        if recent:
            for inv in recent:
                team = db.query(Team).filter(Team.id == inv.team_id).first()
                team_name = team.name if team else "未知"
                join_time = inv.updated_at.strftime("%m/%d %H:%M") if inv.updated_at else "未知"
                
                msg += f"✅ <code>{inv.email}</code>\n"
                msg += f"    → {team_name} · <i>{join_time}</i>\n\n"
        else:
            msg += "<i>暂无记录</i>"
        
        await send_telegram_message(bot_token, chat_id, msg)
        return
    
    # /newteam <名称> <座位数> <account_id> <session_token> - 创建 Team
    if text.startswith("/newteam"):
        parts = text.split()
        if len(parts) < 5:
            msg = """
<b>➕ 创建 Team</b>

<i>━━━━━━━━━━━━━━━━━━━━</i>

<b>用法</b>:
<code>/newteam 名称 座位数 account_id session_token</code>

<b>示例</b>:
<code>/newteam MyTeam 25 acc_xxx sess_xxx</code>

<b>参数说明</b>:
  • 名称: Team 显示名称
  • 座位数: 最大成员数
  • account_id: ChatGPT 账户 ID
  • session_token: 登录凭证
"""
            await send_telegram_message(bot_token, chat_id, msg.strip())
            return
        
        name = parts[1]
        try:
            max_seats = int(parts[2])
        except:
            msg = "❌ <b>错误</b>: 座位数必须是数字"
            await send_telegram_message(bot_token, chat_id, msg)
            return
        
        account_id = parts[3]
        session_token = " ".join(parts[4:])  # token 可能包含空格
        
        # 检查名称是否重复
        existing = db.query(Team).filter(Team.name == name).first()
        if existing:
            msg = f"❌ <b>错误</b>: Team <code>{name}</code> 已存在"
            await send_telegram_message(bot_token, chat_id, msg)
            return
        
        # 创建 Team
        new_team = Team(
            name=name,
            max_seats=max_seats,
            account_id=account_id,
            session_token=session_token,
            is_active=True
        )
        db.add(new_team)
        db.commit()
        
        msg = f"""
<b>✅ Team 创建成功</b>

<i>━━━━━━━━━━━━━━━━━━━━</i>

<b>名称</b>: {name}
<b>座位数</b>: {max_seats}
<b>Account ID</b>: <code>{account_id[:20]}...</code>

<i>💡 建议执行 /sync 同步成员数据</i>
"""
        await send_telegram_message(bot_token, chat_id, msg.strip())
        return
    
    # 未知命令
    msg = "❓ <b>未知命令</b>\n\n<i>发送 /help 查看可用命令</i>"
    await send_telegram_message(bot_token, chat_id, msg)


@router.post("/webhook")
async def telegram_webhook(request: Request):
    """Telegram Webhook 接收消息"""
    try:
        data = await request.json()
        logger.info(f"Telegram webhook: {data}")
        
        message = data.get("message", {})
        text = message.get("text", "")
        chat_id = str(message.get("chat", {}).get("id", ""))
        
        if not text or not chat_id:
            return {"ok": True}
        
        db = SessionLocal()
        try:
            if not is_authorized(chat_id, db):
                bot_token = get_config(db, "telegram_bot_token")
                if bot_token:
                    await send_telegram_message(bot_token, chat_id, "⛔ <b>无权限</b>\n\n<i>此 Bot 仅限授权用户使用</i>")
                return {"ok": True}
            
            bot_token = get_config(db, "telegram_bot_token")
            if bot_token and text.startswith("/"):
                await handle_command(text, chat_id, db, bot_token)
        finally:
            db.close()
        
        return {"ok": True}
    except Exception as e:
        logger.error(f"Telegram webhook error: {e}")
        return {"ok": True}

# Telegram Bot 命令处理
from fastapi import APIRouter, Request
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Team, TeamMember, RedeemCode, SystemConfig, InviteRecord, InviteStatus
from app.services.telegram import send_telegram_message
from datetime import datetime, timedelta
import logging
import secrets
import string

router = APIRouter(prefix="/telegram", tags=["telegram-bot"])
logger = logging.getLogger(__name__)
user_sessions = {}


def get_config(db: Session, key: str) -> str:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return config.value if config and config.value else ""


def is_admin_user(user_id: str, db: Session) -> bool:
    admin_users = get_config(db, "telegram_admin_users")
    if not admin_users:
        return False
    return str(user_id) in [u.strip() for u in admin_users.split(",") if u.strip()]


def is_authorized_chat(chat_id: str, user_id: str, db: Session) -> bool:
    # 管理员用户在任何地方都有权限
    if is_admin_user(user_id, db):
        return True
    notify_chat = get_config(db, "telegram_chat_id")
    if notify_chat and str(chat_id) == str(notify_chat):
        return True
    admin_chat = get_config(db, "telegram_admin_chat_id")
    if admin_chat and str(chat_id) == str(admin_chat):
        return True
    return False


def make_circle_bar(percent: int, length: int = 10) -> str:
    filled = min(round(percent / (100 / length)), length)
    return "●" * filled + "○" * (length - filled)


def get_session(user_id: str) -> dict:
    return user_sessions.get(user_id, {})


def set_session(user_id: str, data: dict):
    user_sessions[user_id] = data


def clear_session(user_id: str):
    user_sessions.pop(user_id, None)



async def handle_interactive(text: str, user_id: str, chat_id: str, db: Session, bot_token: str) -> bool:
    session = get_session(user_id)
    if not session:
        return False
    if text.lower() in ["/cancel", "取消"]:
        clear_session(user_id)
        await send_telegram_message(bot_token, chat_id, "❌ <b>已取消</b>")
        return True
    action = session.get("action")
    step = session.get("step", 0)
    if action == "newteam":
        if step == 1:
            name = text.strip()
            if db.query(Team).filter(Team.name == name).first():
                await send_telegram_message(bot_token, chat_id, f"❌ Team <code>{name}</code> 已存在")
                return True
            session["name"] = name
            session["step"] = 2
            set_session(user_id, session)
            await send_telegram_message(bot_token, chat_id, f"✅ 名称: <code>{name}</code>\n\n<b>第 2 步</b>: 输入座位数：")
            return True
        elif step == 2:
            try:
                max_seats = int(text.strip())
                if max_seats <= 0 or max_seats > 1000:
                    raise ValueError()
            except:
                await send_telegram_message(bot_token, chat_id, "❌ 请输入 1-1000 的数字")
                return True
            session["max_seats"] = max_seats
            session["step"] = 3
            set_session(user_id, session)
            await send_telegram_message(bot_token, chat_id, f"✅ 座位: <code>{max_seats}</code>\n\n<b>第 3 步</b>: 输入 Account ID：")
            return True
        elif step == 3:
            session["account_id"] = text.strip()
            session["step"] = 4
            set_session(user_id, session)
            await send_telegram_message(bot_token, chat_id, "✅ Account ID 已记录\n\n<b>第 4 步</b>: 输入 Session Token：")
            return True
        elif step == 4:
            new_team = Team(name=session["name"], max_seats=session["max_seats"], account_id=session["account_id"], session_token=text.strip(), is_active=True)
            db.add(new_team)
            db.commit()
            clear_session(user_id)
            await send_telegram_message(bot_token, chat_id, f"✅ <b>Team 创建成功</b>\n\n名称: {session['name']}\n座位: {session['max_seats']}\n\n<i>建议 /sync 同步</i>")
            return True
    return False



async def handle_command(text: str, user_id: str, chat_id: str, db: Session, bot_token: str, is_admin: bool):
    text = text.strip()

    # 正确解析命令：只去除 @botname 后缀，不破坏参数中的 @（邮箱）
    parts = text.split(maxsplit=1)
    cmd = parts[0] if parts else ""
    args = parts[1] if len(parts) > 1 else ""

    # 只处理命令中的 @bot_username，不影响参数
    if cmd.startswith("/") and "@" in cmd:
        cmd = cmd.split("@", 1)[0]

    # 管理员专属命令（敏感操作）
    ADMIN_ONLY_COMMANDS = {"/invite", "/remove", "/codes", "/sync", "/newteam"}
    if cmd in ADMIN_ONLY_COMMANDS and not is_admin:
        await send_telegram_message(bot_token, chat_id, "⛔ <b>权限不足</b>\n\n此命令仅管理员可用")
        return

    # 重新组合为完整命令（供后续逻辑使用）
    text = cmd + (f" {args}" if args else "")

    if text == "/start" or text == "/help":
        msg = "<b>🤖 ChatGPT Team 管理助手</b>\n\n<i>━━━━━ 查询命令 ━━━━━</i>\n\n"
        msg += "📊 /status - 系统概览\n💺 /seats - 座位统计\n👥 /teams - Team 列表\n"
        msg += "⚠️ /alerts - 查看预警\n📈 /stats - 今日统计\n🔍 /search - 搜索用户\n"
        msg += "📋 /pending - 待处理邀请\n🕐 /recent - 最近加入\n🚨 /unauthorized - 未授权成员\n"
        if is_admin:
            msg += "\n<i>━━━━━ 管理命令 ━━━━━</i>\n\n"
            msg += "📨 /invite - 邀请用户 (自动分配)\n"
            msg += "👋 /remove - 移除成员\n"
            msg += "🎫 /codes - 生成兑换码\n"
            msg += "🔄 /sync - 同步成员\n➕ /newteam - 创建 Team\n❌ /cancel - 取消操作\n"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/cancel":
        clear_session(user_id)
        await send_telegram_message(bot_token, chat_id, "✅ 已取消当前操作")
        return

    if text == "/status":
        from app.services.seat_calculator import get_all_teams_with_seats

        teams_with_seats = get_all_teams_with_seats(db, only_active=True)
        total_seats = sum(t.max_seats for t in teams_with_seats)
        used_seats = sum(t.confirmed_members for t in teams_with_seats)
        active_codes = db.query(RedeemCode).filter(RedeemCode.is_active == True).count()

        pct = int((used_seats / total_seats * 100)) if total_seats > 0 else 0
        icon = "🔴" if pct >= 90 else ("🟡" if pct >= 70 else "🟢")
        msg = f"<b>📊 系统概览</b>\n\n{icon} 运行正常\n\n<b>💺 座位</b>\n{make_circle_bar(pct)}\n{used_seats}/{total_seats} ({pct}%)\n\nTeam: {len(teams_with_seats)} | 兑换码: {active_codes}"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/seats":
        from app.services.seat_calculator import get_all_teams_with_seats

        teams_with_seats = get_all_teams_with_seats(db, only_active=True)
        msg = "<b>💺 座位统计</b>\n\n"
        total_used, total_max = 0, 0

        for t in teams_with_seats:
            total_used += t.confirmed_members
            total_max += t.max_seats
            pct = int((t.confirmed_members / t.max_seats) * 100) if t.max_seats > 0 else 0
            icon = "🔴" if t.confirmed_members >= t.max_seats else ("🟡" if t.confirmed_members >= t.max_seats - 2 else "🟢")
            bar = "●" * round(pct / 10) + "○" * (10 - round(pct / 10))
            msg += f"{icon} <b>{t.team_name}</b>\n{bar} {t.confirmed_members}/{t.max_seats}\n\n"
        total_pct = int((total_used / total_max * 100)) if total_max > 0 else 0
        msg += f"<b>总计</b>: {total_used}/{total_max} ({total_pct}%)"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/teams":
        from app.services.seat_calculator import get_all_teams_with_seats

        teams_with_seats = get_all_teams_with_seats(db, only_active=True)
        msg = "<b>👥 Team 列表</b>\n\n"

        for i, t in enumerate(teams_with_seats, 1):
            avail = t.available_seats
            badge = "🔴已满" if avail <= 0 else (f"🟡剩{avail}" if avail <= 2 else f"🟢剩{avail}")
            msg += f"{i}. {t.team_name} ({t.confirmed_members}/{t.max_seats}) {badge}\n"

        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/alerts":
        teams = db.query(Team).filter(Team.is_active == True).all()
        alerts = []
        for team in teams:
            count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
            if count >= team.max_seats:
                alerts.append(f"🔴 {team.name}: 已满")
            elif count >= team.max_seats - 2:
                alerts.append(f"🟡 {team.name}: 剩{team.max_seats - count}位")
            unauth = db.query(TeamMember).filter(TeamMember.team_id == team.id, TeamMember.is_unauthorized == True).count()
            if unauth > 0:
                alerts.append(f"🚨 {team.name}: {unauth}个未授权")
        msg = "<b>⚠️ 预警</b>\n\n" + ("\n".join(alerts) if alerts else "✅ 一切正常")
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/stats":
        from app.models import InviteStatus
        today = datetime.utcnow().date()
        today_start = datetime.combine(today, datetime.min.time())
        ti = db.query(InviteRecord).filter(InviteRecord.created_at >= today_start).count()
        tj = db.query(InviteRecord).filter(InviteRecord.created_at >= today_start, InviteRecord.status == InviteStatus.SUCCESS).count()
        tc = db.query(RedeemCode).filter(RedeemCode.used_count > 0, RedeemCode.created_at >= today_start).count()
        week_start = today_start - timedelta(days=today.weekday())
        wi = db.query(InviteRecord).filter(InviteRecord.created_at >= week_start).count()
        wj = db.query(InviteRecord).filter(InviteRecord.created_at >= week_start, InviteRecord.status == InviteStatus.SUCCESS).count()
        msg = f"<b>📈 统计</b>\n\n<b>今日</b>: 邀请{ti} 成功{tj} 兑换码{tc}\n<b>本周</b>: 邀请{wi} 成功{wj}"
        await send_telegram_message(bot_token, chat_id, msg)
        return


    if text.startswith("/search"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            await send_telegram_message(bot_token, chat_id, "用法: /search 邮箱")
            return
        kw = parts[1].strip().lower()
        members = db.query(TeamMember).filter(TeamMember.email.ilike(f"%{kw}%")).all()
        msg = f"<b>🔍 搜索: {kw}</b>\n\n"
        if members:
            for m in members:
                team = db.query(Team).filter(Team.id == m.team_id).first()
                msg += f"{'🚨' if m.is_unauthorized else '✅'} {m.email} → {team.name if team else '?'}\n"
        else:
            msg += "未找到"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/pending":
        pending = db.query(InviteRecord).filter(InviteRecord.status == "pending").order_by(InviteRecord.created_at.desc()).limit(15).all()
        msg = "<b>📋 待处理</b>\n\n"
        if pending:
            for inv in pending:
                team = db.query(Team).filter(Team.id == inv.team_id).first()
                msg += f"⏳ {inv.email} → {team.name if team else '?'}\n"
        else:
            msg += "无"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/recent":
        recent = db.query(InviteRecord).filter(InviteRecord.status == "joined").order_by(InviteRecord.updated_at.desc()).limit(10).all()
        msg = "<b>🕐 最近加入</b>\n\n"
        if recent:
            for inv in recent:
                team = db.query(Team).filter(Team.id == inv.team_id).first()
                msg += f"✅ {inv.email} → {team.name if team else '?'}\n"
        else:
            msg += "无"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/unauthorized":
        # 查找所有未授权成员
        unauthorized_members = db.query(TeamMember).filter(
            TeamMember.is_unauthorized == True
        ).all()

        if not unauthorized_members:
            await send_telegram_message(bot_token, chat_id, "✅ <b>无未授权成员</b>\n\n所有成员均已授权")
            return

        # 按 Team 分组
        team_groups = {}
        for m in unauthorized_members:
            if m.team_id not in team_groups:
                team = db.query(Team).filter(Team.id == m.team_id).first()
                team_groups[m.team_id] = {
                    "name": team.name if team else f"Team {m.team_id}",
                    "members": []
                }
            team_groups[m.team_id]["members"].append(m.email)

        msg = f"🚨 <b>未授权成员 ({len(unauthorized_members)})</b>\n\n"
        for team_id, group in team_groups.items():
            msg += f"<b>{group['name']}</b> ({len(group['members'])}人):\n"
            for email in group["members"][:10]:  # 每个 Team 最多显示 10 个
                msg += f"  • <code>{email}</code>\n"
            if len(group["members"]) > 10:
                msg += f"  ... 还有 {len(group['members']) - 10} 人\n"
            msg += "\n"

        msg += "<i>💡 使用 /remove 邮箱 移除成员</i>"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if not is_admin:
        await send_telegram_message(bot_token, chat_id, "❓ 未知命令，/help 查看")
        return

    # ========== 管理员命令 ==========

    if text.startswith("/invite"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            await send_telegram_message(bot_token, chat_id, "用法: /invite 邮箱")
            return
        email = parts[1].strip().lower()
        # 检查邮箱格式
        if "@" not in email or "." not in email:
            await send_telegram_message(bot_token, chat_id, "❌ 无效的邮箱格式")
            return
        # 检查是否已在任何 Team 中
        existing = db.query(TeamMember).filter(TeamMember.email == email).first()
        if existing:
            team = db.query(Team).filter(Team.id == existing.team_id).first()
            await send_telegram_message(bot_token, chat_id, f"❌ <code>{email}</code> 已在 {team.name if team else 'Team'} 中")
            return
        # 查找有空位的健康 Team（使用 SeatCalculator 精确计算）
        from app.services.seat_calculator import get_all_teams_with_seats
        teams_with_seats = get_all_teams_with_seats(db, group_id=None, only_active=True)
        target_team = None
        target_team_info = None
        for team_info in teams_with_seats:
            if team_info.available_seats > 0:
                target_team = db.query(Team).filter(Team.id == team_info.team_id).first()
                target_team_info = team_info
                break
        if not target_team:
            await send_telegram_message(bot_token, chat_id, "❌ 所有 Team 都已满，无法邀请")
            return
        # 发送邀请
        try:
            from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
            api = ChatGPTAPI(target_team.session_token, target_team.device_id or "", target_team.cookie or "")
            await api.invite_members(target_team.account_id, [email])
            # 记录邀请
            invite = InviteRecord(
                team_id=target_team.id,
                email=email,
                status=InviteStatus.SUCCESS,
                batch_id=f"tg-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
            )
            db.add(invite)
            db.commit()
            await send_telegram_message(bot_token, chat_id, f"✅ <b>邀请成功</b>\n\n📧 {email}\n👥 Team: {target_team.name}")
        except ChatGPTAPIError as e:
            await send_telegram_message(bot_token, chat_id, f"❌ 邀请失败: {e.message}")
        except Exception as e:
            logger.error(f"Invite error: {e}")
            await send_telegram_message(bot_token, chat_id, f"❌ 邀请失败: {str(e)[:100]}")
        return

    if text.startswith("/remove"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            await send_telegram_message(bot_token, chat_id, "用法: /remove 邮箱 [team_id]")
            return

        args = parts[1].strip().split()
        email = args[0].lower()
        target_team_id = int(args[1]) if len(args) > 1 else None

        # 查找该用户的所有 Team
        members = db.query(TeamMember).filter(TeamMember.email == email).all()

        if not members:
            await send_telegram_message(bot_token, chat_id, f"❌ 未找到成员: <code>{email}</code>")
            return

        # 用户在多个 Team，需要指定
        if len(members) > 1 and not target_team_id:
            team_list = '\n'.join([
                f"• {db.query(Team).filter(Team.id == m.team_id).first().name} (ID: {m.team_id})"
                for m in members
            ])
            await send_telegram_message(
                bot_token, chat_id,
                f"⚠️ 用户在 {len(members)} 个 Team:\n\n{team_list}\n\n用法: /remove {email} team_id"
            )
            return

        # 选择目标成员
        member = None
        if target_team_id:
            member = next((m for m in members if m.team_id == target_team_id), None)
            if not member:
                await send_telegram_message(bot_token, chat_id, f"❌ 用户不在 Team {target_team_id}")
                return
        else:
            member = members[0]

        team = db.query(Team).filter(Team.id == member.team_id).first()
        if not team:
            await send_telegram_message(bot_token, chat_id, "❌ Team 不存在")
            return

        # 检查 chatgpt_user_id
        if not member.chatgpt_user_id:
            await send_telegram_message(
                bot_token, chat_id,
                f"❌ 无法移除: 缺少 ChatGPT User ID\n\n建议先执行: /sync {team.id}"
            )
            return

        # 移除成员
        try:
            from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
            api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
            await api.remove_member(team.account_id, member.chatgpt_user_id)

            db.delete(member)
            db.commit()

            await send_telegram_message(bot_token, chat_id, f"✅ <b>已移除</b>\n\n📧 {email}\n👥 Team: {team.name}")
        except ChatGPTAPIError as e:
            # HTML 转义错误消息
            error_msg = str(e.message).replace("<", "&lt;").replace(">", "&gt;")
            await send_telegram_message(bot_token, chat_id, f"❌ 移除失败: {error_msg}")
        except Exception as e:
            logger.error(f"Remove error: {e}")
            error_msg = str(e)[:100].replace("<", "&lt;").replace(">", "&gt;")
            await send_telegram_message(bot_token, chat_id, f"❌ 移除失败: {error_msg}")
        return

    if text.startswith("/codes"):
        parts = text.split(maxsplit=1)
        count = 5  # 默认生成 5 个
        if len(parts) > 1:
            try:
                count = int(parts[1].strip())
                if count < 1 or count > 50:
                    await send_telegram_message(bot_token, chat_id, "❌ 数量范围: 1-50")
                    return
            except ValueError:
                await send_telegram_message(bot_token, chat_id, "❌ 请输入有效数字")
                return
        # 生成兑换码
        codes = []
        for _ in range(count):
            code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            redeem = RedeemCode(
                code=code,
                code_type="direct",  # 直接链接类型
                max_uses=1,
                used_count=0,
                is_active=True
            )
            db.add(redeem)
            codes.append(code)
        db.commit()
        msg = f"✅ <b>已生成 {count} 个兑换码</b>\n\n"
        for c in codes:
            msg += f"<code>{c}</code>\n"
        await send_telegram_message(bot_token, chat_id, msg)
        return

    if text == "/sync":
        await send_telegram_message(bot_token, chat_id, "🔄 同步中...")
        from app.services.chatgpt_api import ChatGPTAPI
        teams = db.query(Team).filter(Team.is_active == True).all()
        results = []
        for team in teams:
            try:
                api = ChatGPTAPI(team.session_token, team.device_id or "")
                result = await api.get_members(team.account_id)
                data = result.get("items", result.get("users", []))
                db.query(TeamMember).filter(TeamMember.team_id == team.id).delete()
                for m in data:
                    email = m.get("email", "").lower().strip()
                    if email:
                        db.add(TeamMember(team_id=team.id, email=email, name=m.get("name", ""), role=m.get("role", "member"), chatgpt_user_id=m.get("id", ""), synced_at=datetime.utcnow()))
                db.commit()
                results.append(f"✅ {team.name}: {len(data)}")
            except Exception as e:
                logger.error(f"Sync {team.name}: {e}")
                results.append(f"❌ {team.name}")
        await send_telegram_message(bot_token, chat_id, "<b>🔄 完成</b>\n\n" + "\n".join(results))
        return

    if text == "/newteam":
        set_session(user_id, {"action": "newteam", "step": 1})
        await send_telegram_message(bot_token, chat_id, "<b>➕ 创建 Team</b>\n\n第 1 步: 输入名称\n\n/cancel 取消")
        return

    await send_telegram_message(bot_token, chat_id, "❓ 未知命令，/help 查看")



@router.post("/webhook")
async def telegram_webhook(request: Request):
    try:
        data = await request.json()
        logger.info(f"Telegram webhook: {data}")
        message = data.get("message", {})
        text = message.get("text", "")
        chat_id = str(message.get("chat", {}).get("id", ""))
        user_id = str(message.get("from", {}).get("id", ""))
        if not text or not chat_id:
            return {"ok": True}
        db = SessionLocal()
        try:
            bot_token = get_config(db, "telegram_bot_token")
            if not bot_token:
                return {"ok": True}
            if not is_authorized_chat(chat_id, user_id, db):
                await send_telegram_message(bot_token, chat_id, "⛔ 无权限")
                return {"ok": True}
            is_admin = is_admin_user(user_id, db)
            if is_admin and not text.startswith("/"):
                if await handle_interactive(text, user_id, chat_id, db, bot_token):
                    return {"ok": True}
            if text.startswith("/"):
                await handle_command(text, user_id, chat_id, db, bot_token, is_admin)
        finally:
            db.close()
        return {"ok": True}
    except Exception as e:
        logger.error(f"Telegram webhook error: {e}")
        return {"ok": True}

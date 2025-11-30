# 异步任务队列
import asyncio
import json
import logging
from typing import Optional, Callable, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# 简单的内存任务队列（生产环境可换成 Celery + Redis）
_task_queue: asyncio.Queue = None
_worker_task: asyncio.Task = None


async def get_task_queue() -> asyncio.Queue:
    """获取任务队列"""
    global _task_queue
    if _task_queue is None:
        _task_queue = asyncio.Queue(maxsize=1000)
    return _task_queue


async def enqueue_task(task_type: str, data: dict, callback: Optional[str] = None):
    """添加任务到队列"""
    queue = await get_task_queue()
    task = {
        "type": task_type,
        "data": data,
        "callback": callback,
        "created_at": datetime.utcnow().isoformat()
    }
    try:
        queue.put_nowait(task)
        logger.info(f"Task enqueued: {task_type}")
        return True
    except asyncio.QueueFull:
        logger.warning(f"Task queue full, dropping task: {task_type}")
        return False


async def process_invite_task(data: dict):
    """处理邀请任务"""
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.database import SessionLocal
    from app.models import Team, InviteRecord, InviteStatus, OperationLog
    from app.cache import invalidate_seat_cache
    
    team_id = data.get("team_id")
    email = data.get("email")
    redeem_code = data.get("redeem_code")
    linuxdo_user_id = data.get("linuxdo_user_id")
    batch_id = data.get("batch_id")
    
    db = SessionLocal()
    try:
        team = db.query(Team).filter(Team.id == team_id).first()
        if not team:
            logger.error(f"Team not found: {team_id}")
            return
        
        api = ChatGPTAPI(team.session_token, team.device_id or "")
        await api.invite_members(team.account_id, [email])
        
        # 记录成功
        invite = InviteRecord(
            team_id=team_id,
            email=email,
            linuxdo_user_id=linuxdo_user_id,
            status=InviteStatus.SUCCESS,
            redeem_code=redeem_code,
            batch_id=batch_id
        )
        db.add(invite)
        
        log = OperationLog(
            action="异步邀请成功",
            target=email,
            team_id=team_id,
            details=f"使用兑换码 {redeem_code} 邀请 {email}"
        )
        db.add(log)
        db.commit()
        
        # 清除座位缓存
        invalidate_seat_cache()
        logger.info(f"Invite success: {email} -> {team.name}")
        
    except ChatGPTAPIError as e:
        logger.error(f"Invite failed: {email} - {e.message}")
        # 记录失败
        invite = InviteRecord(
            team_id=team_id,
            email=email,
            linuxdo_user_id=linuxdo_user_id,
            status=InviteStatus.FAILED,
            redeem_code=redeem_code,
            batch_id=batch_id,
            error_message=e.message
        )
        db.add(invite)
        db.commit()
    except Exception as e:
        logger.error(f"Invite error: {email} - {str(e)}")
    finally:
        db.close()


async def task_worker():
    """任务处理 worker"""
    queue = await get_task_queue()
    logger.info("Task worker started")
    
    while True:
        try:
            task = await queue.get()
            task_type = task.get("type")
            data = task.get("data", {})
            
            if task_type == "invite":
                await process_invite_task(data)
            else:
                logger.warning(f"Unknown task type: {task_type}")
            
            queue.task_done()
            
            # 任务间隔，避免 API 限流
            await asyncio.sleep(1)
            
        except asyncio.CancelledError:
            logger.info("Task worker cancelled")
            break
        except Exception as e:
            logger.error(f"Task worker error: {e}")
            await asyncio.sleep(1)


async def start_task_worker():
    """启动任务 worker"""
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(task_worker())
        logger.info("Task worker started")


async def stop_task_worker():
    """停止任务 worker"""
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        logger.info("Task worker stopped")

from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.auth import get_current_user
from app.services.bulk_email import collect_recipients, TARGET_ALL, TARGET_EXPIRED, TARGET_EXPIRING
from app.tasks_celery import send_bulk_email_task

router = APIRouter(prefix="/bulk-email", tags=["bulk-email"])


class BulkEmailPreviewRequest(BaseModel):
    target: Literal["expiring", "expired", "all"]
    days: Optional[int] = Field(default=None, ge=0)


class BulkEmailSendRequest(BaseModel):
    target: Literal["expiring", "expired", "all"]
    days: Optional[int] = Field(default=None, ge=0)
    subject: str
    content: str
    confirm: bool = False


class BulkEmailPreviewResponse(BaseModel):
    count: int


def _validate_target(target: str, days: Optional[int]) -> None:
    if target == TARGET_EXPIRING and days is None:
        raise HTTPException(status_code=400, detail="请设置快到期天数")
    if target not in [TARGET_EXPIRING, TARGET_EXPIRED, TARGET_ALL]:
        raise HTTPException(status_code=400, detail="无效的发送对象类型")


@router.post("/preview", response_model=BulkEmailPreviewResponse)
async def preview_bulk_email(
    data: BulkEmailPreviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    _validate_target(data.target, data.days)
    recipients = collect_recipients(db, data.target, data.days)
    return BulkEmailPreviewResponse(count=len(recipients))


@router.post("/send")
async def send_bulk_email(
    data: BulkEmailSendRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    _validate_target(data.target, data.days)
    if not data.subject.strip():
        raise HTTPException(status_code=400, detail="请填写邮件标题")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="请填写邮件内容")
    if not data.confirm:
        raise HTTPException(status_code=400, detail="请确认发送")

    recipients = collect_recipients(db, data.target, data.days)
    count = len(recipients)
    if count == 0:
        return {"message": "没有可发送的用户", "count": 0}

    send_bulk_email_task.delay({
        "target": data.target,
        "days": data.days,
        "subject": data.subject,
        "content": data.content,
        "operator": getattr(current_user, "username", "admin")
    })

    return {"message": "发送任务已提交", "count": count}

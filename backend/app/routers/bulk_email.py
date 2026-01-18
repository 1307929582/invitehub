from typing import Optional, Literal, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.auth import get_current_user
from app.models import OperationLog
from app.services.bulk_email import collect_recipients, TARGET_ALL, TARGET_EXPIRED, TARGET_EXPIRING, build_template_context, render_template
from app.services.email import send_email
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


class BulkEmailTestRequest(BaseModel):
    target: Literal["expiring", "expired", "all"]
    days: Optional[int] = Field(default=None, ge=0)
    subject: str
    content: str
    test_email: EmailStr


class BulkEmailSample(BaseModel):
    email: str
    expires_at: str = ""
    days_left: Optional[int] = None
    code: str = ""


class BulkEmailPreviewResponse(BaseModel):
    count: int
    samples: List[BulkEmailSample]


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
    samples = [
        BulkEmailSample(
            email=item.get("email") or "",
            expires_at=item.get("expires_at_str") or "",
            days_left=item.get("days_left"),
            code=item.get("code") or ""
        )
        for item in sorted(recipients, key=lambda x: x.get("email") or "")[:5]
    ]
    return BulkEmailPreviewResponse(count=len(recipients), samples=samples)


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


@router.post("/test")
async def test_bulk_email(
    data: BulkEmailTestRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    _validate_target(data.target, data.days)
    if not data.subject.strip():
        raise HTTPException(status_code=400, detail="请填写邮件标题")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="请填写邮件内容")

    recipients = collect_recipients(db, data.target, data.days)
    sample = recipients[0] if recipients else {
        "email": data.test_email,
        "code": "",
        "expires_at_str": "",
        "days_left": 0,
    }
    context = build_template_context(sample)
    context["email"] = str(data.test_email)

    subject = render_template(data.subject, context).strip()
    content = render_template(data.content, context)
    if not subject:
        raise HTTPException(status_code=400, detail="邮件标题为空")

    if not send_email(db, subject, content, to_email=str(data.test_email)):
        raise HTTPException(status_code=400, detail="测试邮件发送失败")

    try:
        log = OperationLog(
            user_id=getattr(current_user, "id", None),
            action="bulk_email_test",
            target=str(data.test_email),
            details=f"target={data.target}, days={data.days}",
            ip_address="system"
        )
        db.add(log)
        db.commit()
    except Exception:
        pass

    return {"message": "测试邮件已发送"}

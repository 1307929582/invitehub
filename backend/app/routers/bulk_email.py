from typing import Optional, Literal, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy.orm import Session
from uuid import uuid4

from app.database import get_db
from app.services.auth import get_current_user
from app.models import OperationLog, BulkEmailJob, BulkEmailLog
from app.services.bulk_email import collect_recipients, TARGET_ALL, TARGET_EXPIRED, TARGET_EXPIRING, build_template_context, render_template
from app.services.email import send_email
from app.tasks_celery import send_bulk_email_task, _dispatch_bulk_email_chunks, BULK_EMAIL_CHUNK_SIZE
from app.schemas import BulkEmailJobListResponse, BulkEmailJobResponse, BulkEmailLogListResponse, BulkEmailLogResponse

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

def _job_progress(job: BulkEmailJob) -> float:
    total = job.total or 0
    if total <= 0:
        return 0.0
    done = (job.sent or 0) + (job.failed or 0)
    return round(min(done / total, 1) * 100, 2)


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

    job_id = uuid4().hex
    job = BulkEmailJob(
        job_id=job_id,
        user_id=getattr(current_user, "id", None),
        target=data.target,
        days=data.days,
        subject=data.subject,
        content=data.content,
        status="pending",
        total=count
    )
    db.add(job)
    db.commit()

    send_bulk_email_task.delay({
        "job_id": job_id,
        "target": data.target,
        "days": data.days,
        "subject": data.subject,
        "content": data.content,
        "operator": getattr(current_user, "username", "admin")
    })

    return {"message": "发送任务已提交", "count": count, "job_id": job_id}


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


@router.get("/jobs", response_model=BulkEmailJobListResponse)
async def list_bulk_email_jobs(
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    query = db.query(BulkEmailJob).order_by(BulkEmailJob.created_at.desc())
    total = query.count()
    jobs = query.limit(limit).all()
    result = []
    for job in jobs:
        data = BulkEmailJobResponse.model_validate(job).model_dump()
        data["progress"] = _job_progress(job)
        result.append(BulkEmailJobResponse(**data))
    return BulkEmailJobListResponse(jobs=result, total=total)


@router.get("/jobs/{job_id}", response_model=BulkEmailJobResponse)
async def get_bulk_email_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    job = db.query(BulkEmailJob).filter(BulkEmailJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    data = BulkEmailJobResponse.model_validate(job).model_dump()
    data["progress"] = _job_progress(job)
    return BulkEmailJobResponse(**data)


@router.get("/jobs/{job_id}/logs", response_model=BulkEmailLogListResponse)
async def get_bulk_email_logs(
    job_id: str,
    limit: int = Query(200, ge=1, le=500),
    before_id: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    job = db.query(BulkEmailJob).filter(BulkEmailJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    query = db.query(BulkEmailLog).filter(BulkEmailLog.job_id == job_id)
    if before_id:
        query = query.filter(BulkEmailLog.id < before_id)
    logs = query.order_by(BulkEmailLog.id.desc()).limit(limit).all()
    total = db.query(BulkEmailLog).filter(BulkEmailLog.job_id == job_id).count()
    result = [BulkEmailLogResponse.model_validate(log) for log in logs]
    return BulkEmailLogListResponse(logs=result, total=total)


@router.post("/jobs/{job_id}/pause")
async def pause_bulk_email_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    job = db.query(BulkEmailJob).filter(BulkEmailJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    if job.status not in ["running", "pending"]:
        return {"message": "任务当前无法暂停", "status": job.status}
    job.status = "paused"
    db.commit()
    return {"message": "已暂停", "status": job.status}


@router.post("/jobs/{job_id}/resume")
async def resume_bulk_email_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    job = db.query(BulkEmailJob).filter(BulkEmailJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    if job.status != "paused":
        raise HTTPException(status_code=400, detail="任务非暂停状态")

    recipients = collect_recipients(db, job.target, job.days)
    logged_emails = {
        item[0] for item in db.query(BulkEmailLog.email).filter(BulkEmailLog.job_id == job_id).all()
    }
    remaining = [r for r in recipients if (r.get("email") or "") not in logged_emails]

    if not remaining:
        job.status = "completed"
        job.finished_at = datetime.utcnow()
        db.commit()
        return {"message": "无需继续发送", "remaining": 0}

    job.status = "running"
    job.finished_at = None
    db.commit()

    _dispatch_bulk_email_chunks(
        job_id=job_id,
        subject_tpl=job.subject,
        content_tpl=job.content,
        recipients=remaining,
        operator=getattr(current_user, "username", "admin"),
        chunk_size=BULK_EMAIL_CHUNK_SIZE
    )

    return {"message": "继续发送", "remaining": len(remaining)}

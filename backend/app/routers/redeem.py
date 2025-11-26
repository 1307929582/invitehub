# 兑换码管理 API
from datetime import datetime, timedelta
from typing import Optional, List
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import RedeemCode, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/redeem-codes", tags=["redeem-codes"])


class RedeemCodeCreate(BaseModel):
    max_uses: int = 1
    expires_days: Optional[int] = None
    count: int = 1
    prefix: str = ""


class RedeemCodeResponse(BaseModel):
    id: int
    code: str
    max_uses: int
    used_count: int
    expires_at: Optional[datetime]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class RedeemCodeListResponse(BaseModel):
    codes: List[RedeemCodeResponse]
    total: int


class BatchCreateResponse(BaseModel):
    codes: List[str]
    count: int


def generate_code(prefix: str = "", length: int = 8) -> str:
    chars = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(chars) for _ in range(length))
    return f"{prefix}{code}" if prefix else code


@router.get("", response_model=RedeemCodeListResponse)
async def list_redeem_codes(
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取兑换码列表"""
    query = db.query(RedeemCode)
    
    if is_active is not None:
        query = query.filter(RedeemCode.is_active == is_active)
    
    codes = query.order_by(RedeemCode.created_at.desc()).all()
    
    return RedeemCodeListResponse(
        codes=[RedeemCodeResponse(
            id=c.id,
            code=c.code,
            max_uses=c.max_uses,
            used_count=c.used_count,
            expires_at=c.expires_at,
            is_active=c.is_active,
            created_at=c.created_at
        ) for c in codes],
        total=len(codes)
    )


@router.post("/batch", response_model=BatchCreateResponse)
async def batch_create_codes(
    data: RedeemCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量创建兑换码"""
    if data.count < 1 or data.count > 100:
        raise HTTPException(status_code=400, detail="数量必须在 1-100 之间")
    
    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)
    
    codes = []
    for _ in range(data.count):
        while True:
            code_str = generate_code(data.prefix)
            existing = db.query(RedeemCode).filter(RedeemCode.code == code_str).first()
            if not existing:
                break
        
        code = RedeemCode(
            code=code_str,
            max_uses=data.max_uses,
            expires_at=expires_at,
            created_by=current_user.id
        )
        db.add(code)
        codes.append(code_str)
    
    db.commit()
    
    return BatchCreateResponse(codes=codes, count=len(codes))


@router.delete("/{code_id}")
async def delete_code(
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除兑换码"""
    code = db.query(RedeemCode).filter(RedeemCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")
    
    db.delete(code)
    db.commit()
    
    return {"message": "删除成功"}


@router.put("/{code_id}/toggle")
async def toggle_code(
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """禁用/启用兑换码"""
    code = db.query(RedeemCode).filter(RedeemCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")
    
    code.is_active = not code.is_active
    db.commit()
    
    return {"message": "已" + ("启用" if code.is_active else "禁用"), "is_active": code.is_active}

# 管理员管理路由
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Optional

from app.database import get_db
from app.models import User, UserRole, UserApprovalStatus
from app.services.auth import get_current_user, get_password_hash

router = APIRouter(prefix="/admins", tags=["管理员管理"])


class AdminResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True


class AdminCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: str = "admin"


class AdminUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", response_model=List[AdminResponse])
async def list_admins(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有管理员列表"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以查看")
    
    users = db.query(User).filter(User.role.in_([UserRole.ADMIN, UserRole.OPERATOR])).all()
    return [AdminResponse(
        id=u.id,
        username=u.username,
        email=u.email,
        role=u.role.value,
        is_active=u.is_active,
        created_at=u.created_at.isoformat() if u.created_at else ""
    ) for u in users]


@router.post("", response_model=AdminResponse)
async def create_admin(
    data: AdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新管理员"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以创建")
    
    # 检查用户名是否已存在
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    
    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")
    
    # 验证角色
    try:
        role = UserRole(data.role)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的角色")
    
    user = User(
        username=data.username.strip(),
        email=data.email.lower().strip(),
        hashed_password=get_password_hash(data.password),
        role=role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(db, "admin_created", username=user.username, role=data.role, operator=current_user.username)
    
    return AdminResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else ""
    )


@router.put("/{admin_id}", response_model=AdminResponse)
async def update_admin(
    admin_id: int,
    data: AdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新管理员信息"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以修改")
    
    user = db.query(User).filter(User.id == admin_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    if data.email:
        existing = db.query(User).filter(User.email == data.email, User.id != admin_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="邮箱已被使用")
        user.email = data.email.lower().strip()
    
    if data.password:
        user.hashed_password = get_password_hash(data.password)
    
    if data.role:
        try:
            user.role = UserRole(data.role)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的角色")
    
    if data.is_active is not None:
        # 不能禁用自己
        if admin_id == current_user.id and not data.is_active:
            raise HTTPException(status_code=400, detail="不能禁用自己")
        user.is_active = data.is_active
    
    db.commit()
    db.refresh(user)
    
    return AdminResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else ""
    )


@router.delete("/{admin_id}")
async def delete_admin(
    admin_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除管理员"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以删除")
    
    if admin_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    user = db.query(User).filter(User.id == admin_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    db.delete(user)
    db.commit()

    return {"message": "删除成功"}


# ===== 分销商审核相关 API =====

class DistributorPendingResponse(BaseModel):
    """待审核分销商响应"""
    id: int
    username: str
    email: str
    created_at: str
    approval_status: str
    rejection_reason: Optional[str] = None

    class Config:
        from_attributes = True


class DistributorRejectRequest(BaseModel):
    """拒绝分销商请求"""
    reason: Optional[str] = None


class DistributorCreateRequest(BaseModel):
    """手动创建分销商请求"""
    username: str
    email: EmailStr
    password: str


@router.get("/pending-distributors", response_model=List[DistributorPendingResponse])
async def list_pending_distributors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """查看待审核的分销商"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以查看")

    distributors = db.query(User).filter(
        User.role == UserRole.DISTRIBUTOR,
        User.approval_status != UserApprovalStatus.APPROVED
    ).order_by(User.created_at.asc()).all()

    return [
        DistributorPendingResponse(
            id=u.id,
            username=u.username,
            email=u.email,
            created_at=u.created_at.isoformat() if u.created_at else "",
            approval_status=u.approval_status.value,
            rejection_reason=u.rejection_reason,
        )
        for u in distributors
    ]


@router.post("/distributors/{distributor_id}/approve")
async def approve_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批准分销商申请"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以审批")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    distributor.approval_status = UserApprovalStatus.APPROVED
    distributor.rejection_reason = None
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor approved: {distributor.username} by {current_user.username}")

    return {"message": "已通过审核", "distributor": distributor.username}


@router.post("/distributors/{distributor_id}/reject")
async def reject_distributor(
    distributor_id: int,
    payload: DistributorRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """拒绝分销商申请"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以审批")

    distributor = db.query(User).filter(
        User.id == distributor_id,
        User.role == UserRole.DISTRIBUTOR
    ).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="分销商不存在")

    distributor.approval_status = UserApprovalStatus.REJECTED
    distributor.rejection_reason = payload.reason
    db.commit()

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor rejected: {distributor.username} by {current_user.username}, reason: {payload.reason}")

    return {"message": "已拒绝申请", "distributor": distributor.username}


@router.post("/distributors/create")
async def create_distributor(
    payload: DistributorCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手动创建分销商账号（管理员）

    创建的分销商自动批准，无需审核流程
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="只有管理员可以创建分销商")

    # 检查用户名
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 检查邮箱
    if db.query(User).filter(User.email == payload.email.lower()).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")

    # 创建分销商（自动批准）
    distributor = User(
        username=payload.username.strip(),
        email=payload.email.lower().strip(),
        hashed_password=get_password_hash(payload.password),
        role=UserRole.DISTRIBUTOR,
        approval_status=UserApprovalStatus.APPROVED,
        is_active=True
    )
    db.add(distributor)
    db.commit()
    db.refresh(distributor)

    from app.logger import get_logger
    logger = get_logger(__name__)
    logger.info(f"Distributor created manually: {distributor.username} by {current_user.username}")

    return {
        "message": "分销商创建成功",
        "distributor": {
            "id": distributor.id,
            "username": distributor.username,
            "email": distributor.email
        }
    }

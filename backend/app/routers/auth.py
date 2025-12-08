# 认证路由
from datetime import datetime, timedelta
import hashlib
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models import User, UserRole, OperationLog, UserApprovalStatus, VerificationCode, VerificationPurpose
from app.schemas import Token, UserCreate, UserResponse, UserLogin
from app.services.auth import (
    authenticate_user,
    create_access_token,
    get_password_hash,
    get_current_user,
    get_current_admin
)
from app.services.email import send_verification_code_email
from app.config import settings
from app.limiter import limiter
from app.logger import get_logger

router = APIRouter(prefix="/auth", tags=["认证"])
logger = get_logger(__name__)

# 验证码配置
CODE_TTL_MINUTES = 10


def _hash_code(email: str, code: str) -> str:
    """SHA-256 哈希验证码"""
    return hashlib.sha256(f"{email.lower()}::{code}".encode("utf-8")).hexdigest()


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")  # 每分钟最多5次登录尝试
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """用户登录"""
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        logger.warning("Login failed", extra={
            "username": form_data.username,
            "client_ip": request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查审核状态（仅分销商）
    if user.role == UserRole.DISTRIBUTOR:
        if user.approval_status == UserApprovalStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您的账号正在审核中，请耐心等待管理员审核"
            )
        elif user.approval_status == UserApprovalStatus.REJECTED:
            detail = f"您的申请已被拒绝"
            if user.rejection_reason:
                detail += f"：{user.rejection_reason}"
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail
            )

    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    logger.info("Login success", extra={"username": user.username, "client_ip": client_ip})

    # 记录登录日志
    log = OperationLog(
        user_id=user.id,
        action="登录",
        target=user.username,
        details=f"IP: {client_ip}",
        ip_address=client_ip
    )
    db.add(log)
    db.commit()

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/register", response_model=UserResponse)
async def register(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin)
):
    """注册新用户（仅管理员）"""
    # 检查用户名是否存在
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    
    # 检查邮箱是否存在
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已存在")
    
    # 创建用户
    user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        role=user_data.role
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user


# 已移除 init-admin 接口，改用 /setup/initialize


# ===== 分销商注册相关 API =====

class VerificationCodeRequest(BaseModel):
    """发送验证码请求"""
    email: EmailStr


class DistributorRegisterRequest(BaseModel):
    """分销商注册请求"""
    email: EmailStr
    username: str
    password: str
    code: str


@router.post("/send-verification-code")
@limiter.limit("1/minute")  # 1分钟只能发送1次
async def send_verification_code(
    request: Request,
    payload: VerificationCodeRequest,
    db: Session = Depends(get_db)
):
    """发送邮箱验证码"""
    email = payload.email.lower().strip()

    # 生成6位验证码
    code = f"{secrets.randbelow(1000000):06d}"
    code_hash = _hash_code(email, code)

    # 删除该邮箱的旧验证码
    db.query(VerificationCode).filter(
        VerificationCode.email == email,
        VerificationCode.purpose == VerificationPurpose.DISTRIBUTOR_SIGNUP,
    ).delete()

    # 创建新验证码
    verification = VerificationCode(
        email=email,
        code_hash=code_hash,
        purpose=VerificationPurpose.DISTRIBUTOR_SIGNUP,
        expires_at=datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES),
    )
    db.add(verification)
    db.commit()

    # 发送邮件
    if not send_verification_code_email(db, email, code):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="邮件发送失败，请检查邮件配置或稍后重试"
        )

    logger.info(f"Verification code sent to {email}")
    return {"message": "验证码已发送，请查收邮件（有效期10分钟）"}


@router.post("/register-distributor", response_model=UserResponse)
@limiter.limit("5/hour")  # 1小时最多5次注册尝试
async def register_distributor(
    request: Request,
    payload: DistributorRegisterRequest,
    db: Session = Depends(get_db)
):
    """分销商自助注册"""
    email = payload.email.lower().strip()

    # 验证验证码
    vc = db.query(VerificationCode).filter(
        VerificationCode.email == email,
        VerificationCode.purpose == VerificationPurpose.DISTRIBUTOR_SIGNUP,
        VerificationCode.expires_at >= datetime.utcnow(),
    ).order_by(VerificationCode.created_at.desc()).first()

    if not vc or vc.code_hash != _hash_code(email, payload.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期，请重新获取"
        )

    # 检查用户是否已存在
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已注册"
        )
    if db.query(User).filter(User.username == payload.username.strip()).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已被使用"
        )

    # 创建分销商用户（待审核状态）
    user = User(
        username=payload.username.strip(),
        email=email,
        hashed_password=get_password_hash(payload.password),
        role=UserRole.DISTRIBUTOR,
        approval_status=UserApprovalStatus.PENDING,  # 待审核
        is_active=True,
    )
    db.add(user)

    # 标记验证码为已验证
    vc.verified = True
    db.commit()
    db.refresh(user)

    logger.info(f"New distributor registered: {user.username} ({user.email})")
    return user

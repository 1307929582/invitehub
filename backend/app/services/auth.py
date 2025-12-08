# 认证服务
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.config import settings
from app.models import User
from app.database import get_db
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(
        plain_password.encode('utf-8'), 
        hashed_password.encode('utf-8')
    )


def get_password_hash(password: str) -> str:
    """生成密码哈希"""
    return bcrypt.hashpw(
        password.encode('utf-8'), 
        bcrypt.gensalt()
    ).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """创建 JWT Token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """验证用户"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """获取当前用户"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=400, detail="用户已被禁用")
    return user


async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """获取当前管理员用户"""
    from app.models import UserRole
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


def require_roles(*allowed_roles):
    """
    返回 FastAPI 依赖以限制角色访问

    Usage:
        @router.get("/admin/users", dependencies=[Depends(require_roles(UserRole.ADMIN))])
        async def list_users(...):
            ...

        @router.post("/redeem-codes", dependencies=[Depends(require_roles(UserRole.ADMIN, UserRole.DISTRIBUTOR))])
        async def create_code(...):
            ...
    """
    async def _role_checker(current_user: User = Depends(get_current_user)) -> User:
        from app.models import UserRole, UserApprovalStatus

        # 检查角色是否在允许列表中
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="权限不足，无法访问此资源"
            )

        # 分销商需要额外检查审核状态
        if current_user.role == UserRole.DISTRIBUTOR:
            if current_user.approval_status != UserApprovalStatus.APPROVED:
                if current_user.approval_status == UserApprovalStatus.PENDING:
                    detail = "您的账号正在审核中，请耐心等待管理员审核"
                elif current_user.approval_status == UserApprovalStatus.REJECTED:
                    detail = "您的申请已被拒绝"
                    if current_user.rejection_reason:
                        detail += f"：{current_user.rejection_reason}"
                else:
                    detail = "账号审核状态异常，请联系管理员"

                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=detail
                )

        return current_user

    return _role_checker

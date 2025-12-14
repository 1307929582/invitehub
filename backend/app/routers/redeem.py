# 兑换码管理 API
from datetime import datetime, timedelta
from typing import Optional, List
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import RedeemCode, RedeemCodeType, User, TeamGroup, InviteRecord, UserRole
from app.services.auth import get_current_user, require_roles

router = APIRouter(prefix="/redeem-codes", tags=["redeem-codes"])


class RedeemCodeCreate(BaseModel):
    max_uses: int = 1
    expires_days: Optional[int] = None
    validity_days: int = 30  # 用户有效天数（从激活开始计算）
    count: int = 1
    prefix: str = ""
    code_type: str = "direct"  # 仅支持 direct（LinuxDO 已废弃）
    note: Optional[str] = None
    group_id: Optional[int] = None  # 绑定分组


class RedeemCodeResponse(BaseModel):
    id: int
    code: str
    code_type: str
    max_uses: int
    used_count: int
    expires_at: Optional[datetime]
    is_active: bool
    note: Optional[str]
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    created_at: datetime
    # 商业版新增字段
    validity_days: int = 30
    activated_at: Optional[datetime] = None
    bound_email: Optional[str] = None

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
    code_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """获取兑换码列表"""
    query = db.query(RedeemCode)

    # 分销商只能查看自己创建的兑换码
    if current_user.role == UserRole.DISTRIBUTOR:
        query = query.filter(RedeemCode.created_by == current_user.id)

    if is_active is not None:
        query = query.filter(RedeemCode.is_active == is_active)

    if code_type:
        query = query.filter(RedeemCode.code_type == code_type)

    codes = query.order_by(RedeemCode.created_at.desc()).all()

    # 获取分组名称映射
    group_ids = [c.group_id for c in codes if c.group_id]
    groups = {}
    if group_ids:
        group_list = db.query(TeamGroup).filter(TeamGroup.id.in_(group_ids)).all()
        groups = {g.id: g.name for g in group_list}

    return RedeemCodeListResponse(
        codes=[RedeemCodeResponse(
            id=c.id,
            code=c.code,
            code_type=c.code_type.value if c.code_type else "direct",
            max_uses=c.max_uses,
            used_count=c.used_count,
            expires_at=c.expires_at,
            is_active=c.is_active,
            note=c.note,
            group_id=c.group_id,
            group_name=groups.get(c.group_id) if c.group_id else None,
            created_at=c.created_at,
            validity_days=c.validity_days or 30,
            activated_at=c.activated_at,
            bound_email=c.bound_email
        ) for c in codes],
        total=len(codes)
    )


@router.post("/batch", response_model=BatchCreateResponse)
async def batch_create_codes(
    data: RedeemCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """批量创建兑换码"""
    from app.models import SystemConfig

    if data.count < 1 or data.count > 100:
        raise HTTPException(status_code=400, detail="数量必须在 1-100 之间")

    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)

    # 确定兑换码类型
    code_type = RedeemCodeType.DIRECT if data.code_type == "direct" else RedeemCodeType.LINUXDO

    # 分销商可以指定分组，也可以不指定（使用所有分组的 Team）
    group_id = data.group_id

    # 分销商兑换码自动添加 ID 前缀，格式：D{id}_
    # 管理员创建的兑换码使用用户指定的前缀（或无前缀）
    effective_prefix = data.prefix
    if current_user.role == UserRole.DISTRIBUTOR:
        effective_prefix = f"D{current_user.id}_"

    codes = []
    for _ in range(data.count):
        while True:
            code_str = generate_code(effective_prefix)
            existing = db.query(RedeemCode).filter(RedeemCode.code == code_str).first()
            if not existing:
                break

        code = RedeemCode(
            code=code_str,
            code_type=code_type,
            max_uses=data.max_uses,
            expires_at=expires_at,
            validity_days=data.validity_days,
            note=data.note,
            group_id=group_id,  # 使用确定后的 group_id
            created_by=current_user.id
        )
        db.add(code)
        codes.append(code_str)

    db.commit()

    # 发送 Telegram 通知
    from app.services.telegram import send_admin_notification
    await send_admin_notification(db, "redeem_codes_created", count=len(codes), code_type=data.code_type, max_uses=data.max_uses, operator=current_user.username)

    return BatchCreateResponse(codes=codes, count=len(codes))


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    ids: List[int]


class BatchDeleteResponse(BaseModel):
    """批量删除响应"""
    deleted: int
    skipped: int
    errors: List[str]


# 注意：/batch 路由必须在 /{code_id} 之前定义，否则 FastAPI 会把 "batch" 当作 code_id 解析
@router.delete("/batch", response_model=BatchDeleteResponse)
async def batch_delete_codes(
    data: BatchDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """
    批量删除兑换码

    - 分销商只能删除自己创建的兑换码
    - 已使用的兑换码不能删除（会被跳过）
    """
    from app.logger import get_logger
    logger = get_logger(__name__)

    if not data.ids:
        raise HTTPException(status_code=400, detail="请选择要删除的兑换码")

    # 保序去重（dict.fromkeys 保持原始顺序）
    unique_ids = list(dict.fromkeys(data.ids))

    if len(unique_ids) > 100:
        raise HTTPException(status_code=400, detail="一次最多删除 100 个")

    # 批量查询（优化：一次查询代替 N 次）
    # 分销商场景：直接在查询时过滤 created_by，避免泄露其他用户的 ID 存在性
    query = db.query(RedeemCode).filter(RedeemCode.id.in_(unique_ids))
    if current_user.role == UserRole.DISTRIBUTOR:
        query = query.filter(RedeemCode.created_by == current_user.id)

    codes = query.all()
    codes_map = {c.id: c for c in codes}

    deleted = 0
    skipped = 0
    errors = []
    to_delete = []

    for code_id in unique_ids:
        code = codes_map.get(code_id)

        # 不存在或无权限统一返回"无法删除"，避免泄露 ID 存在性
        if not code:
            errors.append(f"ID {code_id}: 无法删除")
            skipped += 1
            continue

        # 已使用的不能删除
        if code.used_count and code.used_count > 0:
            errors.append(f"ID {code_id}: 已使用")
            skipped += 1
            continue

        to_delete.append(code)
        deleted += 1

    # 批量删除 + 异常处理
    if to_delete:
        try:
            for code in to_delete:
                db.delete(code)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"批量删除兑换码失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="删除失败，请稍后重试")

    return BatchDeleteResponse(
        deleted=deleted,
        skipped=skipped,
        errors=errors[:10]  # 只返回前 10 个错误
    )


@router.delete("/{code_id}")
async def delete_code(
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """删除兑换码"""
    code = db.query(RedeemCode).filter(RedeemCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    # 分销商权限检查：只能删除自己创建的兑换码
    if current_user.role == UserRole.DISTRIBUTOR:
        if code.created_by != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="您只能删除自己创建的兑换码"
            )

    # 使用验证：已有使用记录的兑换码不能删除
    if code.used_count and code.used_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该兑换码已被使用 {code.used_count} 次，不能删除。如需停用，请使用禁用功能。"
        )

    db.delete(code)
    db.commit()

    return {"message": "删除成功"}


@router.put("/{code_id}/toggle")
async def toggle_code(
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """禁用/启用兑换码"""
    code = db.query(RedeemCode).filter(RedeemCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")
    
    code.is_active = not code.is_active
    db.commit()
    
    return {"message": "已" + ("启用" if code.is_active else "禁用"), "is_active": code.is_active}



class InviteRecordResponse(BaseModel):
    id: int
    email: str
    team_name: str
    status: str
    created_at: datetime
    accepted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("/{code_id}/records")
async def get_code_records(
    code_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DISTRIBUTOR))
):
    """获取兑换码使用记录"""
    code = db.query(RedeemCode).filter(RedeemCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")
    
    from app.models import Team
    
    # 查询使用该兑换码的邀请记录
    records = db.query(InviteRecord).filter(
        InviteRecord.redeem_code == code.code
    ).order_by(InviteRecord.created_at.desc()).all()
    
    # 获取 Team 名称
    team_ids = [r.team_id for r in records]
    teams = {}
    if team_ids:
        team_list = db.query(Team).filter(Team.id.in_(team_ids)).all()
        teams = {t.id: t.name for t in team_list}
    
    return {
        "code": code.code,
        "records": [
            InviteRecordResponse(
                id=r.id,
                email=r.email,
                team_name=teams.get(r.team_id, "未知"),
                status=r.status.value,
                created_at=r.created_at,
                accepted_at=r.accepted_at
            )
            for r in records
        ]
    }

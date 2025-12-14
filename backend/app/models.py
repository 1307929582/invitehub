# 数据库模型
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
import enum

Base = declarative_base()


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"
    DISTRIBUTOR = "distributor"


class UserApprovalStatus(str, enum.Enum):
    """用户审核状态"""
    PENDING = "pending"      # 待审核
    APPROVED = "approved"    # 已批准
    REJECTED = "rejected"    # 已拒绝


class InviteStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    REMOVED = "removed"  # 成员被分销商/管理员移除


class TeamStatus(str, enum.Enum):
    """Team 状态"""
    ACTIVE = "active"              # 正常使用
    BANNED = "banned"              # 被平台封禁
    TOKEN_INVALID = "token_invalid"  # Token 失效
    PAUSED = "paused"              # 管理员手动暂停


class User(Base):
    """系统用户（管理平台的用户）"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole, values_callable=lambda x: [e.value for e in x]), default=UserRole.VIEWER)
    is_active = Column(Boolean, default=True)
    approval_status = Column(
        Enum(UserApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=UserApprovalStatus.APPROVED
    )
    rejection_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    operation_logs = relationship("OperationLog", back_populates="user")
    redeem_codes = relationship("RedeemCode", back_populates="creator")


class Team(Base):
    """ChatGPT Team 配置"""
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    account_id = Column(String(100), nullable=False)
    session_token = Column(Text, nullable=False)
    device_id = Column(String(100), nullable=True)
    cookie = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    max_seats = Column(Integer, default=5)  # 最大座位数
    group_id = Column(Integer, ForeignKey("team_groups.id"), nullable=True)  # 所属分组
    is_active = Column(Boolean, default=True)
    status = Column(
        Enum(TeamStatus, values_callable=lambda x: [e.value for e in x]),
        default=TeamStatus.ACTIVE,
        nullable=False,
        index=True
    )  # Team 状态
    status_message = Column(String(255), nullable=True)  # 状态变更原因/消息
    status_changed_at = Column(DateTime, nullable=True)  # 状态变更时间
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    group = relationship("TeamGroup", back_populates="teams")
    members = relationship("TeamMember", back_populates="team")
    invites = relationship("InviteRecord", back_populates="team")
    operation_logs = relationship("OperationLog", back_populates="team")


class TeamMember(Base):
    """Team 成员缓存"""
    __tablename__ = "team_members"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)  # 添加索引
    email = Column(String(100), nullable=False, index=True)  # 添加索引
    name = Column(String(100), nullable=True)
    role = Column(String(50), default="member")
    chatgpt_user_id = Column(String(100), nullable=True)
    joined_at = Column(DateTime, nullable=True)
    synced_at = Column(DateTime, default=datetime.utcnow)
    is_unauthorized = Column(Boolean, default=False)  # 是否为未授权成员（非系统邀请）

    team = relationship("Team", back_populates="members")


class InviteRecord(Base):
    """邀请记录"""
    __tablename__ = "invite_records"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)  # 添加索引
    email = Column(String(100), nullable=False, index=True)  # 添加索引
    linuxdo_user_id = Column(Integer, nullable=True)  # 保留字段但移除外键约束
    status = Column(Enum(InviteStatus, values_callable=lambda x: [e.value for e in x]), default=InviteStatus.PENDING, index=True)
    error_message = Column(Text, nullable=True)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    redeem_code = Column(String(50), nullable=True)
    batch_id = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)  # 添加索引
    accepted_at = Column(DateTime, nullable=True)  # 接受邀请时间

    # 新增字段 - 商业版功能
    is_rebind = Column(Boolean, default=False)  # 是否为换车操作

    team = relationship("Team", back_populates="invites")


class OperationLog(Base):
    """操作日志"""
    __tablename__ = "operation_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    action = Column(String(50), nullable=False)
    target = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="operation_logs")
    team = relationship("Team", back_populates="operation_logs")


class TeamGroup(Base):
    """Team 分组"""
    __tablename__ = "team_groups"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    color = Column(String(20), default="#1890ff")  # 标签颜色
    alert_threshold = Column(Integer, default=5)  # 空位预警阈值，0 表示不预警
    created_at = Column(DateTime, default=datetime.utcnow)
    
    teams = relationship("Team", back_populates="group")
    redeem_codes = relationship("RedeemCode", back_populates="group")


class RedeemCodeType(str, enum.Enum):
    LINUXDO = "linuxdo"  # 需要 LinuxDO 登录
    DIRECT = "direct"    # 直接链接，无需登录


class RedeemCodeStatus(str, enum.Enum):
    """兑换码状态（用于过期用户清理）"""
    BOUND = "bound"          # 已绑定，用户活跃
    REMOVING = "removing"    # 正在移除中
    REMOVED = "removed"      # 已移除


class RedeemCode(Base):
    """兑换码"""
    __tablename__ = "redeem_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    code_type = Column(Enum(RedeemCodeType, values_callable=lambda x: [e.value for e in x]), default=RedeemCodeType.LINUXDO)
    max_uses = Column(Integer, default=1)
    used_count = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    note = Column(String(255), nullable=True)  # 备注/订单号
    group_id = Column(Integer, ForeignKey("team_groups.id"), nullable=True)  # 绑定分组
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 新增字段 - 商业版功能
    validity_days = Column(Integer, default=30)  # 有效天数
    activated_at = Column(DateTime, nullable=True)  # 首次激活时间
    bound_email = Column(String(100), nullable=True, index=True)  # 绑定邮箱，添加索引

    # 换车相关字段
    rebind_count = Column(Integer, nullable=True, default=0)  # 已换车次数
    rebind_limit = Column(Integer, nullable=True, default=3)  # 最大换车次数
    status = Column(String(20), nullable=True, default=RedeemCodeStatus.BOUND.value)  # 状态
    removed_at = Column(DateTime, nullable=True)  # 移除时间

    group = relationship("TeamGroup", back_populates="redeem_codes")
    creator = relationship("User", back_populates="redeem_codes")
    
    @property
    def user_expires_at(self) -> Optional[datetime]:
        """用户有效期（从激活开始计算）"""
        if self.activated_at:
            return self.activated_at + timedelta(days=self.validity_days)
        return None
    
    @property
    def is_user_expired(self) -> bool:
        """是否已过用户有效期"""
        if self.user_expires_at:
            return datetime.utcnow() > self.user_expires_at
        return False
    
    @property
    def remaining_days(self) -> Optional[int]:
        """剩余有效天数"""
        if self.user_expires_at:
            delta = self.user_expires_at - datetime.utcnow()
            return max(0, delta.days)
        return None

    @property
    def safe_rebind_count(self) -> int:
        """安全获取换车次数（处理 NULL）"""
        return self.rebind_count if self.rebind_count is not None else 0

    @property
    def safe_rebind_limit(self) -> int:
        """安全获取换车限制（处理 NULL）"""
        return self.rebind_limit if self.rebind_limit is not None else 3

    @property
    def safe_status(self) -> str:
        """安全获取状态（处理 NULL）"""
        return self.status if self.status else RedeemCodeStatus.BOUND.value

    @property
    def can_rebind(self) -> bool:
        """是否可以换车"""
        return self.safe_rebind_count < self.safe_rebind_limit and not self.is_user_expired


class LinuxDOUser(Base):
    """LinuxDO 用户 (保留用于历史数据，不再新增)"""
    __tablename__ = "linuxdo_users"
    
    id = Column(Integer, primary_key=True, index=True)
    linuxdo_id = Column(String(100), unique=True, nullable=False, index=True)
    username = Column(String(100), nullable=False)
    name = Column(String(100), nullable=True)
    email = Column(String(100), nullable=True)
    trust_level = Column(Integer, default=0)
    avatar_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, default=datetime.utcnow)


class SystemConfig(Base):
    """系统配置（存储 LinuxDO OAuth 等配置）"""
    __tablename__ = "system_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InviteQueueStatus(str, enum.Enum):
    PENDING = "pending"        # 等待发送
    PROCESSING = "processing"  # 正在处理
    SUCCESS = "success"        # 发送成功
    FAILED = "failed"          # 发送失败（最终失败，不再重试）
    WAITING = "waiting"        # 等待空位（座位满时进入等待队列）


class InviteQueue(Base):
    """邀请队列（超过每日限制的邀请进入队列）"""
    __tablename__ = "invite_queue"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False)
    redeem_code = Column(String(50), nullable=True)
    linuxdo_user_id = Column(Integer, ForeignKey("linuxdo_users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("team_groups.id"), nullable=True)  # 指定分组
    status = Column(Enum(InviteQueueStatus, values_callable=lambda x: [e.value for e in x]), default=InviteQueueStatus.PENDING, index=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    linuxdo_user = relationship("LinuxDOUser")
    group = relationship("TeamGroup")


class RebindHistory(Base):
    """换车历史记录"""
    __tablename__ = "rebind_history"

    id = Column(Integer, primary_key=True, index=True)
    redeem_code = Column(String(50), nullable=False, index=True)
    email = Column(String(100), nullable=False, index=True)
    from_team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    to_team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    reason = Column(String(50), nullable=False)  # user_requested, expired_cleanup, admin_action
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    from_team = relationship("Team", foreign_keys=[from_team_id])
    to_team = relationship("Team", foreign_keys=[to_team_id])


class VerificationPurpose(str, enum.Enum):
    """验证码用途"""
    DISTRIBUTOR_SIGNUP = "distributor_signup"


class VerificationCode(Base):
    """邮箱验证码"""
    __tablename__ = "verification_codes"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False, index=True)
    code_hash = Column(String(128), nullable=False)  # SHA-256 哈希
    purpose = Column(
        Enum(VerificationPurpose, values_callable=lambda x: [e.value for e in x]),
        nullable=False, index=True
    )
    expires_at = Column(DateTime, nullable=False, index=True)
    verified = Column(Boolean, default=False)
    attempt_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


# ============ 商业化功能：套餐和订单 ============

class OrderStatus(str, enum.Enum):
    """订单状态"""
    PENDING = "pending"      # 待支付
    PAID = "paid"            # 已支付
    EXPIRED = "expired"      # 已过期（超时未支付）
    REFUNDED = "refunded"    # 已退款


class Plan(Base):
    """套餐配置"""
    __tablename__ = "plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)              # 套餐名称
    price = Column(Integer, nullable=False)                 # 价格（分）
    original_price = Column(Integer, nullable=True)         # 原价（分），用于显示划线价
    validity_days = Column(Integer, nullable=False)         # 有效天数
    description = Column(String(255), nullable=True)        # 描述
    features = Column(Text, nullable=True)                  # 特性列表（JSON格式）
    is_active = Column(Boolean, default=True, index=True)   # 是否上架
    is_recommended = Column(Boolean, default=False)         # 是否推荐
    sort_order = Column(Integer, default=0)                 # 排序权重
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    orders = relationship("Order", back_populates="plan")


class Order(Base):
    """订单"""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(32), unique=True, nullable=False, index=True)  # 订单号
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=False)       # 套餐ID
    email = Column(String(100), nullable=False, index=True)                 # 联系邮箱（用于查询订单）
    amount = Column(Integer, nullable=False)                                 # 原始金额（分）
    coupon_code = Column(String(30), nullable=True)                         # 使用的优惠码
    discount_amount = Column(Integer, default=0)                            # 优惠金额（分）
    final_amount = Column(Integer, nullable=True)                           # 实付金额（分），为空则等于 amount
    status = Column(
        Enum(OrderStatus, values_callable=lambda x: [e.value for e in x]),
        default=OrderStatus.PENDING, index=True
    )
    redeem_code = Column(String(50), nullable=True, index=True)             # 生成的兑换码
    trade_no = Column(String(64), nullable=True)                            # 支付平台交易号
    pay_type = Column(String(20), nullable=True)                            # 支付方式 alipay/wxpay
    paid_at = Column(DateTime, nullable=True)                               # 支付时间
    expire_at = Column(DateTime, nullable=True)                             # 订单过期时间
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    plan = relationship("Plan", back_populates="orders")


# ============ 优惠码功能 ============

class DiscountType(str, enum.Enum):
    """折扣类型"""
    FIXED = "fixed"           # 固定金额（分）
    PERCENTAGE = "percentage"  # 百分比（如 20 表示 20%）


class Coupon(Base):
    """优惠码"""
    __tablename__ = "coupons"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)  # 优惠码
    discount_type = Column(
        Enum(DiscountType, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    discount_value = Column(Integer, nullable=False)      # 折扣值：分（固定）或百分比数值
    min_amount = Column(Integer, default=0)               # 最低消费（分），0=无门槛
    max_discount = Column(Integer, nullable=True)         # 最大优惠（分），用于百分比封顶
    max_uses = Column(Integer, default=0)                 # 最大使用次数，0=无限
    used_count = Column(Integer, default=0)               # 已使用次数
    valid_from = Column(DateTime, nullable=True)          # 生效开始时间
    valid_until = Column(DateTime, nullable=True)         # 生效结束时间
    applicable_plan_ids = Column(Text, nullable=True)     # 适用套餐ID（JSON数组），null=全部
    is_active = Column(Boolean, default=True, index=True)
    note = Column(String(255), nullable=True)             # 备注
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User")



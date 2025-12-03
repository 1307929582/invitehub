# Design Document: Commercial Refactor

## Overview

本次重构将 InviteHub 升级为商业版，核心变更包括：
1. 移除 LinuxDO OAuth，改为邮箱 + 兑换码直接上车
2. 兑换码 30 天有效期 + 换车机制
3. Dashboard 销售统计功能
4. 苹果风格用户界面重构

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
├─────────────────────────────────────────────────────────────┤
│  /invite/:code    │  /admin/dashboard  │  /admin/settings   │
│  (用户兑换页面)    │  (销售统计)         │  (价格配置)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (FastAPI)                       │
├─────────────────────────────────────────────────────────────┤
│  /api/v1/public/redeem     - 兑换码使用                      │
│  /api/v1/public/status     - 用户状态查询                    │
│  /api/v1/public/rebind     - 换车请求                        │
│  /api/v1/dashboard/revenue - 销售统计                        │
│  /api/v1/config/price      - 价格配置                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database (PostgreSQL)                     │
├─────────────────────────────────────────────────────────────┤
│  redeem_codes (新增字段)    │  invite_records (新增字段)     │
│  - activated_at            │  - is_rebind                   │
│  - bound_email             │                                │
│  - validity_days           │                                │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. 后端 API 变更

#### 1.1 移除的组件
- `routers/users.py` - LinuxDO 用户路由
- `public.py` 中的 LinuxDO OAuth 相关端点
- `LinuxDOUser` 模型引用

#### 1.2 新增/修改的端点

```python
# POST /api/v1/public/redeem
class RedeemRequest(BaseModel):
    email: EmailStr
    code: str

class RedeemResponse(BaseModel):
    success: bool
    message: str
    team_name: Optional[str]
    expires_at: Optional[datetime]
    remaining_days: Optional[int]

# GET /api/v1/public/status?email=xxx
class StatusResponse(BaseModel):
    found: bool
    email: Optional[str]
    team_name: Optional[str]
    team_active: Optional[bool]
    code: Optional[str]
    expires_at: Optional[datetime]
    remaining_days: Optional[int]
    can_rebind: Optional[bool]

# POST /api/v1/public/rebind
class RebindRequest(BaseModel):
    email: EmailStr
    code: str

class RebindResponse(BaseModel):
    success: bool
    message: str
    new_team_name: Optional[str]

# GET /api/v1/dashboard/revenue
class RevenueStats(BaseModel):
    today: float
    this_week: float
    this_month: float
    daily_trend: List[dict]  # [{date, count, revenue}]
    unit_price: float
```

### 2. 前端组件变更

#### 2.1 移除的组件
- `pages/LinuxDOUsers.tsx`
- `pages/Callback.tsx`
- `pages/Home.tsx` 中的 LinuxDO 登录逻辑

#### 2.2 新增/修改的组件

```
pages/
├── Invite.tsx          # 重构：苹果风格兑换页面
├── Dashboard.tsx       # 修改：新增销售统计卡片
└── settings/
    └── PriceSettings.tsx  # 新增：价格配置页面
```

## Data Models

### RedeemCode 模型变更

```python
class RedeemCode(Base):
    __tablename__ = "redeem_codes"
    
    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    code_type = Column(Enum(RedeemCodeType), default=RedeemCodeType.DIRECT)
    max_uses = Column(Integer, default=1)
    used_count = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)  # 管理员设置的过期时间
    is_active = Column(Boolean, default=True)
    note = Column(String(255), nullable=True)
    group_id = Column(Integer, ForeignKey("team_groups.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 新增字段
    validity_days = Column(Integer, default=30)      # 有效天数
    activated_at = Column(DateTime, nullable=True)   # 首次激活时间
    bound_email = Column(String(100), nullable=True) # 绑定邮箱
    
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
```

### InviteRecord 模型变更

```python
class InviteRecord(Base):
    __tablename__ = "invite_records"
    
    # ... 现有字段 ...
    
    # 新增字段
    is_rebind = Column(Boolean, default=False)  # 是否为换车操作
    
    # 移除字段
    # linuxdo_user_id - 不再需要
```

### SystemConfig 新增配置

```python
# 新增配置项
"redeem_unit_price" = "0.00"  # 兑换码单价
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Activation timestamp and expiration calculation
*For any* redeem code with validity_days V, when activated at time T, the user_expires_at should equal T + V days
**Validates: Requirements 2.1**

### Property 2: Expired code rejection
*For any* redeem code where current_time > user_expires_at, both redeem and rebind operations should be rejected with appropriate error message
**Validates: Requirements 2.2, 3.5**

### Property 3: Remaining days calculation
*For any* activated redeem code, remaining_days should equal max(0, (user_expires_at - current_time).days)
**Validates: Requirements 2.3**

### Property 4: Email binding consistency
*For any* redeem code, after first use with email E, the bound_email should equal E, and subsequent uses with different email should be rejected
**Validates: Requirements 4.1, 4.2**

### Property 5: Rebind operation integrity
*For any* valid rebind request (code not expired, team inactive), the system should: assign to a team with available seats, create invite record with is_rebind=true, and return new team information
**Validates: Requirements 3.1, 3.2, 3.3**

### Property 6: Revenue calculation accuracy
*For any* time period, revenue should equal count(activated_codes_in_period) * unit_price
**Validates: Requirements 5.2**

### Property 7: Status query completeness
*For any* email with active subscription, status query should return team_name, expires_at, remaining_days, and can_rebind flag
**Validates: Requirements 8.1**

## Error Handling

### 兑换错误码

| 错误码 | 描述 | 处理方式 |
|--------|------|----------|
| INVALID_CODE | 兑换码不存在或无效 | 提示用户检查兑换码 |
| CODE_EXPIRED | 兑换码已过期 | 显示过期时间 |
| CODE_USED_UP | 兑换码使用次数已满 | 提示联系管理员 |
| EMAIL_MISMATCH | 邮箱与绑定邮箱不匹配 | 显示绑定邮箱提示 |
| NO_AVAILABLE_TEAM | 没有可用的 Team | 提示稍后重试 |
| TEAM_STILL_ACTIVE | Team 仍然活跃，无法换车 | 提示当前 Team 正常 |

## Testing Strategy

### 单元测试
- 兑换码有效期计算逻辑
- 邮箱绑定验证逻辑
- 销售额计算逻辑

### Property-Based Testing
使用 `hypothesis` 库进行属性测试：

```python
# 测试框架配置
# pip install hypothesis

from hypothesis import given, strategies as st

# 每个属性测试运行 100+ 次迭代
```

### 集成测试
- 完整兑换流程测试
- 换车流程测试
- Dashboard 数据准确性测试

# 分销商系统优化实施计划

**生成日期**: 2025-12-19
**预计总工期**: 2-3 周
**参与角色**: 后端开发、前端开发、DBA、测试

---

## 📋 目录

- [P0: 严重 Bug 修复（立即执行）](#p0-严重-bug-修复立即执行)
- [P1: 性能与可扩展性优化（本周完成）](#p1-性能与可扩展性优化本周完成)
- [P2: UI/UX 体验升级（下周完成）](#p2-uiux-体验升级下周完成)
- [P3: 功能增强（后续迭代）](#p3-功能增强后续迭代)
- [数据迁移总方案](#数据迁移总方案)
- [风险评估与应对](#风险评估与应对)
- [验收标准](#验收标准)

---

## P0: 严重 Bug 修复（立即执行）

**工期**: 1 个工作日
**优先级**: 🔴 最高
**必须完成后才能进行其他优化**

---

### P0-1: 修复同步任务参数类型错误

**问题**: `sync_redeem_count_task` 期望 `int`，但传入了 `str`，导致 Redis → DB 同步失败。

**影响**: 所有分销商的销售统计不准确

**实施步骤**:

1. **定位问题代码**
```python
# backend/app/routers/public.py (约第 XXX 行)
# 搜索关键字: sync_redeem_count_task.delay

# 错误代码
sync_redeem_count_task.delay(code.code)  # ❌
```

2. **修复代码**
```python
# backend/app/routers/public.py
sync_redeem_count_task.delay(code.id)  # ✅ 传递 ID 而非 code 字符串
```

3. **验证测试**
```bash
# 1. 启动 Redis 和 Celery
docker-compose up -d redis
celery -A app.celery_app worker --loglevel=info

# 2. 测试兑换流程
curl -X POST http://localhost:18000/api/v1/public/redeem \
  -H "Content-Type: application/json" \
  -d '{"code": "TEST123", "email": "test@example.com"}'

# 3. 检查 Celery 日志，确认任务执行成功
# 4. 检查数据库，确认 used_count 正确更新
```

**回滚预案**: 使用 git revert

**工作量**: 0.5 小时

---

### P0-2: 修复并发安全问题（移除成员）

**问题**: `used_count -= 1` 是非原子操作，并发下会丢失更新

**影响**: 兑换码次数恢复不准确

**实施步骤**:

1. **定位问题代码**
```python
# backend/app/routers/distributors.py (约第 471 行)
if redeem_code and redeem_code.used_count > 0:
    redeem_code.used_count -= 1  # ❌ 非原子操作
```

2. **修复代码**
```python
# backend/app/routers/distributors.py
from sqlalchemy import text

# 替换为原子更新
db.execute(
    text("""
        UPDATE redeem_codes
        SET used_count = GREATEST(used_count - 1, 0)
        WHERE id = :code_id
    """),
    {"code_id": redeem_code.id}
)
db.flush()  # 确保立即执行
```

3. **并发压测**
```python
# tests/concurrent_test.py
import concurrent.futures
import requests

def remove_member():
    response = requests.post(
        "http://localhost:18000/api/v1/distributors/me/members/remove",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": "test@example.com", "team_id": 1}
    )
    return response.status_code

# 并发执行 10 次
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(lambda _: remove_member(), range(10)))

# 验证数据库中 used_count 正确（应该只减少 1，而不是 10）
```

**回滚预案**: 使用 git revert

**工作量**: 1 小时

---

### P0-3: 修复字段名错误（chatgpt_account_id）

**问题**: 调用不存在的字段导致运行时错误

**影响**: 移除成员功能完全不可用

**实施步骤**:

1. **定位问题代码**
```python
# backend/app/routers/distributors.py (约第 454 行)
result = await api.remove_member(team.chatgpt_account_id, ...)  # ❌
```

2. **修复代码**
```python
# backend/app/routers/distributors.py
result = await api.remove_member(team.account_id, team_member.chatgpt_user_id)  # ✅
```

3. **验证测试**
```bash
# 手动测试移除成员功能
curl -X POST http://localhost:18000/api/v1/distributors/me/members/remove \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "team_id": 1, "reason": "测试"}'

# 预期：成功返回 200，成员被移除
```

**回滚预案**: 使用 git revert

**工作量**: 0.5 小时

---

### P0 阶段总结

**完成标志**:
- [ ] 所有 3 个 Bug 修复完成
- [ ] 通过单元测试
- [ ] 通过并发压测
- [ ] 部署到生产环境

**风险**: 低（代码改动量小，影响范围明确）

---

## P1: 性能与可扩展性优化（本周完成）

**工期**: 5 个工作日
**优先级**: 🟠 高
**依赖**: P0 完成后开始

---

### P1-1: 优化大 IN 列表查询（核心优化）

**问题**: `IN (code_list)` 在 10万+ 兑换码时性能崩溃

**影响**: `/distributors/me/sales`、`/distributors/me/members` 等接口超时

**实施方案**: 两阶段实施

#### 阶段 1: JOIN 优化（短期方案，2天）

**优势**: 无需数据迁移，立即生效
**劣势**: 仍需维护 JOIN，性能提升有限（约 5x）

**实施步骤**:

1. **修改 `/distributors/me/sales` 接口**

```python
# backend/app/routers/distributors.py (约第 203 行)

# 当前代码（❌ 性能差）
my_codes = db.query(RedeemCode.code).filter(
    RedeemCode.created_by == current_user.id
).all()
my_codes_list = [c.code for c in my_codes]

records = db.query(InviteRecord).filter(
    InviteRecord.redeem_code.in_(my_codes_list)  # ❌ 大 IN
).order_by(InviteRecord.created_at.desc()).limit(limit).all()

# 优化后代码（✅ 使用 JOIN）
records = db.query(InviteRecord).join(
    RedeemCode,
    InviteRecord.redeem_code == RedeemCode.code
).filter(
    RedeemCode.created_by == current_user.id  # ✅ 直接过滤
).order_by(
    InviteRecord.created_at.desc()
).limit(limit).all()
```

2. **修改 `/distributors/me/members` 接口**

```python
# backend/app/routers/distributors.py (约第 341 行)

# 当前代码（❌）
my_codes = db.query(RedeemCode).filter(...).all()
my_codes_list = [c.code for c in my_codes]
records = db.query(InviteRecord).filter(
    InviteRecord.redeem_code.in_(my_codes_list),
    InviteRecord.status == InviteStatus.SUCCESS
).all()

# 优化后代码（✅）
records = db.query(InviteRecord).join(
    RedeemCode,
    InviteRecord.redeem_code == RedeemCode.code
).filter(
    RedeemCode.created_by == current_user.id,
    InviteRecord.status == InviteStatus.SUCCESS
).all()
```

3. **修改 `/distributors/{id}/sales` 接口（管理员查看）**

```python
# backend/app/routers/distributors.py (约第 254 行)
# 同样的优化思路
```

4. **性能测试**

```python
# tests/performance_test.py
import time

def test_sales_query_performance():
    # 准备测试数据：10万个兑换码
    # 测试优化前后的查询时间

    start = time.time()
    response = client.get("/api/v1/distributors/me/sales")
    duration = time.time() - start

    assert duration < 1.0  # 要求 1 秒内返回
    assert response.status_code == 200
```

**工作量**: 2 天

---

#### 阶段 2: 冗余字段（长期方案，3天）

**优势**: 查询性能最优（10x+），无需 JOIN
**劣势**: 需要数据迁移，写入时需维护冗余

**实施步骤**:

1. **创建数据库迁移**

```python
# backend/alembic/versions/xxxx_add_distributor_id_to_invite.py
"""add distributor_id to invite_records

Revision ID: xxxx
Revises: yyyy
Create Date: 2025-12-20

"""
from alembic import op
import sqlalchemy as sa


def upgrade():
    # 1. 添加字段（允许 NULL）
    op.add_column('invite_records',
        sa.Column('distributor_id', sa.Integer(), nullable=True)
    )

    # 2. 回填历史数据
    op.execute("""
        UPDATE invite_records ir
        SET distributor_id = (
            SELECT rc.created_by
            FROM redeem_codes rc
            WHERE rc.code = ir.redeem_code
        )
        WHERE ir.distributor_id IS NULL
    """)

    # 3. 设置为 NOT NULL
    op.alter_column('invite_records', 'distributor_id', nullable=False)

    # 4. 添加索引
    op.create_index(
        'ix_invite_records_distributor_id',
        'invite_records',
        ['distributor_id']
    )

    # 5. 添加外键（可选）
    op.create_foreign_key(
        'fk_invite_records_distributor',
        'invite_records', 'users',
        ['distributor_id'], ['id']
    )


def downgrade():
    op.drop_constraint('fk_invite_records_distributor', 'invite_records')
    op.drop_index('ix_invite_records_distributor_id', 'invite_records')
    op.drop_column('invite_records', 'distributor_id')
```

2. **更新模型**

```python
# backend/app/models.py
class InviteRecord(Base):
    __tablename__ = "invite_records"

    # ... 现有字段

    # 新增字段
    distributor_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)

    # 关系
    distributor = relationship("User", foreign_keys=[distributor_id])
```

3. **更新写入逻辑**

```python
# backend/app/routers/public.py (兑换时写入 distributor_id)
redeem_code = db.query(RedeemCode).filter(...).first()

invite_record = InviteRecord(
    email=email,
    redeem_code=code,
    distributor_id=redeem_code.created_by,  # ✅ 冗余字段
    # ... 其他字段
)
```

4. **更新查询逻辑**

```python
# backend/app/routers/distributors.py

# 优化后的查询（✅ 最优性能）
records = db.query(InviteRecord).filter(
    InviteRecord.distributor_id == current_user.id  # ✅ 单字段查询
).order_by(
    InviteRecord.created_at.desc()
).limit(limit).all()
```

5. **数据一致性验证**

```sql
-- 验证回填是否正确
SELECT
    COUNT(*) AS total,
    COUNT(distributor_id) AS filled,
    COUNT(*) - COUNT(distributor_id) AS missing
FROM invite_records;

-- 预期：missing = 0

-- 验证数据准确性（抽样检查）
SELECT ir.id, ir.redeem_code, ir.distributor_id, rc.created_by
FROM invite_records ir
JOIN redeem_codes rc ON ir.redeem_code = rc.code
WHERE ir.distributor_id != rc.created_by;

-- 预期：0 行
```

**工作量**: 3 天

---

### P1-2: 添加必要的数据库索引

**问题**: 缺少关键索引导致查询慢

**实施步骤**:

```python
# backend/alembic/versions/xxxx_add_distributor_indexes.py
"""add distributor indexes

Revision ID: xxxx
Create Date: 2025-12-20

"""
from alembic import op


def upgrade():
    # 1. redeem_codes.created_by（用于过滤分销商的码）
    op.create_index(
        'ix_redeem_codes_created_by',
        'redeem_codes',
        ['created_by']
    )

    # 2. invite_records 复合索引（用于销售记录查询）
    op.create_index(
        'ix_invite_records_redeem_code_status_created_at',
        'invite_records',
        ['redeem_code', 'status', 'created_at']
    )

    # 3. orders.buyer_user_id（用于分销商订单查询）
    op.create_index(
        'ix_orders_buyer_user_id',
        'orders',
        ['buyer_user_id']
    )


def downgrade():
    op.drop_index('ix_orders_buyer_user_id', 'orders')
    op.drop_index('ix_invite_records_redeem_code_status_created_at', 'invite_records')
    op.drop_index('ix_redeem_codes_created_by', 'redeem_codes')
```

**执行迁移**:

```bash
# 1. 生成迁移文件
cd backend
alembic revision -m "add_distributor_indexes"

# 2. 在生产环境执行（非高峰期）
alembic upgrade head

# 3. 验证索引创建成功
psql -U user -d invitehub -c "\d+ redeem_codes"
psql -U user -d invitehub -c "\d+ invite_records"
```

**工作量**: 0.5 天

---

### P1-3: 统一统计口径

**问题**: `used_count` 不等于"成功邀请"或"用户接受"

**实施步骤**:

1. **定义新的统计口径**

```python
# backend/app/routers/distributors.py

@router.get("/me/summary", response_model=DistributorSummaryResponse)
async def get_my_summary(...):
    # 口径 1: 兑换尝试次数（扣次数）
    redeem_attempts = db.query(
        func.coalesce(func.sum(RedeemCode.used_count), 0)
    ).filter(RedeemCode.created_by == current_user.id).scalar()

    # 口径 2: 邀请发送成功（✅ 新增）
    invites_sent_success = db.query(InviteRecord).join(
        RedeemCode, InviteRecord.redeem_code == RedeemCode.code
    ).filter(
        RedeemCode.created_by == current_user.id,
        InviteRecord.status == InviteStatus.SUCCESS
    ).count()

    # 口径 3: 用户接受邀请（✅ 新增）
    invites_accepted = db.query(InviteRecord).join(
        RedeemCode, InviteRecord.redeem_code == RedeemCode.code
    ).filter(
        RedeemCode.created_by == current_user.id,
        InviteRecord.accepted_at.isnot(None)
    ).count()

    # 预估收益应基于"接受"而非"扣次数"
    total_revenue = float(invites_accepted) * unit_price

    return DistributorSummaryResponse(
        redeem_attempts=int(redeem_attempts),
        invites_sent_success=invites_sent_success,
        invites_accepted=invites_accepted,
        total_revenue_estimate=round(total_revenue, 2),
        # ... 其他字段
    )
```

2. **更新前端显示**

```tsx
// frontend/src/pages/distributor/DistributorDashboard.tsx

<Row gutter={[16, 16]}>
  <Col xs={24} sm={12} lg={6}>
    <Card hoverable>
      <Statistic
        title="兑换尝试"  // 原 "总销售次数"
        value={summary?.redeem_attempts || 0}
        prefix={<ShoppingCartOutlined />}
      />
    </Card>
  </Col>
  <Col xs={24} sm={12} lg={6}>
    <Card hoverable>
      <Statistic
        title="成功邀请"  // ✅ 新增
        value={summary?.invites_sent_success || 0}
        prefix={<CheckCircleOutlined />}
      />
    </Card>
  </Col>
  <Col xs={24} sm={12} lg={6}>
    <Card hoverable>
      <Statistic
        title="用户接受"  // ✅ 新增
        value={summary?.invites_accepted || 0}
        prefix={<UserAddOutlined />}
      />
    </Card>
  </Col>
  <Col xs={24} sm={12} lg={6}>
    <Card hoverable>
      <Statistic
        title="预估收益"
        value={summary?.total_revenue_estimate || 0}
        precision={2}
        prefix={<DollarOutlined />}
        suffix="元"
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        基于用户接受数计算
      </Text>
    </Card>
  </Col>
</Row>
```

**工作量**: 1 天

---

### P1-4: 异步发码（支付回调优化）

**问题**: 同步发码导致支付回调超时

**实施步骤**:

1. **添加订单履约状态字段**

```python
# backend/alembic/versions/xxxx_add_order_fulfillment.py
from alembic import op
import sqlalchemy as sa

def upgrade():
    # 添加履约状态
    op.add_column('orders',
        sa.Column('fulfillment_status',
                  sa.String(20),
                  nullable=False,
                  server_default='pending')
    )
    # pending / processing / completed / failed

    # 添加已发码数量
    op.add_column('orders',
        sa.Column('delivered_count',
                  sa.Integer(),
                  nullable=False,
                  server_default='0')
    )

    # 添加履约错误信息
    op.add_column('orders',
        sa.Column('fulfillment_error',
                  sa.Text(),
                  nullable=True)
    )

def downgrade():
    op.drop_column('orders', 'fulfillment_error')
    op.drop_column('orders', 'delivered_count')
    op.drop_column('orders', 'fulfillment_status')
```

2. **创建 Celery 发码任务**

```python
# backend/app/tasks_celery.py

@celery_app.task(bind=True, max_retries=3)
def fulfill_distributor_order(self, order_id: int):
    """异步履约分销商订单（发放兑换码）"""
    from app.database import SessionLocal
    from app.models import Order, Plan, RedeemCode
    import secrets
    import string

    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return {"error": "Order not found"}

        # 防止重复履约
        if order.fulfillment_status == 'completed':
            return {"message": "Already fulfilled"}

        # 更新状态为处理中
        order.fulfillment_status = 'processing'
        db.commit()

        plan = db.query(Plan).filter(Plan.id == order.plan_id).first()
        total_codes = (plan.code_count or 1) * order.quantity

        # 计算过期时间
        expires_at = None
        if plan.expires_days:
            expires_at = datetime.utcnow() + timedelta(days=plan.expires_days)

        # 批量生成兑换码
        generated = 0
        for i in range(total_codes):
            for retry in range(10):
                chars = string.ascii_uppercase + string.digits
                code_str = f"ORD{order.id}_" + "".join(secrets.choice(chars) for _ in range(8))

                try:
                    with db.begin_nested():
                        redeem_code = RedeemCode(
                            code=code_str,
                            code_type=RedeemCodeType.DIRECT,
                            max_uses=plan.code_max_uses or 1,
                            expires_at=expires_at,
                            validity_days=plan.validity_days,
                            note=f"订单 {order.order_no}",
                            is_active=True,
                            created_by=order.buyer_user_id,
                        )
                        db.add(redeem_code)
                        db.flush()
                        generated += 1
                        break
                except IntegrityError:
                    continue

            # 每 100 个更新一次进度
            if generated % 100 == 0:
                order.delivered_count = generated
                db.commit()

        # 全部完成
        order.delivered_count = generated
        order.fulfillment_status = 'completed'
        db.commit()

        return {"generated": generated}

    except Exception as e:
        order.fulfillment_status = 'failed'
        order.fulfillment_error = str(e)
        db.commit()
        raise self.retry(exc=e, countdown=60)
    finally:
        db.close()
```

3. **修改支付回调逻辑**

```python
# backend/app/routers/shop.py

@router.post("/notify")
async def payment_notify(...):
    # ... 验签等逻辑

    # 标记订单已支付
    order.status = OrderStatus.PAID
    order.paid_at = datetime.utcnow()
    db.commit()

    # 🔥 关键改动：投递异步任务，立即返回
    if order.order_type == "distributor_codes":
        from app.tasks_celery import fulfill_distributor_order
        fulfill_distributor_order.delay(order.id)

    return {"code": 1, "msg": "success"}  # ✅ 立即返回，不等待发码
```

4. **前端轮询订单状态**

```tsx
// frontend/src/pages/distributor/DistributorRedeemCodes.tsx

// 购买成功后，轮询订单状态
const pollOrderStatus = (orderNo: string) => {
  const interval = setInterval(async () => {
    const orders = await distributorApi.getMyCodeOrders()
    const order = orders.find(o => o.order_no === orderNo)

    if (order?.fulfillment_status === 'completed') {
      clearInterval(interval)
      message.success(`兑换码已发放完成！共 ${order.delivered_count} 个`)
      fetchCodes()  // 刷新列表
    } else if (order?.fulfillment_status === 'failed') {
      clearInterval(interval)
      message.error('发码失败，请联系客服')
    }
  }, 3000)

  // 最多轮询 5 分钟
  setTimeout(() => clearInterval(interval), 300000)
}
```

**工作量**: 2 天

---

### P1 阶段总结

**完成标志**:
- [ ] 大 IN 查询优化完成（阶段 1 或阶段 2）
- [ ] 所有索引添加完成
- [ ] 统计口径统一
- [ ] 异步发码上线
- [ ] 性能测试通过（响应时间 < 1秒）
- [ ] 部署到生产环境

**风险**: 中（涉及数据迁移，需要充分测试）

---

## P2: UI/UX 体验升级（下周完成）

**工期**: 3 个工作日
**优先级**: 🟡 中
**依赖**: P1 完成后开始

---

### P2-1: 配色方案现代化

**实施步骤**:

```tsx
// frontend/src/pages/distributor/DistributorLayout.tsx

<Sider
  style={{
    background: '#001529'  // ✅ 改为 Ant Design 官方深色
  }}
>
  {/* 侧边栏内容 */}
</Sider>
```

**工作量**: 0.5 天

---

### P2-2: 简化链接复制操作

```tsx
// frontend/src/pages/distributor/DistributorRedeemCodes.tsx

// 替换当前的两个按钮
<Dropdown.Button
  type="primary"
  onClick={() => copyLink(record.code, true)}
  menu={{
    items: [
      {
        key: 'official',
        icon: <LinkOutlined />,
        label: '复制官方链接（显示价格）',
        onClick: () => copyLink(record.code, false)
      }
    ]
  }}
>
  复制邀请链接
</Dropdown.Button>
```

**工作量**: 0.5 天

---

### P2-3: Dashboard 数据可视化升级（核心）

**实施步骤**:

1. **安装依赖**
```bash
cd frontend
npm install @ant-design/charts
```

2. **实现趋势图**

```tsx
// frontend/src/pages/distributor/DistributorDashboard.tsx
import { Line, Pie, Bar } from '@ant-design/charts';

// 新增 API 调用
const fetchTrendData = async () => {
  const res = await distributorApi.getSalesTrend(30)  // 30天趋势
  return res
}

// 渲染趋势图
<Card title="销售趋势（最近30天）" style={{ marginTop: 24 }}>
  <Line
    data={trendData}
    xField="date"
    yField="count"
    point={{
      size: 5,
      shape: 'diamond',
    }}
    label={{
      style: {
        fill: '#aaa',
      },
    }}
  />
</Card>

// 状态分布饼图
<Row gutter={16} style={{ marginTop: 24 }}>
  <Col span={12}>
    <Card title="兑换码状态分布">
      <Pie
        data={[
          { type: '未使用', value: summary?.active_codes || 0 },
          { type: '已用完', value: summary?.depleted_codes || 0 },
          { type: '已禁用', value: summary?.inactive_codes || 0 },
        ]}
        angleField="value"
        colorField="type"
        radius={0.8}
        label={{
          type: 'inner',
          content: '{percentage}',
        }}
      />
    </Card>
  </Col>
  <Col span={12}>
    <Card title="套餐销售排行">
      <Bar
        data={planSalesData}
        xField="count"
        yField="plan_name"
        seriesField="plan_name"
      />
    </Card>
  </Col>
</Row>
```

3. **后端增加趋势 API**

```python
# backend/app/routers/distributors.py

@router.get("/me/sales-trend")
async def get_my_sales_trend(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DISTRIBUTOR))
):
    """获取销售趋势数据（最近N天）"""
    from datetime import timedelta

    start_date = datetime.utcnow() - timedelta(days=days)

    # 按天聚合
    trend = db.query(
        func.date(InviteRecord.created_at).label('date'),
        func.count(InviteRecord.id).label('count')
    ).join(
        RedeemCode, InviteRecord.redeem_code == RedeemCode.code
    ).filter(
        RedeemCode.created_by == current_user.id,
        InviteRecord.created_at >= start_date
    ).group_by(
        func.date(InviteRecord.created_at)
    ).order_by('date').all()

    return [{"date": str(t.date), "count": t.count} for t in trend]
```

**工作量**: 2 天

---

### P2-4: 购买流程升级为 Drawer

```tsx
// frontend/src/pages/distributor/DistributorRedeemCodes.tsx

<Drawer
  title="购买兑换码"
  width={720}
  open={purchaseDrawerVisible}
  onClose={closePurchaseDrawer}
  footer={
    <Space>
      <Button onClick={closePurchaseDrawer}>取消</Button>
      {currentStep > 0 && <Button onClick={prevStep}>上一步</Button>}
      {currentStep < 2 && <Button type="primary" onClick={nextStep}>下一步</Button>}
      {currentStep === 2 && <Button type="primary" onClick={handlePurchase}>确认支付</Button>}
    </Space>
  }
>
  <Steps current={currentStep} style={{ marginBottom: 24 }}>
    <Steps.Step title="选择套餐" />
    <Steps.Step title="确认订单" />
    <Steps.Step title="支付" />
  </Steps>

  {currentStep === 0 && <SelectPlanStep />}
  {currentStep === 1 && <ConfirmOrderStep />}
  {currentStep === 2 && <PaymentStep />}
</Drawer>
```

**工作量**: 1 天

---

### P2 阶段总结

**完成标志**:
- [ ] 配色更新完成
- [ ] 链接复制简化完成
- [ ] Dashboard 图表上线
- [ ] 购买流程优化完成
- [ ] UI/UX 设计评审通过
- [ ] 部署到生产环境

**风险**: 低（仅前端改动）

---

## P3: 功能增强（后续迭代）

**工期**: 10 个工作日
**优先级**: 🟢 低
**依赖**: P2 完成后开始

由于篇幅限制，P3 功能增强的详细实施计划可另外生成。主要包括：

- 白标定制化增强（Logo、欢迎语）
- CRM Lite（备注、标签）
- 财务结算中心
- 导出功能
- 防骚扰机制

---

## 数据迁移总方案

### 迁移清单

| 序号 | 迁移项 | 影响表 | 风险等级 | 回滚难度 |
|-----|--------|--------|---------|---------|
| 1 | 添加索引 | redeem_codes, invite_records, orders | 低 | 容易 |
| 2 | 添加 distributor_id | invite_records | 中 | 中等 |
| 3 | 添加 fulfillment_status | orders | 低 | 容易 |

### 执行流程

```bash
# 1. 备份数据库
pg_dump -U user invitehub > backup_20251220.sql

# 2. 在测试环境执行迁移
export DATABASE_URL="postgresql://test_user:pass@localhost/invitehub_test"
alembic upgrade head

# 3. 验证迁移
psql -U user -d invitehub_test -c "SELECT * FROM alembic_version;"

# 4. 在生产环境执行（非高峰期）
# 预计时间：10万记录约 5-10 分钟
export DATABASE_URL="postgresql://prod_user:pass@localhost/invitehub"
alembic upgrade head

# 5. 验证数据一致性
python scripts/verify_migration.py
```

### 回滚方案

```bash
# 如果迁移失败，回滚到上一个版本
alembic downgrade -1

# 或恢复数据库备份
psql -U user -d invitehub < backup_20251220.sql
```

---

## 风险评估与应对

| 风险项 | 可能性 | 影响 | 应对措施 |
|-------|-------|------|---------|
| P0 修复引入新 Bug | 低 | 高 | 充分单元测试，代码 Review |
| 数据迁移失败 | 中 | 高 | 测试环境预演，备份数据库 |
| 性能优化效果不明显 | 中 | 中 | 分阶段实施，先 JOIN 后冗余 |
| 异步发码任务堆积 | 低 | 中 | 监控队列长度，增加 Worker |
| 前端改动用户不适应 | 低 | 低 | 灰度发布，收集反馈 |

---

## 验收标准

### 功能验收

- [ ] P0: 所有 3 个 Bug 修复完成，通过测试
- [ ] P1: 查询性能提升 5x 以上
- [ ] P1: 异步发码成功率 > 99%
- [ ] P2: Dashboard 图表正确展示
- [ ] P2: 新 UI 通过设计评审

### 性能验收

- [ ] `/distributors/me/sales` 响应时间 < 1秒（10万码场景）
- [ ] `/distributors/me/summary` 响应时间 < 500ms
- [ ] 支付回调响应时间 < 2秒

### 稳定性验收

- [ ] 并发压测通过（100 并发，无数据不一致）
- [ ] Celery 任务成功率 > 99%
- [ ] 无内存泄漏、无死锁

---

## 总工期与里程碑

| 阶段 | 工期 | 完成日期 | 里程碑 |
|-----|------|---------|--------|
| P0 | 1 天 | 2025-12-20 | Bug 修复完成 |
| P1 | 5 天 | 2025-12-27 | 性能优化完成 |
| P2 | 3 天 | 2025-12-31 | UI 升级完成 |
| P3 | 10 天 | 2026-01-14 | 功能增强完成 |

**总计**: 19 个工作日（约 3-4 周）

---

## 附录

### A. 性能测试脚本

详见 `tests/performance/`

### B. 并发测试脚本

详见 `tests/concurrent/`

### C. 数据一致性验证脚本

详见 `scripts/verify_migration.py`

### D. 监控指标

- Celery 队列长度
- API 响应时间（P95, P99）
- 数据库慢查询日志
- 错误率

---

**文档版本**: v1.0
**最后更新**: 2025-12-19
**维护者**: 开发团队

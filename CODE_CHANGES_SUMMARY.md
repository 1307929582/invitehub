# 代码变更总结 - Team 状态管理和换车逻辑优化

## 📊 变更统计

### 修改的文件
- **后端**: 10 个文件
- **前端**: 2 个文件
- **测试**: 1 个文件
- **文档**: 2 个文件

### 代码行数变更
- **新增**: ~500 行
- **修改**: ~100 行
- **删除**: ~20 行

---

## 🔄 详细变更清单

### 第一阶段：修复分配逻辑（P0 严重 Bug）

#### backend/app/services/seat_calculator.py
```diff
- from app.models import Team, TeamMember, InviteRecord, InviteStatus
+ from app.models import Team, TeamMember, InviteRecord, InviteStatus, TeamStatus

- if only_active:
-     team_query = team_query.filter(Team.is_active == True)
+ if only_active:
+     team_query = team_query.filter(
+         Team.is_active == True,
+         Team.status == TeamStatus.ACTIVE
+     )
```

**影响**: 所有自动分配逻辑现在统一过滤不健康的 Team

#### backend/app/main.py
```diff
- teams_list = db.query(Team).filter(Team.is_active == True).all()
+ teams_list = db.query(Team).filter(
+     Team.is_active == True,
+     Team.status == TeamStatus.ACTIVE
+ ).all()
```

**影响**: 定时同步和告警只处理健康 Team，减少无效 API 调用

#### backend/app/routers/teams.py
```diff
- teams_list = db.query(Team).filter(Team.is_active == True).all()
+ teams_list = db.query(Team).filter(
+     Team.is_active == True,
+     Team.status == TeamStatus.ACTIVE
+ ).all()
```

**影响**: 待处理邀请查询不访问不健康的 Team

#### backend/app/tasks.py
```diff
+ # 2. 二次校验 Team 健康状态（防止竞态）
+ if not team.is_active or team.status != TeamStatus.ACTIVE:
+     logger.warning(f"Team is no longer healthy, skipping")
+     # 进入等待队列
+     ...
```

**影响**: 修复关键竞态窗口（分配后、发邀请前状态变更）

#### backend/app/routers/public.py
```diff
- can_rebind = not team.is_active and not redeem_code.is_user_expired
+ team_healthy = team.is_active and team.status == TeamStatus.ACTIVE
+ can_rebind = not team_healthy and not redeem_code.is_user_expired
```

**影响**: can_rebind 现在正确判断 Team 健康状态

#### backend/app/routers/telegram_bot.py
```diff
- teams_list = db.query(Team).filter(Team.is_active == True).order_by(Team.id).all()
- for team in teams_list:
-     count = db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
-     if count < team.max_seats:
-         target_team = team
-         break
+ from app.services.seat_calculator import get_all_teams_with_seats
+ teams_with_seats = get_all_teams_with_seats(db, group_id=None, only_active=True)
+ for team_info in teams_with_seats:
+     if team_info.available_seats > 0:
+         target_team = db.query(Team).filter(Team.id == team_info.team_id).first()
+         break
```

**影响**: Telegram Bot 也使用统一的健康检查和精确座位计算

---

### 第二阶段：Team 状态批量管理

#### backend/app/schemas.py
```diff
+ class TeamBulkStatusUpdate(BaseModel):
+     """批量更新 Team 状态"""
+     team_ids: List[int]
+     status: TeamStatus
+     status_message: Optional[str] = None
+
+ class TeamBulkStatusResponse(BaseModel):
+     """批量更新响应"""
+     success_count: int
+     failed_count: int
+     failed_teams: List[dict] = []
```

#### backend/app/routers/teams.py
```diff
+ @router.patch("/status/bulk", response_model=TeamBulkStatusResponse)
+ async def bulk_update_team_status(
+     data: TeamBulkStatusUpdate,
+     db: Session = Depends(get_db),
+     current_user: User = Depends(get_current_user)
+ ):
+     """批量更新 Team 状态"""
+     ...
```

**新增功能**: 批量修改 Team 状态 API

---

### 第三阶段：优化换车逻辑

#### backend/app/routers/public.py - _do_rebind 函数
```diff
+ # 5. 检测原 Team 健康状态，决定是否消耗换车次数
+ consume_rebind_count = True
+ old_team_chatgpt_user_id = None
+
+ if current_team:
+     # Team 不健康（BANNED 或 TOKEN_INVALID）则免费换车
+     if current_team.status in [TeamStatus.BANNED, TeamStatus.TOKEN_INVALID]:
+         consume_rebind_count = False
+
+     # 获取 chatgpt_user_id 用于踢人
+     member = db.query(TeamMember).filter(...).first()
+     if member:
+         old_team_chatgpt_user_id = member.chatgpt_user_id

+ # 6. 免费换车绕过上限
+ if consume_rebind_count and not redeem_code.can_rebind:
+     raise HTTPException(...)

- # 7. 增加换车计数
- result = db.execute(update(RedeemCode)...)
+ # 8. 只有付费换车才增加计数
+ if consume_rebind_count:
+     result = db.execute(update(RedeemCode)...)
+ else:
+     db.commit()  # 免费换车

+ # 10. 传递踢人参数给 Celery
+ process_invite_task.delay(
+     email=email,
+     ...
+     consume_rebind_count=consume_rebind_count,
+     old_team_id=current_team_id,
+     old_team_chatgpt_user_id=old_team_chatgpt_user_id
+ )
```

**核心变更**：
1. 封禁车免费换
2. 免费换车绕过上限
3. 传递踢人参数

#### backend/app/tasks_celery.py
```diff
def process_invite_task(
    self,
    email: str,
    redeem_code: str,
    group_id: int = None,
    is_rebind: bool = False,
+   consume_rebind_count: bool = False,  # 是否消耗次数
+   old_team_id: int = None,  # 原 Team ID
+   old_team_chatgpt_user_id: str = None  # 原 chatgpt_user_id
):

- def _rollback_redeem_code_usage(db, code_str, email, is_rebind):
+ def _rollback_redeem_code_usage(db, code_str, email, is_rebind, consume_rebind_count: bool = False):
    ...
-   if is_rebind and code and code.rebind_count > 0:
+   if is_rebind and consume_rebind_count and code and code.rebind_count > 0:
        # 只回滚付费换车
```

**核心变更**：
1. 任务签名增加新参数
2. 回滚逻辑修复（只回滚付费换车）

#### backend/app/tasks.py
```diff
+ # 换车操作：邀请成功后，踢出原 Team（先邀再踢）
+ for task in tasks_to_process:
+     if task.is_rebind and task.old_team_id and task.old_team_chatgpt_user_id:
+         try:
+             await _remove_from_old_team(db, task, team.name)
+         except Exception as kick_err:
+             logger.error(f"Failed to kick: {kick_err}")

+ async def _remove_from_old_team(db, task, new_team_name: str):
+     """从原 Team 踢出用户"""
+     old_team = db.query(Team).filter(Team.id == task.old_team_id).first()
+     api = ChatGPTAPI(old_team.session_token, old_team.device_id or "")
+     await api.remove_member(old_team.account_id, task.old_team_chatgpt_user_id)
+     # 删除本地缓存
+     db.query(TeamMember).filter(...).delete()
```

**核心变更**：
1. 邀请成功后自动踢人
2. 新增踢人函数

#### backend/app/services/batch_allocator.py
```diff
@dataclass
class InviteTask:
    email: str
    redeem_code: str
    group_id: Optional[int] = None
    is_rebind: bool = False
+   consume_rebind_count: bool = False
+   old_team_id: Optional[int] = None
+   old_team_chatgpt_user_id: Optional[str] = None
```

---

### 第四阶段：前端 UI

#### frontend/src/api/index.ts
```diff
+ updateStatusBulk: (data: { team_ids: number[]; status: TeamStatus; status_message?: string }) =>
+   api.patch('/teams/status/bulk', data),
```

#### frontend/src/pages/Teams.tsx
```diff
+ // 批量状态修改模态框状态
+ const [bulkStatusModalOpen, setBulkStatusModalOpen] = useState(false)
+ const [bulkTargetStatus, setBulkTargetStatus] = useState<TeamStatus | undefined>()
+ const [bulkStatusReason, setBulkStatusReason] = useState('')
+ const [bulkStatusLoading, setBulkStatusLoading] = useState(false)

+ // 批量状态修改处理函数
+ const handleBulkStatusUpdate = async () => { ... }

+ // 批量操作菜单增加状态修改项
+ const bulkActionItems = [
+   {
+     key: 'status',
+     label: '批量修改状态',
+     icon: <SafetyOutlined />,
+     onClick: () => setBulkStatusModalOpen(true)
+   },
+   ...
+ ]

+ {/* 批量状态修改模态框 */}
+ <Modal title="批量修改 Team 状态" ...>
+   <Select value={bulkTargetStatus} onChange={setBulkTargetStatus}>
+     <Select.Option value="active">正常</Select.Option>
+     <Select.Option value="banned">封禁</Select.Option>
+     <Select.Option value="token_invalid">Token失效</Select.Option>
+     <Select.Option value="paused">暂停</Select.Option>
+   </Select>
+   <TextArea placeholder="变更原因（可选）" />
+ </Modal>
```

**新增功能**：
1. 批量状态修改 UI
2. 确认对话框
3. 危险操作警告

---

### 第五阶段：监控告警

#### backend/app/metrics.py
```diff
+ # 孤儿用户数量（同时在多个 Team 的用户）
+ orphan_users_count = Gauge(
+     'orphan_users_count',
+     'Number of users present in multiple teams simultaneously'
+ )
+
+ # 换车任务僵尸数量（长时间未完成的换车）
+ zombie_rebind_tasks = Gauge(
+     'zombie_rebind_tasks',
+     'Number of rebind tasks stuck in processing state'
+ )
```

#### backend/app/tasks_celery.py
```diff
+ @celery_app.task(bind=True, base=DatabaseTask)
+ def detect_orphan_users(self):
+     """检测孤儿用户（同时在多个 Team 的用户）"""
+     orphan_query = (
+         self.db.query(TeamMember.email, func.count(...))
+         .join(Team)
+         .filter(Team.is_active == True, Team.status == TeamStatus.ACTIVE)
+         .group_by(TeamMember.email)
+         .having(func.count(...) > 1)
+     )
+     orphan_users = orphan_query.all()
+     orphan_users_count.set(len(orphan_users))
+
+     if orphan_count > 0:
+         # 发送 P0 告警
+         ...
```

**新增功能**：孤儿用户检测和告警

---

## 🎯 关键设计决策

### 决策 1：保留 is_active 和 status 双字段
**理由**：
- `is_active`：管理维度（软删除/启用状态）
- `status`：健康维度（运行状态）
- 做弱联动避免语义冲突

### 决策 2：免费换车绕过上限
**理由**：
- 车坏了不是用户的错
- 如果不绕过，用户会被锁死在坏车上
- 用户体验优先

### 决策 3：先邀再踢
**理由**：
- 确保服务不中断
- 新邀请失败时，用户仍在原 Team
- 短暂的双 Team 状态可接受（通常 <1 分钟）

### 决策 4：踢人失败不阻断流程
**理由**：
- 原 Team 可能已不健康（Token 失效无法踢人）
- 用户已加入新 Team，主要目标达成
- 孤儿用户会被监控检测到

---

## 🔒 并发安全保证

### 1. 换车并发控制
- **悲观锁**：`SELECT FOR UPDATE` 锁定兑换码行
- **原子更新**：`WHERE rebind_count < rebind_limit` 条件更新
- **接口限流**：`@limiter.limit("3/minute")`

### 2. 分配并发控制
- **悲观锁**：`SELECT FOR UPDATE` 锁定 Team 行
- **二次校验**：锁内重新验证健康状态
- **Redis 分布式锁**：跨实例并发控制

### 3. 回滚保护
- **条件回滚**：只回滚付费换车的次数
- **幂等性**：`WHERE rebind_count > 0` 防止负数
- **最终失败**：只在重试耗尽后回滚

---

## 📈 性能优化点

### 优化 1：减少无效 API 调用
- 定时同步跳过不健康 Team
- 减少 403 错误和重试
- 降低 ChatGPT API 调用量

### 优化 2：精确座位计算
- Telegram Bot 改用 SeatCalculator
- 统一计算逻辑
- 避免超载

### 优化 3：批量操作
- 批量状态修改使用单个事务
- 减少数据库往返次数

---

## 🐛 已知限制和未来改进

### 限制 1：RebindHistory.to_team_id 为 NULL
**现状**：换车历史中目标 Team ID 未回填
**影响**：审计不完整
**优化方案**：在 InviteRecord 成功后回填

### 限制 2：WAITING 队列丢失 is_rebind
**现状**：进入等待队列的换车请求被标记为普通请求
**影响**：重试时可能消耗次数
**优化方案**：InviteQueue 增加 is_rebind 字段

### 限制 3：踢人无重试机制
**现状**：踢人失败只记录日志，不重试
**影响**：可能产生孤儿用户
**缓解**：孤儿用户检测会告警

---

## 📚 相关文档

- **部署文档**: `TEAM_STATUS_AND_REBIND_UPGRADE.md`
- **测试清单**: `QUICK_TEST_CHECKLIST.md`
- **测试脚本**: `test_team_status_and_rebind.py`

---

## 🎓 技术亮点

### 1. 状态机设计
```
换车流程：
bound → (检测原Team状态) → 决定是否扣费 → 分配新Team → 发邀请 → 踢出原Team
```

### 2. 异常容错
- 踢人失败不阻断流程
- 孤儿用户有监控兜底
- 回滚逻辑完善

### 3. 可观测性
- Prometheus 指标完善
- 日志详细可追踪
- P0 告警及时触发

### 4. 用户体验
- 免费换车友好提示
- 批量操作效率提升
- 危险操作二次确认

---

## 🔄 Git Commit 建议

```bash
git add .
git commit -m "feat: Team 状态管理和换车逻辑全面优化

## 核心改进

### 1. 修复分配逻辑严重 Bug (P0)
- 统一可分配条件: is_active=True AND status=ACTIVE
- 修复竞态窗口: 锁内二次校验健康状态
- 影响: 6 个文件，覆盖所有分配路径

### 2. Team 状态批量管理
- 新增: PATCH /teams/status/bulk 接口
- 前端: 批量操作 UI + 确认对话框
- 支持: 单次/批量修改 Team 状态

### 3. 换车逻辑优化
- 封禁车换车: 不消耗次数 + 绕过上限
- 正常车换车: 消耗次数 + 自动踢出原 Team
- 实现: 先邀再踢流程，确保服务不中断
- 修复: 回滚逻辑只回滚付费换车

### 4. 监控告警
- 新增: 孤儿用户检测任务 (P0 告警)
- 新增: Prometheus 监控指标
- 新增: Telegram 告警通知

## 技术细节

- 并发安全: 悲观锁 + 二次校验
- 数据一致性: 条件更新 + 事务保护
- 可观测性: 详细日志 + 监控指标

## 文件变更

后端:
- app/services/seat_calculator.py
- app/main.py
- app/routers/teams.py
- app/routers/public.py
- app/tasks.py
- app/tasks_celery.py
- app/services/batch_allocator.py
- app/routers/telegram_bot.py
- app/schemas.py
- app/metrics.py

前端:
- src/api/index.ts
- src/pages/Teams.tsx

文档:
- TEAM_STATUS_AND_REBIND_UPGRADE.md
- QUICK_TEST_CHECKLIST.md

🤖 Generated with Claude Code
Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"
```

---

**代码审查**: 建议部署前请 Codex 或同事 review 关键逻辑

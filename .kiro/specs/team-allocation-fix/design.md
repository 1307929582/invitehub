# Design Document: Team Allocation Fix

## Overview

本设计解决 Team 分配逻辑中的并发问题，确保在高并发场景下不会出现 Team 超载。核心改进包括：
1. 精确的座位计算（包含 pending 邀请）
2. 智能的批量分配算法
3. 数据库级别的并发控制

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      API Layer                               │
│  /public/redeem, /public/direct-redeem, /public/rebind      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Invite Queue                              │
│  asyncio.Queue (in-memory, max 5000)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Batch Processor                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. Calculate available seats (with pending)         │   │
│  │  2. Smart allocation across Teams                    │   │
│  │  3. Database lock for concurrent safety              │   │
│  │  4. Send invites & record results                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database                                  │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐       │
│  │   Team   │  │ TeamMember  │  │  InviteRecord    │       │
│  │          │  │ (confirmed) │  │  (pending/done)  │       │
│  └──────────┘  └─────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. SeatCalculator

计算 Team 的真实可用座位数。

```python
class SeatCalculator:
    """计算 Team 可用座位数，考虑 pending 邀请"""
    
    PENDING_INVITE_WINDOW_HOURS = 24  # pending 邀请的有效窗口
    
    @staticmethod
    def get_team_available_seats(db: Session, team_id: int) -> int:
        """获取单个 Team 的可用座位数"""
        pass
    
    @staticmethod
    def get_all_teams_with_seats(
        db: Session, 
        group_id: Optional[int] = None
    ) -> List[TeamSeatInfo]:
        """获取所有 Team 及其可用座位数"""
        pass
```

### 2. BatchAllocator

智能分配批量邀请到多个 Team。

```python
class BatchAllocator:
    """批量邀请分配器"""
    
    @staticmethod
    def allocate(
        invites: List[InviteTask],
        teams: List[TeamSeatInfo]
    ) -> Dict[int, List[InviteTask]]:
        """
        将邀请分配到 Teams
        
        Returns:
            Dict[team_id, List[InviteTask]] - 每个 Team 分配到的邀请
        """
        pass
```

### 3. ConcurrentSafeProcessor

并发安全的邀请处理器。

```python
class ConcurrentSafeProcessor:
    """并发安全的邀请处理"""
    
    @staticmethod
    async def process_with_lock(
        db: Session,
        team_id: int,
        invites: List[InviteTask]
    ) -> ProcessResult:
        """
        使用数据库锁处理邀请
        
        1. SELECT FOR UPDATE 锁定 Team 行
        2. 重新验证可用座位
        3. 发送邀请
        4. 记录结果
        """
        pass
```

## Data Models

### TeamSeatInfo

```python
@dataclass
class TeamSeatInfo:
    team_id: int
    team_name: str
    max_seats: int
    confirmed_members: int  # TeamMember 表中的数量
    pending_invites: int    # 24h 内的 InviteRecord 数量
    available_seats: int    # max_seats - confirmed - pending
    
    @property
    def is_available(self) -> bool:
        return self.available_seats > 0
```

### InviteTask

```python
@dataclass
class InviteTask:
    email: str
    redeem_code: str
    group_id: Optional[int]
    is_rebind: bool = False
```

### AllocationResult

```python
@dataclass
class AllocationResult:
    allocated: Dict[int, List[InviteTask]]  # team_id -> invites
    unallocated: List[InviteTask]           # 无法分配的邀请
    total_available_seats: int
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Seat Calculation Accuracy

*For any* Team with a combination of TeamMembers and InviteRecords, the calculated available_seats SHALL equal:
`max_seats - count(TeamMembers) - count(recent_pending_InviteRecords)`

Where recent_pending_InviteRecords are:
- Created within 24 hours
- Status is SUCCESS
- Email not already in TeamMember for this Team

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: No Over-Allocation Invariant

*For any* batch allocation result, for each Team in the allocation:
`len(allocated_invites) <= team.available_seats`

This is the core safety property - no Team should ever receive more invites than its available capacity.

**Validates: Requirements 2.2**

### Property 3: Allocation Completeness

*For any* batch of invites and set of Teams:
`len(allocated) + len(unallocated) == len(original_batch)`

AND

`len(allocated) == min(len(batch), total_available_seats)`

All invites must be accounted for, and we should allocate as many as possible.

**Validates: Requirements 2.4**

### Property 4: Load Balancing Distribution

*For any* batch allocation where multiple Teams have available seats:
If `total_available_seats >= batch_size`, then invites should be distributed such that no single Team receives all invites when other Teams have capacity.

More formally: if Team A and Team B both have available seats, and batch_size > 1, then both Teams should receive at least one invite (unless one Team's capacity is exhausted).

**Validates: Requirements 2.3**

### Property 5: Concurrent Safety

*For any* two concurrent batch processes targeting the same Team:
`final_member_count <= team.max_seats`

Even under concurrent execution, the total allocated invites should never exceed max_seats.

**Validates: Requirements 3.1**

### Property 6: Statistics Completeness

*For any* seat statistics response, the response SHALL contain:
- total_seats (sum of all Team max_seats)
- confirmed_members (sum of TeamMember counts)
- pending_invites (sum of recent InviteRecord counts)
- available_seats (total - confirmed - pending)

AND `available_seats == total_seats - confirmed_members - pending_invites`

**Validates: Requirements 4.1, 4.2**

## Error Handling

### Allocation Failures

| Error Condition | Handling |
|-----------------|----------|
| No available Teams | Mark all invites as FAILED with "所有 Team 已满" |
| Partial capacity | Allocate what's possible, mark rest as FAILED |
| Concurrent conflict | Retry with fresh seat data (max 3 retries) |
| API error | Mark as FAILED, log error, continue with next |

### Database Errors

| Error Condition | Handling |
|-----------------|----------|
| Lock timeout | Retry after 1 second (max 3 retries) |
| Connection error | Log error, re-queue invites for later processing |
| Constraint violation | Log warning, skip affected invite |

## Testing Strategy

### Property-Based Testing

使用 **Hypothesis** 库进行属性测试。

每个 correctness property 对应一个 property-based test：

1. **test_seat_calculation_accuracy** - 生成随机 Team/Member/Invite 组合，验证计算正确性
2. **test_no_over_allocation** - 生成随机批次和 Team 配置，验证不超载
3. **test_allocation_completeness** - 验证所有邀请都被处理
4. **test_load_balancing** - 验证负载均衡分配
5. **test_concurrent_safety** - 模拟并发场景，验证安全性
6. **test_statistics_completeness** - 验证统计响应完整性

### Unit Tests

- 边界条件：空 Team、满 Team、单个邀请、大批量邀请
- 时间边界：23h59m 的邀请（应计入）、24h01m 的邀请（应排除）
- 去重逻辑：同一邮箱在 TeamMember 和 InviteRecord 中

### Integration Tests

- 完整流程：兑换 -> 队列 -> 分配 -> 邀请 -> 记录
- 并发测试：多个请求同时兑换


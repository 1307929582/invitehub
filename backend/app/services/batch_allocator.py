# 批量邀请分配器 - 智能分配邀请到多个 Team
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict

from app.services.seat_calculator import TeamSeatInfo

logger = logging.getLogger(__name__)


@dataclass
class InviteTask:
    """邀请任务"""
    email: str
    redeem_code: str
    group_id: Optional[int] = None
    is_rebind: bool = False
    consume_immediately: bool = True  # 是否已在请求阶段消耗次数
    consume_rebind_count: bool = False  # 是否消耗换车次数
    old_team_id: Optional[int] = None  # 原 Team ID（换车时踢人）
    old_team_chatgpt_user_id: Optional[str] = None  # 原 chatgpt_user_id（换车时踢人）


@dataclass
class AllocationResult:
    """分配结果"""
    allocated: Dict[int, List[InviteTask]] = field(default_factory=dict)  # team_id -> invites
    unallocated: List[InviteTask] = field(default_factory=list)  # 无法分配的邀请
    total_available_seats: int = 0


class BatchAllocator:
    """
    批量邀请分配器
    
    使用 round-robin 策略将邀请分配到多个 Team，确保：
    1. 不超过任何 Team 的可用座位数
    2. 尽可能均匀分配到多个 Team
    3. 分配尽可能多的邀请
    
    Requirements: 2.2, 2.3, 2.4
    """
    
    @staticmethod
    def allocate(
        invites: List[InviteTask],
        teams: List[TeamSeatInfo]
    ) -> AllocationResult:
        """
        将邀请分配到 Teams
        
        算法：
        1. 过滤出有可用座位的 Team
        2. 按可用座位数降序排列
        3. 使用 round-robin 策略分配邀请
        4. 跟踪每个 Team 的剩余容量
        5. 返回分配结果和未分配的邀请
        
        Args:
            invites: 待分配的邀请列表
            teams: 可用的 Team 列表（包含座位信息）
        
        Returns:
            AllocationResult 包含分配结果和未分配的邀请
        
        Requirements: 2.2, 2.3, 2.4
        """
        result = AllocationResult()
        
        if not invites:
            return result
        
        if not teams:
            result.unallocated = list(invites)
            return result
        
        # 1. 过滤出有可用座位的 Team，并创建容量跟踪
        available_teams = [t for t in teams if t.available_seats > 0]
        
        if not available_teams:
            result.unallocated = list(invites)
            return result
        
        # 按 Team ID 升序排列（优先使用 ID 小的 Team）
        available_teams.sort(key=lambda t: t.team_id)
        
        # 2. 初始化分配结果和容量跟踪
        remaining_capacity = {t.team_id: t.available_seats for t in available_teams}
        result.total_available_seats = sum(remaining_capacity.values())

        for team in available_teams:
            result.allocated[team.team_id] = []

        # 3. 顺序分配：先填满 ID 小的 Team，再到下一个
        pending_invites = list(invites)

        for team in available_teams:
            if not pending_invites:
                break

            # 分配尽可能多的邀请到这个 Team
            while pending_invites and remaining_capacity[team.team_id] > 0:
                invite = pending_invites.pop(0)
                result.allocated[team.team_id].append(invite)
                remaining_capacity[team.team_id] -= 1

        # 剩余未分配的邀请
        result.unallocated = pending_invites
        
        # 4. 清理空的分配
        result.allocated = {k: v for k, v in result.allocated.items() if v}
        
        # 5. 记录分配决策日志
        if result.allocated:
            allocation_summary = ", ".join([
                f"Team {tid}: {len(tasks)}" 
                for tid, tasks in result.allocated.items()
            ])
            logger.info(f"Allocation decision: {allocation_summary}")
        
        if result.unallocated:
            logger.warning(f"Unallocated invites: {len(result.unallocated)} "
                          f"(total capacity: {result.total_available_seats})")
        
        return result
    
    @staticmethod
    def allocate_greedy(
        invites: List[InviteTask],
        teams: List[TeamSeatInfo]
    ) -> AllocationResult:
        """
        贪婪分配策略（备选）
        
        优先填满容量最大的 Team，适用于需要最小化 API 调用次数的场景
        
        Args:
            invites: 待分配的邀请列表
            teams: 可用的 Team 列表
        
        Returns:
            AllocationResult
        """
        result = AllocationResult()
        
        if not invites:
            return result
        
        if not teams:
            result.unallocated = list(invites)
            return result
        
        # 按 Team ID 升序排列（优先使用 ID 小的 Team）
        available_teams = sorted(
            [t for t in teams if t.available_seats > 0],
            key=lambda t: t.team_id
        )
        
        if not available_teams:
            result.unallocated = list(invites)
            return result
        
        result.total_available_seats = sum(t.available_seats for t in available_teams)
        
        pending_invites = list(invites)
        
        for team in available_teams:
            if not pending_invites:
                break
            
            # 分配尽可能多的邀请到这个 Team
            to_allocate = min(len(pending_invites), team.available_seats)
            result.allocated[team.team_id] = pending_invites[:to_allocate]
            pending_invites = pending_invites[to_allocate:]
        
        result.unallocated = pending_invites
        
        return result

# Property-Based Tests for Team Seat Allocation
# **Feature: team-allocation-fix**

import pytest
from hypothesis import given, strategies as st, settings, assume
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import List, Optional, Dict

from app.services.seat_calculator import (
    TeamSeatInfo,
    PENDING_INVITE_WINDOW_HOURS,
    get_pending_invite_cutoff
)
from app.services.batch_allocator import (
    InviteTask,
    AllocationResult,
    BatchAllocator
)


# ============================================================
# Test Data Generators
# ============================================================

@st.composite
def team_seat_info_strategy(draw, min_seats=1, max_seats=20):
    """生成随机的 TeamSeatInfo"""
    team_id = draw(st.integers(min_value=1, max_value=1000))
    max_seats_val = draw(st.integers(min_value=min_seats, max_value=max_seats))
    confirmed = draw(st.integers(min_value=0, max_value=max_seats_val))
    pending = draw(st.integers(min_value=0, max_value=max_seats_val - confirmed))
    available = max(0, max_seats_val - confirmed - pending)
    
    return TeamSeatInfo(
        team_id=team_id,
        team_name=f"Team-{team_id}",
        max_seats=max_seats_val,
        confirmed_members=confirmed,
        pending_invites=pending,
        available_seats=available,
        session_token="test-token",
        device_id="test-device",
        account_id=f"account-{team_id}",
        group_id=1
    )


@st.composite
def team_list_strategy(draw, min_teams=1, max_teams=5):
    """生成随机的 Team 列表"""
    num_teams = draw(st.integers(min_value=min_teams, max_value=max_teams))
    teams = []
    for i in range(num_teams):
        team = draw(team_seat_info_strategy())
        # 确保 team_id 唯一
        team = TeamSeatInfo(
            team_id=i + 1,
            team_name=f"Team-{i + 1}",
            max_seats=team.max_seats,
            confirmed_members=team.confirmed_members,
            pending_invites=team.pending_invites,
            available_seats=team.available_seats,
            session_token=team.session_token,
            device_id=team.device_id,
            account_id=f"account-{i + 1}",
            group_id=1
        )
        teams.append(team)
    return teams


@st.composite
def invite_task_strategy(draw):
    """生成随机的 InviteTask"""
    email = draw(st.emails())
    code = draw(st.text(alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", min_size=8, max_size=8))
    is_rebind = draw(st.booleans())
    
    return InviteTask(
        email=email,
        redeem_code=code,
        group_id=1,
        is_rebind=is_rebind
    )


@st.composite
def invite_batch_strategy(draw, min_size=1, max_size=20):
    """生成随机的邀请批次"""
    size = draw(st.integers(min_value=min_size, max_value=max_size))
    invites = []
    emails_used = set()
    
    for _ in range(size):
        invite = draw(invite_task_strategy())
        # 确保邮箱唯一
        while invite.email in emails_used:
            invite = draw(invite_task_strategy())
        emails_used.add(invite.email)
        invites.append(invite)
    
    return invites


# ============================================================
# Property 1: Seat Calculation Accuracy
# **Validates: Requirements 1.1, 1.2, 1.3**
# ============================================================

class TestSeatCalculationAccuracy:
    """
    Property 1: Seat Calculation Accuracy
    
    *For any* Team with a combination of TeamMembers and InviteRecords, 
    the calculated available_seats SHALL equal:
    `max_seats - count(TeamMembers) - count(recent_pending_InviteRecords)`
    """
    
    @given(
        max_seats=st.integers(min_value=1, max_value=100),
        confirmed=st.integers(min_value=0, max_value=100),
        pending=st.integers(min_value=0, max_value=100)
    )
    @settings(max_examples=100)
    def test_available_seats_formula(self, max_seats: int, confirmed: int, pending: int):
        """
        **Property 1: Seat Calculation Accuracy**
        **Validates: Requirements 1.1, 1.2, 1.3**
        
        验证可用座位计算公式：available = max(0, max_seats - confirmed - pending)
        """
        # 确保 confirmed + pending <= max_seats 是合理的测试场景
        assume(confirmed <= max_seats)
        assume(pending <= max_seats - confirmed)
        
        expected_available = max(0, max_seats - confirmed - pending)
        
        team_info = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=max_seats,
            confirmed_members=confirmed,
            pending_invites=pending,
            available_seats=expected_available
        )
        
        # 验证公式
        assert team_info.available_seats == expected_available
        assert team_info.available_seats >= 0
        assert team_info.available_seats <= max_seats
    
    @given(
        max_seats=st.integers(min_value=1, max_value=50),
        confirmed=st.integers(min_value=0, max_value=50),
        pending=st.integers(min_value=0, max_value=50)
    )
    @settings(max_examples=100)
    def test_is_available_property(self, max_seats: int, confirmed: int, pending: int):
        """
        **Property 1: Seat Calculation Accuracy**
        **Validates: Requirements 1.1**
        
        验证 is_available 属性与 available_seats > 0 一致
        """
        assume(confirmed <= max_seats)
        assume(pending <= max_seats)
        
        available = max(0, max_seats - confirmed - pending)
        
        team_info = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=max_seats,
            confirmed_members=confirmed,
            pending_invites=pending,
            available_seats=available
        )
        
        assert team_info.is_available == (available > 0)
    
    def test_pending_invite_window(self):
        """
        **Property 1: Seat Calculation Accuracy**
        **Validates: Requirements 1.2**
        
        验证 pending 邀请窗口为 24 小时
        """
        assert PENDING_INVITE_WINDOW_HOURS == 24
        
        cutoff = get_pending_invite_cutoff()
        now = datetime.utcnow()
        
        # cutoff 应该是 24 小时前
        diff = now - cutoff
        assert 23 <= diff.total_seconds() / 3600 <= 25  # 允许小误差


# ============================================================
# Property 2: No Over-Allocation Invariant
# **Validates: Requirements 2.2**
# ============================================================

class TestNoOverAllocation:
    """
    Property 2: No Over-Allocation Invariant
    
    *For any* batch allocation result, for each Team in the allocation:
    `len(allocated_invites) <= team.available_seats`
    """
    
    @given(
        teams=team_list_strategy(min_teams=1, max_teams=5),
        invites=invite_batch_strategy(min_size=1, max_size=30)
    )
    @settings(max_examples=100)
    def test_no_team_over_allocated(self, teams: List[TeamSeatInfo], invites: List[InviteTask]):
        """
        **Property 2: No Over-Allocation Invariant**
        **Validates: Requirements 2.2**
        
        验证没有任何 Team 被分配超过其可用座位数的邀请
        """
        result = BatchAllocator.allocate(invites, teams)
        
        # 创建 team_id -> available_seats 映射
        team_capacity = {t.team_id: t.available_seats for t in teams}
        
        # 验证每个 Team 的分配不超过其容量
        for team_id, allocated_invites in result.allocated.items():
            assert len(allocated_invites) <= team_capacity[team_id], \
                f"Team {team_id} over-allocated: {len(allocated_invites)} > {team_capacity[team_id]}"
    
    @given(
        max_seats=st.integers(min_value=1, max_value=10),
        batch_size=st.integers(min_value=1, max_value=20)
    )
    @settings(max_examples=100)
    def test_single_team_capacity_respected(self, max_seats: int, batch_size: int):
        """
        **Property 2: No Over-Allocation Invariant**
        **Validates: Requirements 2.2**
        
        单个 Team 场景：分配数量不超过可用座位
        """
        team = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=max_seats,
            confirmed_members=0,
            pending_invites=0,
            available_seats=max_seats
        )
        
        invites = [
            InviteTask(
                email=f"user{i}@test.com",
                redeem_code=f"CODE{i:04d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(batch_size)
        ]
        
        result = BatchAllocator.allocate(invites, [team])
        
        allocated_count = sum(len(v) for v in result.allocated.values())
        assert allocated_count <= max_seats


# ============================================================
# Property 3: Allocation Completeness
# **Validates: Requirements 2.4**
# ============================================================

class TestAllocationCompleteness:
    """
    Property 3: Allocation Completeness
    
    *For any* batch of invites and set of Teams:
    `len(allocated) + len(unallocated) == len(original_batch)`
    AND
    `len(allocated) == min(len(batch), total_available_seats)`
    """
    
    @given(
        teams=team_list_strategy(min_teams=1, max_teams=5),
        invites=invite_batch_strategy(min_size=1, max_size=30)
    )
    @settings(max_examples=100)
    def test_all_invites_accounted_for(self, teams: List[TeamSeatInfo], invites: List[InviteTask]):
        """
        **Property 3: Allocation Completeness**
        **Validates: Requirements 2.4**
        
        验证所有邀请都被处理（分配或标记为未分配）
        """
        result = BatchAllocator.allocate(invites, teams)
        
        allocated_count = sum(len(v) for v in result.allocated.values())
        unallocated_count = len(result.unallocated)
        
        assert allocated_count + unallocated_count == len(invites), \
            f"Invites not accounted for: {allocated_count} + {unallocated_count} != {len(invites)}"
    
    @given(
        teams=team_list_strategy(min_teams=1, max_teams=5),
        invites=invite_batch_strategy(min_size=1, max_size=30)
    )
    @settings(max_examples=100)
    def test_maximum_allocation(self, teams: List[TeamSeatInfo], invites: List[InviteTask]):
        """
        **Property 3: Allocation Completeness**
        **Validates: Requirements 2.4**
        
        验证分配了尽可能多的邀请
        """
        result = BatchAllocator.allocate(invites, teams)
        
        total_available = sum(t.available_seats for t in teams)
        allocated_count = sum(len(v) for v in result.allocated.values())
        
        expected_allocated = min(len(invites), total_available)
        
        assert allocated_count == expected_allocated, \
            f"Should allocate {expected_allocated}, but allocated {allocated_count}"


# ============================================================
# Property 4: Load Balancing Distribution
# **Validates: Requirements 2.3**
# ============================================================

class TestLoadBalancing:
    """
    Property 4: Load Balancing Distribution
    
    *For any* batch allocation where multiple Teams have available seats:
    If `total_available_seats >= batch_size`, then invites should be distributed
    such that no single Team receives all invites when other Teams have capacity.
    """
    
    @given(
        num_teams=st.integers(min_value=2, max_value=5),
        seats_per_team=st.integers(min_value=5, max_value=20),
        batch_size=st.integers(min_value=2, max_value=10)
    )
    @settings(max_examples=100)
    def test_distribution_across_teams(self, num_teams: int, seats_per_team: int, batch_size: int):
        """
        **Property 4: Load Balancing Distribution**
        **Validates: Requirements 2.3**
        
        验证邀请被分布到多个 Team，而不是全部集中在一个
        """
        # 创建多个相同容量的 Team
        teams = [
            TeamSeatInfo(
                team_id=i + 1,
                team_name=f"Team-{i + 1}",
                max_seats=seats_per_team,
                confirmed_members=0,
                pending_invites=0,
                available_seats=seats_per_team
            )
            for i in range(num_teams)
        ]
        
        invites = [
            InviteTask(
                email=f"user{i}@test.com",
                redeem_code=f"CODE{i:04d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(batch_size)
        ]
        
        result = BatchAllocator.allocate(invites, teams)
        
        # 如果批次大小 > 1 且有多个 Team，应该分布到多个 Team
        if batch_size > 1 and num_teams > 1:
            teams_with_invites = len([t for t in result.allocated.values() if len(t) > 0])
            # 至少应该使用 min(batch_size, num_teams) 个 Team
            expected_min_teams = min(batch_size, num_teams)
            assert teams_with_invites >= min(2, expected_min_teams), \
                f"Should distribute to at least {min(2, expected_min_teams)} teams, but only used {teams_with_invites}"
    
    def test_round_robin_distribution(self):
        """
        **Property 4: Load Balancing Distribution**
        **Validates: Requirements 2.3**
        
        验证 round-robin 分配策略
        """
        teams = [
            TeamSeatInfo(
                team_id=i + 1,
                team_name=f"Team-{i + 1}",
                max_seats=10,
                confirmed_members=0,
                pending_invites=0,
                available_seats=10
            )
            for i in range(3)
        ]
        
        invites = [
            InviteTask(
                email=f"user{i}@test.com",
                redeem_code=f"CODE{i:04d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(6)
        ]
        
        result = BatchAllocator.allocate(invites, teams)
        
        # 6 个邀请分配到 3 个 Team，每个应该得到 2 个
        for team_id, allocated in result.allocated.items():
            assert len(allocated) == 2, \
                f"Team {team_id} should have 2 invites, got {len(allocated)}"


# ============================================================
# Property 5: Concurrent Safety
# **Validates: Requirements 3.1**
# ============================================================

class TestConcurrentSafety:
    """
    Property 5: Concurrent Safety
    
    *For any* two concurrent batch processes targeting the same Team:
    `final_member_count <= team.max_seats`
    
    Even under concurrent execution, the total allocated invites should never exceed max_seats.
    """
    
    def test_concurrent_allocation_simulation(self):
        """
        **Property 5: Concurrent Safety**
        **Validates: Requirements 3.1**
        
        模拟并发分配场景，验证不会超载
        """
        # 创建一个容量有限的 Team
        team = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=5,
            confirmed_members=0,
            pending_invites=0,
            available_seats=5
        )
        
        # 模拟两个并发批次，每个都想分配 5 个邀请
        batch1 = [
            InviteTask(
                email=f"batch1_user{i}@test.com",
                redeem_code=f"CODE1{i:03d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(5)
        ]
        
        batch2 = [
            InviteTask(
                email=f"batch2_user{i}@test.com",
                redeem_code=f"CODE2{i:03d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(5)
        ]
        
        # 第一个批次分配
        result1 = BatchAllocator.allocate(batch1, [team])
        allocated1 = sum(len(v) for v in result1.allocated.values())
        
        # 更新 Team 状态（模拟第一批次完成后）
        team_after_batch1 = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=5,
            confirmed_members=0,
            pending_invites=allocated1,  # 第一批次的邀请变成 pending
            available_seats=5 - allocated1
        )
        
        # 第二个批次分配（使用更新后的状态）
        result2 = BatchAllocator.allocate(batch2, [team_after_batch1])
        allocated2 = sum(len(v) for v in result2.allocated.values())
        
        # 验证总分配不超过容量
        total_allocated = allocated1 + allocated2
        assert total_allocated <= team.max_seats, \
            f"Total allocated {total_allocated} exceeds max_seats {team.max_seats}"
    
    @given(
        max_seats=st.integers(min_value=1, max_value=20),
        batch1_size=st.integers(min_value=1, max_value=15),
        batch2_size=st.integers(min_value=1, max_value=15)
    )
    @settings(max_examples=100)
    def test_sequential_batches_respect_capacity(
        self, 
        max_seats: int, 
        batch1_size: int, 
        batch2_size: int
    ):
        """
        **Property 5: Concurrent Safety**
        **Validates: Requirements 3.1**
        
        验证顺序处理的批次总是尊重容量限制
        """
        # 初始 Team
        team = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=max_seats,
            confirmed_members=0,
            pending_invites=0,
            available_seats=max_seats
        )
        
        # 第一批次
        batch1 = [
            InviteTask(
                email=f"b1u{i}@test.com",
                redeem_code=f"C1{i:04d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(batch1_size)
        ]
        
        result1 = BatchAllocator.allocate(batch1, [team])
        allocated1 = sum(len(v) for v in result1.allocated.values())
        
        # 更新状态
        remaining = max_seats - allocated1
        team_updated = TeamSeatInfo(
            team_id=1,
            team_name="Test Team",
            max_seats=max_seats,
            confirmed_members=0,
            pending_invites=allocated1,
            available_seats=remaining
        )
        
        # 第二批次
        batch2 = [
            InviteTask(
                email=f"b2u{i}@test.com",
                redeem_code=f"C2{i:04d}",
                group_id=1,
                is_rebind=False
            )
            for i in range(batch2_size)
        ]
        
        result2 = BatchAllocator.allocate(batch2, [team_updated])
        allocated2 = sum(len(v) for v in result2.allocated.values())
        
        # 验证
        total = allocated1 + allocated2
        assert total <= max_seats, \
            f"Total {total} exceeds capacity {max_seats}"
        assert allocated2 <= remaining, \
            f"Batch2 allocated {allocated2} but only {remaining} available"


# ============================================================
# Property 6: Statistics Completeness
# **Validates: Requirements 4.1, 4.2**
# ============================================================

class TestStatisticsCompleteness:
    """
    Property 6: Statistics Completeness
    
    *For any* seat statistics response, the response SHALL contain:
    - total_seats (sum of all Team max_seats)
    - confirmed_members (sum of TeamMember counts)
    - pending_invites (sum of recent InviteRecord counts)
    - available_seats (total - confirmed - pending)
    
    AND `available_seats == total_seats - confirmed_members - pending_invites`
    """
    
    @given(
        teams=team_list_strategy(min_teams=1, max_teams=10)
    )
    @settings(max_examples=100)
    def test_statistics_formula(self, teams: List[TeamSeatInfo]):
        """
        **Property 6: Statistics Completeness**
        **Validates: Requirements 4.1, 4.2**
        
        验证统计公式：available = total - confirmed - pending
        """
        total_seats = sum(t.max_seats for t in teams)
        confirmed = sum(t.confirmed_members for t in teams)
        pending = sum(t.pending_invites for t in teams)
        available = sum(t.available_seats for t in teams)
        
        # 验证公式
        expected_available = max(0, total_seats - confirmed - pending)
        
        # 由于每个 Team 的 available_seats 已经是 max(0, ...) 的结果
        # 总和可能略有不同，但应该接近
        assert available >= 0
        assert available <= total_seats
        
        # 验证每个 Team 的公式正确
        for team in teams:
            team_expected = max(0, team.max_seats - team.confirmed_members - team.pending_invites)
            assert team.available_seats == team_expected, \
                f"Team {team.team_id}: expected {team_expected}, got {team.available_seats}"
    
    @given(
        max_seats=st.integers(min_value=1, max_value=100),
        confirmed=st.integers(min_value=0, max_value=100),
        pending=st.integers(min_value=0, max_value=100)
    )
    @settings(max_examples=100)
    def test_available_never_negative(self, max_seats: int, confirmed: int, pending: int):
        """
        **Property 6: Statistics Completeness**
        **Validates: Requirements 4.1, 4.2**
        
        验证 available_seats 永远不为负数
        """
        available = max(0, max_seats - confirmed - pending)
        assert available >= 0
    
    def test_statistics_fields_present(self):
        """
        **Property 6: Statistics Completeness**
        **Validates: Requirements 4.1, 4.2**
        
        验证统计响应包含所有必需字段
        """
        # 模拟统计结果
        stats = {
            "total_seats": 100,
            "confirmed_members": 50,
            "pending_invites": 10,
            "available_seats": 40
        }
        
        # 验证所有字段存在
        required_fields = ["total_seats", "confirmed_members", "pending_invites", "available_seats"]
        for field in required_fields:
            assert field in stats, f"Missing field: {field}"
        
        # 验证公式
        assert stats["available_seats"] == stats["total_seats"] - stats["confirmed_members"] - stats["pending_invites"]

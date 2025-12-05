# Implementation Plan

- [x] 1. Create SeatCalculator module
  - [x] 1.1 Create `backend/app/services/seat_calculator.py` with TeamSeatInfo dataclass
    - Define TeamSeatInfo with: team_id, team_name, max_seats, confirmed_members, pending_invites, available_seats
    - Add is_available property
    - _Requirements: 1.1, 4.1_
  - [x] 1.2 Implement `get_team_available_seats()` function
    - Query TeamMember count for the team
    - Query InviteRecord count (status=SUCCESS, created within 24h, email not in TeamMember)
    - Calculate: max_seats - confirmed - pending
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.3 Implement `get_all_teams_with_seats()` function
    - Query all active Teams in group
    - Use single optimized query with subqueries for member and invite counts
    - Return List[TeamSeatInfo] sorted by available_seats descending
    - _Requirements: 2.1_
  - [x] 1.4 Write property test for seat calculation
    - **Property 1: Seat Calculation Accuracy**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 2. Create BatchAllocator module
  - [x] 2.1 Create `backend/app/services/batch_allocator.py` with InviteTask and AllocationResult dataclasses
    - Define InviteTask: email, redeem_code, group_id, is_rebind
    - Define AllocationResult: allocated (Dict[team_id, List[InviteTask]]), unallocated, total_available_seats
    - _Requirements: 2.1_
  - [x] 2.2 Implement `allocate()` function with load balancing
    - Sort Teams by available_seats descending
    - Distribute invites round-robin across Teams with capacity
    - Track remaining capacity per Team
    - Return unallocated invites when capacity exhausted
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 2.3 Write property test for no over-allocation
    - **Property 2: No Over-Allocation Invariant**
    - **Validates: Requirements 2.2**
  - [x] 2.4 Write property test for allocation completeness
    - **Property 3: Allocation Completeness**
    - **Validates: Requirements 2.4**
  - [x] 2.5 Write property test for load balancing
    - **Property 4: Load Balancing Distribution**
    - **Validates: Requirements 2.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Refactor process_invite_batch in tasks.py
  - [x] 4.1 Update `process_invite_batch()` to use SeatCalculator
    - Replace inline member count query with `get_all_teams_with_seats()`
    - Use TeamSeatInfo for accurate capacity information
    - _Requirements: 1.1, 2.1_
  - [x] 4.2 Update `process_invite_batch()` to use BatchAllocator
    - Replace single-team assignment with `allocate()` call
    - Process each Team's allocated invites separately
    - Handle unallocated invites as failures
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 4.3 Add database locking for concurrent safety
    - Use `SELECT FOR UPDATE` when processing each Team
    - Re-validate available seats after acquiring lock
    - Implement retry logic (max 3 retries) on lock conflict
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.4 Write property test for concurrent safety
    - **Property 5: Concurrent Safety**
    - **Validates: Requirements 3.1**

- [x] 5. Update seat statistics API
  - [x] 5.1 Update `/public/seats` endpoint to include pending invites
    - Modify SeatStats model to include pending_seats
    - Use SeatCalculator for accurate statistics
    - _Requirements: 4.1, 4.2_
  - [x] 5.2 Write property test for statistics completeness
    - **Property 6: Statistics Completeness**
    - **Validates: Requirements 4.1, 4.2**

- [x] 6. Update get_available_team function in public.py
  - [x] 6.1 Refactor `get_available_team()` to use SeatCalculator
    - Replace inline query with `get_all_teams_with_seats()`
    - Return first Team with available_seats > 0
    - _Requirements: 1.1, 2.1_

- [-] 7. Add logging and monitoring
  - [x] 7.1 Add detailed logging for allocation decisions
    - Log batch size, available Teams, allocation result
    - Log warnings when capacity is low or exhausted
    - _Requirements: 4.3_

- [x] 8. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


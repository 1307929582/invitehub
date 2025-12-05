# Requirements Document

## Introduction

本功能修复 Team 分配逻辑中的并发问题。当前系统在高并发场景下，多个用户可能被同时分配到同一个 Team，导致 Team 成员数超过 `max_seats` 限制。问题根源在于：
1. 批量处理时只查询一次可用 Team，然后把整批用户都分配到该 Team
2. 成员数统计只基于 `TeamMember` 表，未考虑已发送但未接受的邀请（pending invites）
3. 缺乏并发控制机制防止竞态条件

## Glossary

- **Team**: ChatGPT Team 账号，有最大成员数限制（max_seats）
- **TeamMember**: 已同步的 Team 成员记录（用户已接受邀请）
- **InviteRecord**: 邀请记录，包含已发送的邀请（可能未被接受）
- **Pending Invite**: 已发送但用户尚未接受的邀请
- **Available Seats**: Team 的可用空位数 = max_seats - 已同步成员数 - pending 邀请数
- **Batch**: 一批待处理的邀请请求（最多 BATCH_SIZE 个）
- **Group**: Team 分组，用于隔离不同类型的 Team

## Requirements

### Requirement 1

**User Story:** As a system administrator, I want the system to accurately calculate available seats, so that Teams are never over-allocated.

#### Acceptance Criteria

1. WHEN calculating available seats for a Team, THE system SHALL count both TeamMember records AND recent successful InviteRecord entries (within 24 hours)
2. WHEN an InviteRecord is older than 24 hours and user has not joined TeamMember, THE system SHALL exclude it from pending count
3. WHEN a user appears in both InviteRecord and TeamMember for the same Team, THE system SHALL count them only once

### Requirement 2

**User Story:** As a system administrator, I want batch invites to be distributed across multiple Teams, so that no single Team becomes overloaded.

#### Acceptance Criteria

1. WHEN processing a batch of invites, THE system SHALL calculate available seats for ALL active Teams in the target group
2. WHEN a Team has fewer available seats than the number of pending invites, THE system SHALL only assign invites up to the available seat count
3. WHEN multiple Teams have available seats, THE system SHALL distribute invites across Teams to balance load
4. WHEN total available seats across all Teams is less than batch size, THE system SHALL process as many invites as possible and mark remaining as failed

### Requirement 3

**User Story:** As a system administrator, I want the system to prevent race conditions during concurrent invite processing, so that seat counts remain accurate.

#### Acceptance Criteria

1. WHEN multiple batches are processed concurrently, THE system SHALL use database-level locking to prevent over-allocation
2. WHEN a Team's available seats change during batch processing, THE system SHALL re-validate before sending invites
3. WHEN an invite fails due to concurrent modification, THE system SHALL retry with updated seat information

### Requirement 4

**User Story:** As a system administrator, I want to monitor seat allocation accuracy, so that I can verify the system is working correctly.

#### Acceptance Criteria

1. WHEN calculating seat statistics, THE system SHALL include pending invite count separately from confirmed member count
2. WHEN displaying available seats, THE system SHALL show: total_seats, confirmed_members, pending_invites, available_seats
3. WHEN a discrepancy is detected between calculated and actual seats, THE system SHALL log a warning


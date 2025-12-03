# Requirements Document

## Introduction

本次重构将 InviteHub 从社区版升级为商业版，主要变更包括：移除 LinuxDO OAuth 依赖、实现兑换码 30 天有效期及换车机制、新增销售统计功能、重构用户界面为苹果风格设计。

## Glossary

- **InviteHub**: ChatGPT Team 座位管理平台
- **兑换码 (Redeem Code)**: 用户用于获取 Team 座位的凭证
- **换车 (Rebind)**: 当用户所在 Team 被封或不可用时，使用同一兑换码重新分配到其他 Team
- **激活 (Activation)**: 兑换码首次被使用的时刻，从此开始计算有效期
- **有效期 (Validity Period)**: 兑换码激活后可使用的天数，默认 30 天
- **销售额 (Revenue)**: 基于兑换码使用数量和单价计算的收入

## Requirements

### Requirement 1: 移除 LinuxDO OAuth 依赖

**User Story:** As a system administrator, I want to remove LinuxDO OAuth dependency, so that users can directly use email and redeem code to join Team without third-party login.

#### Acceptance Criteria

1. WHEN a user visits the invite page, THE system SHALL display an email input field and redeem code input field without requiring any login
2. WHEN a user submits email and redeem code, THE system SHALL validate the redeem code and send invitation to the provided email
3. WHEN the system processes an invitation, THE system SHALL not reference any LinuxDO user data
4. WHEN the backend starts, THE system SHALL not load LinuxDO OAuth configuration or routes

---

### Requirement 2: 兑换码 30 天有效期机制

**User Story:** As a user, I want my redeem code to be valid for 30 days after first use, so that I have a reasonable time window to use the service.

#### Acceptance Criteria

1. WHEN a redeem code is used for the first time, THE system SHALL record the activation timestamp and calculate expiration date as activation time plus validity days
2. WHEN a user attempts to use an expired redeem code, THE system SHALL reject the request and display the expiration date
3. WHEN displaying redeem code information, THE system SHALL show remaining valid days if the code is activated
4. WHEN creating redeem codes, THE system SHALL allow setting custom validity days with default value of 30

---

### Requirement 3: 兑换码换车功能

**User Story:** As a user, I want to use my redeem code to switch to another Team if my current Team becomes unavailable, so that I can continue using the service.

#### Acceptance Criteria

1. WHEN a user's current Team is marked as inactive or banned, THE system SHALL allow the user to rebind using the same redeem code
2. WHEN a user requests rebind, THE system SHALL randomly select an available Team with free seats
3. WHEN a rebind occurs, THE system SHALL record the rebind operation with timestamp and new Team information
4. WHEN a rebind occurs, THE system SHALL send a new invitation email to the user's bound email address
5. WHEN the redeem code has expired, THE system SHALL reject rebind requests

---

### Requirement 4: 兑换码邮箱绑定

**User Story:** As a system administrator, I want redeem codes to be bound to specific email addresses after first use, so that codes cannot be shared or transferred.

#### Acceptance Criteria

1. WHEN a redeem code is used for the first time, THE system SHALL bind the code to the provided email address
2. WHEN a bound redeem code is used with a different email, THE system SHALL reject the request and inform the user of the bound email
3. WHEN querying redeem code status, THE system SHALL return the bound email if the code is activated

---

### Requirement 5: Dashboard 销售统计

**User Story:** As a system administrator, I want to see revenue statistics on the dashboard, so that I can track business performance.

#### Acceptance Criteria

1. WHEN an administrator views the dashboard, THE system SHALL display today's revenue, this week's revenue, and this month's revenue
2. WHEN calculating revenue, THE system SHALL multiply the number of activated redeem codes by the configured unit price
3. WHEN displaying revenue trends, THE system SHALL show a chart of daily revenue for the past 7 days
4. WHEN the unit price is not configured, THE system SHALL use zero as the default price

---

### Requirement 6: 系统设置 - 价格配置

**User Story:** As a system administrator, I want to configure the unit price of redeem codes, so that revenue calculations are accurate.

#### Acceptance Criteria

1. WHEN an administrator accesses system settings, THE system SHALL display a price configuration field
2. WHEN an administrator updates the unit price, THE system SHALL save the value and apply it to future revenue calculations
3. WHEN displaying price, THE system SHALL support decimal values with two decimal places

---

### Requirement 7: 用户界面重构 - 苹果风格设计

**User Story:** As a user, I want a modern Apple-style interface with glass morphism effect, so that I have a premium user experience.

#### Acceptance Criteria

1. WHEN a user visits the invite page, THE system SHALL display a clean white-dominant interface with glass morphism effects
2. WHEN rendering UI components, THE system SHALL use backdrop blur effects and subtle shadows for depth
3. WHEN displaying interactive elements, THE system SHALL use smooth animations and transitions
4. WHEN rendering the page on different devices, THE system SHALL maintain responsive design with consistent styling

---

### Requirement 8: 用户状态查询

**User Story:** As a user, I want to check my subscription status using my email, so that I can see my current Team and redeem code validity.

#### Acceptance Criteria

1. WHEN a user enters their email on the invite page, THE system SHALL display their current subscription status if found
2. WHEN displaying subscription status, THE system SHALL show current Team name, redeem code expiration date, and rebind availability
3. WHEN no subscription is found for the email, THE system SHALL prompt the user to enter a redeem code

---

### Requirement 9: 数据库模型更新

**User Story:** As a developer, I want updated database models to support new features, so that data is properly structured and stored.

#### Acceptance Criteria

1. WHEN the system initializes, THE system SHALL create or migrate the redeem_codes table with new fields: activated_at, bound_email, validity_days
2. WHEN the system initializes, THE system SHALL create or migrate the invite_records table with new field: is_rebind
3. WHEN the system initializes, THE system SHALL remove or deprecate LinuxDO-related tables and foreign keys

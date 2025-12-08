# ChatGPT Team API 完整文档

> **版本**: v1.0.0
> **更新时间**: 2025-12-08
> **适用范围**: ChatGPT Team 成员管理、邀请、订阅查询

---

## 📖 目录

- [API 概述](#api-概述)
- [认证方式](#认证方式)
- [快速开始](#快速开始)
- [核心接口](#核心接口)
  - [验证 Token](#1️⃣-验证-token)
  - [邀请成员](#2️⃣-邀请成员)
  - [获取成员列表](#3️⃣-获取成员列表)
  - [获取待处理邀请](#4️⃣-获取待处理邀请)
  - [移除成员](#5️⃣-移除成员)
  - [取消邀请](#6️⃣-取消邀请)
  - [获取订阅信息](#7️⃣-获取订阅信息)
  - [获取账户身份信息](#8️⃣-获取账户身份信息)
- [错误处理](#错误处理)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)
- [附录](#附录)

---

## API 概述

### Base URL

```
https://chatgpt.com/backend-api
```

### 协议

- **传输协议**: HTTPS
- **请求格式**: JSON
- **响应格式**: JSON
- **字符编码**: UTF-8

### 速率限制

- 建议批量操作间隔 **1-2 秒**
- 单次邀请建议不超过 **10 个邮箱**
- 遇到 `429` 错误时应实现指数退避策略

---

## 认证方式

ChatGPT Team API 使用 **Bearer Token** 认证，需要以下参数：

### 必需参数

| 参数 | 类型 | 位置 | 说明 | 获取方式 |
|------|------|------|------|----------|
| `session_token` | `string` | Header | Bearer Token | 浏览器 Cookie: `__Secure-next-auth.session-token` |
| `account_id` | `string` | URL + Header | Team 账户 ID | 调用 `/me` 接口获取 |

### 可选参数

| 参数 | 类型 | 位置 | 说明 |
|------|------|------|------|
| `device_id` | `string` | Header | 设备唯一标识 |
| `cookie` | `string` | Header | 完整的浏览器 Cookie |

### 标准请求头

```http
Authorization: Bearer {session_token}
Content-Type: application/json
chatgpt-account-id: {account_id}
oai-device-id: {device_id}
Cookie: {完整cookie字符串}
Accept: */*
Accept-Language: zh-CN,zh;q=0.9
Origin: https://chatgpt.com
Referer: https://chatgpt.com/admin/members
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36
oai-language: zh-CN
sec-ch-ua: "Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "macOS"
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
```

---

## 快速开始

### 步骤 1: 获取 Session Token

1. 打开 [ChatGPT](https://chatgpt.com/)
2. 登录你的 Team 账号
3. 按 `F12` 打开开发者工具
4. 进入 **Application** → **Cookies** → `https://chatgpt.com`
5. 复制 `__Secure-next-auth.session-token` 的值

### 步骤 2: 验证 Token 并获取 Account ID

```bash
curl -X GET "https://chatgpt.com/backend-api/me" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

**响应示例**:
```json
{
  "accounts": [
    {
      "account": {
        "account_id": "org-xxxxxxxxxxxxxxxx",
        "name": "My Team",
        "is_default": true
      }
    }
  ],
  "email": "admin@example.com",
  "name": "Admin User"
}
```

### 步骤 3: 邀请成员

```bash
curl -X POST "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/invites" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx" \
  -d '{
    "email_addresses": ["user@example.com"],
    "role": "standard-user",
    "resend_emails": true
  }'
```

---

## 核心接口

### 1️⃣ 验证 Token

**用途**: 验证 Session Token 是否有效，并获取当前用户信息和所有 Team 的 `account_id`

#### 请求

```http
GET /me HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
```

#### cURL 示例

```bash
curl -X GET "https://chatgpt.com/backend-api/me" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

#### 响应示例

```json
{
  "object": "user",
  "id": "user-xxxxxxxxxxxxxxxx",
  "email": "admin@example.com",
  "name": "Admin User",
  "picture": "https://lh3.googleusercontent.com/...",
  "created": 1234567890,
  "accounts": [
    {
      "account": {
        "account_id": "org-xxxxxxxxxxxxxxxx",
        "account_user_role": "owner",
        "account_user_id": "acc_user_xxxxxxxxxxxxxxxx",
        "structure": "workspace",
        "is_default": true,
        "name": "My Team",
        "profile": {
          "picture": null,
          "domain": null
        }
      }
    }
  ]
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 用户唯一标识 |
| `email` | `string` | 用户邮箱 |
| `name` | `string` | 用户名称 |
| `accounts[].account.account_id` | `string` | **Team ID（重要）** |
| `accounts[].account.account_user_role` | `string` | 用户在 Team 中的角色 |
| `accounts[].account.name` | `string` | Team 名称 |

---

### 2️⃣ 邀请成员

**用途**: 向指定的邮箱发送 ChatGPT Team 邀请

#### 请求

```http
POST /accounts/{account_id}/invites HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
Content-Type: application/json
chatgpt-account-id: {account_id}

{
  "email_addresses": ["user1@example.com", "user2@example.com"],
  "role": "standard-user",
  "resend_emails": true
}
```

#### 路径参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `account_id` | `string` | ✅ | Team 账户 ID（格式：`org-xxxxxxxxx`） |

#### 请求体参数

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `email_addresses` | `string[]` | ✅ | - | 要邀请的邮箱列表，支持批量（建议≤10） |
| `role` | `string` | ✅ | `"standard-user"` | 角色类型，可选值见下表 |
| `resend_emails` | `boolean` | ❌ | `true` | 如果邮箱已被邀请，是否重新发送邀请邮件 |

#### Role 类型

| 值 | 说明 |
|----|------|
| `standard-user` | 标准用户（推荐） |
| `reader` | 只读用户 |

#### cURL 示例

```bash
curl -X POST "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/invites" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx" \
  -d '{
    "email_addresses": ["user1@example.com", "user2@example.com"],
    "role": "standard-user",
    "resend_emails": true
  }'
```

#### 成功响应

```json
{
  "success": true,
  "invites": [
    {
      "email": "user1@example.com",
      "status": "invited"
    },
    {
      "email": "user2@example.com",
      "status": "invited"
    }
  ]
}
```

#### 部分失败响应

```json
{
  "success": false,
  "invites": [
    {
      "email": "user1@example.com",
      "status": "invited"
    },
    {
      "email": "invalid-email",
      "status": "failed",
      "error": "Invalid email address"
    }
  ]
}
```

---

### 3️⃣ 获取成员列表

**用途**: 获取 Team 中所有成员的列表，包括已接受邀请的用户

#### 请求

```http
GET /accounts/{account_id}/users?offset=0&limit=100&query= HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
chatgpt-account-id: {account_id}
```

#### 路径参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `account_id` | `string` | ✅ | Team 账户 ID |

#### 查询参数

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `offset` | `int` | ❌ | `0` | 分页偏移量 |
| `limit` | `int` | ❌ | `100` | 每页数量（最大 100） |
| `query` | `string` | ❌ | `""` | 搜索关键词（邮箱或姓名） |

#### cURL 示例

```bash
curl -X GET "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/users?offset=0&limit=100&query=" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx"
```

#### 响应示例

```json
{
  "object": "list",
  "data": [
    {
      "object": "organization.user",
      "id": "user-xxxxxxxxxxxxxxxx",
      "email": "user1@example.com",
      "name": "User One",
      "role": "standard-user",
      "added_at": 1234567890,
      "invited_by": "user-adminxxxxxxxxxxxx"
    },
    {
      "object": "organization.user",
      "id": "user-yyyyyyyyyyyyyyyy",
      "email": "user2@example.com",
      "name": "User Two",
      "role": "standard-user",
      "added_at": 1234567900,
      "invited_by": "user-adminxxxxxxxxxxxx"
    }
  ],
  "total": 2,
  "has_more": false
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data[].id` | `string` | 用户唯一标识（用于移除成员） |
| `data[].email` | `string` | 用户邮箱 |
| `data[].name` | `string` | 用户名称 |
| `data[].role` | `string` | 用户角色 |
| `data[].added_at` | `int` | 加入时间（Unix 时间戳） |
| `total` | `int` | 总成员数 |
| `has_more` | `boolean` | 是否有更多数据 |

---

### 4️⃣ 获取待处理邀请

**用途**: 获取所有待接受的邀请列表（用户已收到邀请但未接受）

#### 请求

```http
GET /accounts/{account_id}/invites HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
chatgpt-account-id: {account_id}
```

#### cURL 示例

```bash
curl -X GET "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/invites" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx"
```

#### 响应示例

```json
{
  "object": "list",
  "data": [
    {
      "object": "organization.invite",
      "id": "invite-xxxxxxxxxxxxxxxx",
      "email": "pending@example.com",
      "role": "standard-user",
      "status": "pending",
      "invited_at": 1234567890,
      "invited_by": "user-adminxxxxxxxxxxxx",
      "expires_at": 1235777890
    }
  ],
  "total": 1
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data[].email` | `string` | 待处理邀请的邮箱 |
| `data[].status` | `string` | 邀请状态：`pending`（待接受） |
| `data[].invited_at` | `int` | 邀请发送时间 |
| `data[].expires_at` | `int` | 邀请过期时间 |

---

### 5️⃣ 移除成员

**用途**: 从 Team 中移除指定成员

#### 请求

```http
DELETE /accounts/{account_id}/users/{user_id} HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
chatgpt-account-id: {account_id}
```

#### 路径参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `account_id` | `string` | ✅ | Team 账户 ID |
| `user_id` | `string` | ✅ | 要移除的用户 ID（从"获取成员列表"接口获取） |

#### cURL 示例

```bash
curl -X DELETE "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/users/user-yyyyyyyyyyyyyyyy" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx"
```

#### 成功响应

```json
{
  "success": true
}
```

或返回 **HTTP 204 No Content**（空响应体）

---

### 6️⃣ 取消邀请

**用途**: 取消待处理的邀请（用户尚未接受）

#### 请求

```http
DELETE /accounts/{account_id}/invites HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
Content-Type: application/json
chatgpt-account-id: {account_id}

{
  "email_address": "pending@example.com"
}
```

#### 路径参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `account_id` | `string` | ✅ | Team 账户 ID |

#### 请求体参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `email_address` | `string` | ✅ | 要取消邀请的邮箱 |

#### cURL 示例

```bash
curl -X DELETE "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/invites" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx" \
  -d '{
    "email_address": "pending@example.com"
  }'
```

#### 成功响应

```json
{
  "success": true
}
```

---

### 7️⃣ 获取订阅信息

**用途**: 获取 Team 的订阅详情，包括座位数、已用座位、到期时间等

#### 请求

```http
GET /subscriptions?account_id={account_id} HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
chatgpt-account-id: {account_id}
```

#### 查询参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `account_id` | `string` | ✅ | Team 账户 ID |

#### cURL 示例

```bash
curl -X GET "https://chatgpt.com/backend-api/subscriptions?account_id=org-xxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx"
```

#### 响应示例

```json
{
  "object": "list",
  "data": [
    {
      "object": "billing.subscription",
      "id": "sub-xxxxxxxxxxxxxxxx",
      "account_id": "org-xxxxxxxxxxxxxxxx",
      "status": "active",
      "plan": {
        "id": "chatgptteamplan",
        "title": "ChatGPT Team",
        "currency": "usd",
        "amount": 2500
      },
      "quantity": 30,
      "current_period_start": 1234567890,
      "current_period_end": 1267567890,
      "cancel_at_period_end": false
    }
  ]
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data[].status` | `string` | 订阅状态：`active`（活跃）、`canceled`（已取消） |
| `data[].plan.title` | `string` | 订阅计划名称 |
| `data[].quantity` | `int` | **总座位数** |
| `data[].current_period_end` | `int` | **到期时间**（Unix 时间戳） |

**计算剩余座位**:
```
剩余座位 = quantity - (成员数 + 待处理邀请数)
```

---

### 8️⃣ 获取账户身份信息

**用途**: 获取 Team 账户的详细身份信息

#### 请求

```http
GET /accounts/{account_id}/identity HTTP/1.1
Host: chatgpt.com
Authorization: Bearer {session_token}
chatgpt-account-id: {account_id}
```

#### cURL 示例

```bash
curl -X GET "https://chatgpt.com/backend-api/accounts/org-xxxxxxxxxxxxxxxx/identity" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "chatgpt-account-id: org-xxxxxxxxxxxxxxxx"
```

#### 响应示例

```json
{
  "account_id": "org-xxxxxxxxxxxxxxxx",
  "name": "My Team",
  "owner": {
    "email": "owner@example.com",
    "name": "Team Owner"
  },
  "structure": "workspace"
}
```

---

## 错误处理

### 标准错误响应

```json
{
  "error": {
    "message": "错误描述信息",
    "type": "invalid_request_error",
    "code": "invalid_email"
  }
}
```

### HTTP 状态码

| 状态码 | 说明 | 常见原因 | 处理方式 |
|--------|------|----------|----------|
| `200` | 成功 | - | 正常处理 |
| `204` | 成功（无内容） | DELETE 操作成功 | 正常处理 |
| `400` | 请求参数错误 | 邮箱格式错误、缺少必需参数 | 检查请求参数 |
| `401` | 未授权 | Token 已过期或无效 | **重新获取 Session Token** |
| `403` | 禁止访问 | 权限不足、账户被封禁 | 检查 Token 权限 |
| `404` | 资源不存在 | `account_id` 或 `user_id` 错误 | 检查 ID 是否正确 |
| `429` | 请求过于频繁 | 触发速率限制 | **实施指数退避重试** |
| `500` | 服务器内部错误 | OpenAI 服务异常 | 稍后重试 |
| `503` | 服务不可用 | 服务维护中 | 稍后重试 |

### 错误示例

#### 401 Token 过期

```json
{
  "error": {
    "message": "Invalid authentication credentials",
    "type": "invalid_request_error",
    "code": "invalid_token"
  }
}
```

**处理方式**: 重新获取 Session Token

#### 429 速率限制

```json
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded"
  }
}
```

**处理方式**: 等待后重试（建议指数退避：1s → 2s → 4s）

---

## 最佳实践

### 1. 批量邀请策略

```python
# 推荐做法：每批 10 个邮箱，批次间间隔 1 秒
batch_size = 10
delay = 1.0

for i in range(0, len(emails), batch_size):
    batch = emails[i:i + batch_size]

    # 发送批量邀请
    invite_members(account_id, batch)

    # 批次间延迟
    if i + batch_size < len(emails):
        time.sleep(delay)
```

### 2. 错误重试机制

```python
import time

def invite_with_retry(account_id, emails, max_retries=3):
    for attempt in range(max_retries):
        try:
            return invite_members(account_id, emails)
        except RateLimitError:
            if attempt < max_retries - 1:
                # 指数退避
                wait_time = 2 ** attempt
                time.sleep(wait_time)
            else:
                raise
```

### 3. Token 有效性检查

```python
# 每次操作前验证 Token
try:
    me = verify_token()
    account_id = me['accounts'][0]['account']['account_id']
except UnauthorizedError:
    # Token 已过期，需要重新获取
    refresh_token()
```

### 4. Cookie 清理

```python
# 清理 Cookie 中的换行符
cookie = raw_cookie.replace('\n', '').replace('\r', '').strip()
```

### 5. 超时设置

```python
import httpx

# 建议 30 秒超时
async with httpx.AsyncClient(timeout=30.0) as client:
    response = await client.post(url, json=data)
```

### 6. 座位数检查

```python
# 邀请前检查剩余座位
subscription = get_subscription(account_id)
members = get_members(account_id)
pending_invites = get_invites(account_id)

total_seats = subscription['data'][0]['quantity']
used_seats = len(members['data']) + len(pending_invites['data'])
available_seats = total_seats - used_seats

if len(new_emails) > available_seats:
    raise InsufficientSeatsError(f"需要 {len(new_emails)} 个座位，但只有 {available_seats} 个可用")
```

---

## 常见问题

### Q1: 如何获取 Session Token？

**答**:
1. 登录 [ChatGPT](https://chatgpt.com/)
2. 按 `F12` 打开开发者工具
3. 进入 **Application** → **Cookies**
4. 复制 `__Secure-next-auth.session-token` 的值

### Q2: Session Token 多久过期？

**答**: 通常 **30 天**，建议每次操作前先调用 `/me` 验证 Token 有效性。

### Q3: 如何判断 Token 已过期？

**答**: 当接口返回 `401 Unauthorized` 错误时，表示 Token 已过期，需要重新获取。

### Q4: 邀请失败但座位已扣除怎么办？

**答**:
1. 调用 `/accounts/{account_id}/invites` 查看待处理邀请
2. 如果邮箱在列表中，说明邀请成功，用户未接受
3. 如果不在列表中，可以重新邀请（设置 `resend_emails: true`）

### Q5: 如何批量移除成员？

**答**:
```python
members = get_members(account_id)

for member in members['data']:
    if member['email'] in emails_to_remove:
        remove_member(account_id, member['id'])
        time.sleep(0.5)  # 避免速率限制
```

### Q6: 支持同时邀请多少个邮箱？

**答**: 理论上无上限，但建议：
- 单次请求：≤ 10 个邮箱
- 批次间隔：≥ 1 秒

### Q7: Cookie 参数是必需的吗？

**答**: 不是必需的，但**强烈推荐**携带完整 Cookie，可以提高请求成功率。

### Q8: 如何获取 Device ID？

**答**: Device ID 是可选的。如果需要，可以从浏览器请求头 `oai-device-id` 中复制。

---

## 附录

### A. Python 完整示例

```python
import httpx
import asyncio
from typing import List, Dict, Any

API_BASE = "https://chatgpt.com/backend-api"

class ChatGPTAPI:
    def __init__(self, session_token: str, device_id: str = "", cookie: str = ""):
        self.session_token = session_token
        self.device_id = device_id
        self.cookie = cookie

    def _get_headers(self, account_id: str = "") -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.session_token.strip()}",
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Origin": "https://chatgpt.com",
            "Referer": "https://chatgpt.com/admin/members",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        }

        if self.device_id:
            headers["oai-device-id"] = self.device_id.strip()

        if account_id:
            headers["chatgpt-account-id"] = account_id.strip()

        if self.cookie:
            headers["Cookie"] = self.cookie.replace('\n', '').strip()

        return headers

    async def verify_token(self) -> Dict[str, Any]:
        """验证 Token"""
        url = f"{API_BASE}/me"
        headers = self._get_headers()

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def invite_members(
        self,
        account_id: str,
        emails: List[str],
        role: str = "standard-user"
    ) -> Dict[str, Any]:
        """邀请成员"""
        url = f"{API_BASE}/accounts/{account_id}/invites"
        headers = self._get_headers(account_id)
        data = {
            "email_addresses": emails,
            "role": role,
            "resend_emails": True
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=data)
            response.raise_for_status()
            return response.json()

    async def get_members(self, account_id: str) -> Dict[str, Any]:
        """获取成员列表"""
        url = f"{API_BASE}/accounts/{account_id}/users"
        headers = self._get_headers(account_id)
        params = {"offset": 0, "limit": 100, "query": ""}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers, params=params)
            response.raise_for_status()
            return response.json()

# 使用示例
async def main():
    api = ChatGPTAPI(
        session_token="YOUR_SESSION_TOKEN",
        device_id="YOUR_DEVICE_ID",
        cookie="YOUR_FULL_COOKIE"
    )

    # 验证 Token
    me = await api.verify_token()
    account_id = me['accounts'][0]['account']['account_id']
    print(f"Account ID: {account_id}")

    # 邀请成员
    result = await api.invite_members(
        account_id=account_id,
        emails=["user1@example.com", "user2@example.com"]
    )
    print(f"Invite result: {result}")

    # 获取成员列表
    members = await api.get_members(account_id)
    print(f"Total members: {members['total']}")

if __name__ == "__main__":
    asyncio.run(main())
```

### B. JavaScript/TypeScript 示例

```typescript
interface InviteOptions {
  emailAddresses: string[];
  role?: string;
  resendEmails?: boolean;
}

class ChatGPTAPI {
  private sessionToken: string;
  private deviceId?: string;
  private cookie?: string;
  private baseURL = 'https://chatgpt.com/backend-api';

  constructor(sessionToken: string, deviceId?: string, cookie?: string) {
    this.sessionToken = sessionToken;
    this.deviceId = deviceId;
    this.cookie = cookie;
  }

  private getHeaders(accountId?: string): HeadersInit {
    const headers: HeadersInit = {
      'Authorization': `Bearer ${this.sessionToken}`,
      'Content-Type': 'application/json',
      'Accept': '*/*',
    };

    if (this.deviceId) {
      headers['oai-device-id'] = this.deviceId;
    }

    if (accountId) {
      headers['chatgpt-account-id'] = accountId;
    }

    if (this.cookie) {
      headers['Cookie'] = this.cookie.replace(/\n/g, '');
    }

    return headers;
  }

  async verifyToken(): Promise<any> {
    const response = await fetch(`${this.baseURL}/me`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async inviteMembers(
    accountId: string,
    options: InviteOptions
  ): Promise<any> {
    const response = await fetch(`${this.baseURL}/accounts/${accountId}/invites`, {
      method: 'POST',
      headers: this.getHeaders(accountId),
      body: JSON.stringify({
        email_addresses: options.emailAddresses,
        role: options.role || 'standard-user',
        resend_emails: options.resendEmails ?? true,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

// 使用示例
const api = new ChatGPTAPI('YOUR_SESSION_TOKEN');

const me = await api.verifyToken();
const accountId = me.accounts[0].account.account_id;

const result = await api.inviteMembers(accountId, {
  emailAddresses: ['user1@example.com', 'user2@example.com'],
  role: 'standard-user',
});

console.log('Invite result:', result);
```

---

## 更新日志

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0.0 | 2025-12-08 | 初始版本，包含所有核心接口文档 |

---

## 许可证

本文档仅供学习和研究使用，请遵守 OpenAI 的服务条款。

---

<div align="center">
  <sub>Made with ❤️ for ChatGPT Team Developers</sub>
</div>

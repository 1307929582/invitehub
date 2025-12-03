# Implementation Plan

## Phase 1: 数据库模型更新

- [x] 1. 更新数据库模型
  - [x] 1.1 修改 RedeemCode 模型，添加新字段
    - 添加 `validity_days` (Integer, default=30)
    - 添加 `activated_at` (DateTime, nullable)
    - 添加 `bound_email` (String(100), nullable)
    - 添加计算属性 `user_expires_at`、`is_user_expired`、`remaining_days`
    - _Requirements: 2.1, 2.3, 4.1_
  - [x] 1.2 修改 InviteRecord 模型
    - 添加 `is_rebind` (Boolean, default=False)
    - 移除 `linuxdo_user_id` 外键（保留字段但设为 nullable）
    - _Requirements: 3.3, 9.2_
  - [x] 1.3 编写属性测试：有效期计算
    - **Property 1: Activation timestamp and expiration calculation**
    - **Property 3: Remaining days calculation**
    - **Validates: Requirements 2.1, 2.3**

## Phase 2: 后端 API 重构

- [x] 2. 移除 LinuxDO 相关代码
  - [x] 2.1 清理 public.py 中的 LinuxDO OAuth 端点
    - 移除 `/linuxdo/auth`、`/linuxdo/callback`、`/user/status` (旧版)
    - 移除 `get_linuxdo_user_from_token` 函数
    - _Requirements: 1.3, 1.4_
  - [x] 2.2 清理 users.py 路由
    - 移除或注释 LinuxDO 用户相关端点
    - _Requirements: 1.4_
  - [x] 2.3 更新 main.py 路由注册
    - 移除 LinuxDO 相关路由导入
    - _Requirements: 1.4_

- [x] 3. 实现新的兑换 API
  - [x] 3.1 实现 POST /public/redeem 端点
    - 验证兑换码有效性
    - 首次使用时绑定邮箱、记录激活时间
    - 检查邮箱绑定一致性
    - 检查有效期
    - 发送邀请
    - _Requirements: 1.2, 2.1, 4.1, 4.2_
  - [x] 3.2 编写属性测试：邮箱绑定一致性
    - **Property 4: Email binding consistency**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 3.3 编写属性测试：过期码拒绝
    - **Property 2: Expired code rejection**
    - **Validates: Requirements 2.2, 3.5**

- [x] 4. 实现用户状态查询 API
  - [x] 4.1 实现 GET /public/status 端点
    - 根据邮箱查询绑定的兑换码
    - 返回 Team 信息、有效期、换车可用性
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 4.2 编写属性测试：状态查询完整性
    - **Property 7: Status query completeness**
    - **Validates: Requirements 8.1**

- [x] 5. 实现换车 API
  - [x] 5.1 实现 POST /public/rebind 端点
    - 验证兑换码和邮箱
    - 检查当前 Team 是否不可用
    - 随机分配新 Team
    - 记录换车操作
    - 发送新邀请
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 5.2 编写属性测试：换车操作完整性
    - **Property 5: Rebind operation integrity**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 6. Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Phase 3: Dashboard 销售统计

- [x] 7. 实现销售统计 API
  - [x] 7.1 实现 GET /dashboard/revenue 端点
    - 计算今日/本周/本月销售额
    - 生成近 7 天销售趋势数据
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 7.2 编写属性测试：销售额计算准确性
    - **Property 6: Revenue calculation accuracy**
    - **Validates: Requirements 5.2**

- [x] 8. 实现价格配置 API
  - [x] 8.1 添加价格配置到 SystemConfig
    - 新增 `redeem_unit_price` 配置项
    - 实现获取和更新接口
    - _Requirements: 6.1, 6.2, 6.3_

## Phase 4: 前端重构

- [x] 9. 移除 LinuxDO 相关前端代码
  - [x] 9.1 删除 LinuxDOUsers.tsx 页面
  - [x] 9.2 删除 Callback.tsx 页面
  - [x] 9.3 更新 App.tsx 路由配置
    - 移除 `/callback` 路由
    - 移除 `/admin/users` 路由
  - [x] 9.4 更新 Layout.tsx 菜单
    - 移除 "LinuxDO 用户" 菜单项
    - 移除 "LinuxDO 兑换码" 菜单项（合并为统一的兑换码管理）
  - [x] 9.5 清理 api/index.ts
    - 移除 `linuxdoUserApi`
    - 移除 `publicApi` 中的 LinuxDO 相关方法
    - _Requirements: 1.1_

- [x] 10. 重构用户兑换页面（苹果风格）
  - [x] 10.1 创建新的 InvitePage.tsx 组件
    - 苹果风格设计：白色主色调、玻璃质感、backdrop-blur
    - 邮箱输入 + 兑换码输入表单
    - 状态查询功能（输入邮箱查看订阅状态）
    - _Requirements: 1.1, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3_
  - [x] 10.2 实现兑换流程 UI
    - 兑换成功/失败状态展示
    - 显示剩余有效天数
    - 换车按钮（当 Team 不可用时显示）
    - _Requirements: 2.3, 3.1_
  - [x] 10.3 实现响应式设计
    - 移动端适配
    - _Requirements: 7.4_

- [x] 11. 重构 Dashboard 页面
  - [x] 11.1 添加销售统计卡片
    - 今日销售额、本周销售额、本月销售额
    - 使用与现有统计卡片一致的样式
    - _Requirements: 5.1_
  - [x] 11.2 添加销售趋势图表
    - 近 7 天销售趋势折线图
    - _Requirements: 5.3_
  - [x] 11.3 更新 API 调用
    - 集成 `/dashboard/revenue` 接口
    - _Requirements: 5.1_

- [x] 12. 添加价格配置页面
  - [x] 12.1 创建 PriceSettings.tsx 组件
    - 价格输入框（支持小数）
    - 保存按钮
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 12.2 更新 Settings.tsx 添加价格配置入口
    - _Requirements: 6.1_

## Phase 5: 兑换码管理优化

- [x] 13. 更新兑换码管理页面
  - [x] 13.1 合并 RedeemCodes.tsx 和 DirectCodes.tsx
    - 统一为一个兑换码管理页面
    - 添加有效天数配置选项
    - _Requirements: 2.4_
  - [x] 13.2 显示兑换码绑定状态
    - 显示绑定邮箱
    - 显示激活时间和剩余天数
    - _Requirements: 4.3_

- [x] 14. 更新兑换码创建表单
  - [x] 14.1 添加有效天数输入
    - 默认值 30 天
    - _Requirements: 2.4_

## Phase 6: 最终检查

- [x] 15. Final Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. 清理和文档
  - [x] 16.1 删除未使用的 LinuxDO 相关文件
  - [x] 16.2 更新 README.md 移除 LinuxDO 相关说明

import axios from 'axios'
import { message } from 'antd'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      // 根据当前路径决定跳转到哪个登录页
      const currentPath = window.location.pathname
      if (currentPath.startsWith('/distributor')) {
        window.location.href = '/distributor/login'
      } else {
        window.location.href = '/admin/login'
      }
    }
    message.error(error.response?.data?.detail || '请求失败')
    return Promise.reject(error)
  }
)

// Auth API
export const authApi = {
  login: (username: string, password: string) => {
    const formData = new FormData()
    formData.append('username', username)
    formData.append('password', password)
    return api.post('/auth/login', formData)
  },
  getMe: () => api.get('/auth/me'),
  initAdmin: () => api.post('/auth/init-admin'),
}

// Team Status 类型
export type TeamStatus = 'active' | 'banned' | 'token_invalid' | 'paused'

// Team API
export const teamApi = {
  list: (params?: { include_inactive?: boolean; status_filter?: TeamStatus }) =>
    api.get('/teams', { params }),
  get: (id: number) => api.get(`/teams/${id}`),
  create: (data: any) => api.post('/teams', data),
  update: (id: number, data: any) => api.put(`/teams/${id}`, data),
  delete: (id: number) => api.delete(`/teams/${id}`),
  getMembers: (id: number) => api.get(`/teams/${id}/members`),
  syncMembers: (id: number) => api.post(`/teams/${id}/sync`),
  syncAll: () => api.post('/teams/sync-all'),
  verifyToken: (id: number) => api.post(`/teams/${id}/verify-token`),
  getSubscription: (id: number) => api.get(`/teams/${id}/subscription`),
  getPendingInvites: (id: number, refresh?: boolean) => api.get(`/teams/${id}/pending-invites`, { params: { refresh } }),
  getAllPendingInvites: (refresh?: boolean) => api.get('/teams/all-pending-invites', { params: { refresh } }),
  removeMember: (teamId: number, userId: string) => api.delete(`/teams/${teamId}/members/${userId}`),
  cancelInvite: (teamId: number, email: string) => api.delete(`/teams/${teamId}/invites`, { params: { email } }),
  getUnauthorizedMembers: () => api.get('/teams/unauthorized/all'),
  removeUnauthorizedMembers: (teamId: number) => api.delete(`/teams/${teamId}/unauthorized-members`),
  updateStatus: (id: number, status: TeamStatus, message?: string) =>
    api.patch(`/teams/${id}/status`, null, { params: { status, message } }),
  updateStatusBulk: (data: { team_ids: number[]; status: TeamStatus; status_message?: string }) =>
    api.patch('/teams/status/bulk', data),

  // 导出 API
  exportMembers: (teamId: number, format: 'csv' | 'json' = 'csv') =>
    api.get(`/teams/${teamId}/members/export`, { params: { format }, responseType: format === 'csv' ? 'blob' : 'json' }),
  exportBulkMembers: (data: { team_ids?: number[]; status?: TeamStatus }, format: 'csv' | 'json' = 'csv') =>
    api.post('/teams/members/export/bulk', data, { params: { format }, responseType: format === 'csv' ? 'blob' : 'json' }),
  exportEmailsOnly: (params: { team_ids?: string; status?: TeamStatus }) =>
    api.get('/teams/members/export/emails-only', { params, responseType: 'blob' }),

  // 迁移 API
  previewMigration: (data: { source_team_ids: number[]; destination_team_id: number }) =>
    api.post('/teams/migrate/preview', data),
  executeMigration: (data: { source_team_ids: number[]; destination_team_id: number; emails?: string[] }) =>
    api.post('/teams/migrate/execute', data),
}

// Invite API
export const inviteApi = {
  batchInvite: (teamId: number, emails: string[]) => 
    api.post(`/teams/${teamId}/invites`, { emails }),
  getRecords: (teamId: number) => api.get(`/teams/${teamId}/invites`),
  getPending: (teamId: number) => api.get(`/teams/${teamId}/invites/pending`),
}

// Dashboard API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
  getSummary: () => api.get('/dashboard/summary'),
  getLogs: (limit?: number, teamId?: number) =>
    api.get('/dashboard/logs', { params: { limit, team_id: teamId } }),
  getSeats: () => api.get('/dashboard/seats'),
}

// Redeem Code API
export const redeemApi = {
  list: (teamId?: number, isActive?: boolean, codeType?: string) =>
    api.get('/redeem-codes', { params: { team_id: teamId, is_active: isActive, code_type: codeType } }),
  batchCreate: (data: { max_uses: number; expires_days?: number; count: number; prefix?: string; code_type?: string; note?: string; group_id?: number; validity_days?: number }) =>
    api.post('/redeem-codes/batch', data),
  delete: (id: number) => api.delete(`/redeem-codes/${id}`),
  batchDelete: (ids: number[]) => api.delete('/redeem-codes/batch', { data: { ids } }),
  toggle: (id: number) => api.put(`/redeem-codes/${id}/toggle`),
  getRecords: (id: number) => api.get(`/redeem-codes/${id}/records`),
}

// Team Group API
export const groupApi = {
  list: () => api.get('/groups'),
  create: (data: { name: string; description?: string; color?: string }) => api.post('/groups', data),
  update: (id: number, data: { name?: string; description?: string; color?: string }) => api.put(`/groups/${id}`, data),
  delete: (id: number) => api.delete(`/groups/${id}`),
}

// Config API
export const configApi = {
  list: () => api.get('/config'),
  update: (key: string, value: string) => api.put(`/config/${key}`, { key, value }),
  batchUpdate: (configs: { key: string; value: string; description?: string | null }[]) => 
    api.post('/config/batch', configs),
  testEmail: () => api.post('/config/test-email'),
  testTelegram: () => api.post('/config/test-telegram'),
  setupTelegramWebhook: () => api.post('/config/setup-telegram-webhook'),
  checkAlerts: () => api.post('/config/check-alerts'),
}

// Revenue API (商业版)
export const revenueApi = {
  getStats: () => api.get('/dashboard/revenue'),
}

// Invite Record API
export const inviteRecordApi = {
  list: (params?: { search?: string; team_id?: number; group_id?: number }) =>
    api.get('/invite-records', { params }),
}

// Notification API
export const notificationApi = {
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (data: any) => api.put('/notifications/settings', data),
  getSmtp: () => api.get('/notifications/smtp'),
  updateSmtp: (data: any) => api.put('/notifications/smtp', data),
  testConnection: () => api.post('/notifications/test'),
  testSend: () => api.post('/notifications/test-send'),
}

// Setup API (无需认证)
export const setupApi = {
  getStatus: () => axios.get('/api/v1/setup/status').then(r => r.data),
  initialize: (data: { username: string; email: string; password: string; confirm_password: string }) =>
    axios.post('/api/v1/setup/initialize', data).then(r => r.data),
}

// Admin Management API
export const adminApi = {
  listAdmins: () => api.get('/admins'),
  createAdmin: (data: { username: string; email: string; password: string; role: string }) =>
    api.post('/admins', data),
  updateAdmin: (id: number, data: { email?: string; password?: string; role?: string; is_active?: boolean }) =>
    api.put(`/admins/${id}`, data),
  deleteAdmin: (id: number) => api.delete(`/admins/${id}`),
  // 分销商审核
  listPendingDistributors: () => api.get('/admins/pending-distributors'),
  approveDistributor: (id: number) => api.post(`/admins/distributors/${id}/approve`),
  rejectDistributor: (id: number, reason?: string) =>
    api.post(`/admins/distributors/${id}/reject`, { reason }),
  // 手动创建分销商
  createDistributor: (data: { username: string; email: string; password: string }) =>
    api.post('/admins/distributors/create', data),
  // 删除分销商
  deleteDistributor: (id: number) => api.delete(`/admins/distributors/${id}`),
}

// Distributor API
export const distributorApi = {
  // 管理员端点
  list: (status?: string) => api.get('/distributors', { params: { status } }),
  getSales: (distributorId: number, limit?: number) =>
    api.get(`/distributors/${distributorId}/sales`, { params: { limit } }),
  // 分销商端点
  getMySummary: () => api.get('/distributors/me/summary'),
  getMySales: (limit?: number) => api.get('/distributors/me/sales', { params: { limit } }),
  // 成员管理端点
  getMyMembers: () => api.get('/distributors/me/members'),
  removeMember: (data: { email: string; team_id: number; reason?: string }) =>
    api.post('/distributors/me/members/remove', data),
  addMember: (data: { email: string; team_id: number }) =>
    api.post('/distributors/me/members/add', data),
}

// Admin Distributor Analytics API
export const distributorAnalyticsApi = {
  getAnalytics: (params?: { page?: number; page_size?: number; sort_by?: string; status?: string }) =>
    api.get('/admins/distributors/analytics', { params }),
  getDetail: (distributorId: number) =>
    api.get(`/admins/distributors/${distributorId}/detail`),
}

// Auth API - 分销商注册相关
export const distributorAuthApi = {
  sendVerificationCode: (email: string) =>
    axios.post('/api/v1/auth/send-verification-code', { email }).then(r => r.data),
  register: (data: { email: string; username: string; password: string; code: string }) =>
    axios.post('/api/v1/auth/register-distributor', data).then(r => r.data),
}

// Public API (无需认证)
const publicApiClient = axios.create({
  baseURL: '/api/v1/public',
  timeout: 30000,
})

publicApiClient.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error)
)

export const publicApi = {
  // 商业版 API
  redeem: (data: { email: string; code: string }) =>
    publicApiClient.post('/redeem', data),
  getStatus: (params: { email?: string; code?: string }) =>
    publicApiClient.get('/status', { params }),
  rebind: (data: { email: string; code: string }) =>
    publicApiClient.post('/rebind', data),
  getSeats: () => publicApiClient.get('/seats'),
  getSiteConfig: () => publicApiClient.get('/site-config'),
  // 邀请状态查询
  getInviteStatus: (email: string) => publicApiClient.get('/invite-status', { params: { email } }),
  // 商店 API
  getPaymentConfig: () => publicApiClient.get('/shop/config'),
  getPlans: () => publicApiClient.get('/shop/plans'),
  createOrder: (data: { plan_id: number; email: string; pay_type: string }) =>
    publicApiClient.post('/shop/buy', data),
  getOrderStatus: (orderNo: string) => publicApiClient.get(`/shop/order/${orderNo}`),
  queryOrdersByEmail: (email: string) => publicApiClient.get('/shop/orders', { params: { email } }),
}

// 套餐管理 API (管理后台)
export const planApi = {
  list: () => api.get('/plans'),
  get: (id: number) => api.get(`/plans/${id}`),
  create: (data: { name: string; price: number; validity_days: number; description?: string; features?: string; is_active?: boolean; is_recommended?: boolean; sort_order?: number; original_price?: number }) =>
    api.post('/plans', data),
  update: (id: number, data: Partial<{ name: string; price: number; validity_days: number; description?: string; features?: string; is_active?: boolean; is_recommended?: boolean; sort_order?: number; original_price?: number }>) =>
    api.put(`/plans/${id}`, data),
  delete: (id: number) => api.delete(`/plans/${id}`),
  toggle: (id: number) => api.put(`/plans/${id}/toggle`),
}

// 订单管理 API (管理后台)
export const orderApi = {
  list: (params?: { status?: string; page?: number; page_size?: number }) =>
    api.get('/orders', { params }),
  get: (orderNo: string) => api.get(`/orders/${orderNo}`),
  getStats: () => api.get('/orders/stats'),
}

export default api

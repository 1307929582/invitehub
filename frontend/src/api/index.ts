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
      window.location.href = '/admin/login'
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

// Team API
export const teamApi = {
  list: () => api.get('/teams'),
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
  getLogs: (limit?: number, teamId?: number) => 
    api.get('/dashboard/logs', { params: { limit, team_id: teamId } }),
  getSeats: () => api.get('/dashboard/seats'),
}

// Redeem Code API
export const redeemApi = {
  list: (teamId?: number, isActive?: boolean, codeType?: string) => 
    api.get('/redeem-codes', { params: { team_id: teamId, is_active: isActive, code_type: codeType } }),
  batchCreate: (data: { max_uses: number; expires_days?: number; count: number; prefix?: string; code_type?: string; note?: string; group_id?: number }) =>
    api.post('/redeem-codes/batch', data),
  delete: (id: number) => api.delete(`/redeem-codes/${id}`),
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
  getStatus: (email: string) => publicApiClient.get('/status', { params: { email } }),
  rebind: (data: { email: string; code: string }) =>
    publicApiClient.post('/rebind', data),
  getSeats: () => publicApiClient.get('/seats'),
  getSiteConfig: () => publicApiClient.get('/site-config'),
}

export default api

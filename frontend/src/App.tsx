import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Spin, ConfigProvider } from 'antd'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Teams from './pages/Teams'
import TeamDetail from './pages/TeamDetail'
import Invite from './pages/Invite'
import Logs from './pages/Logs'
import RedeemCodes from './pages/RedeemCodes'
import Settings from './pages/Settings'
import Home from './pages/Home'
import Setup from './pages/Setup'
import DirectInvite from './pages/DirectInvite'
import Groups from './pages/Groups'
import InviteRecords from './pages/InviteRecords'
import PendingInvites from './pages/PendingInvites'
import Admins from './pages/Admins'
import SiteSettings from './pages/settings/SiteSettings'
import EmailSettings from './pages/settings/EmailSettings'
import AlertSettings from './pages/settings/AlertSettings'
import TelegramSettings from './pages/settings/TelegramSettings'
import PriceSettings from './pages/settings/PriceSettings'
import WhitelistSettings from './pages/settings/WhitelistSettings'
import PaymentSettings from './pages/settings/PaymentSettings'
import Plans from './pages/Plans'
import Orders from './pages/Orders'
import Coupons from './pages/Coupons'
import Purchase from './pages/Purchase'
import PayResult from './pages/PayResult'
import UnauthorizedMembers from './pages/UnauthorizedMembers'
import Legal from './pages/Legal'
import FAQ from './pages/FAQ'
import NotFound from './pages/NotFound'
// 分销商相关页面
import DistributorLogin from './pages/distributor/DistributorLogin'
import DistributorRegister from './pages/distributor/DistributorRegister'
import DistributorLayout from './pages/distributor/DistributorLayout'
import DistributorDashboard from './pages/distributor/DistributorDashboard'
import DistributorRedeemCodes from './pages/distributor/DistributorRedeemCodes'
import DistributorSales from './pages/distributor/DistributorSales'
import DistributorMembers from './pages/distributor/DistributorMembers'
// 管理员分销商管理页面
import AdminPendingDistributors from './pages/admin/AdminPendingDistributors'
import AdminDistributors from './pages/admin/AdminDistributors'
import AdminDistributorAnalytics from './pages/admin/AdminDistributorAnalytics'

import { useStore } from './store'
import { authApi, setupApi } from './api'

function PrivateRoute({ children, initialized }: { children: React.ReactNode; initialized: boolean | null }) {
  const { user } = useStore()
  const token = localStorage.getItem('token')

  // 未初始化时跳转到设置页
  if (initialized === false) {
    return <Navigate to="/setup" replace />
  }

  if (!token) {
    return <Navigate to="/admin/login" replace />
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return <>{children}</>
}

// 分销商专属路由保护
function DistributorRoute({ children, initialized }: { children: React.ReactNode; initialized: boolean | null }) {
  const { user } = useStore()
  const token = localStorage.getItem('token')

  if (initialized === false) {
    return <Navigate to="/setup" replace />
  }

  if (!token) {
    return <Navigate to="/distributor/login" replace />
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  // 检查是否为分销商角色
  if (user.role !== 'distributor') {
    return <Navigate to="/admin/dashboard" replace />
  }

  return <>{children}</>
}

function App() {
  const { setUser } = useStore()
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState<boolean | null>(null)  // 初始为 null，等待 API 返回

  // 全局白标域名检测：除了主站外，所有域名都只能访问 /invite 和 /legal
  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase()
    const isMainSite = hostname === 'mmw-team.zenscaleai.com' || hostname === 'localhost'
    const currentPath = window.location.pathname

    // 如果不是主站，且不在允许的公开路径，则跳转
    const allowedPaths = ['/invite', '/legal', '/faq']
    const isAllowed = allowedPaths.some(p => currentPath.startsWith(p))
    if (!isMainSite && !isAllowed) {
      window.location.replace('/invite')
    }
  }, [])

  useEffect(() => {
    // 先检查系统是否已初始化
    setupApi.getStatus()
      .then((res: any) => {
        console.log('Setup status:', res)
        setInitialized(res.initialized)
        if (res.initialized) {
          // 已初始化，检查登录状态
          const token = localStorage.getItem('token')
          if (token) {
            return authApi.getMe()
              .then((res: any) => setUser(res))
              .catch(() => localStorage.removeItem('token'))
          }
        }
      })
      .catch((err) => {
        console.error('Failed to get setup status:', err)
        // 获取状态失败，假设已初始化
        setInitialized(true)
      })
      .finally(() => setLoading(false))
  }, [setUser])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <ConfigProvider>
    <BrowserRouter>
      <Routes>
        {/* 初始化设置页 */}
        <Route path="/setup" element={
          initialized === true ? <Navigate to="/" replace /> : <Setup />
        } />

        {/* 用户页面 */}
        <Route path="/" element={
          initialized === false ? <Navigate to="/setup" replace /> : <Home />
        } />
        <Route path="/invite" element={<DirectInvite />} />
        <Route path="/invite/:code" element={<DirectInvite />} />
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/pay/result" element={<PayResult />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/rebind" element={<Navigate to="/invite" replace />} />

        {/* 分销商注册页面（公开）- 旧路径重定向 */}
        <Route path="/register" element={<Navigate to="/distributor/register" replace />} />

        {/* 分销商登录和注册 */}
        <Route path="/distributor/login" element={
          initialized === false ? <Navigate to="/setup" replace /> : <DistributorLogin />
        } />
        <Route path="/distributor/register" element={
          initialized === false ? <Navigate to="/setup" replace /> : <DistributorRegister />
        } />

        {/* 管理员登录 */}
        <Route path="/admin/login" element={
          initialized === false ? <Navigate to="/setup" replace /> : <Login />
        } />

        {/* 分销商后台 */}
        <Route path="/distributor" element={
          <DistributorRoute initialized={initialized}>
            <DistributorLayout />
          </DistributorRoute>
        }>
          <Route index element={<DistributorDashboard />} />
          <Route path="redeem-codes" element={<DistributorRedeemCodes />} />
          <Route path="members" element={<DistributorMembers />} />
          <Route path="sales" element={<DistributorSales />} />
        </Route>

        {/* 管理后台 */}
        <Route path="/admin" element={
          <PrivateRoute initialized={initialized}>
            <Layout />
          </PrivateRoute>
        }>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="teams" element={<Teams />} />
          <Route path="teams/:id" element={<TeamDetail />} />
          <Route path="groups" element={<Groups />} />
          <Route path="invite" element={<Invite />} />
          <Route path="redeem-codes" element={<RedeemCodes />} />
          <Route path="invite-records" element={<InviteRecords />} />
          <Route path="pending-invites" element={<PendingInvites />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/site" element={<SiteSettings />} />
          <Route path="settings/email" element={<EmailSettings />} />
          <Route path="settings/alerts" element={<AlertSettings />} />
          <Route path="settings/telegram" element={<TelegramSettings />} />
          <Route path="settings/price" element={<PriceSettings />} />
          <Route path="settings/whitelist" element={<WhitelistSettings />} />
          <Route path="settings/payment" element={<PaymentSettings />} />
          <Route path="plans" element={<Plans />} />
          <Route path="orders" element={<Orders />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="unauthorized" element={<UnauthorizedMembers />} />
          <Route path="admins" element={<Admins />} />
          {/* 分销商管理（管理员） */}
          <Route path="pending-distributors" element={<AdminPendingDistributors />} />
          <Route path="distributors" element={<AdminDistributors />} />
          <Route path="distributor-analytics" element={<AdminDistributorAnalytics />} />
        </Route>

        {/* 404 页面 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
    </ConfigProvider>
  )
}

export default App

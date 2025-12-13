// 分销商布局组件
import { Layout, Menu, Avatar, Dropdown, message } from 'antd'
import {
  DashboardOutlined,
  GiftOutlined,
  BarChartOutlined,
  LogoutOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../store'
import type { MenuProps } from 'antd'

const { Header, Content, Sider } = Layout

const menuItems = [
  { key: '/distributor', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/distributor/redeem-codes', icon: <GiftOutlined />, label: '兑换码管理' },
  { key: '/distributor/members', icon: <TeamOutlined />, label: '成员管理' },
  { key: '/distributor/sales', icon: <BarChartOutlined />, label: '销售统计' },
]

export default function DistributorLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, setUser } = useStore()

  const handleLogout = () => {
    localStorage.removeItem('token')
    setUser(null)
    message.success('已退出登录')
    navigate('/admin/login')
  }

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)'
        }}>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
            分销商中心
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ background: 'transparent', borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: '0 24px',
          background: '#fff',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
        }}>
          <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar style={{ backgroundColor: '#722ed1' }} icon={<UserOutlined />} />
              <span>{user?.username}</span>
            </div>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24 }}>
          <div style={{
            padding: 24,
            minHeight: 360,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
          }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

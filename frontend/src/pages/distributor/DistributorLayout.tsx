// 分销商布局组件
import { Layout, Menu, Avatar, Dropdown, message, Grid, Drawer, Button } from 'antd'
import {
  DashboardOutlined,
  GiftOutlined,
  BarChartOutlined,
  LogoutOutlined,
  UserOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../store'
import { useState, useEffect } from 'react'
import type { MenuProps } from 'antd'

const { Header, Content, Sider } = Layout
const { useBreakpoint } = Grid

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
  const screens = useBreakpoint()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // 判断是否为移动端
  const isMobile = !screens.md

  // 路由变化时关闭移动端菜单
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const handleLogout = () => {
    localStorage.removeItem('token')
    setUser(null)
    message.success('已退出登录')
    navigate('/distributor/login')
  }

  const handleMenuClick = (key: string) => {
    navigate(key)
    if (isMobile) {
      setMobileMenuOpen(false)
    }
  }

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ]

  // 菜单内容（共用于 Sider 和 Drawer）
  const menuContent = (
    <>
      {/* Logo */}
      <div style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
        gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: collapsed && !isMobile ? '0 16px' : '0 20px',
      }}>
        <img
          src="/logo.png"
          alt="Logo"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            flexShrink: 0,
          }}
        />
        {(!collapsed || isMobile) && (
          <span style={{
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}>
            分销商中心
          </span>
        )}
      </div>

      {/* Menu */}
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => handleMenuClick(key)}
        style={{
          background: 'transparent',
          borderRight: 0,
          marginTop: 8,
        }}
      />

      {/* Bottom Info */}
      {(!collapsed || isMobile) && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: 0,
          right: 0,
          padding: '0 20px',
        }}>
          <div style={{
            padding: '12px 16px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 12,
            fontSize: 12,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>当前账号</div>
            <div style={{ color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.username}
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={240}
          collapsedWidth={80}
          style={{
            background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
            boxShadow: '2px 0 8px rgba(0,0,0,0.15)',
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
          }}
        >
          {menuContent}
        </Sider>
      )}

      {/* 移动端抽屉菜单 */}
      <Drawer
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        width={280}
        closable={false}
        styles={{
          body: { padding: 0 },
          header: { display: 'none' },
        }}
        style={{ background: 'transparent' }}
      >
        <div style={{
          background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
          height: '100%',
          position: 'relative',
        }}>
          {/* 关闭按钮 */}
          <Button
            type="text"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="关闭菜单"
            style={{
              position: 'absolute',
              top: 16,
              right: 12,
              color: 'rgba(255,255,255,0.6)',
              fontSize: 18,
              zIndex: 10,
            }}
            icon={<CloseOutlined />}
          />
          {menuContent}
        </div>
      </Drawer>

      <Layout style={{ marginLeft: isMobile ? 0 : (collapsed ? 80 : 240), transition: 'margin-left 0.2s' }}>
        <Header style={{
          padding: '0 16px',
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <Button
            type="text"
            onClick={() => isMobile ? setMobileMenuOpen(true) : setCollapsed(v => !v)}
            aria-label={isMobile ? '打开菜单' : (collapsed ? '展开侧边栏' : '收起侧边栏')}
            style={{ fontSize: 18, color: '#666', padding: '8px' }}
            icon={isMobile ? <MenuUnfoldOutlined /> : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
          />

          <Dropdown menu={{ items: dropdownItems }} placement="bottomRight">
            <div style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 12px',
              borderRadius: 20,
              background: '#f5f5f7',
              transition: 'background 0.2s',
            }}>
              <Avatar
                size={32}
                style={{ backgroundColor: '#722ed1' }}
                icon={<UserOutlined />}
              />
              {!isMobile && (
                <span style={{ fontWeight: 500, color: '#1d1d1f' }}>{user?.username}</span>
              )}
            </div>
          </Dropdown>
        </Header>

        <Content style={{
          margin: isMobile ? 12 : 24,
          minHeight: 'calc(100vh - 64px - 48px)',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

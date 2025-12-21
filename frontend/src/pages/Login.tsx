import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Form, Input, Button, message, Alert } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { authApi } from '../api'
import { useStore } from '../store'
import axios from 'axios'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [errorInfo, setErrorInfo] = useState<{ type: string; message: string } | null>(null)
  const navigate = useNavigate()
  const { setUser } = useStore()

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    setErrorInfo(null)
    try {
      const res: any = await authApi.login(values.username, values.password)
      localStorage.setItem('token', res.access_token)
      const user: any = await authApi.getMe()
      setUser(user)
      message.success('登录成功')
      // 根据角色重定向
      if (user.role === 'distributor') {
        navigate('/distributor')
      } else {
        navigate('/admin/dashboard')
      }
    } catch (error: any) {
      // 处理分销商审核状态
      if (axios.isAxiosError(error) && error.response) {
        const { status, data } = error.response
        if (status === 403) {
          const detail = data?.detail || ''
          if (detail.includes('pending') || detail.includes('待审核')) {
            setErrorInfo({ type: 'warning', message: '您的分销商账号正在审核中，请耐心等待管理员审批。' })
          } else if (detail.includes('rejected') || detail.includes('已拒绝')) {
            const reason = data?.reason || '未提供原因'
            setErrorInfo({ type: 'error', message: `您的分销商申请已被拒绝。原因：${reason}` })
          } else {
            setErrorInfo({ type: 'error', message: detail || '账号状态异常，请联系管理员。' })
          }
        } else if (status === 401) {
          setErrorInfo({ type: 'error', message: '用户名或密码错误' })
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 装饰光晕 */}
      <div style={{
        position: 'absolute',
        top: '-12%',
        right: '-10%',
        width: 500,
        height: 500,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.06) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-10%',
        left: '-8%',
        width: 400,
        height: 400,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: 420,
        padding: 48,
        background: '#fff',
        borderRadius: 20,
        border: 'none',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              objectFit: 'cover',
              margin: '0 auto 24px',
              boxShadow: '0 8px 24px rgba(16, 163, 127, 0.15)',
              display: 'block',
            }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px 0', color: '#1f2937', letterSpacing: '-0.5px' }}>
            管理后台
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            请输入管理员账号登录
          </p>
        </div>
        
        {errorInfo && (
          <Alert
            type={errorInfo.type as 'error' | 'warning'}
            message={errorInfo.message}
            showIcon
            style={{ marginBottom: 24, borderRadius: 12 }}
            closable
            onClose={() => setErrorInfo(null)}
          />
        )}

        <Form name="login" onFinish={onFinish}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input
              prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
              placeholder="用户名"
              size="large"
              style={{ height: 48, borderRadius: 12 }}
            />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="密码"
              size="large"
              style={{ height: 48, borderRadius: 12 }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 36 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              style={{
                height: 48,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                background: '#10a37f',
                border: 'none',
              }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ color: '#6b7280', fontSize: 14 }}>
            想成为分销商？
            <Link to="/distributor/register" style={{ marginLeft: 8, fontWeight: 600, color: '#10a37f' }}>
              申请注册
            </Link>
          </span>
        </div>
      </div>
    </div>
  )
}

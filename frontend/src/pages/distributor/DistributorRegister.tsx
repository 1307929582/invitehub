// 分销商注册页面
import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Result } from 'antd'
import { MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined, ShopOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { distributorAuthApi } from '../../api'

export default function DistributorRegister() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async () => {
    try {
      const values = await form.validateFields(['email'])
      setCodeLoading(true)
      await distributorAuthApi.sendVerificationCode(values.email)
      message.success('验证码已发送，请查收邮件')
      setCountdown(60)
    } catch (error: any) {
      if (error.response?.data?.detail) {
        message.error(error.response.data.detail)
      } else if (error.errorFields) {
        // 表单验证错误
      } else {
        message.error('发送验证码失败，请重试')
      }
    } finally {
      setCodeLoading(false)
    }
  }

  const onFinish = async (values: any) => {
    setLoading(true)
    try {
      await distributorAuthApi.register(values)
      setSuccess(true)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '注册失败，请检查输入')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 装饰光晕 */}
        <div style={{
          position: 'absolute',
          top: '-15%',
          right: '-10%',
          width: 400,
          height: 400,
          background: 'radial-gradient(circle, rgba(16, 163, 127, 0.06) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-10%',
          left: '-8%',
          width: 300,
          height: 300,
          background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        <div style={{
          width: 450,
          padding: 48,
          background: '#fff',
          borderRadius: 20,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
          position: 'relative',
          zIndex: 1,
        }}>
          <Result
            status="success"
            title="注册申请已提交"
            subTitle="您的分销商账号正在等待管理员审核，审核通过后将通过邮件通知您。"
            extra={[
              <Button
                type="primary"
                key="login"
                onClick={() => navigate('/distributor/login')}
                style={{
                  background: '#10a37f',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 600,
                }}
              >
                返回登录
              </Button>,
            ]}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 装饰光晕 */}
      <div style={{
        position: 'absolute',
        top: '-15%',
        right: '-10%',
        width: 400,
        height: 400,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.06) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-10%',
        left: '-8%',
        width: 300,
        height: 300,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: 420,
        padding: 48,
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 72,
            height: 72,
            background: '#10a37f',
            borderRadius: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 24px rgba(16, 163, 127, 0.25)',
          }}>
            <ShopOutlined style={{ fontSize: 36, color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: '#1f2937' }}>
            分销商注册
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            注册成为分销商，获取专属兑换码
          </p>
        </div>

        <Form form={form} name="register" onFinish={onFinish} size="large" layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
              placeholder="邮箱地址"
              style={{ height: 48, borderRadius: 12 }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item name="code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                <Input
                  prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="6位验证码"
                  style={{ flex: 1, height: 48, borderRadius: 12 }}
                  maxLength={6}
                />
              </Form.Item>
              <Button
                onClick={handleSendCode}
                loading={codeLoading}
                disabled={countdown > 0}
                style={{ height: 48, width: 120, borderRadius: 12 }}
              >
                {countdown > 0 ? `${countdown}s` : '发送验证码'}
              </Button>
            </div>
          </Form.Item>

          <Form.Item
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '只能包含字母、数字、下划线' }
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#94a3b8' }} />}
              placeholder="用户名"
              style={{ height: 48, borderRadius: 12 }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6个字符' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="密码"
              style={{ height: 48, borderRadius: 12 }}
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 48,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                background: '#10a37f',
                border: 'none',
              }}
            >
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 14 }}>
              已有账号？
              <Link to="/distributor/login" style={{ marginLeft: 8, fontWeight: 600, color: '#10a37f' }}>
                立即登录
              </Link>
            </span>
          </div>
        </Form>
      </div>
    </div>
  )
}

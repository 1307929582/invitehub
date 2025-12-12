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
    let timer: NodeJS.Timeout
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          width: 450,
          padding: 48,
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: 24,
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.2)'
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
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  borderRadius: 8,
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
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 装饰光晕 */}
      <div style={{
        position: 'absolute',
        top: '5%',
        left: '10%',
        width: 400,
        height: 400,
        background: 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%)',
        borderRadius: '50%',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '15%',
        right: '15%',
        width: 300,
        height: 300,
        background: 'radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
        borderRadius: '50%',
      }} />

      <div style={{
        width: 420,
        padding: 48,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 24,
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.2)',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 72,
            height: 72,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
          }}>
            <ShopOutlined style={{ fontSize: 36, color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: '#1a1a2e' }}>
            分销商注册
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
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
              style={{ height: 48, borderRadius: 10 }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item name="code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                <Input
                  prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="6位验证码"
                  style={{ flex: 1, height: 48, borderRadius: 10 }}
                  maxLength={6}
                />
              </Form.Item>
              <Button
                onClick={handleSendCode}
                loading={codeLoading}
                disabled={countdown > 0}
                style={{ height: 48, width: 120, borderRadius: 10 }}
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
              style={{ height: 48, borderRadius: 10 }}
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
              style={{ height: 48, borderRadius: 10 }}
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 52,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
              }}
            >
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#64748b', fontSize: 14 }}>
              已有账号？
              <Link to="/distributor/login" style={{ marginLeft: 8, fontWeight: 500, color: '#667eea' }}>
                立即登录
              </Link>
            </span>
          </div>
        </Form>
      </div>
    </div>
  )
}

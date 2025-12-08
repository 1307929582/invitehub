// 分销商注册页面
import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Card, Typography, Result } from 'antd'
import { MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { distributorAuthApi } from '../api'

const { Title, Text } = Typography

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <Card style={{ width: 450, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          <Result
            status="success"
            title="注册申请已提交"
            subTitle="您的分销商账号正在等待管理员审核，审核通过后将通过邮件通知您。"
            extra={[
              <Button type="primary" key="login" onClick={() => navigate('/admin/login')}>
                返回登录
              </Button>,
            ]}
          />
        </Card>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 8 }}>分销商注册</Title>
          <Text type="secondary">注册成为分销商，获取专属兑换码</Text>
        </div>

        <Form form={form} name="register" onFinish={onFinish} size="large" layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="邮箱地址" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item name="code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                <Input
                  prefix={<SafetyCertificateOutlined />}
                  placeholder="6位验证码"
                  style={{ flex: 1 }}
                  maxLength={6}
                />
              </Form.Item>
              <Button
                onClick={handleSendCode}
                loading={codeLoading}
                disabled={countdown > 0}
                style={{ width: 120 }}
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
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6个字符' }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary">已有账号？</Text>
            <Button type="link" onClick={() => navigate('/admin/login')} style={{ padding: '0 4px' }}>
              立即登录
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  )
}

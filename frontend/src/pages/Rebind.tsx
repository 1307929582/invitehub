import { useState } from 'react'
import { Form, Input, Button, Card, Alert, Result, Spin, message } from 'antd'
import { SwapOutlined, MailOutlined, KeyOutlined, CheckCircleOutlined, CloseCircleOutlined, HomeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { publicApi } from '../api'

interface RebindResponse {
  success: boolean
  message: string
  team?: {
    name: string
  }
}

export default function Rebind() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RebindResponse | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (values: { email: string; code: string }) => {
    setLoading(true)
    setResult(null)

    try {
      const res: any = await publicApi.rebind({
        email: values.email.trim(),
        code: values.code.trim()
      })
      setResult(res)
      if (res.success) {
        message.success('换车成功！')
      } else {
        message.error(res.message || '换车失败')
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '网络错误，请稍后重试'
      setResult({
        success: false,
        message: errorMsg
      })
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* 装饰背景 */}
      <div style={{
        position: 'fixed',
        top: '-20%',
        right: '-10%',
        width: 600,
        height: 600,
        background: 'radial-gradient(circle, rgba(0, 122, 255, 0.08) 0%, transparent 70%)',
        borderRadius: '50%',
        zIndex: 0
      }} />
      <div style={{
        position: 'fixed',
        bottom: '-15%',
        left: '-5%',
        width: 500,
        height: 500,
        background: 'radial-gradient(circle, rgba(88, 86, 214, 0.06) 0%, transparent 70%)',
        borderRadius: '50%',
        zIndex: 0
      }} />

      {/* 主内容区 */}
      <div style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '80px 20px',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Logo 和标题 */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img
            src="/logo.jpg"
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
              marginBottom: 24,
            }}
          />
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            color: '#1d1d1f',
            margin: '0 0 12px',
            letterSpacing: '-0.5px',
          }}>
            <SwapOutlined style={{ marginRight: 12, color: '#007aff' }} />
            自助换车
          </h1>
          <p style={{
            fontSize: 16,
            color: '#86868b',
            margin: 0
          }}>
            使用兑换码自由切换 Team 座位
          </p>
        </div>

        {/* 主卡片 */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: 'none',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
          }}
          bodyStyle={{ padding: 32 }}
        >
          {!result ? (
            <>
              {/* 提示信息 */}
              <Alert
                message="换车限制"
                description="每个兑换码最多可用于更换 3 次座位，兑换码有效期为 31-35 天"
                type="info"
                showIcon
                style={{
                  marginBottom: 24,
                  borderRadius: 12,
                  background: 'rgba(0, 122, 255, 0.05)',
                  border: '1px solid rgba(0, 122, 255, 0.15)'
                }}
              />

              {/* 表单 */}
              <Spin spinning={loading}>
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  requiredMark={false}
                >
                  <Form.Item
                    name="email"
                    label={<span style={{ fontWeight: 600, color: '#1d1d1f' }}>邮箱地址</span>}
                    rules={[
                      { required: true, message: '请输入邮箱地址' },
                      { type: 'email', message: '请输入有效的邮箱地址' }
                    ]}
                  >
                    <Input
                      prefix={<MailOutlined style={{ color: '#86868b' }} />}
                      placeholder="your@email.com"
                      size="large"
                      style={{
                        borderRadius: 12,
                        fontSize: 15
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    name="code"
                    label={<span style={{ fontWeight: 600, color: '#1d1d1f' }}>兑换码</span>}
                    rules={[
                      { required: true, message: '请输入兑换码' },
                      { min: 6, message: '兑换码长度至少为 6 位' }
                    ]}
                  >
                    <Input
                      prefix={<KeyOutlined style={{ color: '#86868b' }} />}
                      placeholder="请输入您的兑换码"
                      size="large"
                      style={{
                        borderRadius: 12,
                        fontSize: 15
                      }}
                    />
                  </Form.Item>

                  <Form.Item style={{ marginTop: 32, marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SwapOutlined />}
                      size="large"
                      block
                      loading={loading}
                      style={{
                        height: 52,
                        borderRadius: 12,
                        fontSize: 16,
                        fontWeight: 600,
                        background: '#007aff',
                        border: 'none'
                      }}
                    >
                      {loading ? '换车中...' : '立即换车'}
                    </Button>
                  </Form.Item>
                </Form>
              </Spin>

              {/* 返回首页按钮 */}
              <div style={{ marginTop: 20, textAlign: 'center' }}>
                <Button
                  type="link"
                  icon={<HomeOutlined />}
                  onClick={() => navigate('/')}
                  style={{ color: '#86868b' }}
                >
                  返回首页
                </Button>
              </div>
            </>
          ) : (
            /* 结果展示 */
            <Result
              status={result.success ? 'success' : 'error'}
              icon={result.success ?
                <CheckCircleOutlined style={{ color: '#34c759', fontSize: 64 }} /> :
                <CloseCircleOutlined style={{ color: '#ff3b30', fontSize: 64 }} />
              }
              title={
                <span style={{ fontSize: 24, fontWeight: 700, color: '#1d1d1f' }}>
                  {result.success ? '换车成功' : '换车失败'}
                </span>
              }
              subTitle={
                <div style={{ fontSize: 15, color: '#86868b', marginTop: 12 }}>
                  {result.success && result.team ? (
                    <>您已成功加入新团队：<span style={{ fontWeight: 600, color: '#007aff' }}>{result.team.name}</span></>
                  ) : (
                    <span style={{ color: '#ff3b30' }}>{result.message}</span>
                  )}
                </div>
              }
              extra={[
                result.success ? (
                  <Button
                    key="home"
                    type="primary"
                    icon={<HomeOutlined />}
                    size="large"
                    onClick={() => navigate('/')}
                    style={{
                      height: 48,
                      borderRadius: 12,
                      fontSize: 15,
                      fontWeight: 600,
                      background: '#007aff',
                      border: 'none'
                    }}
                  >
                    返回首页
                  </Button>
                ) : (
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <Button
                      key="retry"
                      type="primary"
                      icon={<SwapOutlined />}
                      size="large"
                      onClick={() => setResult(null)}
                      style={{
                        height: 48,
                        borderRadius: 12,
                        fontSize: 15,
                        fontWeight: 600,
                        background: '#007aff',
                        border: 'none'
                      }}
                    >
                      重新尝试
                    </Button>
                    <Button
                      key="home"
                      icon={<HomeOutlined />}
                      size="large"
                      onClick={() => navigate('/')}
                      style={{
                        height: 48,
                        borderRadius: 12,
                        fontSize: 15,
                        fontWeight: 500
                      }}
                    >
                      返回首页
                    </Button>
                  </div>
                )
              ]}
            />
          )}
        </Card>

        {/* 底部提示 */}
        <div style={{
          marginTop: 24,
          textAlign: 'center',
          color: '#86868b',
          fontSize: 13
        }}>
          <p style={{ margin: 0 }}>
            换车后，您将自动从原 Team 中移出，并加入新的 Team
          </p>
          <p style={{ margin: '8px 0 0' }}>
            如遇问题，请联系管理员
          </p>
        </div>
      </div>
    </div>
  )
}

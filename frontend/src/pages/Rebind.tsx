import { useState } from 'react'
import { Form, Input, Button, Card, Alert, Result, Spin, message, Tag } from 'antd'
import { SwapOutlined, MailOutlined, KeyOutlined, CheckCircleOutlined, CloseCircleOutlined, HomeOutlined, SearchOutlined, ClockCircleOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { publicApi } from '../api'

interface StatusResult {
  found: boolean
  email?: string
  team_name?: string
  team_active?: boolean
  code?: string
  expires_at?: string
  remaining_days?: number
  can_rebind?: boolean
}

interface RebindResponse {
  success: boolean
  message: string
  new_team_name?: string
}

export default function Rebind() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RebindResponse | null>(null)
  const navigate = useNavigate()

  // 状态查询相关
  const [queryEmail, setQueryEmail] = useState('')
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null)

  // 计算剩余天数颜色
  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'  // 绿色
    if (days > 5) return '#ff9500'   // 橙色
    return '#ff3b30'                  // 红色
  }

  // 查询用户状态
  const handleQueryStatus = async () => {
    if (!queryEmail || !queryEmail.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }

    setQuerying(true)
    try {
      const res: any = await publicApi.getStatus(queryEmail.trim().toLowerCase())
      setStatusResult(res)
      if (res.found) {
        // 自动填充表单
        form.setFieldsValue({ email: queryEmail.trim().toLowerCase() })
      }
    } catch (error: any) {
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  const handleSubmit = async (values: { email: string; code: string }) => {
    setLoading(true)
    setResult(null)

    try {
      const res: any = await publicApi.rebind({
        email: values.email.trim().toLowerCase(),
        code: values.code.trim().toUpperCase()
      })
      setResult(res)
      if (res.success) {
        message.success('换车请求已提交！')
      } else {
        message.error(res.message || '换车失败')
      }
    } catch (error: any) {
      const errorDetail = error.response?.data?.detail
      const errorMsg = typeof errorDetail === 'object'
        ? errorDetail.message
        : errorDetail || error.message || '网络错误，请稍后重试'
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
        padding: '60px 20px',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Logo 和标题 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/logo.jpg"
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
              marginBottom: 20,
            }}
          />
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#1d1d1f',
            margin: '0 0 8px',
            letterSpacing: '-0.5px',
          }}>
            <SwapOutlined style={{ marginRight: 12, color: '#007aff' }} />
            自助换车
          </h1>
          <p style={{
            fontSize: 15,
            color: '#86868b',
            margin: 0
          }}>
            使用兑换码自由切换 Team 座位
          </p>
        </div>

        {/* 状态查询卡片 */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(20px)',
            borderRadius: 16,
            border: 'none',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
            marginBottom: 16
          }}
          bodyStyle={{ padding: 20 }}
        >
          <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 12, fontSize: 14 }}>
            <SearchOutlined style={{ marginRight: 8 }} />
            查询当前状态
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="输入邮箱查询"
              value={queryEmail}
              onChange={e => setQueryEmail(e.target.value)}
              onPressEnter={handleQueryStatus}
              style={{ flex: 1, borderRadius: 8 }}
            />
            <Button
              onClick={handleQueryStatus}
              loading={querying}
              style={{ borderRadius: 8 }}
            >
              查询
            </Button>
          </div>

          {/* 查询结果 */}
          {statusResult && (
            <div style={{ marginTop: 16 }}>
              {statusResult.found ? (
                <div style={{
                  padding: 16,
                  background: 'rgba(0, 122, 255, 0.04)',
                  borderRadius: 12,
                  fontSize: 13
                }}>
                  {/* Team 信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <TeamOutlined style={{ color: '#007aff' }} />
                    <span style={{ fontWeight: 500 }}>当前 Team：</span>
                    <span style={{ color: '#1d1d1f' }}>{statusResult.team_name || '未知'}</span>
                    {statusResult.team_active !== undefined && (
                      <Tag color={statusResult.team_active ? 'success' : 'error'} style={{ marginLeft: 4 }}>
                        {statusResult.team_active ? '正常' : '异常'}
                      </Tag>
                    )}
                  </div>

                  {/* 有效期信息 */}
                  {statusResult.remaining_days !== null && statusResult.remaining_days !== undefined && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 12,
                      padding: '8px 12px',
                      background: 'rgba(255, 255, 255, 0.8)',
                      borderRadius: 8
                    }}>
                      <ClockCircleOutlined style={{ color: getDaysColor(statusResult.remaining_days) }} />
                      <span style={{ fontWeight: 500 }}>有效期：</span>
                      <span style={{
                        color: getDaysColor(statusResult.remaining_days),
                        fontWeight: 600
                      }}>
                        剩余 {statusResult.remaining_days} 天
                      </span>
                      {statusResult.expires_at && (
                        <span style={{ color: '#86868b', fontSize: 12 }}>
                          （{new Date(statusResult.expires_at).toLocaleDateString('zh-CN')} 到期）
                        </span>
                      )}
                    </div>
                  )}

                  {/* 兑换码信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <KeyOutlined style={{ color: '#86868b' }} />
                    <span style={{ fontWeight: 500 }}>绑定码：</span>
                    <code style={{
                      background: 'rgba(0, 0, 0, 0.04)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontFamily: 'monospace'
                    }}>
                      {statusResult.code}
                    </code>
                  </div>

                  {/* 换车能力 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: statusResult.can_rebind ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
                    borderRadius: 8
                  }}>
                    <SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30' }} />
                    <span style={{
                      color: statusResult.can_rebind ? '#34c759' : '#ff3b30',
                      fontWeight: 500
                    }}>
                      {statusResult.can_rebind ? '可以换车' : '暂时无法换车'}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: 16,
                  background: 'rgba(0, 0, 0, 0.02)',
                  borderRadius: 12,
                  textAlign: 'center',
                  color: '#86868b'
                }}>
                  未找到该邮箱的绑定记录
                </div>
              )}
            </div>
          )}
        </Card>

        {/* 主卡片 */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(20px)',
            borderRadius: 20,
            border: 'none',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
          }}
          bodyStyle={{ padding: 28 }}
        >
          {!result ? (
            <>
              {/* 提示信息 */}
              <Alert
                message="换车说明"
                description={
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    <li>每个兑换码最多可换车 3 次</li>
                    <li>换车后原 Team 邀请失效</li>
                    <li>新邀请将在几秒内发送到邮箱</li>
                    <li>兑换码过期后无法换车</li>
                  </ul>
                }
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
                        fontSize: 15,
                        fontFamily: 'monospace',
                        letterSpacing: 1
                      }}
                    />
                  </Form.Item>

                  <Form.Item style={{ marginTop: 28, marginBottom: 0 }}>
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
                  {result.success ? '换车请求已提交' : '换车失败'}
                </span>
              }
              subTitle={
                <div style={{ fontSize: 14, color: '#86868b', marginTop: 12 }}>
                  {result.success ? (
                    <div>
                      <p style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{result.message}</p>
                      <p style={{ margin: 0, color: '#ff9500' }}>请查收邮箱并接受新邀请</p>
                    </div>
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
          marginTop: 20,
          textAlign: 'center',
          color: '#86868b',
          fontSize: 12
        }}>
          <p style={{ margin: 0 }}>
            换车后，您将自动从原 Team 中移出，并加入新的 Team
          </p>
          <p style={{ margin: '6px 0 0' }}>
            如遇问题，请联系管理员
          </p>
        </div>
      </div>
    </div>
  )
}

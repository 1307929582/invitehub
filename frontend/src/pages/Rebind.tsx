import { useState, useEffect, useCallback } from 'react'
import { Input, Button, Card, Alert, Result, Spin, message, Tag } from 'antd'
import { SwapOutlined, KeyOutlined, CheckCircleOutlined, CloseCircleOutlined, HomeOutlined, ClockCircleOutlined, TeamOutlined, MailOutlined, LoadingOutlined } from '@ant-design/icons'
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
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RebindResponse | null>(null)
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null)
  const navigate = useNavigate()

  // 计算剩余天数颜色
  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'
    if (days > 5) return '#ff9500'
    return '#ff3b30'
  }

  // 防抖查询状态
  const queryStatus = useCallback(async (codeValue: string) => {
    const trimmedCode = codeValue.trim().toUpperCase()
    if (trimmedCode.length < 6) {
      setStatusResult(null)
      return
    }

    setQuerying(true)
    try {
      const res: any = await publicApi.getStatus({ code: trimmedCode })
      setStatusResult(res)
    } catch {
      setStatusResult(null)
    } finally {
      setQuerying(false)
    }
  }, [])

  // 输入变化时延迟查询
  useEffect(() => {
    const timer = setTimeout(() => {
      if (code.trim().length >= 6) {
        queryStatus(code)
      } else {
        setStatusResult(null)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [code, queryStatus])

  const handleSubmit = async () => {
    const trimmedCode = code.trim().toUpperCase()
    if (trimmedCode.length < 6) {
      message.error('请输入有效的兑换码')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const res: any = await publicApi.rebind({ code: trimmedCode })
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

  const canSubmit = statusResult?.found && statusResult?.can_rebind
  const rebindStatusText = (() => {
    if (!statusResult) return ''
    if (!statusResult.can_rebind) return '暂时无法换车（机会已用完/已过期/超过15天）'
    if (statusResult.team_active === false) return 'Team 已封禁，可使用唯一换车机会（激活后15天内）'
    if (statusResult.team_active === true) return 'Team 正常，也可换车（仅一次机会，激活后15天内）'
    return '可换车（仅一次机会，激活后15天内）'
  })()

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
            src="/logo.png"
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
            输入兑换码即可切换 Team 座位
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
          bodyStyle={{ padding: 28 }}
        >
          {!result ? (
            <>
              {/* 提示信息 */}
              <Alert
                message="换车说明"
                description={
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                    <li>每个兑换码仅有 1 次换车机会</li>
                    <li>换车需在激活后 15 天内完成</li>
                    <li>请确认当前 Team 已封禁后再使用（若在正常状态换车，后续封禁将不再提供第二次）</li>
                    <li>换车后新邀请将发送到绑定邮箱</li>
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

              {/* 兑换码输入 */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 8 }}>
                  <KeyOutlined style={{ marginRight: 8 }} />
                  兑换码
                </div>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="请输入您的兑换码"
                  size="large"
                  suffix={querying ? <LoadingOutlined style={{ color: '#007aff' }} /> : null}
                  style={{
                    borderRadius: 12,
                    fontSize: 15,
                    fontFamily: 'monospace',
                    letterSpacing: 1
                  }}
                />
              </div>

              {/* 状态显示区域 */}
              {statusResult && (
                <div style={{
                  padding: 16,
                  background: statusResult.found ? 'rgba(0, 122, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)',
                  borderRadius: 12,
                  marginBottom: 20
                }}>
                  {statusResult.found ? (
                    <>
                      {/* 绑定邮箱 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <MailOutlined style={{ color: '#007aff' }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>绑定邮箱：</span>
                        <span style={{ color: '#1d1d1f', fontFamily: 'monospace' }}>
                          {statusResult.email || '未绑定'}
                        </span>
                      </div>

                      {/* Team 信息 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <TeamOutlined style={{ color: '#007aff' }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>当前 Team：</span>
                        <span style={{ color: '#1d1d1f' }}>{statusResult.team_name || '未知'}</span>
                        {statusResult.team_active !== undefined && (
                          <Tag color={statusResult.team_active ? 'success' : 'error'} style={{ marginLeft: 4 }}>
                            {statusResult.team_active ? '正常' : '已封禁'}
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
                          <span style={{ fontWeight: 500, fontSize: 13 }}>有效期：</span>
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

                      {/* 换车状态提示 */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        background: statusResult.can_rebind ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 149, 0, 0.1)',
                        borderRadius: 8
                      }}>
                        <SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff9500' }} />
                        <span style={{
                          color: statusResult.can_rebind ? '#34c759' : '#ff9500',
                          fontWeight: 500,
                          fontSize: 13
                        }}>
                          {rebindStatusText}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#86868b', padding: '8px 0' }}>
                      未找到此兑换码的绑定记录
                    </div>
                  )}
                </div>
              )}

              {/* 提交按钮 */}
              <Spin spinning={loading}>
                <Button
                  type="primary"
                  icon={<SwapOutlined />}
                  size="large"
                  block
                  onClick={handleSubmit}
                  loading={loading}
                  disabled={!canSubmit}
                  style={{
                    height: 52,
                    borderRadius: 12,
                    fontSize: 16,
                    fontWeight: 600,
                    background: canSubmit ? '#007aff' : '#d1d1d6',
                    border: 'none'
                  }}
                >
                  {loading ? '换车中...' : canSubmit ? '立即换车' : '输入兑换码查询状态'}
                </Button>
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
                  <div key="actions" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <Button
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
            如遇问题，请联系：<a href="mailto:contact@zenscaleai.com" style={{ color: '#007aff' }}>contact@zenscaleai.com</a>
          </p>
        </div>
      </div>
    </div>
  )
}

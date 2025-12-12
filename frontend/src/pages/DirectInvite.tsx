import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Input, Button, message, Spin, Result, Tag } from 'antd'
import { MailOutlined, KeyOutlined, CheckCircleOutlined, ClockCircleOutlined, SearchOutlined } from '@ant-design/icons'
import axios from 'axios'
import { publicApi } from '../api'

interface SiteConfig {
  site_title: string
  site_description: string
  success_message: string
  footer_text: string
}

interface RedeemResult {
  success: boolean
  message: string
  team_name?: string
  expires_at?: string
  remaining_days?: number
  is_first_use?: boolean
}

export default function DirectInvite() {
  const { code: urlCode } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(urlCode?.toUpperCase() || '')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)

  // 状态查询相关
  const [queryEmail, setQueryEmail] = useState('')
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<any>(null)

  useEffect(() => {
    publicApi.getSiteConfig()
      .then((res: any) => {
        setSiteConfig(res)
        if (res.site_title) {
          document.title = res.site_title
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (urlCode) {
      setCode(urlCode.toUpperCase())
    }
  }, [urlCode])

  const handleSubmit = async () => {
    if (!email || !email.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }
    if (!code || code.trim().length === 0) {
      message.error('请输入兑换码')
      return
    }

    setSubmitting(true)
    try {
      // 调用 direct-redeem 接口（商业版）
      const res = await axios.post('/api/v1/public/direct-redeem', {
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase()
      })
      setSuccess(true)
      setRedeemResult(res.data)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      message.error(typeof detail === 'object' ? detail.message : detail || '兑换失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 查询状态
  const handleQueryStatus = async () => {
    if (!queryEmail || !queryEmail.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }

    setQuerying(true)
    try {
      const res = await axios.get('/api/v1/public/invite-status', {
        params: { email: queryEmail.trim().toLowerCase() }
      })
      setStatusResult(res.data)
    } catch (e: any) {
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  // 计算剩余天数颜色
  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'  // 绿色
    if (days > 5) return '#ff9500'   // 橙色
    return '#ff3b30'                  // 红色
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)',
      padding: 20,
    }}>
      {/* 装饰光晕 */}
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.08) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(88, 86, 214, 0.06) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />

      <Card style={{
        width: 440,
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 24,
        border: 'none',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/logo.jpg"
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              objectFit: 'cover',
              margin: '0 auto 20px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              display: 'block',
            }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: '#1d1d1f' }}>
            {siteConfig?.site_title || 'ChatGPT Team'}
          </h1>
          <p style={{ color: '#86868b', fontSize: 15, margin: 0 }}>
            输入邮箱和兑换码加入 Team
          </p>
        </div>

        {/* 成功状态 */}
        {success && redeemResult ? (
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#34c759' }} />}
            title={redeemResult.is_first_use ? "兑换码已激活！" : "邀请已发送！"}
            subTitle={
              <div>
                <p style={{ margin: '0 0 12px', color: '#1d1d1f' }}>{redeemResult.message}</p>

                {/* 有效期信息 */}
                {redeemResult.remaining_days !== null && redeemResult.remaining_days !== undefined && (
                  <div style={{
                    background: 'rgba(0, 122, 255, 0.08)',
                    padding: '12px 16px',
                    borderRadius: 12,
                    marginBottom: 12
                  }}>
                    <ClockCircleOutlined style={{ marginRight: 8, color: getDaysColor(redeemResult.remaining_days) }} />
                    <span style={{ color: getDaysColor(redeemResult.remaining_days), fontWeight: 600 }}>
                      有效期剩余 {redeemResult.remaining_days} 天
                    </span>
                    {redeemResult.expires_at && (
                      <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                        到期时间：{new Date(redeemResult.expires_at).toLocaleDateString('zh-CN')}
                      </div>
                    )}
                  </div>
                )}

                {redeemResult.is_first_use && (
                  <Tag color="blue" style={{ marginBottom: 12 }}>首次激活，邮箱已绑定</Tag>
                )}

                <p style={{ color: '#ff9500', fontSize: 13, marginTop: 8 }}>
                  {siteConfig?.success_message || '请查收邮箱并接受邀请'}
                </p>
              </div>
            }
          />
        ) : (
          <div>
            {/* 邮箱输入 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>邮箱地址</div>
              <Input
                prefix={<MailOutlined style={{ color: '#86868b' }} />}
                placeholder="your@email.com"
                size="large"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7' }}
              />
            </div>

            {/* 兑换码输入 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
              <Input
                prefix={<KeyOutlined style={{ color: '#86868b' }} />}
                placeholder="输入兑换码"
                size="large"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onPressEnter={handleSubmit}
                style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }}
              />
              <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>
                首次使用将绑定邮箱，有效期 30 天
              </div>
            </div>

            <Button
              type="primary"
              block
              size="large"
              loading={submitting}
              onClick={handleSubmit}
              disabled={!email || !code}
              style={{
                height: 48,
                borderRadius: 12,
                fontWeight: 600,
                background: '#007aff',
                border: 'none',
              }}
            >
              立即上车
            </Button>

            {/* 状态查询区域 */}
            <div style={{ marginTop: 24, padding: 16, background: 'rgba(0, 0, 0, 0.02)', borderRadius: 12 }}>
              <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 12, fontSize: 14 }}>
                <SearchOutlined style={{ marginRight: 8 }} />
                查询邀请状态
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="输入邮箱查询"
                  size="middle"
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
                <div style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 8, fontSize: 13 }}>
                  {statusResult.found ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span>状态：</span>
                        <Tag color={
                          statusResult.status === 'success' ? 'success' :
                          statusResult.status === 'waiting' ? 'orange' :
                          statusResult.status === 'processing' ? 'processing' :
                          statusResult.status === 'pending' ? 'blue' : 'error'
                        }>
                          {statusResult.status === 'success' ? '成功' :
                           statusResult.status === 'waiting' ? '等待中' :
                           statusResult.status === 'processing' ? '处理中' :
                           statusResult.status === 'pending' ? '排队中' : '失败'}
                        </Tag>
                      </div>
                      <div style={{ color: '#86868b' }}>{statusResult.status_message}</div>
                      {statusResult.queue_position && (
                        <div style={{ color: '#ff9500', marginTop: 4 }}>
                          队列位置：第 {statusResult.queue_position} 位
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: '#86868b' }}>未找到该邮箱的邀请记录</div>
                  )}
                </div>
              )}
            </div>

            {/* 使用说明 */}
            <div style={{ marginTop: 16, padding: 16, background: 'rgba(0, 122, 255, 0.04)', borderRadius: 12, fontSize: 13, color: '#86868b', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 8 }}>使用说明</div>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>首次使用兑换码将自动绑定邮箱</li>
                <li>绑定后只能使用该邮箱兑换</li>
                <li>有效期 30 天，从首次使用开始计算</li>
                <li>过期后需要联系管理员续期</li>
              </ol>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card, Row, Col, Input, Button, message, Spin, Result, Tag, Tabs, Grid, Space, Typography } from 'antd'
import {
  MailOutlined, KeyOutlined, CheckCircleOutlined, ClockCircleOutlined,
  RocketOutlined, SwapOutlined, TeamOutlined, HourglassOutlined, QuestionCircleOutlined,
  SafetyOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import axios from 'axios'
import { publicApi } from '../api'

const { useBreakpoint } = Grid
const { Title, Text } = Typography

// 特性列表
const features = [
  { icon: <SafetyOutlined style={{ color: '#10a37f', fontSize: 20 }} />, title: '安全稳定', desc: '官方 Team 账号，数据隔离' },
  { icon: <ThunderboltOutlined style={{ color: '#10a37f', fontSize: 20 }} />, title: 'GPT-5 系列', desc: '无消息限制，畅享最新模型' },
  { icon: <SwapOutlined style={{ color: '#10a37f', fontSize: 20 }} />, title: '自助换车', desc: 'Team 失效时可自助转移' },
]

interface Feature {
  icon: string
  title: string
  description: string
}

interface SiteConfig {
  site_title: string
  site_description: string
  success_message: string
  footer_text: string
  hero_title?: string
  hero_subtitle?: string
  features?: Feature[]
  is_simple_page?: boolean  // 纯净页面：只显示兑换表单
}

interface RedeemResult {
  success: boolean
  message: string
  team_name?: string
  expires_at?: string
  remaining_days?: number
  is_first_use?: boolean
  // 方案 B: 座位满进入等待队列
  state?: 'INVITE_QUEUED' | 'WAITING_FOR_SEAT'
  queue_position?: number
}

interface RebindResult {
  success: boolean
  message: string
  new_team_name?: string
  state?: 'INVITE_QUEUED' | 'WAITING_FOR_SEAT'
  queue_position?: number
  email?: string
}

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

export default function DirectInvite() {
  const { code: urlCode } = useParams<{ code: string }>()
  const screens = useBreakpoint()

  const [loading, setLoading] = useState(true)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)

  // 兑换状态
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(urlCode?.toUpperCase() || '')
  const [submitting, setSubmitting] = useState(false)
  const [redeemSuccess, setRedeemSuccess] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)

  // 换车状态（简化版：只需兑换码）
  const [rebindCode, setRebindCode] = useState('')
  const [rebindSubmitting, setRebindSubmitting] = useState(false)
  const [rebindSuccess, setRebindSuccess] = useState(false)
  const [rebindResult, setRebindResult] = useState<RebindResult | null>(null)
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null)

  // Tab 状态
  const [activeTab, setActiveTab] = useState('redeem')

  useEffect(() => {
    publicApi.getSiteConfig()
      .then((res: any) => {
        setSiteConfig(res)
        if (res.site_title) document.title = res.site_title
      })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (urlCode) {
      setCode(urlCode.toUpperCase())
      setActiveTab('redeem')
    }
  }, [urlCode])

  // 等待队列轮询（兑换）
  useEffect(() => {
    if (redeemResult?.state !== 'WAITING_FOR_SEAT' || !email) return
    let cancelled = false

    const pollStatus = async () => {
      try {
        const res: any = await publicApi.getInviteStatus(email.trim().toLowerCase())
        if (cancelled || !res?.found) return
        if (res.status === 'waiting') {
          setRedeemResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            queue_position: res.queue_position ?? prev.queue_position,
          } : prev)
        } else {
          setRedeemResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            team_name: res.team_name || prev.team_name,
            state: 'INVITE_QUEUED',
            queue_position: undefined,
          } : prev)
        }
      } catch {
        // ignore polling errors
      }
    }

    pollStatus()
    const timer = window.setInterval(pollStatus, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [redeemResult?.state, email])

  // 等待队列轮询（换车）
  useEffect(() => {
    if (rebindResult?.state !== 'WAITING_FOR_SEAT' || !rebindResult.email) return
    let cancelled = false

    const pollStatus = async () => {
      try {
        const res: any = await publicApi.getInviteStatus(rebindResult.email as string)
        if (cancelled || !res?.found) return
        if (res.status === 'waiting') {
          setRebindResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            queue_position: res.queue_position ?? prev.queue_position,
          } : prev)
        } else {
          setRebindResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            state: 'INVITE_QUEUED',
            queue_position: undefined,
          } : prev)
        }
      } catch {
        // ignore polling errors
      }
    }

    pollStatus()
    const timer = window.setInterval(pollStatus, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [rebindResult?.state, rebindResult?.email])

  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'
    if (days > 5) return '#ff9500'
    return '#ff3b30'
  }

  const handleRedeem = async () => {
    if (!email || !email.includes('@')) { message.error('请输入有效的邮箱地址'); return }
    if (!code || code.trim().length === 0) { message.error('请输入兑换码'); return }
    setSubmitting(true)
    try {
      const res = await axios.post('/api/v1/public/direct-redeem', {
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase()
      })
      setRedeemSuccess(true)
      setRedeemResult(res.data)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      message.error(typeof detail === 'object' ? detail.message : detail || '兑换失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRebind = async () => {
    if (!rebindCode || rebindCode.trim().length === 0) { message.error('请输入兑换码'); return }
    setRebindSubmitting(true)
    try {
      const res: any = await publicApi.rebind({
        code: rebindCode.trim().toUpperCase()
      })
      setRebindSuccess(true)
      setRebindResult(res)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      message.error(typeof detail === 'object' ? detail.message : detail || '换车失败')
    } finally {
      setRebindSubmitting(false)
    }
  }

  const handleQueryStatus = async () => {
    const trimmedCode = rebindCode.trim().toUpperCase()
    if (!trimmedCode) { message.error('请输入兑换码'); return }
    setQuerying(true)
    setStatusResult(null)
    try {
      const res: any = await publicApi.getStatus({ code: trimmedCode })
      setStatusResult(res)
    } catch {
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  // 兑换成功
  const renderRedeemSuccess = () => {
    const isWaiting = redeemResult?.state === 'WAITING_FOR_SEAT'

    return (
      <Result
        status={isWaiting ? 'info' : 'success'}
        icon={isWaiting
          ? <HourglassOutlined style={{ color: '#ff9500' }} />
          : <CheckCircleOutlined style={{ color: '#34c759' }} />
        }
        title={isWaiting
          ? '已进入等待队列'
          : (redeemResult?.is_first_use ? '兑换码已绑定！' : '请求已提交！')
        }
        subTitle={
          <div>
            <p style={{ margin: '0 0 12px', color: '#1d1d1f' }}>{redeemResult?.message}</p>
            {/* 等待队列状态显示 */}
            {isWaiting && redeemResult?.queue_position && (
              <div style={{ background: 'rgba(255, 149, 0, 0.1)', padding: '16px 20px', borderRadius: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <HourglassOutlined style={{ color: '#ff9500', fontSize: 18 }} />
                  <span style={{ color: '#ff9500', fontWeight: 600, fontSize: 16 }}>
                    排队位置：第 {redeemResult.queue_position} 位
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#86868b' }}>
                  系统将在有空位时自动发送邀请到您的邮箱
                </div>
              </div>
            )}
            {/* 有效期显示 */}
            {redeemResult?.remaining_days !== null && redeemResult?.remaining_days !== undefined && (
              <div style={{ background: 'rgba(16, 163, 127, 0.08)', padding: '12px 16px', borderRadius: 12, marginBottom: 12 }}>
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
            {redeemResult?.is_first_use && <Tag color="blue" style={{ marginBottom: 12 }}>首次绑定，邮箱已绑定</Tag>}
            {!isWaiting && (
              <p style={{ color: '#ff9500', fontSize: 13, marginTop: 8 }}>
                {siteConfig?.success_message || '请查收邮箱并接受邀请'}
              </p>
            )}
          </div>
        }
        extra={<Button type="primary" onClick={() => { setRedeemSuccess(false); setRedeemResult(null) }} style={{ borderRadius: 8 }}>继续兑换</Button>}
      />
    )
  }

  // 换车成功/等待
  const renderRebindSuccess = () => {
    const isWaiting = rebindResult?.state === 'WAITING_FOR_SEAT'
    return (
      <Result
        status={isWaiting ? 'info' : 'success'}
        icon={isWaiting
          ? <HourglassOutlined style={{ color: '#ff9500' }} />
          : <CheckCircleOutlined style={{ color: '#34c759' }} />
        }
        title={isWaiting ? '换车已进入等待队列' : '换车请求已提交'}
        subTitle={
          <div>
            <p style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{rebindResult?.message}</p>
            {isWaiting && rebindResult?.queue_position && (
              <div style={{ background: 'rgba(255, 149, 0, 0.1)', padding: '12px 16px', borderRadius: 12, marginBottom: 8 }}>
                <HourglassOutlined style={{ color: '#ff9500', marginRight: 6 }} />
                <span style={{ color: '#ff9500', fontWeight: 600 }}>排队位置：第 {rebindResult.queue_position} 位</span>
              </div>
            )}
            {!isWaiting && (
              <p style={{ margin: 0, color: '#ff9500' }}>请查收邮箱并接受新邀请</p>
            )}
          </div>
        }
        extra={<Button type="primary" onClick={() => { setRebindSuccess(false); setRebindResult(null) }} style={{ borderRadius: 8 }}>继续操作</Button>}
      />
    )
  }

  // 兑换表单
  const renderRedeemForm = () => (
    <div>
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
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
        <Input
          prefix={<KeyOutlined style={{ color: '#86868b' }} />}
          placeholder="输入兑换码"
          size="large"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onPressEnter={handleRedeem}
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
        onClick={handleRedeem}
        disabled={!email || !code}
        icon={<RocketOutlined />}
        style={{ height: 48, borderRadius: 12, fontWeight: 600, background: '#10a37f', border: 'none' }}
      >
        立即上车
      </Button>
    </div>
  )

  // 换车表单（简化版：只需兑换码）
  const renderRebindForm = () => (
    <div>
      {/* 兑换码输入 + 查询 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            prefix={<KeyOutlined style={{ color: '#86868b' }} />}
            placeholder="输入您的兑换码"
            size="large"
            value={rebindCode}
            onChange={e => {
              setRebindCode(e.target.value.toUpperCase())
              setStatusResult(null)  // 清除之前的查询结果
            }}
            onPressEnter={handleQueryStatus}
            style={{ flex: 1, height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }}
          />
          <Button
            onClick={handleQueryStatus}
            loading={querying}
            size="large"
            style={{ height: 48, borderRadius: 12 }}
          >
            查询
          </Button>
        </div>
        <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>
          输入兑换码后点击查询，查看绑定状态
        </div>
      </div>

      {/* 查询结果 */}
      {statusResult && (
        <div style={{ marginBottom: 20 }}>
          {statusResult.found ? (
            <div style={{ padding: 16, background: 'rgba(16, 163, 127, 0.04)', borderRadius: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <MailOutlined style={{ color: '#10a37f' }} />
                <span>绑定邮箱：</span>
                <span style={{ fontWeight: 600 }}>{statusResult.email || '未绑定'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <TeamOutlined style={{ color: '#10a37f' }} />
                <span>当前 Team：</span>
                <span style={{ fontWeight: 500 }}>{statusResult.team_name || '未知'}</span>
                {statusResult.team_active !== undefined && (
                  <Tag color={statusResult.team_active ? 'success' : 'error'} style={{ marginLeft: 4 }}>
                    {statusResult.team_active ? '正常' : '异常'}
                  </Tag>
                )}
              </div>
              {statusResult.remaining_days !== null && statusResult.remaining_days !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <ClockCircleOutlined style={{ color: getDaysColor(statusResult.remaining_days) }} />
                  <span style={{ color: getDaysColor(statusResult.remaining_days), fontWeight: 600 }}>
                    剩余 {statusResult.remaining_days} 天
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30' }} />
                <span style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30', fontWeight: 500 }}>
                  {statusResult.can_rebind ? '可以换车（仅一次机会，激活后15天内）' : '暂时无法换车（机会已用完/已过期/超过15天）'}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ padding: 16, background: 'rgba(255, 59, 48, 0.04)', borderRadius: 12, textAlign: 'center', color: '#ff3b30' }}>
              未找到该兑换码的绑定记录，请确认兑换码正确
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16, fontSize: 12, color: '#d97706' }}>
        仅一次换车机会，且需在激活后 15 天内使用；请确认当前 Team 已封禁后再使用，若在正常状态换车，后续封禁将不再提供第二次换车。
      </div>

      {/* 换车按钮 */}
      <Button
        type="primary"
        block
        size="large"
        loading={rebindSubmitting}
        onClick={handleRebind}
        disabled={!rebindCode || (statusResult !== null && !statusResult.can_rebind)}
        icon={<SwapOutlined />}
        style={{ height: 48, borderRadius: 12, fontWeight: 600, background: '#10a37f', border: 'none' }}
      >
        立即换车
      </Button>
    </div>
  )

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      }}>
        <Spin size="large" />
      </div>
    )
  }

  const isMobile = !screens.md

  // 居中卡片 + 左右分栏设计
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isMobile ? 16 : 40,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: '-15%',
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
        left: '-5%',
        width: 400,
        height: 400,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* 主卡片 */}
      <Card
        style={{
          width: '100%',
          maxWidth: isMobile ? 480 : 960,
          background: '#fff',
          borderRadius: 20,
          border: 'none',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
        }}
        bodyStyle={{ padding: 0 }}
      >
        <Row>
          {/* 左侧介绍区域 */}
          {!isMobile && (
            <Col span={10}>
              <div style={{
                padding: '48px 40px',
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                borderRight: '1px solid #e5e7eb',
              }}>
                {/* Logo */}
                <img
                  src="/logo.png"
                  alt="Logo"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    objectFit: 'cover',
                    boxShadow: '0 8px 24px rgba(16, 163, 127, 0.15)',
                    marginBottom: 24,
                  }}
                />

                {/* 标题 */}
                <Title level={2} style={{ margin: '0 0 12px', color: '#1f2937', fontWeight: 700, letterSpacing: '-0.5px' }}>
                  {siteConfig?.site_title || 'ChatGPT Team'}
                </Title>
                <Text style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.6, display: 'block', marginBottom: 32 }}>
                  {siteConfig?.hero_subtitle || '专业的自助兑换服务，稳定可靠，即时开通'}
                </Text>

                {/* 特性列表 */}
                <Space direction="vertical" size={16}>
                  {features.map((feature, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'rgba(16, 163, 127, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {feature.icon}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>{feature.title}</div>
                        <div style={{ color: '#9ca3af', fontSize: 13 }}>{feature.desc}</div>
                      </div>
                    </div>
                  ))}
                </Space>

                {/* 底部链接 */}
                <div style={{ marginTop: 'auto', paddingTop: 32 }}>
                  <Space split={<span style={{ color: '#e5e7eb' }}>·</span>} size={12}>
                    <Link to="/faq" style={{ color: '#9ca3af', fontSize: 12 }}>常见问题</Link>
                    <Link to="/legal#terms" style={{ color: '#9ca3af', fontSize: 12 }}>服务条款</Link>
                  </Space>
                </div>
              </div>
            </Col>
          )}

          {/* 右侧表单区域 */}
          <Col span={isMobile ? 24 : 14}>
            <div style={{ padding: isMobile ? 28 : '48px 44px' }}>
              {/* 移动端显示 Logo 和标题 */}
              {isMobile && (
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <img
                    src="/logo.png"
                    alt="Logo"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 14,
                      objectFit: 'cover',
                      boxShadow: '0 8px 24px rgba(16, 163, 127, 0.15)',
                      marginBottom: 12,
                    }}
                  />
                  <Title level={4} style={{ margin: '0 0 4px', color: '#1f2937', fontWeight: 700 }}>
                    {siteConfig?.site_title || 'ChatGPT Team'}
                  </Title>
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>
                    {siteConfig?.hero_subtitle || '自助兑换服务'}
                  </Text>
                </div>
              )}

              {/* Tab 切换 */}
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                centered={isMobile}
                size="large"
                items={[
                  {
                    key: 'redeem',
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <RocketOutlined />
                        兑换上车
                      </span>
                    ),
                    children: redeemSuccess && redeemResult ? renderRedeemSuccess() : renderRedeemForm()
                  },
                  {
                    key: 'rebind',
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <SwapOutlined />
                        自助换车
                      </span>
                    ),
                    children: rebindSuccess && rebindResult ? renderRebindSuccess() : renderRebindForm()
                  }
                ]}
              />

              {/* 使用说明 */}
              <div style={{
                marginTop: 24,
                padding: '16px 18px',
                background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.06) 0%, rgba(16, 163, 127, 0.02) 100%)',
                borderRadius: 14,
                fontSize: 13,
                color: '#6b7280',
                lineHeight: 1.8,
                border: '1px solid rgba(16, 163, 127, 0.1)',
              }}>
                <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <QuestionCircleOutlined style={{ color: '#10a37f' }} />
                  使用说明
                </div>
                {activeTab === 'redeem' ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>首次使用兑换码将自动绑定邮箱</li>
                    <li>绑定后只能使用该邮箱兑换</li>
                    <li>有效期从首次使用开始计算</li>
                  </ul>
                ) : (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>输入兑换码查询绑定状态</li>
                    <li>每个兑换码仅有 1 次换车机会</li>
                    <li>换车需在激活后 15 天内完成</li>
                    <li>请确认当前 Team 已封禁后再换车（若在正常状态换车，后续封禁将不再提供第二次）</li>
                    <li>换车后原 Team 邀请失效</li>
                  </ul>
                )}
              </div>

              {/* 移动端显示底部链接 */}
              {isMobile && (
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <Space split={<span style={{ color: '#e5e7eb' }}>·</span>} size={12}>
                    <Link to="/faq" style={{ color: '#9ca3af', fontSize: 12 }}>常见问题</Link>
                    <Link to="/legal#terms" style={{ color: '#9ca3af', fontSize: 12 }}>服务条款</Link>
                    <Link to="/legal#privacy" style={{ color: '#9ca3af', fontSize: 12 }}>隐私政策</Link>
                  </Space>
                  <div style={{ marginTop: 12, color: '#9ca3af', fontSize: 11 }}>
                    {siteConfig?.footer_text || '© 2025 ZenScale AI. All rights reserved.'}
                  </div>
                </div>
              )}
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  )
}

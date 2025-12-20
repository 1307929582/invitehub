import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Input, Button, message, Spin, Result, Tag, Tabs, Row, Col, Grid, Space, Typography } from 'antd'
import {
  MailOutlined, KeyOutlined, CheckCircleOutlined, ClockCircleOutlined,
  RocketOutlined, SwapOutlined, TeamOutlined,
  SafetyOutlined, ThunderboltOutlined, CustomerServiceOutlined, StarOutlined,
  HourglassOutlined
} from '@ant-design/icons'
import axios from 'axios'
import { publicApi } from '../api'

const { useBreakpoint } = Grid
const { Title, Paragraph, Text } = Typography

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

const iconMap: { [key: string]: React.ReactNode } = {
  SafetyOutlined: <SafetyOutlined />,
  ThunderboltOutlined: <ThunderboltOutlined />,
  TeamOutlined: <TeamOutlined />,
  CustomerServiceOutlined: <CustomerServiceOutlined />,
  StarOutlined: <StarOutlined />,
  RocketOutlined: <RocketOutlined />,
}

const DynamicIcon = ({ name }: { name: string }) => iconMap[name] || <StarOutlined />

const defaultFeatures: Feature[] = [
  { icon: 'SafetyOutlined', title: '安全稳定', description: '官方 Team 账号，数据隔离，稳定可靠' },
  { icon: 'ThunderboltOutlined', title: 'GPT-5 系列', description: 'Team 版本无消息限制，畅享最新模型' },
  { icon: 'CustomerServiceOutlined', title: '自助换车', description: 'Team 失效时可自助换车，无需等待' },
]

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
          : (redeemResult?.is_first_use ? '兑换码已激活！' : '请求已提交！')
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
              <div style={{ background: 'rgba(0, 122, 255, 0.08)', padding: '12px 16px', borderRadius: 12, marginBottom: 12 }}>
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
            {redeemResult?.is_first_use && <Tag color="blue" style={{ marginBottom: 12 }}>首次激活，邮箱已绑定</Tag>}
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

  // 换车成功
  const renderRebindSuccess = () => (
    <Result
      status="success"
      icon={<CheckCircleOutlined style={{ color: '#34c759' }} />}
      title="换车请求已提交"
      subTitle={
        <div>
          <p style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{rebindResult?.message}</p>
          <p style={{ margin: 0, color: '#ff9500' }}>请查收邮箱并接受新邀请</p>
        </div>
      }
      extra={<Button type="primary" onClick={() => { setRebindSuccess(false); setRebindResult(null) }} style={{ borderRadius: 8 }}>继续操作</Button>}
    />
  )

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
        style={{ height: 48, borderRadius: 12, fontWeight: 600, background: '#007aff', border: 'none' }}
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
            <div style={{ padding: 16, background: 'rgba(0, 122, 255, 0.04)', borderRadius: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <MailOutlined style={{ color: '#007aff' }} />
                <span>绑定邮箱：</span>
                <span style={{ fontWeight: 600 }}>{statusResult.email || '未绑定'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <TeamOutlined style={{ color: '#007aff' }} />
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
                  {statusResult.can_rebind ? '可以换车' : '暂时无法换车（仅 Team 被封时可换车）'}
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

      {/* 换车按钮 */}
      <Button
        type="primary"
        block
        size="large"
        loading={rebindSubmitting}
        onClick={handleRebind}
        disabled={!rebindCode || (statusResult !== null && !statusResult.can_rebind)}
        icon={<SwapOutlined />}
        style={{ height: 48, borderRadius: 12, fontWeight: 600, background: '#007aff', border: 'none' }}
      >
        立即换车
      </Button>
    </div>
  )

  // 左侧面板
  const renderLeftPanel = () => (
    <div style={{
      padding: screens.lg ? '60px 50px' : '40px 24px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      minHeight: screens.md ? '100vh' : 'auto',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40 }}>
          <img src="/logo.jpg" alt="Logo" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }} />
          <Title level={3} style={{ margin: 0, color: 'white', fontWeight: 700 }}>
            {siteConfig?.site_title || 'ChatGPT Team'}
          </Title>
        </div>

        <Title level={1} style={{
          margin: '0 0 20px',
          color: 'white',
          fontWeight: 800,
          fontSize: screens.lg ? 42 : 32,
          letterSpacing: '-1px',
        }}>
          {siteConfig?.hero_title || '欢迎加入 Team'}
        </Title>

        <Paragraph style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: screens.lg ? 18 : 16, lineHeight: 1.7, marginBottom: 40 }}>
          {siteConfig?.hero_subtitle || '自助兑换服务，为您提供稳定、可靠的 ChatGPT Team 邀请。'}
        </Paragraph>

        <Space direction="vertical" size={28}>
          {(siteConfig?.features || defaultFeatures).map((feature, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                color: 'rgba(255, 255, 255, 0.9)',
                flexShrink: 0,
              }}>
                <DynamicIcon name={feature.icon} />
              </div>
              <div>
                <Text style={{ fontSize: 16, color: 'white', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {feature.title}
                </Text>
                <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14 }}>
                  {feature.description}
                </Text>
              </div>
            </div>
          ))}
        </Space>
      </div>

      <div style={{ marginTop: 40 }}>
        {/* 推广信息 */}
        <div style={{ marginBottom: 20, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <RocketOutlined style={{ color: '#34c759', fontSize: 18 }} />
            <Text style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>API 服务</Text>
          </div>
          <Text style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: 13 }}>
            OpenAI 兼容 API：<a href="https://mmw.zenscaleai.com" target="_blank" rel="noopener noreferrer" style={{ color: '#34c759', fontWeight: 500 }}>mmw.zenscaleai.com</a>
          </Text>
        </div>
        <div style={{ marginBottom: 20, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <TeamOutlined style={{ color: '#007aff', fontSize: 18 }} />
            <Text style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>成为分销商</Text>
          </div>
          <Text style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: 13 }}>
            想成为分销商？联系 TG：<a href="https://t.me/sqbbzsy" target="_blank" rel="noopener noreferrer" style={{ color: '#007aff', fontWeight: 500 }}>@sqbbzsy</a>
          </Text>
        </div>
        {/* 版权信息 */}
        <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: 12 }}>
          {siteConfig?.footer_text || '© 2024 ChatGPT Team. All rights reserved.'}
        </div>
      </div>
    </div>
  )

  // 右侧面板
  const renderRightPanel = () => (
    <div style={{
      height: '100%',
      minHeight: screens.md ? '100vh' : 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: screens.md ? 40 : 20,
      position: 'relative',
    }}>
      {/* 装饰光晕 */}
      {screens.md && (
        <>
          <div style={{ position: 'absolute', top: '-10%', right: '-20%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.08) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
          <div style={{ position: 'absolute', bottom: '-10%', left: '-10%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(88, 86, 214, 0.06) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
        </>
      )}

      <Card style={{
        width: '100%',
        maxWidth: 460,
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 24,
        border: 'none',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* 移动端显示 Logo */}
        {!screens.md && (
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <img src="/logo.jpg" alt="Logo" style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover', margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)', display: 'block' }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: '#1d1d1f' }}>{siteConfig?.site_title || 'ChatGPT Team'}</h1>
            <p style={{ color: '#86868b', fontSize: 14, margin: 0 }}>自助兑换和换车服务</p>
          </div>
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: 'redeem',
              label: <span><RocketOutlined style={{ marginRight: 6 }} />兑换上车</span>,
              children: redeemSuccess && redeemResult ? renderRedeemSuccess() : renderRedeemForm()
            },
            {
              key: 'rebind',
              label: <span><SwapOutlined style={{ marginRight: 6 }} />自助换车</span>,
              children: rebindSuccess && rebindResult ? renderRebindSuccess() : renderRebindForm()
            }
          ]}
        />

        <div style={{ marginTop: 16, padding: 14, background: 'rgba(0, 122, 255, 0.04)', borderRadius: 12, fontSize: 12, color: '#86868b', lineHeight: 1.8 }}>
          <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 6 }}>使用说明</div>
          {activeTab === 'redeem' ? (
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              <li>首次使用兑换码将自动绑定邮箱</li>
              <li>绑定后只能使用该邮箱兑换</li>
              <li>有效期 30 天，从首次使用开始计算</li>
            </ol>
          ) : (
            <ol style={{ paddingLeft: 18, margin: 0 }}>
              <li>输入兑换码查询绑定状态</li>
              <li>仅当 Team 被封时可以换车</li>
              <li>换车后原 Team 邀请失效</li>
            </ol>
          )}
        </div>
      </Card>
    </div>
  )

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  // 纯净页面：只显示兑换表单（居中）
  if (siteConfig?.is_simple_page) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}>
        {renderRightPanel()}
      </div>
    )
  }

  // 移动端：上下布局
  if (!screens.md) {
    return (
      <div style={{ minHeight: '100vh' }}>
        <div style={{ background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)' }}>
          {renderLeftPanel()}
        </div>
        <div style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
          {renderRightPanel()}
        </div>
      </div>
    )
  }

  // 桌面端：左右布局
  return (
    <Row style={{ minHeight: '100vh' }}>
      <Col span={12} style={{ background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)' }}>
        {renderLeftPanel()}
      </Col>
      <Col span={12} style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        {renderRightPanel()}
      </Col>
    </Row>
  )
}

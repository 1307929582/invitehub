import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Input, Button, message, Spin, Result, Tag, Tabs, Radio } from 'antd'
import {
  MailOutlined, KeyOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SearchOutlined, RocketOutlined, SwapOutlined, TeamOutlined
} from '@ant-design/icons'
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

export default function DirectInvite() {
  const { code: urlCode } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)

  // 兑换相关
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(urlCode?.toUpperCase() || '')
  const [submitting, setSubmitting] = useState(false)
  const [redeemSuccess, setRedeemSuccess] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)

  // 换车相关
  const [rebindEmail, setRebindEmail] = useState('')
  const [rebindCode, setRebindCode] = useState('')
  const [rebindSubmitting, setRebindSubmitting] = useState(false)
  const [rebindSuccess, setRebindSuccess] = useState(false)
  const [rebindResult, setRebindResult] = useState<RebindResult | null>(null)

  // 状态查询相关
  const [queryType, setQueryType] = useState<'email' | 'code'>('email')
  const [queryValue, setQueryValue] = useState('')
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null)

  // Tab 状态
  const [activeTab, setActiveTab] = useState('redeem')

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

  // 计算剩余天数颜色
  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'
    if (days > 5) return '#ff9500'
    return '#ff3b30'
  }

  // 兑换提交
  const handleRedeem = async () => {
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

  // 换车提交
  const handleRebind = async () => {
    if (!rebindEmail || !rebindEmail.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }
    if (!rebindCode || rebindCode.trim().length === 0) {
      message.error('请输入兑换码')
      return
    }

    setRebindSubmitting(true)
    try {
      const res: any = await publicApi.rebind({
        email: rebindEmail.trim().toLowerCase(),
        code: rebindCode.trim().toUpperCase()
      })
      setRebindSuccess(true)
      setRebindResult(res)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      const errorMsg = typeof detail === 'object' ? detail.message : detail || '换车失败'
      message.error(errorMsg)
    } finally {
      setRebindSubmitting(false)
    }
  }

  // 查询状态
  const handleQueryStatus = async () => {
    const value = queryValue.trim()
    if (!value) {
      message.error(queryType === 'email' ? '请输入邮箱地址' : '请输入兑换码')
      return
    }

    if (queryType === 'email' && !value.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }

    setQuerying(true)
    setStatusResult(null)
    try {
      const params = queryType === 'email'
        ? { email: value.toLowerCase() }
        : { code: value.toUpperCase() }
      const res: any = await publicApi.getStatus(params)
      setStatusResult(res)
      if (res.found && res.email) {
        // 自动填充换车表单
        setRebindEmail(res.email)
      }
    } catch (e: any) {
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  // 兑换成功结果
  const renderRedeemSuccess = () => (
    <Result
      status="success"
      icon={<CheckCircleOutlined style={{ color: '#34c759' }} />}
      title={redeemResult?.is_first_use ? "兑换码已激活！" : "邀请已发送！"}
      subTitle={
        <div>
          <p style={{ margin: '0 0 12px', color: '#1d1d1f' }}>{redeemResult?.message}</p>
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
          <p style={{ color: '#ff9500', fontSize: 13, marginTop: 8 }}>
            {siteConfig?.success_message || '请查收邮箱并接受邀请'}
          </p>
        </div>
      }
      extra={<Button type="primary" onClick={() => { setRedeemSuccess(false); setRedeemResult(null) }} style={{ borderRadius: 8 }}>继续兑换</Button>}
    />
  )

  // 换车成功结果
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

  // 换车表单
  const renderRebindForm = () => (
    <div>
      {/* 状态查询 */}
      <div style={{ marginBottom: 20, padding: 16, background: 'rgba(0, 0, 0, 0.02)', borderRadius: 12 }}>
        <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 12, fontSize: 14 }}>
          <SearchOutlined style={{ marginRight: 8 }} />
          查询当前状态
        </div>
        <Radio.Group
          value={queryType}
          onChange={e => { setQueryType(e.target.value); setQueryValue(''); setStatusResult(null) }}
          size="small"
          style={{ marginBottom: 12 }}
        >
          <Radio.Button value="email">按邮箱</Radio.Button>
          <Radio.Button value="code">按兑换码</Radio.Button>
        </Radio.Group>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            prefix={queryType === 'email' ? <MailOutlined style={{ color: '#86868b' }} /> : <KeyOutlined style={{ color: '#86868b' }} />}
            placeholder={queryType === 'email' ? '输入邮箱查询' : '输入兑换码查询'}
            value={queryValue}
            onChange={e => setQueryValue(queryType === 'code' ? e.target.value.toUpperCase() : e.target.value)}
            onPressEnter={handleQueryStatus}
            style={{ flex: 1, borderRadius: 8, fontFamily: queryType === 'code' ? 'monospace' : 'inherit' }}
          />
          <Button onClick={handleQueryStatus} loading={querying} style={{ borderRadius: 8 }}>查询</Button>
        </div>

        {/* 查询结果 */}
        {statusResult && (
          <div style={{ marginTop: 12 }}>
            {statusResult.found ? (
              <div style={{ padding: 12, background: 'rgba(0, 122, 255, 0.04)', borderRadius: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <ClockCircleOutlined style={{ color: getDaysColor(statusResult.remaining_days) }} />
                    <span style={{ color: getDaysColor(statusResult.remaining_days), fontWeight: 600 }}>
                      剩余 {statusResult.remaining_days} 天
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30' }} />
                  <span style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30', fontWeight: 500 }}>
                    {statusResult.can_rebind ? '可以换车' : '暂时无法换车'}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ padding: 12, background: 'rgba(0, 0, 0, 0.02)', borderRadius: 8, textAlign: 'center', color: '#86868b' }}>
                未找到该邮箱的绑定记录
              </div>
            )}
          </div>
        )}
      </div>

      {/* 换车表单 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>邮箱地址</div>
        <Input
          prefix={<MailOutlined style={{ color: '#86868b' }} />}
          placeholder="your@email.com"
          size="large"
          value={rebindEmail}
          onChange={e => setRebindEmail(e.target.value)}
          style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7' }}
        />
      </div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
        <Input
          prefix={<KeyOutlined style={{ color: '#86868b' }} />}
          placeholder="输入绑定的兑换码"
          size="large"
          value={rebindCode}
          onChange={e => setRebindCode(e.target.value.toUpperCase())}
          onPressEnter={handleRebind}
          style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }}
        />
        <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>
          每个兑换码最多可换车 3 次
        </div>
      </div>
      <Button
        type="primary"
        block
        size="large"
        loading={rebindSubmitting}
        onClick={handleRebind}
        disabled={!rebindEmail || !rebindCode}
        icon={<SwapOutlined />}
        style={{ height: 48, borderRadius: 12, fontWeight: 600, background: '#007aff', border: 'none' }}
      >
        立即换车
      </Button>
    </div>
  )

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
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src="/logo.jpg"
            alt="Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              objectFit: 'cover',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              display: 'block',
            }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: '#1d1d1f' }}>
            {siteConfig?.site_title || 'ChatGPT Team'}
          </h1>
          <p style={{ color: '#86868b', fontSize: 14, margin: 0 }}>
            自助兑换和换车服务
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: 'redeem',
              label: (
                <span>
                  <RocketOutlined style={{ marginRight: 6 }} />
                  兑换上车
                </span>
              ),
              children: redeemSuccess && redeemResult ? renderRedeemSuccess() : renderRedeemForm()
            },
            {
              key: 'rebind',
              label: (
                <span>
                  <SwapOutlined style={{ marginRight: 6 }} />
                  自助换车
                </span>
              ),
              children: rebindSuccess && rebindResult ? renderRebindSuccess() : renderRebindForm()
            }
          ]}
        />

        {/* 使用说明 */}
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
              <li>每个兑换码最多可换车 3 次</li>
              <li>换车后原 Team 邀请失效</li>
              <li>兑换码过期后无法换车</li>
            </ol>
          )}
        </div>
      </Card>
    </div>
  )
}

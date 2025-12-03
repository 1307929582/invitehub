import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Input, Button, message, Spin, Result } from 'antd'
import { MailOutlined, KeyOutlined, CheckCircleOutlined } from '@ant-design/icons'
import axios from 'axios'
import { publicApi } from '../api'

interface SiteConfig {
  site_title: string
  site_description: string
  success_message: string
  footer_text: string
}

export default function DirectInvite() {
  const { code: urlCode } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(urlCode?.toUpperCase() || '')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [remainingDays, setRemainingDays] = useState<number | null>(null)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)

  useEffect(() => {
    // 获取站点配置
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

  // URL 中的兑换码变化时更新
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
      const res = await axios.post('/api/v1/public/redeem', {
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase()
      })
      setSuccess(true)
      setTeamName(res.data.team_name)
      setRemainingDays(res.data.remaining_days)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      if (typeof detail === 'object') {
        message.error(detail.message || '兑换失败')
      } else {
        message.error(detail || '兑换失败')
      }
    } finally {
      setSubmitting(false)
    }
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
        width: 420,
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
        {success ? (
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#34c759' }} />}
            title="邀请已发送！"
            subTitle={
              <div>
                <p style={{ margin: '0 0 8px' }}>已加入 {teamName || 'Team'}</p>
                {remainingDays !== null && (
                  <p style={{ color: '#007aff', fontSize: 14, margin: '0 0 8px' }}>
                    有效期剩余 {remainingDays} 天
                  </p>
                )}
                <p style={{ color: '#ff9500', fontSize: 13, marginTop: 12 }}>
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
                邀请邮件将发送到您的邮箱
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

            {/* 使用说明 */}
            <div style={{ marginTop: 24, padding: 16, background: 'rgba(0, 122, 255, 0.04)', borderRadius: 12, fontSize: 13, color: '#86868b', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#1d1d1f', marginBottom: 8 }}>📋 使用说明</div>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>输入您的邮箱地址和兑换码</li>
                <li>点击「立即上车」按钮</li>
                <li>查收邮箱中的 ChatGPT Team 邀请邮件</li>
                <li>点击邮件中的链接接受邀请</li>
              </ol>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Input, Button, message, Spin, Result } from 'antd'
import { MailOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import axios from 'axios'
import { publicApi } from '../api'

interface SiteConfig {
  site_title: string
  site_description: string
  success_message: string
  footer_text: string
}

export default function DirectInvite() {
  const { code } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [valid, setValid] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)

  useEffect(() => {
    // 获取站点配置
    publicApi.getSiteConfig().then((res: any) => {
      setSiteConfig(res)
      if (res.site_title) {
        document.title = res.site_title
      }
    }).catch(() => {})

    if (!code) {
      setError('无效的链接')
      setLoading(false)
      return
    }

    // 验证兑换码
    axios.get(`/api/v1/public/direct/${code}`)
      .then(() => {
        setValid(true)
      })
      .catch((e) => {
        setError(e.response?.data?.detail || '兑换码无效')
      })
      .finally(() => setLoading(false))
  }, [code])

  const handleSubmit = async () => {
    if (!email || !email.includes('@')) {
      message.error('请输入有效的邮箱地址')
      return
    }

    setSubmitting(true)
    try {
      const res = await axios.post('/api/v1/public/direct-redeem', {
        email: email.trim(),
        code: code
      })
      setSuccess(true)
      setTeamName(res.data.team_name)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '兑换失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)' }}>
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
      background: 'linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)',
      padding: 20,
    }}>
      {/* 装饰光晕 */}
      <div style={{ position: 'fixed', top: '10%', right: '20%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(147, 197, 253, 0.3) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '20%', left: '15%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(196, 181, 253, 0.25) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />

      <Card style={{
        width: 420,
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(40px)',
        WebkitBackdropFilter: 'blur(40px)',
        borderRadius: 24,
        border: '1px solid rgba(255, 255, 255, 0.9)',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img 
            src="/logo.jpg" 
            alt="Logo" 
            style={{ 
              width: 56, 
              height: 56, 
              borderRadius: 16,
              objectFit: 'cover',
              margin: '0 auto 20px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
              display: 'block',
            }} 
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: '#1a1a2e' }}>
            {siteConfig?.site_title || 'ChatGPT Team 邀请'}
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            输入邮箱即可加入
          </p>
        </div>

        {/* 错误状态 */}
        {error && (
          <Result
            status="error"
            icon={<CloseCircleOutlined style={{ color: '#ef4444' }} />}
            title="链接无效"
            subTitle={error}
          />
        )}

        {/* 成功状态 */}
        {success && (
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#10b981' }} />}
            title="邀请已发送！"
            subTitle={
              <div>
                <p>已加入 {teamName || 'Team'}</p>
                <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 12 }}>
                  {siteConfig?.success_message || '请查收邮箱并接受邀请'}
                </p>
              </div>
            }
          />
        )}

        {/* 输入邮箱 */}
        {valid && !success && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>邮箱地址</div>
              <Input
                prefix={<MailOutlined style={{ color: '#94a3b8', marginRight: 8 }} />}
                placeholder="  your@email.com"
                size="large"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onPressEnter={handleSubmit}
                style={{ height: 48, borderRadius: 12 }}
              />
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                邀请邮件将发送到此邮箱
              </div>
            </div>

            <Button 
              type="primary" 
              block 
              size="large" 
              loading={submitting}
              onClick={handleSubmit}
              disabled={!email}
              style={{ height: 48, borderRadius: 12, fontWeight: 600 }}
            >
              获取邀请
            </Button>

            {/* 使用说明 */}
            <div style={{ marginTop: 24, padding: 16, background: '#f8fafc', borderRadius: 12, fontSize: 13, color: '#64748b', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: '#475569', marginBottom: 8 }}>📋 使用说明</div>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>输入您的邮箱地址</li>
                <li>点击「获取邀请」按钮</li>
                <li>查收邮箱中的 ChatGPT Team 邀请邮件</li>
                <li>点击邮件中的链接接受邀请，完成加入</li>
              </ol>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

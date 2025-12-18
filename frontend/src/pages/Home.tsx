import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Spin } from 'antd'
import { RocketOutlined, CheckCircleOutlined, SafetyOutlined, ThunderboltOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import { publicApi } from '../api'

interface SiteConfig {
  site_title: string
  site_description: string
  home_notice: string
  footer_text: string
  redeem_only?: boolean  // 是否为分销商白标域名
}

interface SeatStats {
  total_seats: number
  used_seats: number
  available_seats: number
}

export default function Home() {
  const [loading, setLoading] = useState(true)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)
  const [seats, setSeats] = useState<SeatStats | null>(null)
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const navigate = useNavigate()

  // 分销商白标域名检测：直接跳转到兑换页面
  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase().replace(/\.$/, '')  // 移除尾点
    const isDistributorDomain = /^distributor-\d+\.zenscaleai\.com$/.test(hostname)
    if (isDistributorDomain) {
      navigate('/invite', { replace: true })
      return
    }
  }, [navigate])

  useEffect(() => {
    Promise.all([
      publicApi.getSiteConfig().catch(() => null),
      publicApi.getSeats().catch(() => null),
      publicApi.getPaymentConfig().catch(() => null),
    ]).then(([config, seatsData, paymentConfig]: any[]) => {
      if (config) {
        setSiteConfig(config)
        if (config.site_title) document.title = config.site_title
      }
      if (seatsData) setSeats(seatsData)
      if (paymentConfig?.enabled) setPaymentEnabled(true)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
      {/* 装饰 */}
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.08) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(88, 86, 214, 0.06) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />

      {/* Hero Section */}
      <div style={{ 
        maxWidth: 1000, 
        margin: '0 auto', 
        padding: '80px 20px', 
        textAlign: 'center',
        position: 'relative',
        zIndex: 1,
      }}>
        <img 
          src="/logo.jpg" 
          alt="Logo" 
          style={{ 
            width: 80, 
            height: 80, 
            borderRadius: 20,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
            marginBottom: 32,
          }} 
        />
        
        <h1 style={{ 
          fontSize: 48, 
          fontWeight: 700, 
          color: '#1d1d1f', 
          margin: '0 0 16px',
          letterSpacing: '-1px',
        }}>
          {siteConfig?.site_title || 'ChatGPT Team'}
        </h1>
        
        <p style={{ 
          fontSize: 20, 
          color: '#86868b', 
          margin: '0 0 40px',
          maxWidth: 600,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          {siteConfig?.site_description || '加入 ChatGPT Team，享受 GPT-4 无限制使用'}
        </p>

        {/* 座位统计 */}
        {seats && (
          <div style={{ 
            display: 'inline-flex', 
            gap: 40, 
            padding: '20px 40px',
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px)',
            borderRadius: 16,
            marginBottom: 40,
          }}>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#34c759' }}>{seats.available_seats}</div>
              <div style={{ fontSize: 14, color: '#86868b' }}>可用座位</div>
            </div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#007aff' }}>{seats.used_seats}</div>
              <div style={{ fontSize: 14, color: '#86868b' }}>已使用</div>
            </div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#86868b' }}>{seats.total_seats}</div>
              <div style={{ fontSize: 14, color: '#86868b' }}>总座位</div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 60, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={() => navigate('/invite')}
            style={{
              height: 56,
              padding: '0 48px',
              fontSize: 18,
              fontWeight: 500,
              borderRadius: 28,
              background: '#007aff',
              border: 'none',
            }}
          >
            立即上车
          </Button>
          {paymentEnabled && !siteConfig?.redeem_only && (
            <Button
              size="large"
              icon={<ShoppingCartOutlined />}
              onClick={() => navigate('/purchase')}
              style={{
                height: 56,
                padding: '0 48px',
                fontSize: 18,
                fontWeight: 500,
                borderRadius: 28,
                background: 'linear-gradient(135deg, #ff9500 0%, #ff5e3a 100%)',
                border: 'none',
                color: '#fff',
              }}
            >
              购买套餐
            </Button>
          )}
        </div>

        {/* 公告 */}
        {siteConfig?.home_notice && (
          <div style={{ 
            background: 'rgba(0, 122, 255, 0.08)', 
            padding: '16px 24px', 
            borderRadius: 12,
            color: '#007aff',
            fontSize: 15,
            maxWidth: 500,
            margin: '0 auto 60px',
          }}>
            {siteConfig.home_notice}
          </div>
        )}

        {/* 特性介绍 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px)',
            padding: 32,
            borderRadius: 20,
            textAlign: 'left',
          }}>
            <CheckCircleOutlined style={{ fontSize: 32, color: '#34c759', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#1d1d1f' }}>GPT-5.1 无限制</h3>
            <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>Team 版本无消息限制，畅享 GPT-5.1 强大能力</p>
          </div>

          <div style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px)',
            padding: 32,
            borderRadius: 20,
            textAlign: 'left',
          }}>
            <SafetyOutlined style={{ fontSize: 32, color: '#007aff', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#1d1d1f' }}>安全稳定</h3>
            <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>官方 Team 账号，稳定可靠，支持换车保障</p>
          </div>

          <div style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px)',
            padding: 32,
            borderRadius: 20,
            textAlign: 'left',
          }}>
            <ThunderboltOutlined style={{ fontSize: 32, color: '#ff9500', marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#1d1d1f' }}>即时开通</h3>
            <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>兑换码自助上车，邮箱收到邀请即可使用</p>
          </div>
        </div>

        {/* 页脚 */}
        {siteConfig?.footer_text && (
          <div style={{ marginTop: 80, color: '#86868b', fontSize: 13 }}>
            {siteConfig.footer_text}
          </div>
        )}
      </div>
    </div>
  )
}

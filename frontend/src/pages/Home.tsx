import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button, Spin, Card, Row, Col, Grid } from 'antd'
import {
  RocketOutlined, CheckCircleOutlined, SafetyOutlined, ThunderboltOutlined,
  ShoppingCartOutlined, CustomerServiceOutlined, SwapOutlined,
  ArrowRightOutlined, QuestionCircleOutlined
} from '@ant-design/icons'
import { publicApi } from '../api'

const { useBreakpoint } = Grid

interface SiteConfig {
  site_title: string
  site_description: string
  home_notice: string
  footer_text: string
  redeem_only?: boolean
}

interface SeatStats {
  total_seats: number
  used_seats: number
  available_seats: number
}

const steps = [
  { icon: <ShoppingCartOutlined />, title: '购买套餐', desc: '选择合适的套餐并完成支付' },
  { icon: <RocketOutlined />, title: '获取兑换码', desc: '支付成功后立即获得兑换码' },
  { icon: <CheckCircleOutlined />, title: '自助上车', desc: '输入邮箱和兑换码完成兑换' },
]

const features = [
  { icon: <ThunderboltOutlined />, title: 'GPT-4o 无限制', desc: 'Team 版本无消息限制，畅享最新模型', color: '#ff9500' },
  { icon: <SafetyOutlined />, title: '官方账号', desc: '正规 OpenAI Team，数据安全隔离', color: '#007aff' },
  { icon: <SwapOutlined />, title: '自助换车', desc: 'Team 异常时可自助转移，无需等待', color: '#34c759' },
  { icon: <CustomerServiceOutlined />, title: '售后保障', desc: '专业客服支持，问题快速响应', color: '#af52de' },
]

export default function Home() {
  const [loading, setLoading] = useState(true)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)
  const [seats, setSeats] = useState<SeatStats | null>(null)
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const navigate = useNavigate()
  const screens = useBreakpoint()

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
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Hero Section */}
      <div style={{
        background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        padding: screens.md ? '100px 20px 120px' : '60px 20px 80px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 装饰圆 - 对辅助技术隐藏 */}
        <div aria-hidden="true" style={{ position: 'absolute', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.15) 0%, transparent 70%)', borderRadius: '50%' }} />
        <div aria-hidden="true" style={{ position: 'absolute', bottom: '-30%', left: '-10%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(88, 86, 214, 0.1) 0%, transparent 70%)', borderRadius: '50%' }} />

        <div style={{ maxWidth: 1000, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{
              width: screens.md ? 88 : 72,
              height: screens.md ? 88 : 72,
              borderRadius: 22,
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)',
              marginBottom: 32,
            }}
          />

          <h1 style={{
            fontSize: screens.md ? 52 : 36,
            fontWeight: 800,
            color: '#fff',
            margin: '0 0 16px',
            letterSpacing: '-1px',
          }}>
            {siteConfig?.site_title || 'ZenScale AI'}
          </h1>

          <p style={{
            fontSize: screens.md ? 20 : 16,
            color: 'rgba(255,255,255,0.7)',
            margin: '0 0 40px',
            maxWidth: 500,
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: 1.6,
          }}>
            {siteConfig?.site_description || '稳定、可靠的 ChatGPT Team 邀请服务，畅享 GPT-4o 无限制使用'}
          </p>

          {/* 座位统计 */}
          {seats && (
            <div style={{
              display: 'inline-flex',
              gap: screens.md ? 48 : 24,
              padding: screens.md ? '24px 48px' : '16px 24px',
              background: 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(20px)',
              borderRadius: 16,
              marginBottom: 40,
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <div>
                <div style={{ fontSize: screens.md ? 36 : 28, fontWeight: 700, color: '#34c759' }}>{seats.available_seats}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>可用座位</div>
              </div>
              <div>
                <div style={{ fontSize: screens.md ? 36 : 28, fontWeight: 700, color: '#007aff' }}>{seats.used_seats}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>已使用</div>
              </div>
              <div>
                <div style={{ fontSize: screens.md ? 36 : 28, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>{seats.total_seats}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>总座位</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => navigate('/invite')}
              style={{
                height: 56,
                padding: '0 40px',
                fontSize: 17,
                fontWeight: 600,
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
                  padding: '0 40px',
                  fontSize: 17,
                  fontWeight: 600,
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
              marginTop: 40,
              padding: '14px 24px',
              background: 'rgba(255, 149, 0, 0.15)',
              borderRadius: 12,
              color: '#ff9500',
              fontSize: 14,
              display: 'inline-block',
              border: '1px solid rgba(255, 149, 0, 0.3)',
            }}>
              📢 {siteConfig.home_notice}
            </div>
          )}
        </div>
      </div>

      {/* How It Works */}
      {paymentEnabled && !siteConfig?.redeem_only && (
        <div style={{ padding: screens.md ? '80px 20px' : '60px 20px', background: '#fff' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h2 style={{ textAlign: 'center', fontSize: screens.md ? 32 : 24, fontWeight: 700, color: '#1d1d1f', margin: '0 0 16px' }}>
              如何上车？
            </h2>
            <p style={{ textAlign: 'center', color: '#86868b', margin: '0 0 48px', fontSize: 16 }}>
              三步轻松搞定，即刻畅享 ChatGPT Team
            </p>

            <Row gutter={[24, 24]} justify="center">
              {steps.map((step, index) => (
                <Col key={index} xs={24} sm={8}>
                  <div style={{ textAlign: 'center', position: 'relative' }}>
                    <div style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      background: 'linear-gradient(135deg, #007aff 0%, #5856d6 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 20px',
                      fontSize: 28,
                      color: '#fff',
                    }}>
                      {step.icon}
                    </div>
                    <div style={{
                      position: 'absolute',
                      top: 8,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      marginLeft: -50,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: '#ff9500',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 14,
                      lineHeight: '28px',
                    }}>
                      {index + 1}
                    </div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#1d1d1f' }}>{step.title}</h3>
                    <p style={{ fontSize: 14, color: '#86868b', margin: 0 }}>{step.desc}</p>
                    {index < steps.length - 1 && screens.sm && (
                      <ArrowRightOutlined style={{
                        position: 'absolute',
                        right: -20,
                        top: 36,
                        fontSize: 20,
                        color: '#d1d1d6',
                      }} />
                    )}
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        </div>
      )}

      {/* Features */}
      <div style={{ padding: screens.md ? '80px 20px' : '60px 20px', background: '#f5f5f7' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontSize: screens.md ? 32 : 24, fontWeight: 700, color: '#1d1d1f', margin: '0 0 16px' }}>
            为什么选择我们？
          </h2>
          <p style={{ textAlign: 'center', color: '#86868b', margin: '0 0 48px', fontSize: 16 }}>
            专业服务，安心使用
          </p>

          <Row gutter={[20, 20]}>
            {features.map((feature, index) => (
              <Col key={index} xs={12} md={6}>
                <Card
                  style={{
                    height: '100%',
                    borderRadius: 16,
                    border: 'none',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                  }}
                  bodyStyle={{ padding: screens.md ? 28 : 20 }}
                >
                  <div style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: `${feature.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                    fontSize: 24,
                    color: feature.color,
                  }}>
                    {feature.icon}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: '#1d1d1f' }}>{feature.title}</h3>
                  <p style={{ fontSize: 13, color: '#86868b', margin: 0, lineHeight: 1.6 }}>{feature.desc}</p>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      </div>

      {/* CTA Section */}
      <div style={{
        padding: screens.md ? '80px 20px' : '60px 20px',
        background: 'linear-gradient(135deg, #007aff 0%, #5856d6 100%)',
        textAlign: 'center',
      }}>
        <h2 style={{ fontSize: screens.md ? 32 : 24, fontWeight: 700, color: '#fff', margin: '0 0 16px' }}>
          准备好了吗？
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '0 0 32px', fontSize: 16 }}>
          立即加入，开启 AI 之旅
        </p>
        <Button
          size="large"
          icon={<RocketOutlined />}
          onClick={() => navigate('/invite')}
          style={{
            height: 52,
            padding: '0 40px',
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 26,
            background: '#fff',
            border: 'none',
            color: '#007aff',
          }}
        >
          立即上车
        </Button>
      </div>

      {/* Footer */}
      <div style={{ padding: '40px 20px', background: '#1d1d1f', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ marginBottom: 20 }}>
            <Link to="/faq" style={{ color: 'rgba(255,255,255,0.6)', margin: '0 16px', fontSize: 14 }}>
              <QuestionCircleOutlined style={{ marginRight: 6 }} />常见问题
            </Link>
            <Link to="/legal" style={{ color: 'rgba(255,255,255,0.6)', margin: '0 16px', fontSize: 14 }}>服务条款</Link>
            <a href="mailto:contact@zenscaleai.com" style={{ color: 'rgba(255,255,255,0.6)', margin: '0 16px', fontSize: 14 }}>联系我们</a>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
            {siteConfig?.footer_text || '© 2025 ZenScale AI. All rights reserved.'}
          </p>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button, Spin, Card, Row, Col, Grid } from 'antd'
import {
  RocketOutlined, CheckCircleOutlined, SafetyOutlined, ThunderboltOutlined,
  ShoppingCartOutlined, CustomerServiceOutlined, SwapOutlined,
  ArrowDownOutlined, QuestionCircleOutlined
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

// 功能亮点
const highlights = [
  { text: 'GPT-4o 无限制', icon: <CheckCircleOutlined style={{ color: '#22c55e' }} /> },
  { text: '即时开通', icon: <CheckCircleOutlined style={{ color: '#22c55e' }} /> },
  { text: '专属客服', icon: <CheckCircleOutlined style={{ color: '#22c55e' }} /> },
]

// 特性卡片
const features = [
  { icon: <ThunderboltOutlined />, title: 'GPT-4o 无限制', desc: 'Team 版本无消息限制，畅享最新模型能力', color: '#f59e0b' },
  { icon: <SafetyOutlined />, title: '官方正规渠道', desc: '正规 OpenAI Team 账号，数据安全有保障', color: '#3b82f6' },
  { icon: <SwapOutlined />, title: '自助换车服务', desc: 'Team 异常时可自助转移，无需等待客服', color: '#10b981' },
  { icon: <CustomerServiceOutlined />, title: '优质售后支持', desc: '专业团队响应，问题快速解决', color: '#8b5cf6' },
]

// CSS 动画样式
const animationStyles = `
  @keyframes float {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-15px) rotate(3deg); }
  }
  @keyframes floatSlow {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
  .animate-fadeInUp {
    animation: fadeInUp 0.8s ease-out forwards;
  }
  .animate-fadeInUp-delay {
    animation: fadeInUp 0.8s ease-out 0.2s forwards;
    opacity: 0;
  }
`

export default function Home() {
  const [loading, setLoading] = useState(true)
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null)
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const navigate = useNavigate()
  const screens = useBreakpoint()
  const isMobile = !screens.lg

  useEffect(() => {
    Promise.all([
      publicApi.getSiteConfig().catch(() => null),
      publicApi.getPaymentConfig().catch(() => null),
    ]).then(([config, paymentConfig]: unknown[]) => {
      if (config) {
        setSiteConfig(config as SiteConfig)
        if ((config as SiteConfig).site_title) document.title = (config as SiteConfig).site_title
      }
      if ((paymentConfig as { enabled?: boolean })?.enabled) setPaymentEnabled(true)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafbfc' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <>
      <style>{animationStyles}</style>
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)' }}>

        {/* Hero Section */}
        <div style={{
          minHeight: isMobile ? 'auto' : '100vh',
          padding: isMobile ? '60px 20px 80px' : '0 40px',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* 背景装饰字母 */}
          <div aria-hidden="true" style={{
            position: 'absolute', top: '8%', left: '3%',
            fontSize: isMobile ? '80px' : '140px', fontWeight: 900,
            color: 'rgba(0,0,0,0.03)', userSelect: 'none',
            animation: 'floatSlow 8s ease-in-out infinite',
          }}>G</div>
          <div aria-hidden="true" style={{
            position: 'absolute', top: '15%', right: '8%',
            fontSize: isMobile ? '100px' : '180px', fontWeight: 900,
            color: 'rgba(0,0,0,0.02)', userSelect: 'none',
            animation: 'floatSlow 10s ease-in-out infinite',
            animationDelay: '1s',
          }}>P</div>
          <div aria-hidden="true" style={{
            position: 'absolute', bottom: '15%', left: '8%',
            fontSize: isMobile ? '60px' : '120px', fontWeight: 900,
            color: 'rgba(0,0,0,0.025)', userSelect: 'none',
            animation: 'floatSlow 9s ease-in-out infinite',
            animationDelay: '2s',
          }}>T</div>
          <div aria-hidden="true" style={{
            position: 'absolute', bottom: '25%', right: '15%',
            fontSize: isMobile ? '50px' : '100px', fontWeight: 900,
            color: 'rgba(0,0,0,0.02)', userSelect: 'none',
            animation: 'floatSlow 7s ease-in-out infinite',
            animationDelay: '0.5s',
          }}>4</div>

          <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
            <Row gutter={[48, 48]} align="middle">
              {/* 左侧内容 */}
              <Col xs={24} lg={12}>
                <div className="animate-fadeInUp" style={{ textAlign: isMobile ? 'center' : 'left' }}>
                  {/* 顶部标签 */}
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#f1f5f9',
                    padding: '8px 16px',
                    borderRadius: 999,
                    marginBottom: 28,
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#475569',
                  }}>
                    <span style={{ color: '#3b82f6' }}>✦</span>
                    稳定可靠 · 即时开通
                  </div>

                  {/* 主标题 */}
                  <h1 style={{
                    fontSize: isMobile ? 36 : 54,
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: '0 0 20px',
                    letterSpacing: '-1.5px',
                    lineHeight: 1.15,
                  }}>
                    畅享 GPT-4o
                    <br />
                    <span style={{ color: '#3b82f6' }}>无限可能</span>
                  </h1>

                  {/* 副标题 */}
                  <p style={{
                    fontSize: isMobile ? 16 : 18,
                    color: '#64748b',
                    margin: '0 0 32px',
                    lineHeight: 1.7,
                    maxWidth: isMobile ? '100%' : 440,
                  }}>
                    {siteConfig?.site_description || '专业的 ChatGPT Team 邀请服务，为您提供稳定、可靠的 AI 使用体验'}
                  </p>

                  {/* 功能亮点 */}
                  <div style={{
                    display: 'flex',
                    gap: isMobile ? 16 : 28,
                    marginBottom: 40,
                    flexWrap: 'wrap',
                    justifyContent: isMobile ? 'center' : 'flex-start',
                  }}>
                    {highlights.map((item, index) => (
                      <div key={index} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 14,
                        fontWeight: 500,
                        color: '#334155',
                      }}>
                        {item.icon}
                        {item.text}
                      </div>
                    ))}
                  </div>

                  {/* 按钮组 */}
                  <div style={{
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                    justifyContent: isMobile ? 'center' : 'flex-start',
                  }}>
                    <Button
                      type="primary"
                      size="large"
                      onClick={() => navigate('/invite')}
                      style={{
                        height: 52,
                        padding: '0 36px',
                        fontSize: 16,
                        fontWeight: 600,
                        borderRadius: 12,
                        background: '#0f172a',
                        border: 'none',
                        boxShadow: '0 4px 14px rgba(15, 23, 42, 0.25)',
                      }}
                    >
                      立即上车 <RocketOutlined />
                    </Button>
                    {paymentEnabled && !siteConfig?.redeem_only && (
                      <Button
                        size="large"
                        onClick={() => navigate('/purchase')}
                        style={{
                          height: 52,
                          padding: '0 36px',
                          fontSize: 16,
                          fontWeight: 600,
                          borderRadius: 12,
                          background: '#fff',
                          border: '2px solid #e2e8f0',
                          color: '#334155',
                        }}
                      >
                        查看套餐 <ArrowDownOutlined />
                      </Button>
                    )}
                  </div>

                  {/* 公告 */}
                  {siteConfig?.home_notice && (
                    <div style={{
                      marginTop: 32,
                      padding: '12px 20px',
                      background: '#fef3c7',
                      borderRadius: 12,
                      color: '#92400e',
                      fontSize: 14,
                      display: 'inline-block',
                      border: '1px solid #fcd34d',
                    }}>
                      📢 {siteConfig.home_notice}
                    </div>
                  )}
                </div>
              </Col>

              {/* 右侧视觉 */}
              <Col xs={24} lg={12}>
                <div className="animate-fadeInUp-delay" style={{
                  position: 'relative',
                  height: isMobile ? 320 : 480,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {/* 主卡片 */}
                  <div style={{
                    width: isMobile ? 220 : 300,
                    height: isMobile ? 140 : 190,
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    borderRadius: 20,
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: isMobile ? 20 : 28,
                    animation: 'float 6s ease-in-out infinite',
                    position: 'relative',
                    zIndex: 2,
                  }}>
                    {/* 卡片芯片 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: isMobile ? 36 : 48,
                        height: isMobile ? 28 : 36,
                        background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                        borderRadius: 6,
                      }} />
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: isMobile ? 14 : 18 }}>TEAM</span>
                    </div>
                    {/* 卡号 */}
                    <div style={{ color: '#94a3b8', fontSize: isMobile ? 14 : 18, fontFamily: 'monospace', letterSpacing: 2 }}>
                      •••• •••• •••• 4088
                    </div>
                    {/* 底部信息 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>MEMBER</div>
                        <div style={{ color: '#fff', fontSize: isMobile ? 12 : 14, fontWeight: 500 }}>ZENSCALE AI</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>VALID</div>
                        <div style={{ color: '#fff', fontSize: isMobile ? 12 : 14 }}>12/26</div>
                      </div>
                    </div>
                  </div>

                  {/* 浮动图标 */}
                  <div style={{
                    position: 'absolute',
                    top: isMobile ? '5%' : '10%',
                    left: isMobile ? '5%' : '10%',
                    width: isMobile ? 50 : 64,
                    height: isMobile ? 50 : 64,
                    background: '#fff',
                    borderRadius: 16,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'float 5s ease-in-out infinite',
                    animationDelay: '0.5s',
                  }}>
                    <span style={{ fontSize: isMobile ? 24 : 32 }}>🤖</span>
                  </div>

                  <div style={{
                    position: 'absolute',
                    top: isMobile ? '0%' : '5%',
                    right: isMobile ? '10%' : '15%',
                    width: isMobile ? 50 : 64,
                    height: isMobile ? 50 : 64,
                    background: '#10b981',
                    borderRadius: 16,
                    boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'float 6s ease-in-out infinite',
                    animationDelay: '1s',
                  }}>
                    <span style={{ fontSize: isMobile ? 24 : 32 }}>✨</span>
                  </div>

                  <div style={{
                    position: 'absolute',
                    bottom: isMobile ? '10%' : '15%',
                    left: isMobile ? '0%' : '5%',
                    width: isMobile ? 50 : 64,
                    height: isMobile ? 50 : 64,
                    background: '#3b82f6',
                    borderRadius: 16,
                    boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'float 7s ease-in-out infinite',
                    animationDelay: '1.5s',
                  }}>
                    <span style={{ fontSize: isMobile ? 24 : 32 }}>🧠</span>
                  </div>

                  <div style={{
                    position: 'absolute',
                    bottom: isMobile ? '5%' : '10%',
                    right: isMobile ? '5%' : '10%',
                    width: isMobile ? 50 : 64,
                    height: isMobile ? 50 : 64,
                    background: '#fff',
                    borderRadius: 16,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'float 5.5s ease-in-out infinite',
                    animationDelay: '2s',
                  }}>
                    <span style={{ fontSize: isMobile ? 24 : 32 }}>🚀</span>
                  </div>

                  <div style={{
                    position: 'absolute',
                    top: '45%',
                    right: isMobile ? '0%' : '0%',
                    width: isMobile ? 45 : 56,
                    height: isMobile ? 45 : 56,
                    background: '#f43f5e',
                    borderRadius: 14,
                    boxShadow: '0 8px 24px rgba(244, 63, 94, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'float 6.5s ease-in-out infinite',
                    animationDelay: '0.8s',
                  }}>
                    <span style={{ fontSize: isMobile ? 20 : 26 }}>💬</span>
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        </div>

        {/* Features Section */}
        <div style={{ padding: isMobile ? '60px 20px' : '100px 40px', background: '#fff' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <h2 style={{
                fontSize: isMobile ? 28 : 36,
                fontWeight: 700,
                color: '#0f172a',
                margin: '0 0 16px',
              }}>
                为什么选择我们？
              </h2>
              <p style={{ color: '#64748b', fontSize: 16, margin: 0 }}>
                专业服务，安心使用
              </p>
            </div>

            <Row gutter={[24, 24]}>
              {features.map((feature, index) => (
                <Col key={index} xs={12} md={6}>
                  <Card
                    style={{
                      height: '100%',
                      borderRadius: 20,
                      border: '1px solid #f1f5f9',
                      boxShadow: 'none',
                      transition: 'all 0.3s ease',
                    }}
                    bodyStyle={{ padding: isMobile ? 20 : 28 }}
                    hoverable
                  >
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 16,
                      background: `${feature.color}10`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 20,
                      fontSize: 26,
                      color: feature.color,
                    }}>
                      {feature.icon}
                    </div>
                    <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 10px', color: '#0f172a' }}>
                      {feature.title}
                    </h3>
                    <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
                      {feature.desc}
                    </p>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        </div>

        {/* CTA Section */}
        <div style={{
          padding: isMobile ? '60px 20px' : '80px 40px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: isMobile ? 28 : 36, fontWeight: 700, color: '#fff', margin: '0 0 16px' }}>
            准备好开启 AI 之旅了吗？
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: '0 0 36px', fontSize: 16 }}>
            立即加入，畅享 GPT-4o 无限可能
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              size="large"
              onClick={() => navigate('/invite')}
              style={{
                height: 52,
                padding: '0 40px',
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                background: '#fff',
                border: 'none',
                color: '#0f172a',
              }}
            >
              立即上车 <RocketOutlined />
            </Button>
            {paymentEnabled && !siteConfig?.redeem_only && (
              <Button
                size="large"
                ghost
                icon={<ShoppingCartOutlined />}
                onClick={() => navigate('/purchase')}
                style={{
                  height: 52,
                  padding: '0 40px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 12,
                  borderColor: 'rgba(255,255,255,0.3)',
                  color: '#fff',
                }}
              >
                购买套餐
              </Button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '40px 20px', background: '#0f172a', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <div style={{ marginBottom: 20 }}>
              <Link to="/faq" style={{ color: 'rgba(255,255,255,0.5)', margin: '0 16px', fontSize: 14 }}>
                <QuestionCircleOutlined style={{ marginRight: 6 }} />常见问题
              </Link>
              <Link to="/legal" style={{ color: 'rgba(255,255,255,0.5)', margin: '0 16px', fontSize: 14 }}>
                服务条款
              </Link>
              <a href="mailto:contact@zenscaleai.com" style={{ color: 'rgba(255,255,255,0.5)', margin: '0 16px', fontSize: 14 }}>
                联系我们
              </a>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: 0 }}>
              {siteConfig?.footer_text || '© 2025 ZenScale AI. All rights reserved.'}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

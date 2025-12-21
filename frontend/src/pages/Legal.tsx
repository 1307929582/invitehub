import { useState, useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { Card, Row, Col, Menu, Typography, Button, Grid, Space } from 'antd'
import {
  HomeOutlined, FileTextOutlined, SafetyOutlined, DollarOutlined, MailOutlined
} from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography
const { useBreakpoint } = Grid

export default function Legal() {
  const location = useLocation()
  const screens = useBreakpoint()
  const [selectedKey, setSelectedKey] = useState('privacy')

  const contactEmail = 'contact@zenscaleai.com'
  const siteName = 'ZenScale AI'
  const lastUpdated = '2025年12月'

  useEffect(() => {
    const hash = location.hash.replace('#', '')
    if (hash && ['privacy', 'terms', 'refund'].includes(hash)) {
      setSelectedKey(hash)
    }
  }, [location.hash])

  const handleMenuClick = ({ key }: { key: string }) => {
    setSelectedKey(key)
    window.history.replaceState(null, '', `#${key}`)
  }

  const isMobile = !screens.md

  // 隐私政策内容
  const renderPrivacy = () => (
    <div>
      <Title level={3} style={{ color: '#1f2937', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        隐私政策
      </Title>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>1. 信息收集</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        我们在提供服务过程中会收集以下信息：
      </Paragraph>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li><Text strong>邮箱地址</Text>：用于发送 ChatGPT Team 邀请和服务通知</li>
        <li><Text strong>兑换码使用记录</Text>：用于防止滥用和提供售后支持</li>
        <li><Text strong>支付信息</Text>：通过第三方支付平台处理，我们不存储您的银行卡信息</li>
      </ul>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>2. 信息使用</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        收集的信息仅用于：
      </Paragraph>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li>发送 ChatGPT Team 邀请邮件</li>
        <li>处理换车请求</li>
        <li>发送重要的服务通知</li>
        <li>处理退款和售后问题</li>
      </ul>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>3. 信息保护</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        我们采取合理的技术和管理措施保护您的个人信息安全。您的数据通过加密传输存储，未经授权的第三方无法访问。
      </Paragraph>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>4. 信息分享</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        我们不会将您的个人信息出售或分享给任何第三方，除非：
      </Paragraph>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li>获得您的明确同意</li>
        <li>法律法规要求</li>
        <li>为完成服务必须（如向 OpenAI 发送邀请）</li>
      </ul>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>5. 联系我们</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        如有隐私相关问题，请联系：<a href={`mailto:${contactEmail}`} style={{ color: '#10a37f' }}>{contactEmail}</a>
      </Paragraph>
    </div>
  )

  // 服务条款内容
  const renderTerms = () => (
    <div>
      <Title level={3} style={{ color: '#1f2937', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        服务条款
      </Title>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>1. 服务说明</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        {siteName} 提供 ChatGPT Team 邀请服务。购买兑换码后，您将收到加入 ChatGPT Team 的邀请邮件。
      </Paragraph>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>2. 使用规则</Title>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li>每个兑换码仅限绑定一个邮箱使用</li>
        <li>兑换码有效期为激活后 30 天（具体以购买时说明为准）</li>
        <li>禁止转售、分享或滥用兑换码</li>
        <li>禁止使用自动化工具批量操作</li>
      </ul>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>3. 免责声明</Title>
      <div style={{
        background: 'rgba(255, 149, 0, 0.08)',
        padding: '16px 20px',
        borderRadius: 12,
        marginBottom: 16,
        border: '1px solid rgba(255, 149, 0, 0.2)',
      }}>
        <Text style={{ color: '#b45309', fontWeight: 500 }}>⚠️ 重要提示</Text>
      </div>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li>本服务依赖 OpenAI/ChatGPT 平台，如因平台政策变更导致服务中断，我们将尽力提供替代方案或退款</li>
        <li>Team 账号的可用性取决于 OpenAI 政策，我们不保证永久可用</li>
        <li>如 Team 被 OpenAI 封禁，您可使用"换车"功能转移到其他可用 Team</li>
        <li>我们不对因 OpenAI 政策变更造成的损失承担责任</li>
      </ul>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>4. 账号安全</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        请妥善保管您的兑换码，因个人原因导致兑换码泄露或被盗用，我们不承担责任。
      </Paragraph>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>5. 服务变更</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        我们保留随时修改服务内容和价格的权利。重大变更将提前通知用户。
      </Paragraph>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>6. 争议解决</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        如有争议，请先通过 <a href={`mailto:${contactEmail}`} style={{ color: '#10a37f' }}>{contactEmail}</a> 联系我们协商解决。
      </Paragraph>
    </div>
  )

  // 退款政策内容
  const renderRefund = () => (
    <div>
      <Title level={3} style={{ color: '#1f2937', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        退款政策
      </Title>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>1. 可退款情况</Title>
      <div style={{
        background: 'rgba(16, 163, 127, 0.06)',
        padding: '16px 20px',
        borderRadius: 12,
        marginBottom: 16,
        border: '1px solid rgba(16, 163, 127, 0.15)',
      }}>
        <ul style={{ color: '#4b5563', lineHeight: 2, margin: 0, paddingLeft: 20 }}>
          <li><Text strong>未激活的兑换码</Text>：购买后 7 天内可申请全额退款</li>
          <li><Text strong>服务无法使用</Text>：如因我方原因导致无法正常使用，可申请退款</li>
          <li><Text strong>重复购买</Text>：误操作重复购买可申请退款</li>
        </ul>
      </div>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>2. 不可退款情况</Title>
      <div style={{
        background: 'rgba(239, 68, 68, 0.06)',
        padding: '16px 20px',
        borderRadius: 12,
        marginBottom: 16,
        border: '1px solid rgba(239, 68, 68, 0.15)',
      }}>
        <ul style={{ color: '#4b5563', lineHeight: 2, margin: 0, paddingLeft: 20 }}>
          <li>兑换码已激活使用</li>
          <li>购买超过 7 天且已激活</li>
          <li>因 OpenAI 政策变更导致的服务调整（我们会提供换车等替代方案）</li>
          <li>因个人原因不想使用</li>
        </ul>
      </div>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>3. 退款流程</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        申请退款请发送邮件至 <a href={`mailto:${contactEmail}`} style={{ color: '#10a37f' }}>{contactEmail}</a>，并提供：
      </Paragraph>
      <ul style={{ color: '#4b5563', lineHeight: 2 }}>
        <li>订单号或兑换码</li>
        <li>购买时使用的邮箱</li>
        <li>退款原因</li>
      </ul>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        我们将在 3 个工作日内处理您的退款请求。退款将原路返回至您的支付账户。
      </Paragraph>

      <Title level={5} style={{ color: '#1f2937', marginTop: 24 }}>4. 特殊情况</Title>
      <Paragraph style={{ color: '#4b5563', lineHeight: 1.8 }}>
        如遇特殊情况（如大规模服务故障），我们会主动联系受影响用户并提供补偿或退款。
      </Paragraph>
    </div>
  )

  const contentMap: Record<string, React.ReactNode> = {
    privacy: renderPrivacy(),
    terms: renderTerms(),
    refund: renderRefund(),
  }

  const menuItems = [
    { key: 'privacy', icon: <SafetyOutlined />, label: '隐私政策' },
    { key: 'terms', icon: <FileTextOutlined />, label: '服务条款' },
    { key: 'refund', icon: <DollarOutlined />, label: '退款政策' },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      padding: isMobile ? 16 : 40,
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* 顶部导航 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}>
          <Link to="/">
            <Button
              type="text"
              icon={<HomeOutlined />}
              style={{ color: '#6b7280', fontWeight: 500 }}
            >
              返回首页
            </Button>
          </Link>
          <Text style={{ color: '#9ca3af', fontSize: 12 }}>
            最后更新：{lastUpdated}
          </Text>
        </div>

        {/* 主卡片 */}
        <Card
          style={{
            borderRadius: 20,
            border: 'none',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
            overflow: 'hidden',
          }}
          bodyStyle={{ padding: 0 }}
        >
          <Row>
            {/* 左侧导航 */}
            <Col xs={24} md={7}>
              <div style={{
                padding: isMobile ? '20px 16px' : '32px 24px',
                background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
                borderBottom: isMobile ? '1px solid #e5e7eb' : 'none',
                minHeight: isMobile ? 'auto' : 500,
              }}>
                <div style={{ marginBottom: 20 }}>
                  <Title level={5} style={{ margin: 0, color: '#1f2937' }}>法律条款</Title>
                  <Text style={{ color: '#9ca3af', fontSize: 13 }}>Legal Documents</Text>
                </div>
                <Menu
                  mode={isMobile ? 'horizontal' : 'vertical'}
                  selectedKeys={[selectedKey]}
                  onClick={handleMenuClick}
                  items={menuItems}
                  style={{
                    background: 'transparent',
                    border: 'none',
                  }}
                />
              </div>
            </Col>

            {/* 右侧内容 */}
            <Col xs={24} md={17}>
              <div style={{
                padding: isMobile ? 24 : '32px 40px',
                minHeight: isMobile ? 'auto' : 500,
                maxHeight: isMobile ? 'none' : 'calc(100vh - 200px)',
                overflowY: 'auto',
              }}>
                {contentMap[selectedKey]}
              </div>
            </Col>
          </Row>
        </Card>

        {/* 底部联系卡片 */}
        <Card
          style={{
            marginTop: 24,
            borderRadius: 16,
            border: 'none',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          }}
          bodyStyle={{ padding: isMobile ? 24 : 32 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(16, 163, 127, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MailOutlined style={{ fontSize: 22, color: '#10a37f' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>有问题需要帮助？</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>我们随时为您提供支持</div>
            </div>
            <a href={`mailto:${contactEmail}`}>
              <Button
                type="primary"
                style={{
                  background: '#10a37f',
                  border: 'none',
                  borderRadius: 10,
                  height: 40,
                  fontWeight: 500,
                }}
              >
                联系我们
              </Button>
            </a>
          </div>
        </Card>

        {/* 底部版权 */}
        <div style={{ textAlign: 'center', marginTop: 32, paddingBottom: 20 }}>
          <Space split={<span style={{ color: '#d1d5db' }}>·</span>} size={16}>
            <Link to="/faq" style={{ color: '#9ca3af', fontSize: 13 }}>常见问题</Link>
            <Link to="/" style={{ color: '#9ca3af', fontSize: 13 }}>返回首页</Link>
          </Space>
          <div style={{ marginTop: 12, color: '#9ca3af', fontSize: 12 }}>
            © 2025 {siteName}. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  )
}

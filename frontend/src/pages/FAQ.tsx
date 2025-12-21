import type { ReactNode } from 'react'
import { Typography, Card, Button, Collapse, Grid } from 'antd'
import { ArrowLeftOutlined, QuestionCircleOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Title, Paragraph, Text } = Typography
const { useBreakpoint } = Grid

interface FAQItem {
  question: string
  answer: string | ReactNode
}

const faqData: { category: string; items: FAQItem[] }[] = [
  {
    category: '兑换相关',
    items: [
      {
        question: '兑换码是什么？怎么使用？',
        answer: '兑换码是一串唯一的字符，用于获取 ChatGPT Team 邀请。使用方法：访问兑换页面 → 输入邮箱和兑换码 → 点击"立即上车" → 查收邮箱接受邀请。'
      },
      {
        question: '兑换码可以多次使用吗？',
        answer: '兑换码首次使用时会绑定您的邮箱，之后只能用该邮箱兑换。在有效期内，您可以多次使用同一兑换码重新获取邀请（例如换车后）。'
      },
      {
        question: '兑换码有效期怎么计算？',
        answer: '有效期从首次使用（激活）时开始计算，默认为 30 天。未激活的兑换码不会开始计时。'
      },
      {
        question: '提交兑换后多久能收到邀请？',
        answer: '通常在 1-5 分钟内会收到邀请邮件。如果长时间未收到，请检查垃圾邮件文件夹，或尝试重新提交兑换。'
      },
      {
        question: '邮箱填错了怎么办？',
        answer: '首次使用兑换码时会绑定邮箱，绑定后无法更改。请在首次兑换时仔细核对邮箱地址。'
      },
    ]
  },
  {
    category: '换车相关',
    items: [
      {
        question: '什么是"换车"？',
        answer: '换车是指当您当前所在的 ChatGPT Team 出现问题（如被封禁）时，可以自助转移到其他正常运行的 Team，无需等待人工处理。'
      },
      {
        question: '什么情况下可以换车？',
        answer: '只有当您当前所在的 Team 被封禁或异常时才能换车。如果 Team 正常运行，系统会提示"当前 Team 正常运行，无需换车"。'
      },
      {
        question: '换车后原来的数据还在吗？',
        answer: 'ChatGPT 的对话历史是存储在您的 OpenAI 账号中的，换车只是更换 Team 座位，不会影响您的历史对话记录。'
      },
      {
        question: '换车需要额外付费吗？',
        answer: '不需要。在兑换码有效期内，换车是免费的，这是我们提供的售后保障服务。'
      },
    ]
  },
  {
    category: '购买相关',
    items: [
      {
        question: '支持哪些支付方式？',
        answer: '目前支持支付宝和微信支付。'
      },
      {
        question: '购买后兑换码在哪里查看？',
        answer: '支付成功后会立即显示兑换码，请务必保存。您也可以通过购买页面的"查询订单"功能，输入购买时填写的邮箱来查询。'
      },
      {
        question: '可以开发票吗？',
        answer: '目前暂不支持开具发票，敬请谅解。'
      },
      {
        question: '优惠码怎么使用？',
        answer: '在支付弹窗中，选择套餐后会有"优惠码"输入框，输入优惠码并点击"使用"即可享受优惠。'
      },
    ]
  },
  {
    category: 'ChatGPT Team 相关',
    items: [
      {
        question: 'ChatGPT Team 有什么优势？',
        answer: (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>GPT-4/GPT-4o 无消息限制</li>
            <li>优先使用最新模型和功能</li>
            <li>数据不用于训练</li>
            <li>更稳定的服务体验</li>
          </ul>
        )
      },
      {
        question: 'Team 会被封禁吗？',
        answer: '由于 OpenAI 政策原因，Team 存在被封禁的风险。如遇封禁，您可以使用"换车"功能转移到其他正常 Team，我们会尽力保障您的使用体验。'
      },
      {
        question: '加入 Team 后需要做什么设置吗？',
        answer: '收到邀请邮件后，点击接受邀请即可。加入 Team 后，您的 ChatGPT 会自动切换到 Team 工作区，可以在左上角切换个人/Team 工作区。'
      },
    ]
  },
  {
    category: '其他问题',
    items: [
      {
        question: '遇到问题如何联系客服？',
        answer: (
          <span>
            请发送邮件至 <a href="mailto:contact@zenscaleai.com" style={{ color: '#10a37f' }}>contact@zenscaleai.com</a>，我们会在 24 小时内回复。
          </span>
        )
      },
      {
        question: '可以退款吗？',
        answer: (
          <span>
            未激活的兑换码在购买后 7 天内可申请全额退款。已激活的兑换码不支持退款。详情请查看 <a href="/legal#refund" style={{ color: '#10a37f' }}>退款政策</a>。
          </span>
        )
      },
    ]
  },
]

export default function FAQ() {
  const navigate = useNavigate()
  const screens = useBreakpoint()
  const contactEmail = 'contact@zenscaleai.com'
  const isMobile = !screens.md

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
      padding: isMobile ? '24px 16px' : '40px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: '-15%',
        right: '-10%',
        width: 520,
        height: 520,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.06) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-12%',
        left: '-8%',
        width: 420,
        height: 420,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* 返回按钮 */}
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginBottom: 20, padding: 0 }}
        >
          返回首页
        </Button>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: 'rgba(16, 163, 127, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <QuestionCircleOutlined style={{ fontSize: 36, color: '#10a37f' }} />
          </div>
          <Title level={2} style={{ margin: '0 0 8px', color: '#1f2937', fontWeight: 700 }}>常见问题</Title>
          <Paragraph style={{ color: '#6b7280' }}>找不到答案？联系我们获取帮助</Paragraph>
        </div>

        {/* FAQ 列表 */}
        {faqData.map((section, index) => (
          <Card
            key={index}
            title={<Text strong style={{ fontSize: 16, color: '#1f2937' }}>{section.category}</Text>}
            style={{
              marginBottom: 20,
              borderRadius: 20,
              border: 'none',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
            }}
            headStyle={{ borderBottom: '1px solid #e5e7eb' }}
          >
            <Collapse
              ghost
              expandIconPosition="end"
              items={section.items.map((item, idx) => ({
                key: idx,
                label: <Text style={{ fontWeight: 500 }}>{item.question}</Text>,
                children: (
                  <Paragraph style={{ color: '#666', margin: 0 }}>
                    {item.answer}
                  </Paragraph>
                ),
              }))}
            />
          </Card>
        ))}

        {/* 联系我们 */}
        <Card style={{
          borderRadius: 20,
          textAlign: 'center',
          marginTop: 32,
          border: 'none',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: 'rgba(16, 163, 127, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <MailOutlined style={{ fontSize: 28, color: '#10a37f' }} />
          </div>
          <Title level={5} style={{ margin: '0 0 8px', color: '#1f2937' }}>没有找到答案？</Title>
          <Paragraph style={{ marginBottom: 16, color: '#6b7280' }}>
            联系我们：<a href={`mailto:${contactEmail}`} style={{ color: '#10a37f', fontWeight: 600 }}>{contactEmail}</a>
          </Paragraph>
          <Button
            type="primary"
            href={`mailto:${contactEmail}`}
            style={{
              borderRadius: 12,
              background: '#10a37f',
              border: 'none',
              height: 48,
              fontWeight: 600,
              paddingLeft: 24,
              paddingRight: 24,
            }}
          >
            发送邮件
          </Button>
        </Card>
      </div>
    </div>
  )
}

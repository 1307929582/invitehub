import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Typography, Card, Button } from 'antd'
import { ArrowLeftOutlined, MailOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

export default function Legal() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    // 根据 hash 滚动到对应位置
    if (location.hash) {
      const id = location.hash.replace('#', '')
      const element = document.getElementById(id)
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    }
  }, [location.hash])

  const contactEmail = 'contact@zenscaleai.com'
  const siteName = 'ZenScale AI'
  const lastUpdated = '2024年12月'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* 返回按钮 */}
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginBottom: 20, padding: 0 }}
        >
          返回首页
        </Button>

        {/* 导航锚点 */}
        <Card style={{ marginBottom: 24, borderRadius: 12 }}>
          <Title level={4} style={{ margin: '0 0 16px' }}>法律条款</Title>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <a href="#privacy" style={{ color: '#007aff' }}>隐私政策</a>
            <a href="#terms" style={{ color: '#007aff' }}>服务条款</a>
            <a href="#refund" style={{ color: '#007aff' }}>退款政策</a>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            最后更新：{lastUpdated}
          </Text>
        </Card>

        {/* 隐私政策 */}
        <Card id="privacy" style={{ marginBottom: 24, borderRadius: 12 }}>
          <Title level={3}>隐私政策</Title>

          <Title level={5}>1. 信息收集</Title>
          <Paragraph>
            我们在提供服务过程中会收集以下信息：
          </Paragraph>
          <ul>
            <li><Text strong>邮箱地址</Text>：用于发送 ChatGPT Team 邀请和服务通知</li>
            <li><Text strong>兑换码使用记录</Text>：用于防止滥用和提供售后支持</li>
            <li><Text strong>支付信息</Text>：通过第三方支付平台处理，我们不存储您的银行卡信息</li>
          </ul>

          <Title level={5}>2. 信息使用</Title>
          <Paragraph>
            收集的信息仅用于：
          </Paragraph>
          <ul>
            <li>发送 ChatGPT Team 邀请邮件</li>
            <li>处理换车请求</li>
            <li>发送重要的服务通知</li>
            <li>处理退款和售后问题</li>
          </ul>

          <Title level={5}>3. 信息保护</Title>
          <Paragraph>
            我们采取合理的技术和管理措施保护您的个人信息安全。您的数据通过加密传输存储，未经授权的第三方无法访问。
          </Paragraph>

          <Title level={5}>4. 信息分享</Title>
          <Paragraph>
            我们不会将您的个人信息出售或分享给任何第三方，除非：
          </Paragraph>
          <ul>
            <li>获得您的明确同意</li>
            <li>法律法规要求</li>
            <li>为完成服务必须（如向 OpenAI 发送邀请）</li>
          </ul>

          <Title level={5}>5. 联系我们</Title>
          <Paragraph>
            如有隐私相关问题，请联系：<a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </Paragraph>
        </Card>

        {/* 服务条款 */}
        <Card id="terms" style={{ marginBottom: 24, borderRadius: 12 }}>
          <Title level={3}>服务条款</Title>

          <Title level={5}>1. 服务说明</Title>
          <Paragraph>
            {siteName} 提供 ChatGPT Team 邀请服务。购买兑换码后，您将收到加入 ChatGPT Team 的邀请邮件。
          </Paragraph>

          <Title level={5}>2. 使用规则</Title>
          <ul>
            <li>每个兑换码仅限绑定一个邮箱使用</li>
            <li>兑换码有效期为激活后 30 天（具体以购买时说明为准）</li>
            <li>禁止转售、分享或滥用兑换码</li>
            <li>禁止使用自动化工具批量操作</li>
          </ul>

          <Title level={5}>3. 免责声明</Title>
          <Paragraph>
            <Text type="warning">重要提示：</Text>
          </Paragraph>
          <ul>
            <li>本服务依赖 OpenAI/ChatGPT 平台，如因平台政策变更导致服务中断，我们将尽力提供替代方案或退款</li>
            <li>Team 账号的可用性取决于 OpenAI 政策，我们不保证永久可用</li>
            <li>如 Team 被 OpenAI 封禁，您可使用"换车"功能转移到其他可用 Team</li>
            <li>我们不对因 OpenAI 政策变更造成的损失承担责任</li>
          </ul>

          <Title level={5}>4. 账号安全</Title>
          <Paragraph>
            请妥善保管您的兑换码，因个人原因导致兑换码泄露或被盗用，我们不承担责任。
          </Paragraph>

          <Title level={5}>5. 服务变更</Title>
          <Paragraph>
            我们保留随时修改服务内容和价格的权利。重大变更将提前通知用户。
          </Paragraph>

          <Title level={5}>6. 争议解决</Title>
          <Paragraph>
            如有争议，请先通过 <a href={`mailto:${contactEmail}`}>{contactEmail}</a> 联系我们协商解决。
          </Paragraph>
        </Card>

        {/* 退款政策 */}
        <Card id="refund" style={{ marginBottom: 24, borderRadius: 12 }}>
          <Title level={3}>退款政策</Title>

          <Title level={5}>1. 可退款情况</Title>
          <ul>
            <li><Text strong>未激活的兑换码</Text>：购买后 7 天内可申请全额退款</li>
            <li><Text strong>服务无法使用</Text>：如因我方原因导致无法正常使用，可申请退款</li>
            <li><Text strong>重复购买</Text>：误操作重复购买可申请退款</li>
          </ul>

          <Title level={5}>2. 不可退款情况</Title>
          <ul>
            <li>兑换码已激活使用</li>
            <li>购买超过 7 天且已激活</li>
            <li>因 OpenAI 政策变更导致的服务调整（我们会提供换车等替代方案）</li>
            <li>因个人原因不想使用</li>
          </ul>

          <Title level={5}>3. 退款流程</Title>
          <Paragraph>
            申请退款请发送邮件至 <a href={`mailto:${contactEmail}`}>{contactEmail}</a>，并提供：
          </Paragraph>
          <ul>
            <li>订单号或兑换码</li>
            <li>购买时使用的邮箱</li>
            <li>退款原因</li>
          </ul>
          <Paragraph>
            我们将在 3 个工作日内处理您的退款请求。退款将原路返回至您的支付账户。
          </Paragraph>

          <Title level={5}>4. 特殊情况</Title>
          <Paragraph>
            如遇特殊情况（如大规模服务故障），我们会主动联系受影响用户并提供补偿或退款。
          </Paragraph>
        </Card>

        {/* 联系信息 */}
        <Card style={{ borderRadius: 12, textAlign: 'center' }}>
          <MailOutlined style={{ fontSize: 32, color: '#007aff', marginBottom: 16 }} />
          <Title level={5} style={{ margin: '0 0 8px' }}>有问题？</Title>
          <Paragraph>
            联系我们：<a href={`mailto:${contactEmail}`} style={{ color: '#007aff', fontWeight: 500 }}>{contactEmail}</a>
          </Paragraph>
        </Card>
      </div>
    </div>
  )
}

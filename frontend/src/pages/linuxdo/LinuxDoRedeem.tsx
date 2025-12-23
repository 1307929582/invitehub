// LinuxDo 专属兑换页面（白标风格）
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, message, Row, Col, Space, Grid } from 'antd'
import { CheckCircleOutlined, LoadingOutlined, ArrowRightOutlined, CopyOutlined, CheckCircleFilled } from '@ant-design/icons'
import { linuxdoApi } from '../../api'

const { Title, Text, Paragraph } = Typography
const { useBreakpoint } = Grid

interface Plan {
  id: number
  name: string
  credits: string
  validity_days: number
  description?: string
  features?: string
  is_recommended: boolean
}

// LinuxDo 主题色
const LINUXDO_COLOR = '#0066FF'

// 套餐卡片组件
const PlanCard: React.FC<{ plan: Plan; selected: boolean; onSelect: () => void }> = ({ plan, selected, onSelect }) => {
  const features = plan.features ? plan.features.split(',').map(f => f.trim()) : []

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`选择套餐：${plan.name}`}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        borderRadius: 16,
        border: selected ? `2px solid ${LINUXDO_COLOR}` : '1px solid #e5e7eb',
        boxShadow: selected ? `0 8px 24px rgba(0, 102, 255, 0.15)` : '0 2px 8px rgba(0, 0, 0, 0.04)',
        background: '#fff',
        padding: 24,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        height: '100%',
      }}
    >
      {plan.is_recommended && (
        <div style={{
          position: 'absolute',
          top: -1,
          right: 16,
          background: LINUXDO_COLOR,
          color: '#fff',
          padding: '4px 12px',
          borderRadius: '0 0 8px 8px',
          fontSize: 12,
          fontWeight: 600,
        }}>
          推荐
        </div>
      )}

      <Title level={4} style={{ margin: '0 0 8px', color: '#1f2937' }}>{plan.name}</Title>
      <Text type="secondary" style={{ fontSize: 14 }}>{plan.description || `有效期 ${plan.validity_days} 天`}</Text>

      <div style={{ margin: '20px 0' }}>
        <Text style={{ fontSize: 14, color: '#6b7280' }}>L 币</Text>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <Text style={{ fontSize: 36, fontWeight: 700, color: selected ? LINUXDO_COLOR : '#1f2937' }}>
            {plan.credits}
          </Text>
        </div>
      </div>

      {features.length > 0 && (
        <Space direction="vertical" size={8}>
          {features.map((feature, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircleOutlined style={{ color: LINUXDO_COLOR, fontSize: 14 }} />
              <Text style={{ color: '#4b5563', fontSize: 13 }}>{feature}</Text>
            </div>
          ))}
        </Space>
      )}
    </div>
  )
}

export default function LinuxDoRedeem() {
  const navigate = useNavigate()
  const screens = useBreakpoint()
  const isMobile = !screens.md

  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [enabled, setEnabled] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pollTimeoutRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)

  // 支付中状态
  const [payingOrder, setPayingOrder] = useState<{ orderNo: string; payUrl: string; credits: string } | null>(null)

  // 支付成功状态
  const [successOrder, setSuccessOrder] = useState<{ redeemCode: string; validityDays: number } | null>(null)

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    Promise.all([
      linuxdoApi.getConfig().catch(() => ({ enabled: false })),
      linuxdoApi.getPlans().catch(() => []),
    ]).then(([config, plansData]) => {
      setEnabled((config as { enabled: boolean }).enabled)
      setPlans(plansData as Plan[])
    }).finally(() => setLoading(false))
  }, [])

  // 创建订单
  const handleSubmit = async () => {
    if (!selectedPlan) {
      message.error('请选择套餐')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email.trim() || !emailRegex.test(email.trim())) {
      message.error('请输入正确的邮箱地址')
      return
    }

    setSubmitting(true)
    try {
      const response: any = await linuxdoApi.createOrder({
        plan_id: selectedPlan.id,
        email: email.trim().toLowerCase(),
      })

      setPayingOrder({
        orderNo: response.order_no,
        payUrl: response.pay_url,
        credits: response.credits,
      })

      // 打开支付页面
      const opened = window.open(response.pay_url, '_blank', 'noopener,noreferrer')
      if (!opened) {
        message.info('支付页面可能被浏览器拦截，请点击"重新打开支付页面"')
      }

      // 开始轮询
      startPolling(response.order_no)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建订单失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 轮询订单状态
  const startPolling = (orderNo: string) => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }

    let attempts = 0
    const maxAttempts = 60

    const poll = async () => {
      if (unmountedRef.current) return
      if (attempts >= maxAttempts) return
      attempts++

      try {
        const response: any = await linuxdoApi.getOrderStatus(orderNo)
        if (response.status === 'paid' && response.redeem_code) {
          setPayingOrder(null)
          setSuccessOrder({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
          return
        }
      } catch {}

      pollTimeoutRef.current = window.setTimeout(poll, 3000)
    }

    poll()
  }

  // 复制兑换码
  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      message.success({ content: '已复制！', icon: <CheckCircleFilled style={{ color: LINUXDO_COLOR }} /> })
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafbfc' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!enabled || plans.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafbfc' }}>
        <Result
          status="info"
          title="LinuxDo 兑换暂未开放"
          subTitle="请稍后再试"
        />
      </div>
    )
  }

  // 支付成功页面
  if (successOrder) {
    return (
      <div style={{ minHeight: '100vh', background: '#fafbfc', padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 20, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)' }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: LINUXDO_COLOR,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <CheckCircleOutlined style={{ fontSize: 36, color: '#fff' }} />
          </div>
          <Title level={2} style={{ color: '#1f2937', marginBottom: 8 }}>兑换成功！</Title>
          <Paragraph style={{ color: '#ef4444', fontWeight: 600, fontSize: 15, marginBottom: 28 }}>
            请立即保存您的兑换码
          </Paragraph>

          <div style={{
            background: `rgba(0, 102, 255, 0.06)`,
            padding: 24,
            borderRadius: 12,
            marginBottom: 28,
            border: `1px solid rgba(0, 102, 255, 0.15)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Input
                value={successOrder.redeemCode}
                readOnly
                style={{
                  width: 200,
                  textAlign: 'center',
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: LINUXDO_COLOR,
                  background: '#fff',
                  borderRadius: '10px 0 0 10px',
                  height: 44,
                }}
              />
              <Button
                icon={<CopyOutlined />}
                onClick={() => handleCopy(successOrder.redeemCode)}
                style={{ height: 44, width: 44, background: LINUXDO_COLOR, borderColor: LINUXDO_COLOR, color: '#fff', borderRadius: '0 10px 10px 0' }}
              />
            </div>
            <Text type="secondary">有效期：{successOrder.validityDays} 天</Text>
          </div>

          <Space size="middle">
            <Button size="large" onClick={() => { setSuccessOrder(null); setSelectedPlan(null) }} style={{ height: 44, borderRadius: 10 }}>
              继续兑换
            </Button>
            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => navigate('/invite')}
              style={{ height: 44, borderRadius: 10, background: LINUXDO_COLOR, border: 'none' }}>
              前往激活
            </Button>
          </Space>
        </div>
      </div>
    )
  }

  // 支付中页面
  if (payingOrder) {
    return (
      <div style={{ minHeight: '100vh', background: '#fafbfc', padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 20, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: LINUXDO_COLOR }} spin />} />
          <Title level={3} style={{ color: '#1f2937', marginTop: 24 }}>等待支付确认</Title>
          <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
          <Paragraph type="secondary">认证页面已在新窗口打开，请完成 L 币支付</Paragraph>

          <div style={{
            margin: '24px 0',
            padding: '16px 32px',
            background: `rgba(0, 102, 255, 0.06)`,
            borderRadius: 10,
            display: 'inline-block',
          }}>
            <Text>L 币：</Text>
            <Text style={{ fontSize: 28, fontWeight: 700, color: LINUXDO_COLOR }}>
              {payingOrder.credits}
            </Text>
          </div>

          <div style={{ marginTop: 20 }}>
            <Button onClick={() => window.open(payingOrder.payUrl, '_blank')} style={{ borderRadius: 8 }}>
              重新打开支付页面
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fafbfc' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '40px 20px' : '60px 20px' }}>
        {/* 头部 - LinuxDo 标识 */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: LINUXDO_COLOR,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontSize: 24, fontWeight: 700 }}>L</span>
            </div>
            <Title level={3} style={{ margin: 0, color: '#1f2937' }}>Linux.do</Title>
          </div>
          <Title level={2} style={{ margin: '0 0 12px', color: '#1f2937', fontWeight: 700 }}>
            专属兑换通道
          </Title>
          <Text type="secondary" style={{ fontSize: 16 }}>
            使用 L 币兑换 ChatGPT Team 使用权
          </Text>
        </div>

        {/* 套餐选择 */}
        <Row gutter={[20, 20]} style={{ marginBottom: 32 }}>
          {plans.map(plan => (
            <Col key={plan.id} xs={24} sm={12} md={8}>
              <PlanCard
                plan={plan}
                selected={selectedPlan?.id === plan.id}
                onSelect={() => setSelectedPlan(plan)}
              />
            </Col>
          ))}
        </Row>

        {/* 邮箱输入和提交 */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
        }}>
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ display: 'block', marginBottom: 8, color: '#1f2937' }}>
              邮箱地址 <Text type="danger">*</Text>
            </Text>
            <Input
              placeholder="请输入您的邮箱，用于接收兑换码"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              size="large"
              style={{ borderRadius: 10 }}
            />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              支付成功后可通过邮箱查询订单
            </Text>
          </div>

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            onClick={handleSubmit}
            disabled={!selectedPlan}
            style={{
              height: 48,
              borderRadius: 10,
              background: selectedPlan ? LINUXDO_COLOR : '#d1d5db',
              border: 'none',
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {selectedPlan ? `使用 ${selectedPlan.credits} L 币兑换` : '请先选择套餐'}
          </Button>
        </div>

        {/* 底部说明 */}
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            支付将跳转至 Linux.do 进行 L 币认证
          </Text>
        </div>
      </div>
    </div>
  )
}

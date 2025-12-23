// LinuxDo L币购买页面
import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, message, Row, Col, Space, Grid, Card, Tooltip } from 'antd'
import {
  CheckCircleOutlined, LoadingOutlined, ArrowRightOutlined, CopyOutlined, CheckCircleFilled,
  ShoppingCartOutlined, CrownOutlined, MailOutlined, TeamOutlined
} from '@ant-design/icons'
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
  stock?: number | null
  sold_count: number
  remaining_stock?: number | null
}

// LinuxDo 主题色
const LINUXDO_COLOR = '#0066FF'
const LINUXDO_GRADIENT = 'linear-gradient(135deg, #0066FF 0%, #0052CC 100%)'

// 套餐卡片组件
const PlanCard: React.FC<{ plan: Plan; onBuy: (plan: Plan) => void }> = ({ plan, onBuy }) => {
  const isRecommended = plan.is_recommended
  const featureList = plan.features ? plan.features.split(',').map(f => f.trim()) : ['全特性可用', '畅享体验']
  const hasStock = plan.stock !== null && plan.stock !== undefined
  const remaining = plan.remaining_stock ?? (hasStock ? 0 : null)
  const isSoldOut = hasStock && (remaining === null || remaining <= 0)

  return (
    <div style={{
      borderRadius: 20,
      border: isRecommended ? `2px solid ${LINUXDO_COLOR}` : '1px solid #e5e7eb',
      boxShadow: isRecommended
        ? `0 20px 40px -10px rgba(0, 102, 255, 0.15)`
        : '0 4px 16px rgba(0, 0, 0, 0.04)',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s ease',
      opacity: isSoldOut ? 0.7 : 1,
    }}>
      {isRecommended && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: -32,
          background: LINUXDO_GRADIENT,
          color: 'white',
          padding: '6px 40px',
          fontSize: 12,
          fontWeight: 600,
          transform: 'rotate(45deg)',
          boxShadow: `0 2px 8px rgba(0, 102, 255, 0.3)`,
        }}>
          推荐
        </div>
      )}

      {isSoldOut && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: 16,
          background: '#ff4d4f',
          color: 'white',
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 6,
        }}>
          已售罄
        </div>
      )}

      <div style={{
        padding: '28px 24px 20px',
        borderBottom: '1px solid #f3f4f6',
        background: isRecommended ? `linear-gradient(180deg, rgba(0, 102, 255, 0.04) 0%, transparent 100%)` : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {isRecommended && <CrownOutlined style={{ color: LINUXDO_COLOR, fontSize: 18 }} />}
          <Title level={4} style={{ margin: 0, color: '#1f2937', fontWeight: 700 }}>{plan.name}</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 14 }}>
          {plan.description || `有效期 ${plan.validity_days} 天`}
        </Text>
      </div>

      <div style={{ padding: '24px', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontSize: 16, color: '#6b7280' }}>L 币</Text>
            <Text style={{ fontSize: 48, fontWeight: 800, color: isRecommended ? LINUXDO_COLOR : '#1f2937', lineHeight: 1, marginLeft: 8 }}>
              {plan.credits.split('.')[0]}
            </Text>
            {plan.credits.includes('.') && (
              <Text style={{ fontSize: 20, fontWeight: 600, color: isRecommended ? LINUXDO_COLOR : '#1f2937' }}>
                .{plan.credits.split('.')[1]}
              </Text>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 14 }}>/ {plan.validity_days} 天</Text>
        </div>

        {hasStock && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: isSoldOut ? '#fff2f0' : '#f0f9ff', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TeamOutlined style={{ color: isSoldOut ? '#ff4d4f' : LINUXDO_COLOR }} />
            <Text style={{ color: isSoldOut ? '#ff4d4f' : '#1f2937', fontSize: 13 }}>
              {isSoldOut ? '已售罄' : `剩余 ${remaining} 份`}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>/ 共 {plan.stock} 份</Text>
          </div>
        )}

        <div style={{ flexGrow: 1, marginBottom: 24 }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {featureList.map((feature, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircleOutlined style={{ color: LINUXDO_COLOR, fontSize: 16 }} />
                <Text style={{ color: '#4b5563', fontSize: 14 }}>{feature}</Text>
              </div>
            ))}
          </Space>
        </div>

        <Button
          type="primary"
          size="large"
          block
          icon={<ShoppingCartOutlined />}
          onClick={() => onBuy(plan)}
          disabled={isSoldOut}
          style={{
            height: 48,
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 12,
            background: isSoldOut ? '#d9d9d9' : (isRecommended ? LINUXDO_GRADIENT : '#1f2937'),
            border: 'none',
            boxShadow: isSoldOut ? 'none' : (isRecommended
              ? `0 4px 14px rgba(0, 102, 255, 0.3)`
              : '0 4px 14px rgba(0, 0, 0, 0.1)'),
          }}
        >
          {isSoldOut ? '已售罄' : '立即购买'}
        </Button>
      </div>
    </div>
  )
}

export default function LinuxDoRedeem() {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [enabled, setEnabled] = useState(false)

  // 购买状态
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [buyEmail, setBuyEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 支付中状态
  const [payingOrder, setPayingOrder] = useState<{ orderNo: string; gatewayUrl: string; payParams: Record<string, string>; credits: string } | null>(null)
  const pollTimeoutRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  // 购买成功状态
  const [buySuccess, setBuySuccess] = useState<{ redeemCode: string; validityDays: number } | null>(null)

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

  // 处理从支付网关跳转回来的情况
  useEffect(() => {
    const orderNo = searchParams.get('order_no')
    if (!orderNo) return

    const checkOrderStatus = async () => {
      try {
        const response: any = await linuxdoApi.getOrderStatus(orderNo)
        if (response.status === 'paid' && response.redeem_code) {
          setBuySuccess({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
        } else if (response.status === 'pending') {
          setPayingOrder({
            orderNo: orderNo,
            gatewayUrl: '',
            payParams: {},
            credits: response.credits || '0',
          })
          startPolling(orderNo)
        }
      } catch { }
    }

    checkOrderStatus()
  }, [searchParams])

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success({ content: '已复制！', icon: <CheckCircleFilled style={{ color: LINUXDO_COLOR }} /> })
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const handleBuyClick = (plan: Plan) => {
    setSelectedPlan(plan)
  }

  const handleCreateOrder = async () => {
    if (!selectedPlan) return

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!buyEmail.trim() || !emailRegex.test(buyEmail.trim())) {
      message.error('请输入正确的邮箱地址')
      return
    }

    setSubmitting(true)
    try {
      const response: any = await linuxdoApi.createOrder({
        plan_id: selectedPlan.id,
        email: buyEmail.trim().toLowerCase(),
      })

      setPayingOrder({
        orderNo: response.order_no,
        gatewayUrl: response.gateway_url,
        payParams: response.pay_params,
        credits: response.credits,
      })

      setTimeout(() => {
        if (formRef.current) {
          formRef.current.submit()
        }
      }, 100)

      startPolling(response.order_no)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建订单失败')
    } finally {
      setSubmitting(false)
    }
  }

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
          setBuySuccess({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
          return
        }
      } catch { }

      pollTimeoutRef.current = window.setTimeout(poll, 3000)
    }

    poll()
  }

  const handleResubmitPayment = () => {
    if (formRef.current) {
      formRef.current.submit()
    }
  }

  // 前往兑换页面
  const handleGoToRedeem = () => {
    if (buySuccess) {
      navigate(`/direct/${buySuccess.redeemCode}`)
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

  // 购买成功页面
  if (buySuccess) {
    return (
      <div style={{ minHeight: '100vh', background: `linear-gradient(180deg, rgba(0, 102, 255, 0.04) 0%, #f8fafc 100%)`, padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: LINUXDO_GRADIENT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <CheckCircleOutlined style={{ fontSize: 40, color: '#fff' }} />
          </div>
          <Title level={2} style={{ color: '#1f2937', marginBottom: 8 }}>支付成功！</Title>
          <Paragraph style={{ color: '#ef4444', fontWeight: 600, fontSize: 16, marginBottom: 32 }}>
            请立即保存您的兑换码
          </Paragraph>

          <div style={{
            background: `linear-gradient(135deg, rgba(0, 102, 255, 0.08) 0%, rgba(0, 102, 255, 0.04) 100%)`,
            padding: 28,
            borderRadius: 16,
            marginBottom: 32,
            border: `1px solid rgba(0, 102, 255, 0.2)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Input
                value={buySuccess.redeemCode}
                readOnly
                style={{
                  width: 240,
                  textAlign: 'center',
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 3,
                  color: LINUXDO_COLOR,
                  background: '#fff',
                  borderRadius: '12px 0 0 12px',
                  height: 48,
                }}
              />
              <Tooltip title="复制">
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(buySuccess.redeemCode)}
                  style={{ height: 48, width: 48, background: LINUXDO_COLOR, borderColor: LINUXDO_COLOR, color: '#fff', borderRadius: '0 12px 12px 0' }}
                />
              </Tooltip>
            </div>
            <Paragraph style={{ color: '#6b7280', margin: 0 }}>
              有效期：{buySuccess.validityDays} 天（从兑换激活时开始计算）
            </Paragraph>
          </div>

          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Button
              type="primary"
              size="large"
              block
              icon={<ArrowRightOutlined />}
              onClick={handleGoToRedeem}
              style={{
                height: 52,
                borderRadius: 12,
                background: LINUXDO_GRADIENT,
                border: 'none',
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              前往兑换上车
            </Button>
            <Button
              size="large"
              block
              onClick={() => { setBuySuccess(null); setSelectedPlan(null) }}
              style={{ height: 48, borderRadius: 12 }}
            >
              继续购买
            </Button>
          </Space>
        </div>
      </div>
    )
  }

  // 支付中页面
  if (payingOrder) {
    return (
      <div style={{ minHeight: '100vh', background: `linear-gradient(180deg, rgba(0, 102, 255, 0.04) 0%, #f8fafc 100%)`, padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {payingOrder.gatewayUrl && (
          <form
            ref={formRef}
            method="POST"
            action={payingOrder.gatewayUrl}
            target="_blank"
            style={{ display: 'none' }}
          >
            {Object.entries(payingOrder.payParams).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          </form>
        )}

        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 56, color: LINUXDO_COLOR }} spin />} />
          <Title level={3} style={{ color: '#1f2937', marginTop: 24 }}>等待支付确认</Title>
          <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
          <Paragraph type="secondary">认证页面已在新窗口打开，请完成 L 币支付</Paragraph>

          <div style={{
            margin: '24px 0',
            padding: '16px 32px',
            background: `linear-gradient(135deg, rgba(0, 102, 255, 0.08) 0%, rgba(0, 102, 255, 0.04) 100%)`,
            borderRadius: 12,
            display: 'inline-block',
          }}>
            <Text>L 币：</Text>
            <Text style={{ fontSize: 32, fontWeight: 700, color: LINUXDO_COLOR }}>
              {payingOrder.credits}
            </Text>
          </div>

          {payingOrder.gatewayUrl && (
            <div style={{ marginTop: 24 }}>
              <Button onClick={handleResubmitPayment} style={{ borderRadius: 10 }}>
                重新打开支付页面
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 购买页面（选中套餐后显示邮箱输入）
  const renderBuyContent = () => {
    if (selectedPlan) {
      return (
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <Button type="text" onClick={() => setSelectedPlan(null)} style={{ marginBottom: 24, padding: 0, color: '#6b7280' }}>
            ← 返回套餐选择
          </Button>

          <div style={{ background: '#f8fafc', borderRadius: 16, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text type="secondary">套餐</Text>
              <Text strong>{selectedPlan.name}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text type="secondary">有效期</Text>
              <Text>{selectedPlan.validity_days} 天</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text type="secondary">价格</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: LINUXDO_COLOR }}>
                {selectedPlan.credits} L 币
              </Text>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              联系邮箱 <Text type="danger">*</Text>
            </Text>
            <Input
              prefix={<MailOutlined style={{ color: '#86868b' }} />}
              placeholder="请输入邮箱，用于查询订单"
              value={buyEmail}
              onChange={e => setBuyEmail(e.target.value)}
              size="large"
              style={{ height: 48, borderRadius: 12 }}
            />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              支付成功后可通过邮箱查询订单和兑换码
            </Text>
          </div>

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            onClick={handleCreateOrder}
            style={{
              height: 52,
              borderRadius: 12,
              background: LINUXDO_GRADIENT,
              border: 'none',
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            使用 {selectedPlan.credits} L 币购买
          </Button>
        </div>
      )
    }

    return (
      <div>
        <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
          {plans.map(plan => (
            <Col key={plan.id} xs={24} sm={12} lg={8}>
              <PlanCard plan={plan} onBuy={handleBuyClick} />
            </Col>
          ))}
        </Row>

        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Space split={<span style={{ color: '#e5e7eb' }}>•</span>} size={24}>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: LINUXDO_COLOR, marginRight: 6 }} />
              L 币安全支付
            </Text>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: LINUXDO_COLOR, marginRight: 6 }} />
              即时发码
            </Text>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: LINUXDO_COLOR, marginRight: 6 }} />
              LinuxDo 专属
            </Text>
          </Space>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
      {/* 背景装饰 */}
      <div style={{ position: 'fixed', top: '-15%', right: '-10%', width: 500, height: 500, background: `radial-gradient(circle, rgba(0, 102, 255, 0.06) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: 400, height: 400, background: `radial-gradient(circle, rgba(0, 102, 255, 0.04) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '32px 16px' : '48px 20px', position: 'relative', zIndex: 1 }}>
        {/* 头部 */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: LINUXDO_GRADIENT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 8px 24px rgba(0, 102, 255, 0.25)`,
            }}>
              <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>L</span>
            </div>
            <Title level={3} style={{ margin: 0, color: '#1f2937' }}>Linux.do</Title>
          </div>
          <Title level={2} style={{ margin: '0 0 12px', color: '#1f2937', fontWeight: 700 }}>
            L 币购买通道
          </Title>
          <Text type="secondary" style={{ fontSize: 16 }}>
            使用 L 币购买 ChatGPT Team 兑换码
          </Text>
        </div>

        {/* 购买卡片 */}
        <Card
          style={{
            borderRadius: 20,
            border: 'none',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)',
            overflow: 'hidden',
          }}
          bodyStyle={{ padding: isMobile ? 24 : 40 }}
        >
          {renderBuyContent()}
        </Card>

        {/* 底部 */}
        <div style={{ textAlign: 'center', marginTop: 32, color: '#9ca3af', fontSize: 12 }}>
          Powered by Linux.do
        </div>
      </div>
    </div>
  )
}

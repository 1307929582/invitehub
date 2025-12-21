// 购买套餐页面
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, Tooltip, message, Modal, Radio, Space, Row, Col, Tag, Divider, Table, Empty } from 'antd'
import { ShoppingCartOutlined, CheckCircleOutlined, CheckCircleFilled, CopyOutlined, ArrowRightOutlined, LoadingOutlined, AlipayCircleOutlined, WechatOutlined, ArrowLeftOutlined, SearchOutlined, GiftOutlined, CrownOutlined } from '@ant-design/icons'
import { publicApi } from '../api'

const { Title, Text, Paragraph } = Typography

interface Plan {
  id: number
  name: string
  price: number
  original_price?: number
  validity_days: number
  description?: string
  features?: string
  is_recommended: boolean
}

interface PaymentConfig {
  enabled: boolean
  alipay_enabled: boolean
  wxpay_enabled: boolean
}

interface OrderResponse {
  order_no: string
  amount: number
  pay_url: string
  expire_at: string
}

interface OrderStatus {
  order_no: string
  status: string
  amount: number
  discount_amount: number
  final_amount?: number
  email?: string
  redeem_code?: string
  plan_name?: string
  validity_days?: number
  created_at?: string
  paid_at?: string
}

// 新设计的套餐卡片组件
const PlanCard: React.FC<{ plan: Plan; onBuy: (plan: Plan) => void }> = ({ plan, onBuy }) => {
  const isRecommended = plan.is_recommended
  const priceYuan = (plan.price / 100).toFixed(2)
  const originalPriceYuan = plan.original_price ? (plan.original_price / 100).toFixed(2) : null
  const features = plan.features ? plan.features.split(',').map(f => f.trim()) : ['全特性可用', '畅享体验']

  return (
    <div style={{
      borderRadius: 20,
      border: isRecommended ? '2px solid #10a37f' : '1px solid #e5e7eb',
      boxShadow: isRecommended
        ? '0 20px 40px -10px rgba(16, 163, 127, 0.15)'
        : '0 4px 16px rgba(0, 0, 0, 0.04)',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s ease',
    }}>
      {/* 推荐标签 */}
      {isRecommended && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: -32,
          background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
          color: 'white',
          padding: '6px 40px',
          fontSize: 12,
          fontWeight: 600,
          transform: 'rotate(45deg)',
          boxShadow: '0 2px 8px rgba(16, 163, 127, 0.3)',
        }}>
          推荐
        </div>
      )}

      {/* 头部 */}
      <div style={{
        padding: '28px 24px 20px',
        borderBottom: '1px solid #f3f4f6',
        background: isRecommended ? 'linear-gradient(180deg, rgba(16, 163, 127, 0.04) 0%, transparent 100%)' : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {isRecommended && <CrownOutlined style={{ color: '#10a37f', fontSize: 18 }} />}
          <Title level={4} style={{ margin: 0, color: '#1f2937', fontWeight: 700 }}>{plan.name}</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 14 }}>
          {plan.description || `有效期 ${plan.validity_days} 天`}
        </Text>
      </div>

      {/* 价格区域 */}
      <div style={{ padding: '24px', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 24 }}>
          {originalPriceYuan && (
            <Text delete type="secondary" style={{ fontSize: 18, marginRight: 8 }}>
              ¥{originalPriceYuan}
            </Text>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontSize: 16, color: '#6b7280' }}>¥</Text>
            <Text style={{ fontSize: 48, fontWeight: 800, color: isRecommended ? '#10a37f' : '#1f2937', lineHeight: 1 }}>
              {priceYuan.split('.')[0]}
            </Text>
            <Text style={{ fontSize: 20, fontWeight: 600, color: isRecommended ? '#10a37f' : '#1f2937' }}>
              .{priceYuan.split('.')[1]}
            </Text>
          </div>
          <Text type="secondary" style={{ fontSize: 14 }}>/ {plan.validity_days} 天</Text>
        </div>

        {/* 特性列表 */}
        <div style={{ flexGrow: 1, marginBottom: 24 }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {features.map((feature, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircleOutlined style={{ color: '#10a37f', fontSize: 16 }} />
                <Text style={{ color: '#4b5563', fontSize: 14 }}>{feature}</Text>
              </div>
            ))}
          </Space>
        </div>

        {/* 购买按钮 */}
        <Button
          type="primary"
          size="large"
          block
          icon={<ShoppingCartOutlined />}
          onClick={() => onBuy(plan)}
          style={{
            height: 48,
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 12,
            background: isRecommended
              ? 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)'
              : '#1f2937',
            border: 'none',
            boxShadow: isRecommended
              ? '0 4px 14px rgba(16, 163, 127, 0.3)'
              : '0 4px 14px rgba(0, 0, 0, 0.1)',
          }}
        >
          立即购买
        </Button>
      </div>
    </div>
  )
}

export default function Purchase() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlCoupon = searchParams.get('coupon')?.toUpperCase() || ''

  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)

  // 支付弹窗状态
  const [payModalVisible, setPayModalVisible] = useState(false)
  const [email, setEmail] = useState(() => localStorage.getItem('purchase_email') || '')
  const [payType, setPayType] = useState<string>('alipay')
  const [submitting, setSubmitting] = useState(false)

  // 支付中状态
  const [payingOrder, setPayingOrder] = useState<{ orderNo: string; payUrl: string; amount: number } | null>(null)

  // 支付成功状态
  const [successOrder, setSuccessOrder] = useState<{ redeemCode: string; validityDays: number } | null>(null)

  // 订单查询状态
  const [queryModalVisible, setQueryModalVisible] = useState(false)
  const [queryEmail, setQueryEmail] = useState('')
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryOrders, setQueryOrders] = useState<OrderStatus[]>([])

  // 优惠码状态
  const [couponCode, setCouponCode] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string
    discountAmount: number
  } | null>(null)

  useEffect(() => {
    Promise.all([
      publicApi.getPaymentConfig().catch(() => null),
      publicApi.getPlans().catch(() => []),
    ]).then(([config, plansData]) => {
      const payConfig = config as unknown as PaymentConfig | null
      setPaymentConfig(payConfig)
      const plansList = (plansData || []) as unknown as Plan[]
      setPlans(plansList)
      if (payConfig) {
        if (payConfig.alipay_enabled) setPayType('alipay')
        else if (payConfig.wxpay_enabled) setPayType('wxpay')
      }
    }).finally(() => setLoading(false))
  }, [])

  // 打开支付弹窗（新版：直接传入 plan）
  const handleBuyClick = async (plan: Plan) => {
    setSelectedPlan(plan)
    // 重置优惠码状态
    setCouponError(null)
    setAppliedCoupon(null)

    // 如果 URL 有优惠码参数，自动填入并验证
    if (urlCoupon) {
      setCouponCode(urlCoupon)
      setPayModalVisible(true)
      // 自动验证优惠码
      setCouponLoading(true)
      try {
        const response = await publicApi.checkCoupon({
          code: urlCoupon,
          plan_id: plan.id,
          amount: plan.price,
        }) as unknown as { valid: boolean; discount_amount: number; final_amount: number; message: string }

        if (response.valid && response.discount_amount > 0) {
          setAppliedCoupon({
            code: urlCoupon,
            discountAmount: response.discount_amount,
          })
          message.success(`优惠码已生效，优惠 ¥${(response.discount_amount / 100).toFixed(2)}`)
        } else {
          setCouponError(response.message || '优惠码无效')
        }
      } catch (error: any) {
        setCouponError(error.response?.data?.detail || '优惠码验证失败')
      } finally {
        setCouponLoading(false)
      }
    } else {
      setCouponCode('')
      setPayModalVisible(true)
    }
  }

  // 验证优惠码
  const handleCheckCoupon = async () => {
    if (!selectedPlan || !couponCode.trim()) {
      setCouponError('请输入优惠码')
      return
    }

    setCouponLoading(true)
    setCouponError(null)

    try {
      const response = await publicApi.checkCoupon({
        code: couponCode.trim().toUpperCase(),
        plan_id: selectedPlan.id,
        amount: selectedPlan.price,
      }) as unknown as { valid: boolean; discount_amount: number; final_amount: number; message: string }

      if (response.valid && response.discount_amount > 0) {
        setAppliedCoupon({
          code: couponCode.trim().toUpperCase(),
          discountAmount: response.discount_amount,
        })
        message.success(`优惠码已生效，优惠 ¥${(response.discount_amount / 100).toFixed(2)}`)
      } else {
        setCouponError(response.message || '优惠码无效')
        setAppliedCoupon(null)
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || '验证失败'
      setCouponError(errorMsg)
      setAppliedCoupon(null)
    } finally {
      setCouponLoading(false)
    }
  }

  // 移除优惠码
  const handleRemoveCoupon = () => {
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponError(null)
    message.info('优惠码已移除')
  }

  // 计算最终金额
  const finalAmount = selectedPlan ? selectedPlan.price - (appliedCoupon?.discountAmount || 0) : 0

  // 创建订单
  const handleCreateOrder = async () => {
    if (!selectedPlan) return

    // 邮箱校验
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email.trim() || !emailRegex.test(email.trim())) {
      message.error('请输入正确的邮箱地址')
      return
    }

    setSubmitting(true)
    try {
      // 保存邮箱到本地
      localStorage.setItem('purchase_email', email.trim().toLowerCase())

      const response = await publicApi.createOrder({
        plan_id: selectedPlan.id,
        email: email.trim().toLowerCase(),
        pay_type: payType,
        coupon_code: appliedCoupon?.code,
      }) as unknown as OrderResponse

      setPayModalVisible(false)
      setPayingOrder({
        orderNo: response.order_no,
        payUrl: response.pay_url,
        amount: response.amount,
      })

      // 打开支付页面
      window.open(response.pay_url, '_blank')

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
    let attempts = 0
    const maxAttempts = 60

    const poll = async () => {
      if (attempts >= maxAttempts) return
      attempts++

      try {
        const response = await publicApi.getOrderStatus(orderNo) as unknown as OrderStatus
        if (response.status === 'paid' && response.redeem_code) {
          setPayingOrder(null)
          setSuccessOrder({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
          return
        }
      } catch {}

      setTimeout(poll, 3000)
    }

    poll()
  }

  // 复制兑换码
  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    message.success({ content: '已复制！', icon: <CheckCircleFilled style={{ color: '#34c759' }} /> })
  }

  // 查询订单
  const handleQueryOrders = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!queryEmail.trim() || !emailRegex.test(queryEmail.trim())) {
      message.error('请输入正确的邮箱地址')
      return
    }

    setQueryLoading(true)
    try {
      const response = await publicApi.queryOrdersByEmail(queryEmail.trim().toLowerCase()) as unknown as { orders: OrderStatus[]; total: number }
      setQueryOrders(response.orders)
      if (response.orders.length === 0) {
        message.info('未找到相关订单')
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '查询失败')
    } finally {
      setQueryLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!paymentConfig?.enabled || plans.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Result
          status="info"
          title="暂未开放购买"
          subTitle={<span>请联系：<a href="mailto:contact@zenscaleai.com" style={{ color: '#007aff' }}>contact@zenscaleai.com</a></span>}
          extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </div>
    )
  }

  // 支付成功页面
  if (successOrder) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 100%)', padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <CheckCircleOutlined style={{ fontSize: 40, color: '#fff' }} />
          </div>
          <Title level={2} style={{ color: '#1f2937', marginBottom: 8 }}>支付成功！</Title>
          <Paragraph style={{ color: '#ef4444', fontWeight: 600, fontSize: 16, marginBottom: 32 }}>
            请立即保存您的兑换码，关闭后可通过邮箱查询
          </Paragraph>

          <div style={{
            background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.08) 0%, rgba(16, 163, 127, 0.04) 100%)',
            padding: 28,
            borderRadius: 16,
            marginBottom: 32,
            border: '1px solid rgba(16, 163, 127, 0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Input
                value={successOrder.redeemCode}
                readOnly
                style={{
                  width: 240,
                  textAlign: 'center',
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 3,
                  color: '#10a37f',
                  background: '#fff',
                  borderRadius: '12px 0 0 12px',
                  height: 48,
                }}
              />
              <Tooltip title="复制">
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(successOrder.redeemCode)}
                  style={{ height: 48, width: 48, background: '#10a37f', borderColor: '#10a37f', color: '#fff', borderRadius: '0 12px 12px 0' }}
                />
              </Tooltip>
            </div>
            <Paragraph style={{ color: '#6b7280', margin: 0 }}>
              有效期：{successOrder.validityDays} 天（从兑换激活时开始计算）
            </Paragraph>
          </div>

          <Space size="middle">
            <Button size="large" onClick={() => { setSuccessOrder(null); setSelectedPlan(null) }} style={{ height: 48, borderRadius: 12 }}>
              继续购买
            </Button>
            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => navigate('/invite')}
              style={{ height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)', border: 'none' }}>
              前往兑换
            </Button>
          </Space>
        </div>
      </div>
    )
  }

  // 支付中页面
  if (payingOrder) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 100%)', padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 56, color: '#10a37f' }} spin />} />
          <Title level={3} style={{ color: '#1f2937', marginTop: 24 }}>等待支付确认</Title>
          <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
          <Paragraph type="secondary">支付页面已在新窗口打开，请完成支付</Paragraph>

          <div style={{
            margin: '24px 0',
            padding: '16px 32px',
            background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.08) 0%, rgba(16, 163, 127, 0.04) 100%)',
            borderRadius: 12,
            display: 'inline-block',
          }}>
            <Text>金额：</Text>
            <Text style={{ fontSize: 32, fontWeight: 700, color: '#10a37f' }}>
              ¥{(payingOrder.amount / 100).toFixed(2)}
            </Text>
          </div>

          <div style={{ marginTop: 24 }}>
            <Button onClick={() => window.open(payingOrder.payUrl, '_blank')} style={{ borderRadius: 10 }}>
              重新打开支付页面
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 50%, #ffffff 100%)' }}>
      {/* 装饰 */}
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(16, 163, 127, 0.06) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(16, 163, 127, 0.04) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0, pointerEvents: 'none' }} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px', position: 'relative', zIndex: 1 }}>
        {/* 顶部栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ color: '#6b7280', fontWeight: 500 }}>
            返回首页
          </Button>
          <Button icon={<SearchOutlined />} onClick={() => setQueryModalVisible(true)} style={{ borderRadius: 10 }}>
            查询订单
          </Button>
        </div>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Title style={{ fontSize: 42, fontWeight: 800, color: '#1f2937', marginBottom: 16, letterSpacing: '-1px' }}>
            选择最适合你的方案
          </Title>
          <Paragraph style={{ fontSize: 18, color: '#6b7280', maxWidth: 500, margin: '0 auto' }}>
            即刻开始您的 ChatGPT Team 之旅，支付后立即获取兑换码
          </Paragraph>
        </div>

        {/* 套餐列表 */}
        <Row gutter={[28, 28]} justify="center" style={{ marginBottom: 48 }}>
          {plans.map(plan => (
            <Col key={plan.id} xs={24} sm={12} lg={8}>
              <PlanCard plan={plan} onBuy={handleBuyClick} />
            </Col>
          ))}
        </Row>

        {/* 底部说明 */}
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Space split={<span style={{ color: '#e5e7eb' }}>•</span>} size={24}>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: '#10a37f', marginRight: 6 }} />
              安全支付
            </Text>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: '#10a37f', marginRight: 6 }} />
              即时发码
            </Text>
            <Text type="secondary" style={{ fontSize: 14 }}>
              <CheckCircleOutlined style={{ color: '#10a37f', marginRight: 6 }} />
              售后保障
            </Text>
          </Space>
        </div>
      </div>

      {/* 支付弹窗 */}
      <Modal
        title="确认订单"
        open={payModalVisible}
        onCancel={() => setPayModalVisible(false)}
        footer={null}
        centered
        width={440}
      >
        <div style={{ padding: '16px 0' }}>
          {/* 订单信息 */}
          <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">套餐</Text>
              <Text strong>{selectedPlan?.name}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">有效期</Text>
              <Text>{selectedPlan?.validity_days} 天</Text>
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: appliedCoupon ? 8 : 0 }}>
              <Text type="secondary">套餐价格</Text>
              <Text style={{ fontSize: appliedCoupon ? 14 : 22, fontWeight: appliedCoupon ? 400 : 700, color: appliedCoupon ? '#9ca3af' : '#10a37f', textDecoration: appliedCoupon ? 'line-through' : 'none' }}>
                ¥{selectedPlan ? (selectedPlan.price / 100).toFixed(2) : '0.00'}
              </Text>
            </div>
            {appliedCoupon && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text type="secondary">优惠</Text>
                  <Text style={{ color: '#10a37f', fontWeight: 500 }}>
                    -¥{(appliedCoupon.discountAmount / 100).toFixed(2)}
                  </Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text type="secondary">应付金额</Text>
                  <Text style={{ fontSize: 22, fontWeight: 700, color: '#10a37f' }}>
                    ¥{(finalAmount / 100).toFixed(2)}
                  </Text>
                </div>
              </>
            )}
          </div>

          {/* 优惠码 */}
          <div style={{ marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>优惠码</Text>
            {appliedCoupon ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'rgba(16, 163, 127, 0.08)',
                borderRadius: 10,
                border: '1px solid #10a37f',
              }}>
                <Space>
                  <GiftOutlined style={{ color: '#10a37f' }} />
                  <Text style={{ color: '#10a37f', fontWeight: 500 }}>{appliedCoupon.code}</Text>
                  <Text type="secondary">已优惠 ¥{(appliedCoupon.discountAmount / 100).toFixed(2)}</Text>
                </Space>
                <Button type="link" size="small" danger onClick={handleRemoveCoupon}>移除</Button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="输入优惠码"
                  value={couponCode}
                  onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null) }}
                  onPressEnter={handleCheckCoupon}
                  size="large"
                  style={{ flex: 1, borderRadius: 10 }}
                  status={couponError ? 'error' : undefined}
                />
                <Button
                  size="large"
                  loading={couponLoading}
                  onClick={handleCheckCoupon}
                  disabled={!couponCode.trim()}
                  style={{ borderRadius: 10 }}
                >
                  使用
                </Button>
              </div>
            )}
            {couponError && (
              <Text type="danger" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>{couponError}</Text>
            )}
          </div>

          {/* 邮箱输入 */}
          <div style={{ marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              联系邮箱 <Text type="danger">*</Text>
            </Text>
            <Input
              placeholder="请输入邮箱，用于查询订单"
              value={email}
              onChange={e => setEmail(e.target.value)}
              size="large"
              style={{ borderRadius: 10 }}
              status={!email.trim() ? 'warning' : undefined}
            />
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              支付成功后可通过邮箱查询订单和兑换码
            </Text>
          </div>

          {/* 支付方式 */}
          <div style={{ marginBottom: 24 }}>
            <Text strong style={{ display: 'block', marginBottom: 12 }}>支付方式</Text>
            <Radio.Group value={payType} onChange={e => setPayType(e.target.value)} style={{ width: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {paymentConfig?.alipay_enabled && (
                  <Radio value="alipay" style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: payType === 'alipay' ? 'rgba(22, 119, 255, 0.08)' : '#fafafa',
                    borderRadius: 8,
                    border: payType === 'alipay' ? '1px solid #1677ff' : '1px solid #e8e8e8',
                  }}>
                    <Space>
                      <AlipayCircleOutlined style={{ fontSize: 24, color: '#1677ff' }} />
                      <span>支付宝</span>
                    </Space>
                  </Radio>
                )}
                {paymentConfig?.wxpay_enabled && (
                  <Radio value="wxpay" style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: payType === 'wxpay' ? 'rgba(7, 193, 96, 0.08)' : '#fafafa',
                    borderRadius: 8,
                    border: payType === 'wxpay' ? '1px solid #07c160' : '1px solid #e8e8e8',
                  }}>
                    <Space>
                      <WechatOutlined style={{ fontSize: 24, color: '#07c160' }} />
                      <span>微信支付</span>
                    </Space>
                  </Radio>
                )}
              </Space>
            </Radio.Group>
          </div>

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            onClick={handleCreateOrder}
            style={{
              height: 48,
              borderRadius: 24,
              background: 'linear-gradient(135deg, #ff9500 0%, #ff5e3a 100%)',
              border: 'none',
              fontWeight: 600,
            }}
          >
            确认支付
          </Button>

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#86868b' }}>
            点击支付即表示您已阅读并同意
            <a href="/legal#terms" target="_blank" style={{ color: '#007aff', margin: '0 2px' }}>服务条款</a>、
            <a href="/legal#privacy" target="_blank" style={{ color: '#007aff', margin: '0 2px' }}>隐私政策</a>和
            <a href="/legal#refund" target="_blank" style={{ color: '#007aff', margin: '0 2px' }}>退款政策</a>
          </div>
        </div>
      </Modal>

      {/* 订单查询弹窗 */}
      <Modal
        title="查询订单"
        open={queryModalVisible}
        onCancel={() => { setQueryModalVisible(false); setQueryOrders([]) }}
        footer={null}
        width={600}
      >
        <div style={{ padding: '16px 0' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <Input
              placeholder="请输入购买时填写的邮箱"
              value={queryEmail}
              onChange={e => setQueryEmail(e.target.value)}
              onPressEnter={handleQueryOrders}
              size="large"
              style={{ flex: 1 }}
            />
            <Button type="primary" size="large" icon={<SearchOutlined />} loading={queryLoading} onClick={handleQueryOrders}>
              查询
            </Button>
          </div>

          {queryOrders.length > 0 ? (
            <Table
              dataSource={queryOrders}
              rowKey="order_no"
              pagination={false}
              size="small"
              columns={[
                {
                  title: '套餐',
                  dataIndex: 'plan_name',
                  width: 100,
                },
                {
                  title: '金额',
                  width: 100,
                  render: (_: any, r: OrderStatus) => {
                    const finalAmt = r.final_amount ?? r.amount
                    const hasDiscount = r.discount_amount > 0
                    return (
                      <Space direction="vertical" size={0}>
                        <Text type="danger" style={{ fontWeight: 500 }}>¥{(finalAmt / 100).toFixed(2)}</Text>
                        {hasDiscount && (
                          <Text type="secondary" delete style={{ fontSize: 11 }}>¥{(r.amount / 100).toFixed(2)}</Text>
                        )}
                      </Space>
                    )
                  }
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 80,
                  render: (v: string) => (
                    <Tag color={v === 'paid' ? 'green' : v === 'pending' ? 'blue' : 'default'}>
                      {v === 'paid' ? '已支付' : v === 'pending' ? '待支付' : '已过期'}
                    </Tag>
                  )
                },
                {
                  title: '兑换码',
                  dataIndex: 'redeem_code',
                  render: (v: string) => v ? (
                    <Space>
                      <Text code style={{ color: '#007aff' }}>{v}</Text>
                      <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(v)} />
                    </Space>
                  ) : <Text type="secondary">-</Text>
                },
              ]}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入邮箱查询订单" />
          )}
        </div>
      </Modal>
    </div>
  )
}

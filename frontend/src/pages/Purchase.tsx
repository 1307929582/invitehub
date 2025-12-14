// 购买套餐页面
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, Tooltip, message, Modal, Radio, Space, Row, Col, Card, Tag, Divider, Table, Empty } from 'antd'
import { ShoppingCartOutlined, CheckCircleFilled, CopyOutlined, ArrowRightOutlined, LoadingOutlined, AlipayCircleOutlined, WechatOutlined, ArrowLeftOutlined, SearchOutlined, GiftOutlined, ClockCircleOutlined } from '@ant-design/icons'
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
  email?: string
  redeem_code?: string
  plan_name?: string
  validity_days?: number
  created_at?: string
  paid_at?: string
}

// 套餐卡片
const PlanCard: React.FC<{ plan: Plan; selected: boolean; onSelect: () => void }> = ({ plan, selected, onSelect }) => {
  const priceYuan = (plan.price / 100).toFixed(2)

  return (
    <Card
      hoverable
      onClick={onSelect}
      style={{
        borderRadius: 16,
        border: selected ? '2px solid #007aff' : plan.is_recommended ? '2px solid #ff9500' : '1px solid #e8e8e8',
        background: selected ? 'rgba(0, 122, 255, 0.05)' : '#fff',
        transition: 'all 0.2s',
      }}
      bodyStyle={{ padding: 20, textAlign: 'center' }}
    >
      {plan.is_recommended && (
        <Tag color="orange" style={{ position: 'absolute', top: 12, right: 12 }}>推荐</Tag>
      )}
      <Title level={5} style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{plan.name}</Title>
      <div>
        <Text style={{ fontSize: 24, fontWeight: 700, color: selected ? '#007aff' : '#1d1d1f' }}>
          ¥{priceYuan}
        </Text>
      </div>
      <Text type="secondary" style={{ fontSize: 13 }}>{plan.validity_days}天有效</Text>
    </Card>
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

  // 打开支付弹窗
  const handleBuyClick = async () => {
    if (!selectedPlan) {
      message.warning('请先选择套餐')
      return
    }
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
          plan_id: selectedPlan.id,
          amount: selectedPlan.price,
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
          subTitle="请联系管理员获取兑换码"
          extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </div>
    )
  }

  // 支付成功页面
  if (successOrder) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)', padding: '60px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <CheckCircleFilled style={{ fontSize: 72, color: '#34c759', marginBottom: 24 }} />
          <Title level={2} style={{ color: '#1d1d1f', marginBottom: 8 }}>支付成功！</Title>
          <Paragraph style={{ color: '#ff3b30', fontWeight: 600, fontSize: 16, marginBottom: 32 }}>
            请立即保存您的兑换码，关闭后可通过邮箱查询
          </Paragraph>

          <div style={{
            background: 'rgba(0, 122, 255, 0.08)',
            padding: 24,
            borderRadius: 16,
            marginBottom: 32,
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Input
                value={successOrder.redeemCode}
                readOnly
                style={{
                  width: 280,
                  textAlign: 'center',
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: '#007aff',
                  background: '#fff',
                  borderRadius: '12px 0 0 12px',
                }}
              />
              <Tooltip title="复制">
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(successOrder.redeemCode)}
                  style={{ height: 40, background: '#007aff', borderColor: '#007aff', color: '#fff', borderRadius: '0 12px 12px 0' }}
                />
              </Tooltip>
            </div>
            <Paragraph style={{ color: '#86868b', margin: 0 }}>
              有效期：{successOrder.validityDays} 天（从兑换激活时开始计算）
            </Paragraph>
          </div>

          <Space size="middle">
            <Button size="large" onClick={() => { setSuccessOrder(null); setSelectedPlan(null) }}>
              继续购买
            </Button>
            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => navigate('/invite')}
              style={{ background: '#007aff', borderColor: '#007aff' }}>
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
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)', padding: '60px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(20px)',
            borderRadius: 24,
            padding: 48,
          }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 56 }} spin />} />
            <Title level={3} style={{ color: '#1d1d1f', marginTop: 24 }}>等待支付确认</Title>
            <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
            <Paragraph type="secondary">支付页面已在新窗口打开，请完成支付</Paragraph>

            <div style={{
              margin: '24px 0',
              padding: '12px 32px',
              background: 'rgba(255, 149, 0, 0.1)',
              borderRadius: 12,
              display: 'inline-block',
            }}>
              <Text>金额：</Text>
              <Text style={{ fontSize: 28, fontWeight: 700, color: '#ff9500' }}>
                ¥{(payingOrder.amount / 100).toFixed(2)}
              </Text>
            </div>

            <div style={{ marginTop: 24 }}>
              <Button onClick={() => window.open(payingOrder.payUrl, '_blank')}>
                重新打开支付页面
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
      {/* 装饰 */}
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(255, 149, 0, 0.08) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.06) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px', position: 'relative', zIndex: 1 }}>
        {/* 顶部栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ color: '#86868b' }}>
            返回首页
          </Button>
          <Button icon={<SearchOutlined />} onClick={() => setQueryModalVisible(true)}>
            查询订单
          </Button>
        </div>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Title level={2} style={{ color: '#1d1d1f', fontWeight: 700, marginBottom: 8 }}>
            选择套餐
          </Title>
          <Paragraph type="secondary" style={{ fontSize: 16 }}>
            选择适合您的套餐，支付后即可获得兑换码
          </Paragraph>
        </div>

        {/* 套餐列表 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
          {plans.map(plan => (
            <Col key={plan.id} xs={12} sm={8} md={6}>
              <PlanCard
                plan={plan}
                selected={selectedPlan?.id === plan.id}
                onSelect={() => setSelectedPlan(plan)}
              />
            </Col>
          ))}
        </Row>

        {/* 选中套餐详情 */}
        {selectedPlan && (
          <Card style={{ borderRadius: 16, marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                  <Title level={4} style={{ margin: 0 }}>{selectedPlan.name}</Title>
                  {selectedPlan.is_recommended && <Tag color="orange">推荐</Tag>}
                </div>
                <Space split={<Divider type="vertical" />}>
                  <Text type="secondary"><ClockCircleOutlined /> 有效期 {selectedPlan.validity_days} 天</Text>
                  {selectedPlan.description && <Text type="secondary">{selectedPlan.description}</Text>}
                </Space>
              </div>
              <div style={{ textAlign: 'right' }}>
                {selectedPlan.original_price && (
                  <Text delete type="secondary" style={{ marginRight: 8 }}>
                    ¥{(selectedPlan.original_price / 100).toFixed(2)}
                  </Text>
                )}
                <Text style={{ fontSize: 28, fontWeight: 700, color: '#ff9500' }}>
                  ¥{(selectedPlan.price / 100).toFixed(2)}
                </Text>
              </div>
            </div>

            <Divider />

            <div style={{ textAlign: 'center' }}>
              <Button
                type="primary"
                size="large"
                icon={<ShoppingCartOutlined />}
                onClick={handleBuyClick}
                style={{
                  height: 50,
                  padding: '0 48px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 25,
                  background: 'linear-gradient(135deg, #ff9500 0%, #ff5e3a 100%)',
                  border: 'none',
                }}
              >
                立即购买
              </Button>
            </div>
          </Card>
        )}

        {/* 未选择套餐提示 */}
        {!selectedPlan && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#86868b' }}>
            <GiftOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} />
            <Paragraph type="secondary">请点击上方套餐卡片进行选择</Paragraph>
          </div>
        )}
      </div>

      {/* 支付弹窗 */}
      <Modal
        title="确认订单"
        open={payModalVisible}
        onCancel={() => setPayModalVisible(false)}
        footer={null}
        centered
        width={420}
      >
        <div style={{ padding: '16px 0' }}>
          {/* 订单信息 */}
          <div style={{ background: '#f5f5f7', borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">套餐</Text>
              <Text strong>{selectedPlan?.name}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">有效期</Text>
              <Text>{selectedPlan?.validity_days} 天</Text>
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: appliedCoupon ? 8 : 0 }}>
              <Text type="secondary">套餐价格</Text>
              <Text style={{ fontSize: appliedCoupon ? 14 : 20, fontWeight: appliedCoupon ? 400 : 700, color: appliedCoupon ? '#86868b' : '#ff9500', textDecoration: appliedCoupon ? 'line-through' : 'none' }}>
                ¥{selectedPlan ? (selectedPlan.price / 100).toFixed(2) : '0.00'}
              </Text>
            </div>
            {appliedCoupon && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text type="secondary">优惠</Text>
                  <Text style={{ color: '#34c759', fontWeight: 500 }}>
                    -¥{(appliedCoupon.discountAmount / 100).toFixed(2)}
                  </Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">应付金额</Text>
                  <Text style={{ fontSize: 20, fontWeight: 700, color: '#ff9500' }}>
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
                background: 'rgba(52, 199, 89, 0.1)',
                borderRadius: 8,
                border: '1px solid #34c759',
              }}>
                <Space>
                  <GiftOutlined style={{ color: '#34c759' }} />
                  <Text style={{ color: '#34c759', fontWeight: 500 }}>{appliedCoupon.code}</Text>
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
                  style={{ flex: 1, borderRadius: 8 }}
                  status={couponError ? 'error' : undefined}
                />
                <Button
                  size="large"
                  loading={couponLoading}
                  onClick={handleCheckCoupon}
                  disabled={!couponCode.trim()}
                  style={{ borderRadius: 8 }}
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
              style={{ borderRadius: 8 }}
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
                  dataIndex: 'amount',
                  width: 80,
                  render: (v: number) => <Text type="danger">¥{(v / 100).toFixed(2)}</Text>
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

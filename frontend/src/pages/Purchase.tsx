// 购买套餐页面
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, Tooltip, message, Space, Row, Col, Radio } from 'antd'
import { ShoppingCartOutlined, CheckCircleFilled, CopyOutlined, ArrowRightOutlined, LoadingOutlined, AlipayCircleOutlined, WechatOutlined, ArrowLeftOutlined } from '@ant-design/icons'
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
  redeem_code?: string
  plan_name?: string
  validity_days?: number
}

// 套餐卡片
const PricingCard: React.FC<{ plan: Plan; selected: boolean; onSelect: (plan: Plan) => void }> = ({ plan, selected, onSelect }) => {
  const priceYuan = (plan.price / 100).toFixed(2)
  const originalPriceYuan = plan.original_price ? (plan.original_price / 100).toFixed(2) : null

  return (
    <div
      onClick={() => onSelect(plan)}
      style={{
        position: 'relative',
        background: selected ? 'rgba(0, 122, 255, 0.08)' : 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 20,
        border: selected ? '2px solid #007aff' : plan.is_recommended ? '2px solid #ff9500' : '1px solid rgba(0, 0, 0, 0.08)',
        padding: 32,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxShadow: selected ? '0 8px 32px rgba(0, 122, 255, 0.2)' : '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
      }}
    >
      {plan.is_recommended && (
        <div style={{
          position: 'absolute',
          top: -15,
          background: 'linear-gradient(45deg, #ff9500, #ff5e3a)',
          color: 'white',
          padding: '6px 16px',
          borderRadius: 20,
          fontSize: 14,
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(255, 149, 0, 0.4)',
        }}>
          推荐
        </div>
      )}

      <Title level={4} style={{ color: '#1d1d1f', fontWeight: 600, marginTop: plan.is_recommended ? 8 : 0 }}>
        {plan.name}
      </Title>

      <div style={{ margin: '16px 0' }}>
        {originalPriceYuan && (
          <Text delete style={{ fontSize: 16, color: '#86868b', marginRight: 8 }}>¥{originalPriceYuan}</Text>
        )}
        <Text style={{ fontSize: 20, fontWeight: 500, color: '#1d1d1f', marginRight: 4 }}>¥</Text>
        <Text style={{ fontSize: 44, fontWeight: 700, color: '#1d1d1f', lineHeight: 1 }}>
          {priceYuan.split('.')[0]}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: 500, color: '#1d1d1f' }}>.{priceYuan.split('.')[1]}</Text>
      </div>

      <Paragraph style={{ color: '#86868b', marginBottom: 8 }}>
        有效期 {plan.validity_days} 天
      </Paragraph>

      {plan.description && (
        <Paragraph style={{ color: '#86868b', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
          {plan.description}
        </Paragraph>
      )}

      {selected && (
        <div style={{
          marginTop: 'auto',
          background: '#007aff',
          color: '#fff',
          padding: '8px 24px',
          borderRadius: 20,
          fontWeight: 600,
        }}>
          已选择
        </div>
      )}
    </div>
  )
}

export default function Purchase() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [payType, setPayType] = useState<string>('alipay')
  const [status, setStatus] = useState<'SELECT' | 'LOADING' | 'PAYING' | 'SUCCESS'>('SELECT')
  const [orderNo, setOrderNo] = useState<string>('')
  const [payUrl, setPayUrl] = useState<string>('')
  const [redeemCode, setRedeemCode] = useState<string>('')

  useEffect(() => {
    Promise.all([
      publicApi.getPaymentConfig().catch(() => null),
      publicApi.getPlans().catch(() => []),
    ]).then(([config, plansData]) => {
      const payConfig = config as unknown as PaymentConfig | null
      setPaymentConfig(payConfig)
      const plansList = (plansData || []) as unknown as Plan[]
      setPlans(plansList)
      // 默认选中推荐套餐或第一个
      const recommended = plansList.find(p => p.is_recommended) || plansList[0]
      if (recommended) setSelectedPlan(recommended)
      // 默认支付方式
      if (payConfig) {
        if (payConfig.alipay_enabled) setPayType('alipay')
        else if (payConfig.wxpay_enabled) setPayType('wxpay')
      }
    }).finally(() => setLoading(false))
  }, [])

  // 创建订单
  const handleCreateOrder = async () => {
    if (!selectedPlan) {
      message.warning('请选择套餐')
      return
    }

    setStatus('LOADING')
    try {
      const response = await publicApi.createOrder({
        plan_id: selectedPlan.id,
        pay_type: payType,
      }) as unknown as OrderResponse

      setOrderNo(response.order_no)
      setPayUrl(response.pay_url)
      setStatus('PAYING')
      window.open(response.pay_url, '_blank')
      startPolling(response.order_no)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建订单失败')
      setStatus('SELECT')
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
          setRedeemCode(response.redeem_code)
          setStatus('SUCCESS')
          return
        }
      } catch {}

      setTimeout(poll, 3000)
    }

    poll()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(redeemCode)
    message.success({ content: '兑换码已复制！', icon: <CheckCircleFilled style={{ color: '#34c759' }} /> })
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

  // 支付成功
  if (status === 'SUCCESS') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)', padding: '60px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <Result
            status="success"
            icon={<CheckCircleFilled style={{ color: '#34c759', fontSize: 72 }} />}
            title={<Title level={2} style={{ color: '#1d1d1f' }}>支付成功！</Title>}
            subTitle={
              <Paragraph style={{ color: '#ff3b30', fontWeight: 600, fontSize: 16 }}>
                请立即保存您的兑换码，关闭后无法找回！
              </Paragraph>
            }
            extra={[
              <div key="code" style={{
                background: 'rgba(0, 122, 255, 0.08)',
                padding: 24,
                borderRadius: 16,
                marginBottom: 24,
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <Input
                    value={redeemCode}
                    readOnly
                    style={{
                      width: 280,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: 700,
                      letterSpacing: 2,
                      color: '#007aff',
                      background: '#fff',
                      borderColor: 'rgba(0, 122, 255, 0.4)',
                      borderRadius: '12px 0 0 12px',
                    }}
                  />
                  <Tooltip title="复制">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={handleCopy}
                      style={{
                        height: 40,
                        background: '#007aff',
                        borderColor: '#007aff',
                        color: '#fff',
                        borderRadius: '0 12px 12px 0',
                      }}
                    />
                  </Tooltip>
                </div>
                <Paragraph style={{ color: '#86868b', margin: 0 }}>
                  有效期：{selectedPlan?.validity_days} 天（从兑换激活时开始计算）
                </Paragraph>
              </div>,
              <Button
                key="redeem"
                type="primary"
                size="large"
                shape="round"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate('/invite')}
                style={{ background: '#007aff', borderColor: '#007aff', fontWeight: 600, height: 50, padding: '0 40px' }}
              >
                前往兑换
              </Button>,
            ]}
          />
        </div>
      </div>
    )
  }

  // 支付中
  if (status === 'PAYING') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)', padding: '60px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            borderRadius: 24,
            padding: 48,
          }}>
            <Title level={5} style={{ color: '#86868b', marginBottom: 4 }}>订单号: {orderNo}</Title>
            <div style={{ margin: '32px 0' }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 56 }} spin />} />
            </div>
            <Paragraph style={{ fontSize: 18 }}>支付页面已在新窗口打开</Paragraph>
            <Paragraph style={{ color: '#86868b' }}>请完成支付后等待自动确认...</Paragraph>
            <div style={{
              margin: '24px 0',
              padding: '12px 32px',
              background: 'rgba(255, 149, 0, 0.1)',
              borderRadius: 12,
              display: 'inline-block',
            }}>
              <Text style={{ color: '#1d1d1f' }}>金额：</Text>
              <Text style={{ fontSize: 28, fontWeight: 700, color: '#ff9500' }}>
                ¥{selectedPlan ? (selectedPlan.price / 100).toFixed(2) : '0.00'}
              </Text>
            </div>
            <div style={{ marginTop: 24 }}>
              <Button size="large" onClick={() => window.open(payUrl, '_blank')}>
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
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(255, 149, 0, 0.1) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-5%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(0, 122, 255, 0.08) 0%, transparent 70%)', borderRadius: '50%', zIndex: 0 }} />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px', position: 'relative', zIndex: 1 }}>
        {/* 返回按钮 */}
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginBottom: 24, color: '#86868b' }}
        >
          返回首页
        </Button>

        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <Title level={1} style={{ color: '#1d1d1f', fontWeight: 700, marginBottom: 12 }}>
            选择套餐
          </Title>
          <Paragraph style={{ color: '#86868b', fontSize: 18 }}>
            选择适合您的套餐，支付后即可获得兑换码
          </Paragraph>
        </div>

        {/* 套餐列表 */}
        <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
          {plans.map(plan => (
            <Col key={plan.id} xs={24} sm={12} md={8}>
              <PricingCard
                plan={plan}
                selected={selectedPlan?.id === plan.id}
                onSelect={setSelectedPlan}
              />
            </Col>
          ))}
        </Row>

        {/* 支付区域 */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: 24,
          padding: 32,
          maxWidth: 500,
          margin: '0 auto',
        }}>
          <Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>选择支付方式</Title>

          <Radio.Group
            value={payType}
            onChange={(e) => setPayType(e.target.value)}
            style={{ width: '100%', marginBottom: 24 }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {paymentConfig?.alipay_enabled && (
                <Radio value="alipay" style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: payType === 'alipay' ? 'rgba(22, 119, 255, 0.08)' : '#fff',
                  borderRadius: 12,
                  border: payType === 'alipay' ? '2px solid #1677ff' : '1px solid #e8e8e8',
                }}>
                  <Space>
                    <AlipayCircleOutlined style={{ fontSize: 28, color: '#1677ff' }} />
                    <span style={{ fontSize: 16, fontWeight: 500 }}>支付宝</span>
                  </Space>
                </Radio>
              )}
              {paymentConfig?.wxpay_enabled && (
                <Radio value="wxpay" style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: payType === 'wxpay' ? 'rgba(7, 193, 96, 0.08)' : '#fff',
                  borderRadius: 12,
                  border: payType === 'wxpay' ? '2px solid #07c160' : '1px solid #e8e8e8',
                }}>
                  <Space>
                    <WechatOutlined style={{ fontSize: 28, color: '#07c160' }} />
                    <span style={{ fontSize: 16, fontWeight: 500 }}>微信支付</span>
                  </Space>
                </Radio>
              )}
            </Space>
          </Radio.Group>

          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Text style={{ color: '#86868b' }}>应付金额：</Text>
            <Text style={{ fontSize: 32, fontWeight: 700, color: '#ff9500' }}>
              ¥{selectedPlan ? (selectedPlan.price / 100).toFixed(2) : '0.00'}
            </Text>
          </div>

          <Button
            type="primary"
            size="large"
            block
            icon={<ShoppingCartOutlined />}
            onClick={handleCreateOrder}
            loading={status === 'LOADING'}
            style={{
              height: 56,
              fontSize: 18,
              fontWeight: 600,
              borderRadius: 28,
              background: 'linear-gradient(135deg, #ff9500 0%, #ff5e3a 100%)',
              border: 'none',
            }}
          >
            立即支付
          </Button>
        </div>
      </div>
    </div>
  )
}

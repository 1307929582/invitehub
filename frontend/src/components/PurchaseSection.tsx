// 首页购买区域组件
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Button, Typography, Spin, Result, Input, Tooltip, message, Space, Row, Col, Radio } from 'antd'
import { ShoppingCartOutlined, CheckCircleFilled, CopyOutlined, ArrowRightOutlined, LoadingOutlined, AlipayCircleOutlined, WechatOutlined } from '@ant-design/icons'
import { publicApi } from '../api'

const { Title, Text, Paragraph } = Typography

// 套餐类型
interface Plan {
  id: number
  name: string
  price: number  // 分
  original_price?: number
  validity_days: number
  description?: string
  features?: string
  is_recommended: boolean
}

// 支付配置
interface PaymentConfig {
  enabled: boolean
  alipay_enabled: boolean
  wxpay_enabled: boolean
}

// 订单响应
interface OrderResponse {
  order_no: string
  amount: number
  pay_url: string
  expire_at: string
}

// 订单状态
interface OrderStatus {
  order_no: string
  status: string
  amount: number
  redeem_code?: string
  plan_name?: string
  validity_days?: number
}

// 套餐卡片组件
const PricingCard: React.FC<{ plan: Plan; onBuy: (plan: Plan) => void; disabled?: boolean }> = ({ plan, onBuy, disabled }) => {
  const priceYuan = (plan.price / 100).toFixed(2)
  const originalPriceYuan = plan.original_price ? (plan.original_price / 100).toFixed(2) : null

  return (
    <div style={{
      position: 'relative',
      background: 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: 20,
      border: plan.is_recommended ? '2px solid #007aff' : '1px solid rgba(255, 255, 255, 0.4)',
      padding: 32,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      transition: 'transform 0.3s ease, box-shadow 0.3s ease',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-10px)'
      e.currentTarget.style.boxShadow = '0 16px 40px 0 rgba(31, 38, 135, 0.15)'
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = '0 8px 32px 0 rgba(31, 38, 135, 0.1)'
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

      <Button
        type="primary"
        shape="round"
        size="large"
        icon={<ShoppingCartOutlined />}
        onClick={() => onBuy(plan)}
        disabled={disabled}
        style={{
          background: '#007aff',
          borderColor: '#007aff',
          fontWeight: 600,
          marginTop: 'auto',
          width: '100%',
          height: 44,
        }}
      >
        立即购买
      </Button>
    </div>
  )
}

// 支付弹窗组件
const PaymentModal: React.FC<{
  plan: Plan | null
  visible: boolean
  paymentConfig: PaymentConfig | null
  onClose: () => void
}> = ({ plan, visible, paymentConfig, onClose }) => {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'SELECTING' | 'LOADING' | 'PAYING' | 'SUCCESS'>('SELECTING')
  const [payType, setPayType] = useState<string>('alipay')
  const [orderNo, setOrderNo] = useState<string>('')
  const [payUrl, setPayUrl] = useState<string>('')
  const [redeemCode, setRedeemCode] = useState<string>('')
  const [validityDays, setValidityDays] = useState<number>(30)

  // 重置状态
  useEffect(() => {
    if (visible) {
      setStatus('SELECTING')
      setOrderNo('')
      setPayUrl('')
      setRedeemCode('')
      // 设置默认支付方式
      if (paymentConfig?.alipay_enabled) {
        setPayType('alipay')
      } else if (paymentConfig?.wxpay_enabled) {
        setPayType('wxpay')
      }
    }
  }, [visible, paymentConfig])

  // 创建订单
  const handleCreateOrder = async () => {
    if (!plan) return

    setStatus('LOADING')
    try {
      const response = await publicApi.createOrder({
        plan_id: plan.id,
        pay_type: payType,
      }) as unknown as OrderResponse

      setOrderNo(response.order_no)
      setPayUrl(response.pay_url)
      setValidityDays(plan.validity_days)
      setStatus('PAYING')

      // 打开支付页面
      window.open(response.pay_url, '_blank')

      // 开始轮询订单状态
      startPolling(response.order_no)
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建订单失败')
      setStatus('SELECTING')
    }
  }

  // 轮询订单状态
  const startPolling = (orderNo: string) => {
    let attempts = 0
    const maxAttempts = 60  // 最多轮询 3 分钟

    const poll = async () => {
      if (attempts >= maxAttempts) {
        return
      }
      attempts++

      try {
        const response = await publicApi.getOrderStatus(orderNo) as unknown as OrderStatus
        if (response.status === 'paid' && response.redeem_code) {
          setRedeemCode(response.redeem_code)
          setStatus('SUCCESS')
          return
        }
      } catch (error) {
        // 忽略错误，继续轮询
      }

      // 继续轮询
      setTimeout(poll, 3000)
    }

    poll()
  }

  // 复制兑换码
  const handleCopy = () => {
    navigator.clipboard.writeText(redeemCode)
    message.success({
      content: '兑换码已复制！',
      icon: <CheckCircleFilled style={{ color: '#34c759' }} />,
    })
  }

  // 渲染内容
  const renderContent = () => {
    switch (status) {
      case 'SELECTING':
        return (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 24 }}>选择支付方式</Title>
            <Radio.Group
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              style={{ marginBottom: 24 }}
            >
              <Space direction="vertical" size="middle">
                {paymentConfig?.alipay_enabled && (
                  <Radio value="alipay">
                    <Space>
                      <AlipayCircleOutlined style={{ fontSize: 24, color: '#1677ff' }} />
                      <span>支付宝</span>
                    </Space>
                  </Radio>
                )}
                {paymentConfig?.wxpay_enabled && (
                  <Radio value="wxpay">
                    <Space>
                      <WechatOutlined style={{ fontSize: 24, color: '#07c160' }} />
                      <span>微信支付</span>
                    </Space>
                  </Radio>
                )}
              </Space>
            </Radio.Group>
            <div style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 24, fontWeight: 700, color: '#ff9500' }}>
                ¥{plan ? (plan.price / 100).toFixed(2) : '0.00'}
              </Text>
            </div>
            <Button
              type="primary"
              size="large"
              onClick={handleCreateOrder}
              style={{ marginTop: 24, width: 200, height: 44, background: '#007aff', borderColor: '#007aff' }}
            >
              确认支付
            </Button>
          </div>
        )

      case 'LOADING':
        return (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Spin size="large" tip="正在创建订单..." />
          </div>
        )

      case 'PAYING':
        return (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <Title level={5} style={{ color: '#86868b', marginBottom: 4 }}>订单号: {orderNo}</Title>
            <div style={{ margin: '24px 0' }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
            </div>
            <Paragraph>支付页面已在新窗口打开</Paragraph>
            <Paragraph style={{ color: '#86868b' }}>请完成支付后等待自动确认...</Paragraph>
            <div style={{
              margin: '16px 0',
              padding: '8px 20px',
              background: 'rgba(245, 245, 247, 0.8)',
              borderRadius: 12,
              display: 'inline-block',
            }}>
              <Text style={{ color: '#1d1d1f' }}>金额：</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: '#ff9500' }}>
                ¥{plan ? (plan.price / 100).toFixed(2) : '0.00'}
              </Text>
            </div>
            <div style={{ marginTop: 16 }}>
              <Button onClick={() => window.open(payUrl, '_blank')}>
                重新打开支付页面
              </Button>
            </div>
          </div>
        )

      case 'SUCCESS':
        return (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <Result
              status="success"
              icon={<CheckCircleFilled style={{ color: '#34c759' }} />}
              title={<Title level={3} style={{ color: '#1d1d1f' }}>支付成功！</Title>}
              subTitle={
                <Paragraph style={{ color: '#ff3b30', fontWeight: 600 }}>
                  请立即保存您的兑换码，关闭后无法找回！
                </Paragraph>
              }
              extra={[
                <div key="code-display" style={{ display: 'flex', maxWidth: 320, margin: '0 auto' }}>
                  <Input
                    value={redeemCode}
                    readOnly
                    style={{
                      textAlign: 'center',
                      fontSize: '1.2em',
                      fontWeight: 700,
                      letterSpacing: 2,
                      color: '#007aff',
                      background: 'rgba(230, 242, 255, 0.8)',
                      borderColor: 'rgba(0, 122, 255, 0.4)',
                      borderRightWidth: 0,
                      borderRadius: '12px 0 0 12px',
                    }}
                  />
                  <Tooltip title="复制">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={handleCopy}
                      style={{
                        background: 'rgba(230, 242, 255, 0.8)',
                        borderColor: 'rgba(0, 122, 255, 0.4)',
                        color: '#007aff',
                        borderRadius: '0 12px 12px 0',
                        fontSize: 16,
                      }}
                    />
                  </Tooltip>
                </div>,
                <Paragraph key="validity" style={{ color: '#86868b', marginTop: 16 }}>
                  有效期：{validityDays} 天（从兑换激活时开始计算）
                </Paragraph>,
                <Button
                  key="go-redeem"
                  type="primary"
                  size="large"
                  shape="round"
                  style={{ background: '#007aff', borderColor: '#007aff', fontWeight: 600, marginTop: 16 }}
                  onClick={() => {
                    onClose()
                    navigate('/invite')
                  }}
                >
                  前往兑换 <ArrowRightOutlined />
                </Button>,
              ]}
            />
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Modal
      open={visible}
      onCancel={status === 'SUCCESS' ? undefined : onClose}
      footer={null}
      centered
      destroyOnClose
      width={420}
      closable={status !== 'SUCCESS'}
      maskClosable={status !== 'PAYING' && status !== 'SUCCESS'}
      styles={{
        content: {
          background: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(25px)',
          borderRadius: 20,
        }
      }}
    >
      {renderContent()}
    </Modal>
  )
}

// 主组件：购买区域
export const PurchaseSection: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [modalVisible, setModalVisible] = useState(false)

  // 加载数据
  useEffect(() => {
    Promise.all([
      publicApi.getPaymentConfig().catch(() => null),
      publicApi.getPlans().catch(() => []),
    ]).then(([config, plansData]) => {
      setPaymentConfig(config as PaymentConfig | null)
      setPlans((plansData || []) as Plan[])
    }).finally(() => setLoading(false))
  }, [])

  const handleBuy = useCallback((plan: Plan) => {
    setSelectedPlan(plan)
    setModalVisible(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    setModalVisible(false)
    setTimeout(() => setSelectedPlan(null), 300)
  }, [])

  // 未启用支付或无套餐时不显示
  if (loading) {
    return null
  }

  if (!paymentConfig?.enabled || plans.length === 0) {
    return null
  }

  return (
    <div style={{ padding: '40px 0 60px', textAlign: 'center' }}>
      <Title level={2} style={{ color: '#1d1d1f', fontWeight: 700, marginBottom: 40 }}>
        选择套餐
      </Title>

      <Row gutter={[24, 24]} justify="center" style={{ maxWidth: 900, margin: '0 auto' }}>
        {plans.map(plan => (
          <Col key={plan.id} xs={24} sm={12} md={8}>
            <PricingCard
              plan={plan}
              onBuy={handleBuy}
              disabled={!paymentConfig.enabled}
            />
          </Col>
        ))}
      </Row>

      <PaymentModal
        plan={selectedPlan}
        visible={modalVisible}
        paymentConfig={paymentConfig}
        onClose={handleCloseModal}
      />
    </div>
  )
}

export default PurchaseSection

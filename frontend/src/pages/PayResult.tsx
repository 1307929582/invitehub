// 支付结果页面（易支付同步回调）
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Result, Button, Spin, Input, Tooltip, Typography, message } from 'antd'
import { CheckCircleFilled, CopyOutlined, ArrowRightOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { publicApi } from '../api'

const { Title, Paragraph, Text } = Typography

interface OrderStatus {
  order_no: string
  status: string
  amount: number
  redeem_code?: string
  plan_name?: string
  validity_days?: number
}

export default function PayResult() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderNo = searchParams.get('order_no') || ''

  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState<OrderStatus | null>(null)
  const [polling, setPolling] = useState(false)

  // 查询订单状态
  const fetchOrder = async () => {
    if (!orderNo) {
      setLoading(false)
      return
    }

    try {
      const res = await publicApi.getOrderStatus(orderNo) as unknown as OrderStatus
      setOrder(res)

      // 如果是待支付状态，开始轮询
      if (res.status === 'pending') {
        setPolling(true)
        startPolling()
      }
    } catch (error) {
      console.error('Failed to fetch order:', error)
    } finally {
      setLoading(false)
    }
  }

  // 轮询订单状态
  const startPolling = () => {
    let attempts = 0
    const maxAttempts = 40 // 2分钟

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setPolling(false)
        return
      }
      attempts++

      try {
        const res = await publicApi.getOrderStatus(orderNo) as unknown as OrderStatus
        setOrder(res)

        if (res.status === 'paid') {
          setPolling(false)
          return
        }
      } catch {}

      setTimeout(poll, 3000)
    }

    setTimeout(poll, 3000)
  }

  useEffect(() => {
    fetchOrder()
  }, [orderNo])

  const handleCopy = () => {
    if (order?.redeem_code) {
      navigator.clipboard.writeText(order.redeem_code)
      message.success({ content: '兑换码已复制！', icon: <CheckCircleFilled style={{ color: '#34c759' }} /> })
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!orderNo || !order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Result
          status="error"
          title="订单不存在"
          subTitle="请检查订单号是否正确"
          extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </div>
    )
  }

  // 支付成功
  if (order.status === 'paid' && order.redeem_code) {
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
                <div style={{ marginBottom: 8, color: '#86868b', fontSize: 14 }}>
                  {order.plan_name && <span>套餐：{order.plan_name}</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <Input
                    value={order.redeem_code}
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
                  有效期：{order.validity_days} 天（从兑换激活时开始计算）
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

  // 待支付 / 轮询中
  if (order.status === 'pending') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)', padding: '60px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            borderRadius: 24,
            padding: 48,
          }}>
            <ClockCircleOutlined style={{ fontSize: 64, color: '#ff9500', marginBottom: 24 }} />
            <Title level={3} style={{ color: '#1d1d1f' }}>等待支付确认</Title>
            <Paragraph style={{ color: '#86868b', marginBottom: 8 }}>
              订单号：{order.order_no}
            </Paragraph>
            <Paragraph style={{ color: '#86868b' }}>
              {polling ? '正在确认支付结果，请稍候...' : '如已支付请刷新页面'}
            </Paragraph>
            {polling && (
              <div style={{ margin: '24px 0' }}>
                <Spin />
              </div>
            )}
            <div style={{
              margin: '24px 0',
              padding: '12px 32px',
              background: 'rgba(255, 149, 0, 0.1)',
              borderRadius: 12,
              display: 'inline-block',
            }}>
              <Text style={{ color: '#1d1d1f' }}>金额：</Text>
              <Text style={{ fontSize: 24, fontWeight: 700, color: '#ff9500' }}>
                ¥{(order.amount / 100).toFixed(2)}
              </Text>
            </div>
            <div style={{ marginTop: 24 }}>
              <Button onClick={() => window.location.reload()} style={{ marginRight: 12 }}>
                刷新状态
              </Button>
              <Button type="primary" onClick={() => navigate('/')}>
                返回首页
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 已过期
  if (order.status === 'expired') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
        <Result
          status="warning"
          title="订单已过期"
          subTitle="该订单已超时未支付"
          extra={[
            <Button key="home" onClick={() => navigate('/')}>返回首页</Button>,
            <Button key="buy" type="primary" onClick={() => navigate('/purchase')}>重新购买</Button>,
          ]}
        />
      </div>
    )
  }

  // 其他状态
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)' }}>
      <Result
        status="info"
        title={`订单状态：${order.status}`}
        subTitle={`订单号：${order.order_no}`}
        extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
      />
    </div>
  )
}

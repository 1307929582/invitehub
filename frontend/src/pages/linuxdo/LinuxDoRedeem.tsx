// LinuxDo 专属页面（购买 + 兑换 + 换车）
import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Typography, Spin, Result, Input, message, Row, Col, Space, Grid, Card, Tabs, Tag, Tooltip } from 'antd'
import {
  CheckCircleOutlined, LoadingOutlined, ArrowRightOutlined, CopyOutlined, CheckCircleFilled,
  RocketOutlined, SwapOutlined, ShoppingCartOutlined, CrownOutlined, MailOutlined, KeyOutlined,
  ClockCircleOutlined, TeamOutlined, QuestionCircleOutlined, SafetyOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import { linuxdoApi, publicApi } from '../../api'
import axios from 'axios'

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
  stock?: number | null  // 库存数量（null=无限）
  sold_count: number     // 已售数量
  remaining_stock?: number | null  // 剩余库存
}

interface RedeemResult {
  success: boolean
  message: string
  team_name?: string
  expires_at?: string
  remaining_days?: number
  is_first_use?: boolean
  state?: 'INVITE_QUEUED' | 'WAITING_FOR_SEAT'
  queue_position?: number
}

interface RebindResult {
  success: boolean
  message: string
  new_team_name?: string
}

interface StatusResult {
  found: boolean
  email?: string
  team_name?: string
  team_active?: boolean
  code?: string
  expires_at?: string
  remaining_days?: number
  can_rebind?: boolean
}

// LinuxDo 主题色
const LINUXDO_COLOR = '#0066FF'
const LINUXDO_GRADIENT = 'linear-gradient(135deg, #0066FF 0%, #0052CC 100%)'

// 特性列表
const features = [
  { icon: <SafetyOutlined style={{ color: LINUXDO_COLOR, fontSize: 20 }} />, title: '安全稳定', desc: '官方 Team 账号，数据隔离' },
  { icon: <ThunderboltOutlined style={{ color: LINUXDO_COLOR, fontSize: 20 }} />, title: 'GPT-5 系列', desc: '无消息限制，畅享最新模型' },
  { icon: <SwapOutlined style={{ color: LINUXDO_COLOR, fontSize: 20 }} />, title: '自助换车', desc: 'Team 失效时可自助转移' },
]

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

        {/* 库存显示 */}
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

  // Tab 状态
  const [activeTab, setActiveTab] = useState('buy')

  // 兑换状态
  const [redeemEmail, setRedeemEmail] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemSubmitting, setRedeemSubmitting] = useState(false)
  const [redeemSuccess, setRedeemSuccess] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)

  // 换车状态
  const [rebindCode, setRebindCode] = useState('')
  const [rebindSubmitting, setRebindSubmitting] = useState(false)
  const [rebindSuccess, setRebindSuccess] = useState(false)
  const [rebindResult, setRebindResult] = useState<RebindResult | null>(null)
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null)

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

  // 处理从支付网关跳转回来的情况（URL 中带有 order_no）
  useEffect(() => {
    const orderNo = searchParams.get('order_no')
    if (!orderNo) return

    // 查询订单状态
    const checkOrderStatus = async () => {
      try {
        const response: any = await linuxdoApi.getOrderStatus(orderNo)
        if (response.status === 'paid' && response.redeem_code) {
          // 支付成功，显示兑换码
          setBuySuccess({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
        } else if (response.status === 'pending') {
          // 还在等待支付确认，开始轮询
          setPayingOrder({
            orderNo: orderNo,
            gatewayUrl: '',  // 跳转回来时不需要再跳转
            payParams: {},
            credits: response.credits || '0',
          })
          startPolling(orderNo)
        }
      } catch {
        // 订单查询失败，忽略
      }
    }

    checkOrderStatus()
  }, [searchParams])

  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'
    if (days > 5) return '#ff9500'
    return '#ff3b30'
  }

  // 复制
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success({ content: '已复制！', icon: <CheckCircleFilled style={{ color: LINUXDO_COLOR }} /> })
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // ========== 购买流程 ==========
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

      // 使用隐藏表单 POST 提交到支付网关
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
      } catch {}

      pollTimeoutRef.current = window.setTimeout(poll, 3000)
    }

    poll()
  }

  // ========== 兑换流程 ==========
  const handleRedeem = async () => {
    if (!redeemEmail || !redeemEmail.includes('@')) { message.error('请输入有效的邮箱地址'); return }
    if (!redeemCode || redeemCode.trim().length === 0) { message.error('请输入兑换码'); return }
    setRedeemSubmitting(true)
    try {
      const res = await axios.post('/api/v1/public/direct-redeem', {
        email: redeemEmail.trim().toLowerCase(),
        code: redeemCode.trim().toUpperCase()
      })
      setRedeemSuccess(true)
      setRedeemResult(res.data)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      message.error(typeof detail === 'object' ? detail.message : detail || '兑换失败')
    } finally {
      setRedeemSubmitting(false)
    }
  }

  // ========== 换车流程 ==========
  const handleQueryStatus = async () => {
    const trimmedCode = rebindCode.trim().toUpperCase()
    if (!trimmedCode) { message.error('请输入兑换码'); return }
    setQuerying(true)
    setStatusResult(null)
    try {
      const res: any = await publicApi.getStatus({ code: trimmedCode })
      setStatusResult(res)
    } catch {
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  const handleRebind = async () => {
    if (!rebindCode || rebindCode.trim().length === 0) { message.error('请输入兑换码'); return }
    setRebindSubmitting(true)
    try {
      const res: any = await publicApi.rebind({
        code: rebindCode.trim().toUpperCase()
      })
      setRebindSuccess(true)
      setRebindResult(res)
    } catch (e: any) {
      const detail = e.response?.data?.detail
      message.error(typeof detail === 'object' ? detail.message : detail || '换车失败')
    } finally {
      setRebindSubmitting(false)
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

          <Space size="middle">
            <Button size="large" onClick={() => { setBuySuccess(null); setSelectedPlan(null) }} style={{ height: 48, borderRadius: 12 }}>
              继续购买
            </Button>
            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => setActiveTab('redeem')}
              style={{ height: 48, borderRadius: 12, background: LINUXDO_GRADIENT, border: 'none' }}>
              前往兑换
            </Button>
          </Space>
        </div>
      </div>
    )
  }

  // 重新提交支付表单
  const handleResubmitPayment = () => {
    if (formRef.current) {
      formRef.current.submit()
    }
  }

  // 支付中页面
  if (payingOrder) {
    return (
      <div style={{ minHeight: '100vh', background: `linear-gradient(180deg, rgba(0, 102, 255, 0.04) 0%, #f8fafc 100%)`, padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* 隐藏表单用于 POST 提交到支付网关 */}
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

          <div style={{ marginTop: 24 }}>
            <Button onClick={handleResubmitPayment} style={{ borderRadius: 10 }}>
              重新打开支付页面
            </Button>
          </div>
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

          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#86868b' }}>
            点击购买即表示您同意
            <Link to="/legal#terms" style={{ color: LINUXDO_COLOR, margin: '0 2px' }}>服务条款</Link>
          </div>
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

  // 兑换表单
  const renderRedeemForm = () => {
    if (redeemSuccess && redeemResult) {
      const isWaiting = redeemResult.state === 'WAITING_FOR_SEAT'
      return (
        <Result
          status={isWaiting ? 'info' : 'success'}
          icon={isWaiting
            ? <ClockCircleOutlined style={{ color: '#ff9500' }} />
            : <CheckCircleOutlined style={{ color: LINUXDO_COLOR }} />
          }
          title={isWaiting ? '已进入等待队列' : (redeemResult.is_first_use ? '兑换码已激活！' : '请求已提交！')}
          subTitle={
            <div>
              <p style={{ margin: '0 0 12px', color: '#1d1d1f' }}>{redeemResult.message}</p>
              {redeemResult.remaining_days !== null && redeemResult.remaining_days !== undefined && (
                <div style={{ background: `rgba(0, 102, 255, 0.08)`, padding: '12px 16px', borderRadius: 12, marginBottom: 12 }}>
                  <ClockCircleOutlined style={{ marginRight: 8, color: getDaysColor(redeemResult.remaining_days) }} />
                  <span style={{ color: getDaysColor(redeemResult.remaining_days), fontWeight: 600 }}>
                    有效期剩余 {redeemResult.remaining_days} 天
                  </span>
                </div>
              )}
              {redeemResult.is_first_use && <Tag color="blue" style={{ marginBottom: 12 }}>首次激活，邮箱已绑定</Tag>}
            </div>
          }
          extra={<Button type="primary" onClick={() => { setRedeemSuccess(false); setRedeemResult(null) }} style={{ borderRadius: 8, background: LINUXDO_COLOR, border: 'none' }}>继续兑换</Button>}
        />
      )
    }

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>邮箱地址</div>
          <Input
            prefix={<MailOutlined style={{ color: '#86868b' }} />}
            placeholder="your@email.com"
            size="large"
            value={redeemEmail}
            onChange={e => setRedeemEmail(e.target.value)}
            style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7' }}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
          <Input
            prefix={<KeyOutlined style={{ color: '#86868b' }} />}
            placeholder="输入兑换码"
            size="large"
            value={redeemCode}
            onChange={e => setRedeemCode(e.target.value.toUpperCase())}
            onPressEnter={handleRedeem}
            style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }}
          />
          <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>
            首次使用将绑定邮箱，有效期 30 天
          </div>
        </div>
        <Button
          type="primary"
          block
          size="large"
          loading={redeemSubmitting}
          onClick={handleRedeem}
          disabled={!redeemEmail || !redeemCode}
          icon={<RocketOutlined />}
          style={{ height: 48, borderRadius: 12, fontWeight: 600, background: LINUXDO_COLOR, border: 'none' }}
        >
          立即上车
        </Button>
      </div>
    )
  }

  // 换车表单
  const renderRebindForm = () => {
    if (rebindSuccess && rebindResult) {
      return (
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color: LINUXDO_COLOR }} />}
          title="换车请求已提交"
          subTitle={
            <div>
              <p style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{rebindResult.message}</p>
              <p style={{ margin: 0, color: '#ff9500' }}>请查收邮箱并接受新邀请</p>
            </div>
          }
          extra={<Button type="primary" onClick={() => { setRebindSuccess(false); setRebindResult(null) }} style={{ borderRadius: 8, background: LINUXDO_COLOR, border: 'none' }}>继续操作</Button>}
        />
      )
    }

    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              prefix={<KeyOutlined style={{ color: '#86868b' }} />}
              placeholder="输入您的兑换码"
              size="large"
              value={rebindCode}
              onChange={e => {
                setRebindCode(e.target.value.toUpperCase())
                setStatusResult(null)
              }}
              onPressEnter={handleQueryStatus}
              style={{ flex: 1, height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }}
            />
            <Button
              onClick={handleQueryStatus}
              loading={querying}
              size="large"
              style={{ height: 48, borderRadius: 12 }}
            >
              查询
            </Button>
          </div>
          <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>
            输入兑换码后点击查询，查看绑定状态
          </div>
        </div>

        {statusResult && (
          <div style={{ marginBottom: 20 }}>
            {statusResult.found ? (
              <div style={{ padding: 16, background: `rgba(0, 102, 255, 0.04)`, borderRadius: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <MailOutlined style={{ color: LINUXDO_COLOR }} />
                  <span>绑定邮箱：</span>
                  <span style={{ fontWeight: 600 }}>{statusResult.email || '未绑定'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <TeamOutlined style={{ color: LINUXDO_COLOR }} />
                  <span>当前 Team：</span>
                  <span style={{ fontWeight: 500 }}>{statusResult.team_name || '未知'}</span>
                  {statusResult.team_active !== undefined && (
                    <Tag color={statusResult.team_active ? 'success' : 'error'} style={{ marginLeft: 4 }}>
                      {statusResult.team_active ? '正常' : '异常'}
                    </Tag>
                  )}
                </div>
                {statusResult.remaining_days !== null && statusResult.remaining_days !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <ClockCircleOutlined style={{ color: getDaysColor(statusResult.remaining_days) }} />
                    <span style={{ color: getDaysColor(statusResult.remaining_days), fontWeight: 600 }}>
                      剩余 {statusResult.remaining_days} 天
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30' }} />
                  <span style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30', fontWeight: 500 }}>
                    {statusResult.can_rebind ? '可以换车' : '暂时无法换车（仅 Team 被封时可换车）'}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ padding: 16, background: 'rgba(255, 59, 48, 0.04)', borderRadius: 12, textAlign: 'center', color: '#ff3b30' }}>
                未找到该兑换码的绑定记录，请确认兑换码正确
              </div>
            )}
          </div>
        )}

        <Button
          type="primary"
          block
          size="large"
          loading={rebindSubmitting}
          onClick={handleRebind}
          disabled={!rebindCode || (statusResult !== null && !statusResult.can_rebind)}
          icon={<SwapOutlined />}
          style={{ height: 48, borderRadius: 12, fontWeight: 600, background: LINUXDO_COLOR, border: 'none' }}
        >
          立即换车
        </Button>
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
            专属兑换通道
          </Title>
          <Text type="secondary" style={{ fontSize: 16 }}>
            使用 L 币兑换 ChatGPT Team 使用权
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
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            centered
            size="large"
            style={{ marginBottom: 0 }}
            items={[
              {
                key: 'buy',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, padding: '8px 16px' }}>
                    <ShoppingCartOutlined />
                    L 币购买
                  </span>
                ),
                children: (
                  <div style={{ padding: isMobile ? 24 : 40 }}>
                    {renderBuyContent()}
                  </div>
                )
              },
              {
                key: 'redeem',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, padding: '8px 16px' }}>
                    <RocketOutlined />
                    兑换上车
                  </span>
                ),
                children: (
                  <div style={{ padding: isMobile ? 24 : 40 }}>
                    <Row gutter={48}>
                      {!isMobile && (
                        <Col span={10}>
                          <div style={{ paddingRight: 24, borderRight: '1px solid #e5e7eb', height: '100%' }}>
                            <Space direction="vertical" size={20}>
                              {features.map((feature, index) => (
                                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                  <div style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 12,
                                    background: `rgba(0, 102, 255, 0.1)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}>
                                    {feature.icon}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>{feature.title}</div>
                                    <div style={{ color: '#9ca3af', fontSize: 13 }}>{feature.desc}</div>
                                  </div>
                                </div>
                              ))}
                            </Space>
                          </div>
                        </Col>
                      )}
                      <Col span={isMobile ? 24 : 14}>
                        {renderRedeemForm()}
                      </Col>
                    </Row>
                  </div>
                )
              },
              {
                key: 'rebind',
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, padding: '8px 16px' }}>
                    <SwapOutlined />
                    自助换车
                  </span>
                ),
                children: (
                  <div style={{ padding: isMobile ? 24 : 40 }}>
                    <Row gutter={48}>
                      {!isMobile && (
                        <Col span={10}>
                          <div style={{ paddingRight: 24, borderRight: '1px solid #e5e7eb' }}>
                            <div style={{
                              padding: '20px 24px',
                              background: `linear-gradient(135deg, rgba(0, 102, 255, 0.06) 0%, rgba(0, 102, 255, 0.02) 100%)`,
                              borderRadius: 16,
                              border: `1px solid rgba(0, 102, 255, 0.1)`,
                            }}>
                              <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <QuestionCircleOutlined style={{ color: LINUXDO_COLOR }} />
                                换车说明
                              </div>
                              <ul style={{ paddingLeft: 18, margin: 0, color: '#6b7280', fontSize: 13, lineHeight: 2 }}>
                                <li>输入兑换码查询绑定状态</li>
                                <li>仅当 Team 被封时可以换车</li>
                                <li>换车后原 Team 邀请失效</li>
                                <li>新邀请将发送到绑定邮箱</li>
                              </ul>
                            </div>
                          </div>
                        </Col>
                      )}
                      <Col span={isMobile ? 24 : 14}>
                        {renderRebindForm()}
                      </Col>
                    </Row>
                  </div>
                )
              },
            ]}
          />
        </Card>

        {/* 底部 */}
        <div style={{ textAlign: 'center', marginTop: 32, color: '#9ca3af', fontSize: 12 }}>
          Powered by Linux.do
        </div>
      </div>
    </div>
  )
}

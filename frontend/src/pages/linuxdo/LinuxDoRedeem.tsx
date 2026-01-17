// LinuxDo 专属页面（购买 + 兑换 + 换车）- 模仿主站设计
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Row, Col, Input, Button, message, Spin, Result, Tag, Tabs, Grid, Space, Typography, Tooltip } from 'antd'
import {
  MailOutlined, KeyOutlined, CheckCircleOutlined, ClockCircleOutlined,
  RocketOutlined, SwapOutlined, TeamOutlined, HourglassOutlined, QuestionCircleOutlined,
  SafetyOutlined, ThunderboltOutlined, ShoppingCartOutlined, CopyOutlined, CheckCircleFilled,
  LoadingOutlined, CrownOutlined
} from '@ant-design/icons'
import {
  publicApi,
  linuxdoApi,
  type LinuxDoPlan,
  type PublicRedeemResponse,
  type PublicRebindResponse,
  type PublicStatusResponse,
} from '../../api'
import SupportGroupModal from '../../components/SupportGroupModal'

const { useBreakpoint } = Grid
const { Title, Text, Paragraph } = Typography

interface SupportConfig {
  support_group_message?: string
  support_tg_link?: string
  support_qq_group?: string
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

// 邮箱验证工具函数
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

// 域名白名单验证（防止钓鱼跳转）
const ALLOWED_GATEWAY_DOMAINS = ['easypay.co', 'linux.do']
const validateGatewayUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'https:') return false
    // 修复：添加点边界防止 evil-linuxdo.org 绕过
    return ALLOWED_GATEWAY_DOMAINS.some(domain =>
      parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

// 错误解析工具函数（处理多种 detail 格式）
const parseErrorDetail = (error: any): string => {
  const detail = error.response?.data?.detail
  if (!detail) return '操作失败'

  // 字符串直接返回
  if (typeof detail === 'string') return detail

  // { message: string } 格式
  if (typeof detail === 'object' && detail.message) {
    return typeof detail.message === 'string' ? detail.message : '操作失败'
  }

  // 其他对象/数组尝试 JSON 序列化
  try {
    return JSON.stringify(detail)
  } catch {
    return '操作失败'
  }
}

export default function LinuxDoRedeem() {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<LinuxDoPlan[]>([])
  const [enabled, setEnabled] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Tab 状态
  const [activeTab, setActiveTab] = useState('buy')

  // 购买状态
  const [selectedPlan, setSelectedPlan] = useState<LinuxDoPlan | null>(null)
  const [buyEmail, setBuyEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payingOrder, setPayingOrder] = useState<{ orderNo: string; gatewayUrl: string; payParams: Record<string, string>; credits: string } | null>(null)
  const [buySuccess, setBuySuccess] = useState<{ redeemCode: string; validityDays: number } | null>(null)
  const [pollingTimeout, setPollingTimeout] = useState(false)
  const pollTimeoutRef = useRef<number | null>(null)
  const submitTimeoutRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  // 兑换状态
  const [redeemEmail, setRedeemEmail] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemSubmitting, setRedeemSubmitting] = useState(false)
  const [redeemSuccess, setRedeemSuccess] = useState(false)
  const [redeemResult, setRedeemResult] = useState<PublicRedeemResponse | null>(null)
  const [redeemSupportOpen, setRedeemSupportOpen] = useState(false)
  const [redeemSupportShown, setRedeemSupportShown] = useState(false)

  // 换车状态
  const [rebindCode, setRebindCode] = useState('')
  const [rebindSubmitting, setRebindSubmitting] = useState(false)
  const [rebindSuccess, setRebindSuccess] = useState(false)
  const [rebindResult, setRebindResult] = useState<PublicRebindResponse | null>(null)
  const [querying, setQuerying] = useState(false)
  const [statusResult, setStatusResult] = useState<PublicStatusResponse | null>(null)
  const [rebindSupportOpen, setRebindSupportOpen] = useState(false)
  const [rebindSupportShown, setRebindSupportShown] = useState(false)

  const [supportConfig, setSupportConfig] = useState<SupportConfig | null>(null)

  // 组件挂载/卸载状态管理
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current)
      }
      if (submitTimeoutRef.current !== null) {
        window.clearTimeout(submitTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    Promise.all([
      linuxdoApi.getConfig().catch((error) => {
        console.error('Failed to load config:', error)
        throw new Error('config')
      }),
      linuxdoApi.getPlans().catch((error) => {
        console.error('Failed to load plans:', error)
        throw new Error('plans')
      }),
    ]).then(([config, plansData]) => {
      setEnabled(config.enabled)
      setPlans(plansData)
      setLoadError(null)
    }).catch((error) => {
      // 区分服务不可用 vs 禁用/无套餐
      setLoadError('服务暂时不可用，请稍后再试')
      console.error('Initial load failed:', error)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    publicApi.getSiteConfig()
      .then((config: any) => setSupportConfig(config))
      .catch(() => { })
  }, [])

  const supportTg = (supportConfig?.support_tg_link || '').trim()
  const supportQq = (supportConfig?.support_qq_group || '').trim()
  const canShowSupport = !!(supportTg || supportQq)

  useEffect(() => {
    if (!redeemSuccess) {
      setRedeemSupportShown(false)
      return
    }
    if (redeemSuccess && redeemResult && canShowSupport && !redeemSupportShown) {
      setRedeemSupportOpen(true)
      setRedeemSupportShown(true)
    }
  }, [redeemSuccess, redeemResult, canShowSupport, redeemSupportShown])

  useEffect(() => {
    if (!rebindSuccess) {
      setRebindSupportShown(false)
      return
    }
    if (rebindSuccess && rebindResult && canShowSupport && !rebindSupportShown) {
      setRebindSupportOpen(true)
      setRebindSupportShown(true)
    }
  }, [rebindSuccess, rebindResult, canShowSupport, rebindSupportShown])

  // 等待队列轮询（兑换）
  useEffect(() => {
    if (redeemResult?.state !== 'WAITING_FOR_SEAT' || !redeemEmail) return
    let cancelled = false

    const pollStatus = async () => {
      try {
        const res: any = await publicApi.getInviteStatus(redeemEmail.trim().toLowerCase())
        if (cancelled || !res?.found) return
        if (res.status === 'waiting') {
          setRedeemResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            queue_position: res.queue_position ?? prev.queue_position,
          } : prev)
        } else {
          setRedeemResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            team_name: res.team_name || prev.team_name,
            state: 'INVITE_QUEUED',
            queue_position: undefined,
          } : prev)
        }
      } catch {
        // ignore polling errors
      }
    }

    pollStatus()
    const timer = window.setInterval(pollStatus, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [redeemResult?.state, redeemEmail])

  // 等待队列轮询（换车）
  useEffect(() => {
    if (rebindResult?.state !== 'WAITING_FOR_SEAT' || !rebindResult.email) return
    let cancelled = false

    const pollStatus = async () => {
      try {
        const res: any = await publicApi.getInviteStatus(rebindResult.email as string)
        if (cancelled || !res?.found) return
        if (res.status === 'waiting') {
          setRebindResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            queue_position: res.queue_position ?? prev.queue_position,
          } : prev)
        } else {
          setRebindResult(prev => prev ? {
            ...prev,
            message: res.status_message || prev.message,
            state: 'INVITE_QUEUED',
            queue_position: undefined,
          } : prev)
        }
      } catch {
        // ignore polling errors
      }
    }

    pollStatus()
    const timer = window.setInterval(pollStatus, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [rebindResult?.state, rebindResult?.email])

  // 处理从支付网关跳转回来（使用 orderNo 作为依赖）
  const orderNo = searchParams.get('order_no')
  useEffect(() => {
    if (!orderNo) return

    const checkOrderStatus = async () => {
      try {
        const response = await linuxdoApi.getOrderStatus(orderNo)

        // 修复：检查组件是否已卸载，防止 setState on unmounted component
        if (unmountedRef.current) return

        switch (response.status) {
          case 'paid':
            if (response.redeem_code) {
              setBuySuccess({
                redeemCode: response.redeem_code,
                validityDays: response.validity_days || 30,
              })
            }
            break

          case 'pending':
            setPayingOrder({
              orderNo: orderNo,
              gatewayUrl: response.gateway_url || '',
              payParams: response.pay_params || {},
              credits: response.credits || '0',
            })
            startPolling(orderNo)
            break

          case 'failed':
            message.error('支付失败，请重试')
            console.error('Order failed:', response)
            break

          case 'canceled':
            message.warning('订单已取消')
            break

          case 'expired':
            message.warning('订单已过期')
            break

          default:
            console.error('Unknown order status:', response)
        }
      } catch (error) {
        if (unmountedRef.current) return
        console.error('Failed to check order status:', error)
        message.error('查询订单状态失败')
      }
    }

    checkOrderStatus()
  }, [orderNo])

  const getDaysColor = (days: number | null | undefined) => {
    if (days === null || days === undefined) return '#86868b'
    if (days > 15) return '#34c759'
    if (days > 5) return '#ff9500'
    return '#ff3b30'
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success({ content: '已复制！', icon: <CheckCircleFilled style={{ color: LINUXDO_COLOR }} /> })
    } catch {
      message.error('复制失败')
    }
  }

  // ========== 购买流程 ==========
  const handleBuyClick = (plan: LinuxDoPlan) => {
    setSelectedPlan(plan)
  }

  const handleCreateOrder = async () => {
    if (!selectedPlan) return
    if (!validateEmail(buyEmail)) {
      message.error('请输入正确的邮箱地址')
      return
    }

    setSubmitting(true)
    try {
      const response = await linuxdoApi.createOrder({
        plan_id: selectedPlan.id,
        email: buyEmail.trim().toLowerCase(),
      })

      // 修复：检查组件是否已卸载
      if (unmountedRef.current) return

      // 验证支付网关 URL
      if (!validateGatewayUrl(response.gateway_url)) {
        message.error('支付链接异常，请联系管理员')
        console.error('Invalid gateway URL:', response.gateway_url)
        return
      }

      setPayingOrder({
        orderNo: response.order_no,
        gatewayUrl: response.gateway_url,
        payParams: response.pay_params,
        credits: response.credits,
      })

      // 修复：使用 ref 存储 timeout ID 以便清理
      submitTimeoutRef.current = window.setTimeout(() => {
        if (!unmountedRef.current && formRef.current) {
          formRef.current.submit()
        }
      }, 100)

      startPolling(response.order_no)
    } catch (error: any) {
      if (unmountedRef.current) return
      console.error('Create order failed:', error)
      message.error(parseErrorDetail(error) || '创建订单失败')
    } finally {
      if (!unmountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const startPolling = (orderNo: string) => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }

    setPollingTimeout(false)
    let attempts = 0
    let errorCount = 0
    const maxAttempts = 60
    const maxErrors = 5

    const poll = async () => {
      if (unmountedRef.current) return

      if (attempts >= maxAttempts) {
        setPollingTimeout(true)
        console.warn('Polling timeout after', maxAttempts, 'attempts')
        return
      }

      attempts++

      try {
        const response = await linuxdoApi.getOrderStatus(orderNo)
        errorCount = 0 // 重置错误计数

        if (response.status === 'paid' && response.redeem_code) {
          setPayingOrder(null)
          setBuySuccess({
            redeemCode: response.redeem_code,
            validityDays: response.validity_days || 30,
          })
          return
        } else if (response.status === 'failed' || response.status === 'canceled' || response.status === 'expired') {
          setPayingOrder(null)
          message.error(`订单${response.status === 'failed' ? '支付失败' : response.status === 'canceled' ? '已取消' : '已过期'}`)
          return
        }
      } catch (error) {
        errorCount++
        console.error('Polling error:', error, `(${errorCount}/${maxErrors})`)

        // 修复：累积错误后提示用户
        if (errorCount >= maxErrors) {
          message.warning('网络连接不稳定，正在继续尝试...')
          errorCount = 0 // 重置以避免重复提示
        }
      }

      pollTimeoutRef.current = window.setTimeout(poll, 3000)
    }

    poll()
  }

  // ========== 兑换流程 ==========
  const handleRedeem = async () => {
    if (!validateEmail(redeemEmail)) {
      message.error('请输入正确的邮箱地址')
      return
    }
    if (!redeemCode || redeemCode.trim().length === 0) {
      message.error('请输入兑换码')
      return
    }

    setRedeemSubmitting(true)
    try {
      const res = await publicApi.redeem({
        email: redeemEmail.trim().toLowerCase(),
        code: redeemCode.trim().toUpperCase()
      })
      setRedeemSuccess(true)
      setRedeemResult(res)
    } catch (e: any) {
      console.error('Redeem failed:', e)
      message.error(parseErrorDetail(e) || '兑换失败')
    } finally {
      setRedeemSubmitting(false)
    }
  }

  // ========== 换车流程 ==========
  const handleQueryStatus = async () => {
    const trimmedCode = rebindCode.trim().toUpperCase()
    if (!trimmedCode) {
      message.error('请输入兑换码')
      return
    }

    setQuerying(true)
    setStatusResult(null)
    try {
      const res = await publicApi.getStatus({ code: trimmedCode })
      setStatusResult(res)
    } catch (error) {
      console.error('Query status failed:', error)
      message.error('查询失败')
    } finally {
      setQuerying(false)
    }
  }

  const handleRebind = async () => {
    if (!rebindCode || rebindCode.trim().length === 0) {
      message.error('请输入兑换码')
      return
    }

    setRebindSubmitting(true)
    try {
      const res = await publicApi.rebind({ code: rebindCode.trim().toUpperCase() })
      setRebindSuccess(true)
      setRebindResult(res)
    } catch (e: any) {
      console.error('Rebind failed:', e)
      message.error(parseErrorDetail(e) || '换车失败')
    } finally {
      setRebindSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
        <Spin size="large" />
      </div>
    )
  }

  // 修复：区分服务不可用 vs 禁用/无套餐
  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
        <Result status="error" title="服务暂时不可用" subTitle={loadError} />
      </div>
    )
  }

  if (!enabled || plans.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
        <Result status="info" title="LinuxDo 兑换暂未开放" subTitle={!enabled ? "功能已禁用" : "暂无可用套餐"} />
      </div>
    )
  }

  // 购买成功页面
  if (buySuccess) {
    return (
      <div style={{ minHeight: '100vh', background: `linear-gradient(180deg, rgba(0, 102, 255, 0.04) 0%, #f8fafc 100%)`, padding: '60px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: LINUXDO_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircleOutlined style={{ fontSize: 40, color: '#fff' }} />
          </div>
          <Title level={2} style={{ color: '#1f2937', marginBottom: 8 }}>支付成功！</Title>
          <Paragraph style={{ color: '#ef4444', fontWeight: 600, fontSize: 16, marginBottom: 32 }}>请立即保存您的兑换码</Paragraph>

          <div style={{ background: `linear-gradient(135deg, rgba(0, 102, 255, 0.08) 0%, rgba(0, 102, 255, 0.04) 100%)`, padding: 28, borderRadius: 16, marginBottom: 32, border: `1px solid rgba(0, 102, 255, 0.2)` }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Input value={buySuccess.redeemCode} readOnly style={{ width: 240, textAlign: 'center', fontSize: 22, fontWeight: 700, letterSpacing: 3, color: LINUXDO_COLOR, background: '#fff', borderRadius: '12px 0 0 12px', height: 48 }} />
              <Tooltip title="复制">
                <Button icon={<CopyOutlined />} onClick={() => handleCopy(buySuccess.redeemCode)} style={{ height: 48, width: 48, background: LINUXDO_COLOR, borderColor: LINUXDO_COLOR, color: '#fff', borderRadius: '0 12px 12px 0' }} />
              </Tooltip>
            </div>
            <Paragraph style={{ color: '#6b7280', margin: 0 }}>有效期：{buySuccess.validityDays} 天（从兑换激活时开始计算）</Paragraph>
          </div>

          <Space size="middle">
            <Button size="large" onClick={() => { setBuySuccess(null); setSelectedPlan(null) }} style={{ height: 48, borderRadius: 12 }}>继续购买</Button>
            <Button type="primary" size="large" onClick={() => { setBuySuccess(null); setActiveTab('redeem'); setRedeemCode(buySuccess.redeemCode) }} style={{ height: 48, borderRadius: 12, background: LINUXDO_GRADIENT, border: 'none' }}>前往兑换</Button>
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
          <form ref={formRef} method="POST" action={payingOrder.gatewayUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'none' }}>
            {Object.entries(payingOrder.payParams).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          </form>
        )}
        <div style={{ maxWidth: 500, width: '100%', textAlign: 'center', background: '#fff', padding: '48px 40px', borderRadius: 24, boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)' }}>
          {pollingTimeout ? (
            <>
              <ClockCircleOutlined style={{ fontSize: 56, color: '#ff9500' }} />
              <Title level={3} style={{ color: '#1f2937', marginTop: 24 }}>等待支付超时</Title>
              <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
              <Paragraph type="secondary">如果您已完成支付，请手动刷新状态</Paragraph>
              <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
                <Button type="primary" size="large" block onClick={async () => {
                  try {
                    const response = await linuxdoApi.getOrderStatus(payingOrder.orderNo)
                    if (response.status === 'paid' && response.redeem_code) {
                      setPayingOrder(null)
                      setBuySuccess({
                        redeemCode: response.redeem_code,
                        validityDays: response.validity_days || 30,
                      })
                    } else {
                      message.info(`订单状态：${response.status}`)
                    }
                  } catch (error) {
                    console.error('Manual refresh failed:', error)
                    message.error('刷新失败，请稍后重试')
                  }
                }} style={{ background: LINUXDO_COLOR, border: 'none', borderRadius: 12 }}>
                  手动刷新状态
                </Button>
                <Button size="large" block onClick={() => { setPayingOrder(null); setPollingTimeout(false) }} style={{ borderRadius: 12 }}>
                  返回
                </Button>
              </Space>
            </>
          ) : (
            <>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 56, color: LINUXDO_COLOR }} spin />} />
              <Title level={3} style={{ color: '#1f2937', marginTop: 24 }}>等待支付确认</Title>
              <Paragraph type="secondary">订单号：{payingOrder.orderNo}</Paragraph>
              <Paragraph type="secondary">认证页面已在新窗口打开，请完成 L 币支付</Paragraph>
              <div style={{ margin: '24px 0', padding: '16px 32px', background: `linear-gradient(135deg, rgba(0, 102, 255, 0.08) 0%, rgba(0, 102, 255, 0.04) 100%)`, borderRadius: 12, display: 'inline-block' }}>
                <Text>L 币：</Text>
                <Text style={{ fontSize: 32, fontWeight: 700, color: LINUXDO_COLOR }}>{payingOrder.credits}</Text>
              </div>
              <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
                {payingOrder.gatewayUrl && (
                  <Button onClick={() => formRef.current?.submit()} style={{ borderRadius: 10 }}>重新打开支付页面</Button>
                )}
                <Button onClick={() => { setPayingOrder(null); setPollingTimeout(false) }} style={{ borderRadius: 10 }}>取消</Button>
              </Space>
            </>
          )}
        </div>
      </div>
    )
  }

  // ========== 渲染各 Tab 内容 ==========
  const renderBuyContent = () => {
    if (selectedPlan) {
      return (
        <div>
          <Button type="text" onClick={() => setSelectedPlan(null)} style={{ marginBottom: 20, padding: 0, color: '#6b7280' }}>← 返回套餐选择</Button>
          <div style={{ background: '#f8fafc', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><Text type="secondary">套餐</Text><Text strong>{selectedPlan.name}</Text></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><Text type="secondary">有效期</Text><Text>{selectedPlan.validity_days} 天</Text></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><Text type="secondary">价格</Text><Text style={{ fontSize: 24, fontWeight: 700, color: LINUXDO_COLOR }}>{selectedPlan.credits} L 币</Text></div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>联系邮箱</div>
            <Input prefix={<MailOutlined style={{ color: '#86868b' }} />} placeholder="your@email.com" size="large" value={buyEmail} onChange={e => setBuyEmail(e.target.value)} style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7' }} />
            <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>支付成功后可通过邮箱查询订单</div>
          </div>
          <Button type="primary" block size="large" loading={submitting} onClick={handleCreateOrder} disabled={!buyEmail} style={{ height: 48, borderRadius: 12, fontWeight: 600, background: LINUXDO_COLOR, border: 'none' }}>
            使用 {selectedPlan.credits} L 币购买
          </Button>
        </div>
      )
    }

    return (
      <div>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {plans.map(plan => {
            const hasStock = plan.stock !== null && plan.stock !== undefined
            // 修复：使用 remaining_stock，如果缺失则用 stock - sold_count 兜底
            const stockValue = plan.stock ?? 0
            const remaining = plan.remaining_stock ?? (hasStock ? Math.max(0, stockValue - plan.sold_count) : null)
            const isSoldOut = hasStock && (remaining === null || remaining <= 0)

            return (
              <div
                key={plan.id}
                onClick={() => !isSoldOut && handleBuyClick(plan)}
                style={{
                  padding: '16px 20px',
                  borderRadius: 14,
                  border: plan.is_recommended ? `2px solid ${LINUXDO_COLOR}` : '1px solid #e5e7eb',
                  background: isSoldOut ? '#f9fafb' : (plan.is_recommended ? `rgba(0, 102, 255, 0.04)` : '#fff'),
                  cursor: isSoldOut ? 'not-allowed' : 'pointer',
                  opacity: isSoldOut ? 0.6 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {plan.is_recommended && <CrownOutlined style={{ color: LINUXDO_COLOR }} />}
                    <span style={{ fontWeight: 600, color: '#1f2937' }}>{plan.name}</span>
                    {plan.is_recommended && <Tag color="blue" style={{ marginLeft: 4 }}>推荐</Tag>}
                    {isSoldOut && <Tag color="red">售罄</Tag>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: LINUXDO_COLOR }}>{plan.credits} L</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{plan.validity_days} 天</div>
                  </div>
                </div>
                {hasStock && !isSoldOut && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                    <TeamOutlined style={{ marginRight: 4 }} />剩余 {remaining} 份
                  </div>
                )}
              </div>
            )
          })}
        </Space>
      </div>
    )
  }

  const renderRedeemContent = () => {
    if (redeemSuccess && redeemResult) {
      const isWaiting = redeemResult.state === 'WAITING_FOR_SEAT'
      return (
        <Result
          status={isWaiting ? 'info' : 'success'}
          icon={isWaiting ? <HourglassOutlined style={{ color: '#ff9500' }} /> : <CheckCircleOutlined style={{ color: LINUXDO_COLOR }} />}
          title={isWaiting ? '已进入等待队列' : (redeemResult.is_first_use ? '兑换码已绑定！' : '请求已提交！')}
          subTitle={
            <div>
              <p style={{ margin: '0 0 12px', color: '#1d1d1f' }}>{redeemResult.message}</p>
              {redeemResult.remaining_days !== null && redeemResult.remaining_days !== undefined && (
                <div style={{ background: `rgba(0, 102, 255, 0.08)`, padding: '12px 16px', borderRadius: 12, marginBottom: 12 }}>
                  <ClockCircleOutlined style={{ marginRight: 8, color: getDaysColor(redeemResult.remaining_days) }} />
                  <span style={{ color: getDaysColor(redeemResult.remaining_days), fontWeight: 600 }}>有效期剩余 {redeemResult.remaining_days} 天</span>
                </div>
              )}
              {redeemResult.is_first_use && <Tag color="blue" style={{ marginBottom: 12 }}>首次绑定，邮箱已绑定</Tag>}
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
          <Input prefix={<MailOutlined style={{ color: '#86868b' }} />} placeholder="your@email.com" size="large" value={redeemEmail} onChange={e => setRedeemEmail(e.target.value)} style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7' }} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 8, fontWeight: 500, color: '#1d1d1f' }}>兑换码</div>
          <Input prefix={<KeyOutlined style={{ color: '#86868b' }} />} placeholder="输入兑换码" size="large" value={redeemCode} onChange={e => setRedeemCode(e.target.value.toUpperCase())} onPressEnter={handleRedeem} style={{ height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }} />
          <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>首次使用将绑定邮箱，有效期 30 天</div>
        </div>
        <Button type="primary" block size="large" loading={redeemSubmitting} onClick={handleRedeem} disabled={!redeemEmail || !redeemCode} icon={<RocketOutlined />} style={{ height: 48, borderRadius: 12, fontWeight: 600, background: LINUXDO_COLOR, border: 'none' }}>
          立即上车
        </Button>
      </div>
    )
  }

  const renderRebindContent = () => {
    if (rebindSuccess && rebindResult) {
      const isWaiting = rebindResult.state === 'WAITING_FOR_SEAT'
      return (
        <Result
          status={isWaiting ? 'info' : 'success'}
          icon={isWaiting ? <HourglassOutlined style={{ color: '#ff9500' }} /> : <CheckCircleOutlined style={{ color: LINUXDO_COLOR }} />}
          title={isWaiting ? '换车已进入等待队列' : '换车请求已提交'}
          subTitle={
            <div>
              <p style={{ margin: '0 0 8px', color: '#1d1d1f' }}>{rebindResult.message}</p>
              {isWaiting && rebindResult.queue_position && (
                <div style={{ background: 'rgba(255, 149, 0, 0.1)', padding: '12px 16px', borderRadius: 12, marginBottom: 8 }}>
                  <HourglassOutlined style={{ color: '#ff9500', marginRight: 6 }} />
                  <span style={{ color: '#ff9500', fontWeight: 600 }}>排队位置：第 {rebindResult.queue_position} 位</span>
                </div>
              )}
              {!isWaiting && <p style={{ margin: 0, color: '#ff9500' }}>请查收邮箱并接受新邀请</p>}
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
            <Input prefix={<KeyOutlined style={{ color: '#86868b' }} />} placeholder="输入您的兑换码" size="large" value={rebindCode} onChange={e => { setRebindCode(e.target.value.toUpperCase()); setStatusResult(null) }} onPressEnter={handleQueryStatus} style={{ flex: 1, height: 48, borderRadius: 12, border: '1px solid #d2d2d7', fontFamily: 'monospace', letterSpacing: 1 }} />
            <Button onClick={handleQueryStatus} loading={querying} size="large" style={{ height: 48, borderRadius: 12 }}>查询</Button>
          </div>
          <div style={{ fontSize: 12, color: '#86868b', marginTop: 6 }}>输入兑换码后点击查询，查看绑定状态</div>
        </div>

        {statusResult && (
          <div style={{ marginBottom: 20 }}>
            {statusResult.found ? (
              <div style={{ padding: 16, background: `rgba(0, 102, 255, 0.04)`, borderRadius: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><MailOutlined style={{ color: LINUXDO_COLOR }} /><span>绑定邮箱：</span><span style={{ fontWeight: 600 }}>{statusResult.email || '未绑定'}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><TeamOutlined style={{ color: LINUXDO_COLOR }} /><span>当前 Team：</span><span style={{ fontWeight: 500 }}>{statusResult.team_name || '未知'}</span>{statusResult.team_active !== undefined && <Tag color={statusResult.team_active ? 'success' : 'error'} style={{ marginLeft: 4 }}>{statusResult.team_active ? '正常' : '异常'}</Tag>}</div>
                {statusResult.remaining_days !== null && statusResult.remaining_days !== undefined && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><ClockCircleOutlined style={{ color: getDaysColor(statusResult.remaining_days) }} /><span style={{ color: getDaysColor(statusResult.remaining_days), fontWeight: 600 }}>剩余 {statusResult.remaining_days} 天</span></div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SwapOutlined style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30' }} /><span style={{ color: statusResult.can_rebind ? '#34c759' : '#ff3b30', fontWeight: 500 }}>{statusResult.can_rebind ? '可以换车（仅一次机会，激活后15天内）' : '暂时无法换车（机会已用完/已过期/超过15天）'}</span></div>
              </div>
            ) : (
              <div style={{ padding: 16, background: 'rgba(255, 59, 48, 0.04)', borderRadius: 12, textAlign: 'center', color: '#ff3b30' }}>未找到该兑换码的绑定记录</div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 16, fontSize: 12, color: '#d97706' }}>
          仅一次换车机会，且需在激活后 15 天内使用；请确认当前 Team 已封禁后再使用，若在正常状态换车，后续封禁将不再提供第二次换车。
        </div>

        <Button type="primary" block size="large" loading={rebindSubmitting} onClick={handleRebind} disabled={!rebindCode || (statusResult !== null && !statusResult.can_rebind)} icon={<SwapOutlined />} style={{ height: 48, borderRadius: 12, fontWeight: 600, background: LINUXDO_COLOR, border: 'none' }}>
          立即换车
        </Button>
      </div>
    )
  }

  // 主页面 - 模仿主站左右分栏设计
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 16 : 40, position: 'relative', overflow: 'hidden' }}>
      {/* 背景装饰 */}
      <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 500, height: 500, background: `radial-gradient(circle, rgba(0, 102, 255, 0.06) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', left: '-5%', width: 400, height: 400, background: `radial-gradient(circle, rgba(0, 102, 255, 0.04) 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }} />

      {/* 主卡片 */}
      <Card style={{ width: '100%', maxWidth: isMobile ? 480 : 960, background: '#fff', borderRadius: 20, border: 'none', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.08)', position: 'relative', zIndex: 1, overflow: 'hidden' }} bodyStyle={{ padding: 0 }}>
        <Row>
          {/* 左侧介绍区域 */}
          {!isMobile && (
            <Col span={10}>
              <div style={{ padding: '48px 40px', background: `linear-gradient(135deg, rgba(0, 102, 255, 0.04) 0%, #f8fafc 100%)`, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid #e5e7eb' }}>
                {/* Logo */}
                <div style={{ width: 72, height: 72, borderRadius: 16, background: LINUXDO_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 24px rgba(0, 102, 255, 0.25)`, marginBottom: 24 }}>
                  <span style={{ color: '#fff', fontSize: 36, fontWeight: 700 }}>L</span>
                </div>

                <Title level={2} style={{ margin: '0 0 12px', color: '#1f2937', fontWeight: 700, letterSpacing: '-0.5px' }}>Linux.do</Title>
                <Text style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.6, display: 'block', marginBottom: 32 }}>L 币专属兑换通道，稳定可靠，即时开通</Text>

                {/* 特性列表 */}
                <Space direction="vertical" size={16}>
                  {features.map((feature, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: `rgba(0, 102, 255, 0.1)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{feature.icon}</div>
                      <div>
                        <div style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>{feature.title}</div>
                        <div style={{ color: '#9ca3af', fontSize: 13 }}>{feature.desc}</div>
                      </div>
                    </div>
                  ))}
                </Space>

                <div style={{ marginTop: 'auto', paddingTop: 32, color: '#9ca3af', fontSize: 12 }}>Powered by Linux.do</div>
              </div>
            </Col>
          )}

          {/* 右侧表单区域 */}
          <Col span={isMobile ? 24 : 14}>
            <div style={{ padding: isMobile ? 28 : '48px 44px' }}>
              {/* 移动端显示 Logo */}
              {isMobile && (
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: LINUXDO_GRADIENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 24px rgba(0, 102, 255, 0.25)`, marginBottom: 12 }}>
                    <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>L</span>
                  </div>
                  <Title level={4} style={{ margin: '0 0 4px', color: '#1f2937', fontWeight: 700 }}>Linux.do</Title>
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>L 币专属兑换通道</Text>
                </div>
              )}

              {/* Tab 切换 */}
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                centered={isMobile}
                size="large"
                items={[
                  {
                    key: 'buy',
                    label: <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}><ShoppingCartOutlined />L 币购买</span>,
                    children: renderBuyContent()
                  },
                  {
                    key: 'redeem',
                    label: <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}><RocketOutlined />兑换上车</span>,
                    children: renderRedeemContent()
                  },
                  {
                    key: 'rebind',
                    label: <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}><SwapOutlined />自助换车</span>,
                    children: renderRebindContent()
                  }
                ]}
              />

              {/* 使用说明 */}
              <div style={{ marginTop: 24, padding: '16px 18px', background: `linear-gradient(135deg, rgba(0, 102, 255, 0.06) 0%, rgba(0, 102, 255, 0.02) 100%)`, borderRadius: 14, fontSize: 13, color: '#6b7280', lineHeight: 1.8, border: `1px solid rgba(0, 102, 255, 0.1)` }}>
                <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><QuestionCircleOutlined style={{ color: LINUXDO_COLOR }} />使用说明</div>
                {activeTab === 'buy' ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>选择套餐后使用 L 币支付</li>
                    <li>支付成功自动生成兑换码</li>
                    <li>使用兑换码上车</li>
                  </ul>
                ) : activeTab === 'redeem' ? (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>首次使用兑换码将自动绑定邮箱</li>
                    <li>绑定后只能使用该邮箱兑换</li>
                    <li>有效期从首次使用开始计算</li>
                  </ul>
                ) : (
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>输入兑换码查询绑定状态</li>
                    <li>每个兑换码仅有 1 次换车机会</li>
                    <li>换车需在激活后 15 天内完成</li>
                    <li>请确认当前 Team 已封禁后再换车（若在正常状态换车，后续封禁将不再提供第二次）</li>
                    <li>换车后原 Team 邀请失效</li>
                  </ul>
                )}
              </div>

              {/* 移动端底部 */}
              {isMobile && (
                <div style={{ marginTop: 24, textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>Powered by Linux.do</div>
              )}
            </div>
          </Col>
        </Row>
      </Card>
      <SupportGroupModal
        open={redeemSupportOpen}
        onClose={() => setRedeemSupportOpen(false)}
        messageText={supportConfig?.support_group_message}
        tgLink={supportTg}
        qqGroup={supportQq}
      />
      <SupportGroupModal
        open={rebindSupportOpen}
        onClose={() => setRebindSupportOpen(false)}
        messageText={supportConfig?.support_group_message}
        tgLink={supportTg}
        qqGroup={supportQq}
      />
    </div>
  )
}

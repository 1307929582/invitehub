import { useEffect, useState } from 'react'
import { Card, Table, Tag, Statistic, Row, Col, Radio, Tooltip, Space, Typography, Input, DatePicker, Button } from 'antd'
import { ShoppingCartOutlined, DollarOutlined, CheckCircleOutlined, ClockCircleOutlined, GiftOutlined, SearchOutlined, ClearOutlined } from '@ant-design/icons'
import { orderApi } from '../api'
import { formatDate } from '../utils/date'
import dayjs from 'dayjs'

const { Text } = Typography
const { RangePicker } = DatePicker

interface Order {
  id: number
  order_no: string
  order_type?: string  // 订单类型
  plan_id: number
  plan_name?: string
  email?: string  // 联系邮箱
  buyer_username?: string  // 买家用户名（分销商）
  amount: number
  coupon_code?: string
  discount_amount: number
  final_amount?: number
  status: string
  redeem_code?: string
  quantity?: number  // 购买份数
  delivered_count?: number  // 已发码数量
  trade_no?: string
  pay_type?: string
  paid_at?: string
  expire_at?: string
  created_at: string
}

interface OrderStats {
  total_orders: number
  paid_orders: number
  pending_orders: number
  total_revenue: number
  today_orders: number
  today_revenue: number
  linuxdo_revenue?: number  // LinuxDo 订单总收入
  linuxdo_orders?: number  // LinuxDo 订单总数
}

type FilterStatus = 'all' | 'pending' | 'paid' | 'expired'

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<FilterStatus>('all')
  const pageSize = 20

  // 搜索状态
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchEmail, setSearchEmail] = useState('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const params: any = { page, page_size: pageSize }
      if (status !== 'all') params.status = status
      if (searchKeyword.trim()) params.search = searchKeyword.trim()
      if (searchEmail.trim()) params.email = searchEmail.trim()
      if (dateRange[0]) params.date_from = dateRange[0].toISOString()
      if (dateRange[1]) params.date_to = dateRange[1].toISOString()
      const res: any = await orderApi.list(params)
      setOrders(res.orders)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const res: any = await orderApi.getStats()
      setStats(res)
    } catch {}
  }

  useEffect(() => {
    fetchOrders()
  }, [page, status, searchKeyword, searchEmail, dateRange])

  useEffect(() => {
    fetchStats()
  }, [])

  const getStatusTag = (s: string) => {
    switch (s) {
      case 'paid':
        return <Tag color="green">已支付</Tag>
      case 'pending':
        return <Tag color="blue">待支付</Tag>
      case 'expired':
        return <Tag color="default">已过期</Tag>
      case 'refunded':
        return <Tag color="orange">已退款</Tag>
      default:
        return <Tag>{s}</Tag>
    }
  }

  const getPayTypeText = (t?: string) => {
    switch (t) {
      case 'alipay':
        return <span style={{ color: '#1677ff' }}>支付宝</span>
      case 'wxpay':
        return <span style={{ color: '#07c160' }}>微信</span>
      case 'linuxdo':
        return <span style={{ color: '#0066FF', fontWeight: 500 }}>L 币</span>
      default:
        return <span style={{ color: '#86868b' }}>-</span>
    }
  }

  const columns = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      width: 180,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>
    },
    {
      title: '类型',
      dataIndex: 'order_type',
      width: 120,
      render: (v: string) => {
        if (v === 'distributor_codes') {
          return <Tag color="purple">分销商采购</Tag>
        }
        return <Tag color="blue">用户购买</Tag>
      }
    },
    {
      title: '买家',
      width: 150,
      render: (_: any, r: Order) => {
        if (r.order_type === 'distributor_codes' && r.buyer_username) {
          return <Text style={{ fontWeight: 500 }}>{r.buyer_username}</Text>
        }
        return <Text type="secondary">{r.email || '-'}</Text>
      }
    },
    {
      title: '套餐',
      dataIndex: 'plan_name',
      width: 180,
      render: (v: string, r: Order) => (
        <div>
          <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{v || '-'}</div>
          {r.order_type === 'distributor_codes' && r.quantity && r.quantity > 1 && (
            <Text type="secondary" style={{ fontSize: 12 }}>x{r.quantity} 份</Text>
          )}
        </div>
      )
    },
    {
      title: '金额',
      width: 150,
      render: (_: any, r: Order) => {
        const finalAmt = r.final_amount ?? r.amount
        const hasDiscount = r.discount_amount > 0
        return (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: '#f5222d', whiteSpace: 'nowrap' }}>
              ¥{(finalAmt / 100).toFixed(2)}
            </Text>
            {hasDiscount && (
              <Tooltip title={`优惠码: ${r.coupon_code}`}>
                <Text type="secondary" delete style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  ¥{(r.amount / 100).toFixed(2)}
                </Text>
              </Tooltip>
            )}
          </Space>
        )
      }
    },
    {
      title: '优惠',
      width: 100,
      render: (_: any, r: Order) => {
        if (!r.discount_amount || r.discount_amount === 0) {
          return <Text type="secondary">-</Text>
        }
        return (
          <Tooltip title={r.coupon_code}>
            <Tag icon={<GiftOutlined />} color="green">
              -¥{(r.discount_amount / 100).toFixed(2)}
            </Tag>
          </Tooltip>
        )
      }
    },
    {
      title: '支付方式',
      dataIndex: 'pay_type',
      width: 90,
      render: (v: string) => getPayTypeText(v)
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => getStatusTag(v)
    },
    {
      title: '兑换码',
      dataIndex: 'redeem_code',
      width: 140,
      render: (v: string, r: Order) => {
        // 分销商订单显示已发码数量
        if (r.order_type === 'distributor_codes') {
          return (
            <Tooltip title={`已发放 ${r.delivered_count || 0} 个兑换码`}>
              <Tag color="green">{r.delivered_count || 0} 个码</Tag>
            </Tooltip>
          )
        }
        // 公开订单显示单个兑换码
        return v ? <code style={{ fontSize: 12, color: '#007aff' }}>{v}</code> : <span style={{ color: '#86868b' }}>-</span>
      }
    },
    {
      title: '流水号',
      dataIndex: 'trade_no',
      width: 180,
      render: (v: string) => {
        if (!v) return <span style={{ color: '#86868b' }}>-</span>
        return (
          <Tooltip title={v}>
            <span style={{ color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
              {v.length > 20 ? `${v.substring(0, 20)}...` : v}
            </span>
          </Tooltip>
        )
      }
    },
    {
      title: '支付时间',
      dataIndex: 'paid_at',
      width: 150,
      render: (v: string) => v ? <span style={{ color: '#64748b', fontSize: 13 }}>{formatDate(v, 'YYYY-MM-DD HH:mm')}</span> : <span style={{ color: '#86868b' }}>-</span>
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 150,
      render: (v: string) => <span style={{ color: '#64748b', fontSize: 13 }}>{formatDate(v, 'YYYY-MM-DD HH:mm')}</span>
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>订单管理</h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>查看和管理所有购买订单</p>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="总订单数"
                value={stats.total_orders}
                prefix={<ShoppingCartOutlined style={{ color: '#007aff' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="已支付"
                value={stats.paid_orders}
                prefix={<CheckCircleOutlined style={{ color: '#34c759' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="总收入"
                value={(stats.total_revenue / 100).toFixed(2)}
                prefix={<DollarOutlined style={{ color: '#f5222d' }} />}
                suffix="元"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="今日收入"
                value={(stats.today_revenue / 100).toFixed(2)}
                prefix={<ClockCircleOutlined style={{ color: '#ff9500' }} />}
                suffix="元"
              />
              <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                今日订单：{stats.today_orders} 笔
              </div>
            </Card>
          </Col>
          {/* LinuxDo 收入统计 */}
          {stats.linuxdo_revenue !== undefined && stats.linuxdo_revenue > 0 && (
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="LinuxDo 收入"
                  value={(stats.linuxdo_revenue / 100).toFixed(2)}
                  prefix={<span style={{ color: '#0066FF', fontSize: 20, fontWeight: 700 }}>L</span>}
                  suffix="元"
                  valueStyle={{ color: '#0066FF' }}
                />
                <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                  订单数：{stats.linuxdo_orders || 0} 笔
                </div>
              </Card>
            </Col>
          )}
        </Row>
      )}

      <Card bodyStyle={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Radio.Group value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} buttonStyle="solid">
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="pending">待支付</Radio.Button>
              <Radio.Button value="paid">已支付</Radio.Button>
              <Radio.Button value="expired">已过期</Radio.Button>
            </Radio.Group>
            <Space wrap>
              <Input
                placeholder="搜索订单号/邮箱/交易号"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                prefix={<SearchOutlined />}
                style={{ width: 240 }}
                allowClear
              />
              <Input
                placeholder="精确邮箱搜索"
                value={searchEmail}
                onChange={e => setSearchEmail(e.target.value)}
                style={{ width: 200 }}
                allowClear
              />
              <RangePicker
                value={dateRange}
                onChange={dates => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
                style={{ width: 280 }}
              />
              <Button
                icon={<ClearOutlined />}
                onClick={() => {
                  setSearchKeyword('')
                  setSearchEmail('')
                  setDateRange([null, null])
                  setPage(1)
                }}
              >
                清空筛选
              </Button>
            </Space>
          </Space>
        </div>
        <Table
          dataSource={orders}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1730 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: setPage,
            showTotal: t => `共 ${t} 条`,
          }}
        />
      </Card>
    </div>
  )
}

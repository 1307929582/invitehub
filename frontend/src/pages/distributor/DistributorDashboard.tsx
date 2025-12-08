// 分销商 Dashboard
import { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Table, Typography, Spin, Empty } from 'antd'
import {
  GiftOutlined,
  CheckCircleOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
} from '@ant-design/icons'
import { distributorApi } from '../../api'

const { Title } = Typography

interface Summary {
  total_codes_created: number
  active_codes: number
  inactive_codes: number
  total_sales: number
  pending_invites: number
  accepted_invites: number
  total_revenue_estimate: number
}

interface SaleRecord {
  code: string
  email: string
  team_name: string
  status: string
  created_at: string
  accepted_at?: string
}

export default function DistributorDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [recentSales, setRecentSales] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [summaryRes, salesRes] = await Promise.all([
          distributorApi.getMySummary(),
          distributorApi.getMySales(5),
        ])
        setSummary(summaryRes as any)
        setRecentSales((salesRes as any) || [])
      } catch (error) {
        console.error('加载数据失败:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const columns = [
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{text}</code>,
    },
    { title: '用户邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    { title: 'Team', dataIndex: 'team_name', key: 'team_name' },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>仪表盘</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="总兑换码数"
              value={summary?.total_codes_created || 0}
              prefix={<GiftOutlined style={{ color: '#722ed1' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="活跃码数"
              value={summary?.active_codes || 0}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="总销售次数"
              value={summary?.total_sales || 0}
              prefix={<ShoppingCartOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="预估收益"
              value={summary?.total_revenue_estimate || 0}
              precision={2}
              prefix={<DollarOutlined style={{ color: '#faad14' }} />}
              suffix="元"
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近销售记录" style={{ marginTop: 24 }}>
        {recentSales.length > 0 ? (
          <Table
            rowKey={(r, i) => `${r.code}-${i}`}
            dataSource={recentSales}
            columns={columns}
            pagination={false}
            size="small"
          />
        ) : (
          <Empty description="暂无销售记录" />
        )}
      </Card>
    </div>
  )
}

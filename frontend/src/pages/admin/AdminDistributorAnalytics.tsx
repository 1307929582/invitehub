// 管理员 - 分销商数据分析
import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  Button,
  message,
  Badge,
  Typography,
  Card,
  Modal,
  Select,
  Space,
  Row,
  Col,
  Statistic,
  Tag,
  Spin,
  Descriptions,
  Timeline,
} from 'antd'
import {
  EyeOutlined,
  ReloadOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  RiseOutlined,
  BarChartOutlined,
} from '@ant-design/icons'
import { distributorAnalyticsApi } from '../../api'

const { Title, Text } = Typography

interface DistributorAnalytics {
  id: number
  username: string
  email: string
  approval_status: string
  created_at: string
  total_codes: number
  active_codes: number
  total_sales: number
  today_sales: number
  week_sales: number
  month_sales: number
  active_members: number
  revenue_estimate: number
}

interface AnalyticsSummary {
  total_distributors: number
  approved_count: number
  pending_count: number
  total_revenue: number
  total_sales: number
  today_sales: number
  unit_price: number
}

interface DistributorDetail {
  distributor: DistributorAnalytics
  recent_sales: {
    email: string
    redeem_code: string
    team_name: string
    status: string
    created_at: string
  }[]
  codes_summary: {
    total: number
    active: number
    inactive: number
    usage_rate: number
  }
}

export default function AdminDistributorAnalytics() {
  const [distributors, setDistributors] = useState<DistributorAnalytics[]>([])
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('total_sales')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // 详情弹窗
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<DistributorDetail | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = (await distributorAnalyticsApi.getAnalytics({
        page,
        page_size: 20,
        sort_by: sortBy,
        status: statusFilter || undefined,
      })) as any as { items: DistributorAnalytics[]; total: number; summary: AnalyticsSummary }
      setDistributors(res.items || [])
      setTotal(res.total || 0)
      setSummary(res.summary || null)
    } catch (error) {
      message.error('加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleViewDetail = async (distributor: DistributorAnalytics) => {
    setDetailModalVisible(true)
    setDetailLoading(true)
    try {
      const res = (await distributorAnalyticsApi.getDetail(distributor.id)) as any as DistributorDetail
      setSelectedDetail(res)
    } catch (error) {
      message.error('加载详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const statusMap: Record<string, { status: 'success' | 'processing' | 'error' | 'default'; text: string }> = {
    approved: { status: 'success', text: '已批准' },
    pending: { status: 'processing', text: '待审核' },
    rejected: { status: 'error', text: '已拒绝' },
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '状态',
      dataIndex: 'approval_status',
      key: 'approval_status',
      width: 90,
      render: (status: string) => {
        const s = statusMap[status] || { status: 'default', text: status }
        return <Badge status={s.status} text={s.text} />
      },
    },
    {
      title: '总销售',
      dataIndex: 'total_sales',
      key: 'total_sales',
      width: 90,
      render: (val: number) => <Text strong>{val}</Text>,
    },
    {
      title: '今日',
      dataIndex: 'today_sales',
      key: 'today_sales',
      width: 70,
      render: (val: number) =>
        val > 0 ? <Tag color="green">{val}</Tag> : <Text type="secondary">{val}</Text>,
    },
    {
      title: '本周',
      dataIndex: 'week_sales',
      key: 'week_sales',
      width: 70,
      render: (val: number) => val,
    },
    {
      title: '本月',
      dataIndex: 'month_sales',
      key: 'month_sales',
      width: 70,
      render: (val: number) => val,
    },
    {
      title: '活跃成员',
      dataIndex: 'active_members',
      key: 'active_members',
      width: 90,
      render: (val: number) => (
        <Space>
          <TeamOutlined style={{ color: '#1890ff' }} />
          {val}
        </Space>
      ),
    },
    {
      title: '兑换码',
      key: 'codes',
      width: 90,
      render: (_: any, record: DistributorAnalytics) => (
        <Text type="secondary">
          {record.active_codes}/{record.total_codes}
        </Text>
      ),
    },
    {
      title: '预估收益',
      dataIndex: 'revenue_estimate',
      key: 'revenue_estimate',
      width: 100,
      render: (val: number) => (
        <Text type="success">
          ¥{val.toFixed(2)}
        </Text>
      ),
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: DistributorAnalytics) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetail(record)}
        >
          详情
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <BarChartOutlined style={{ marginRight: 8 }} />
          分销商数据分析
        </Title>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          刷新
        </Button>
      </div>

      {/* KPI 汇总卡片 */}
      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable>
              <Statistic
                title="总分销商"
                value={summary.total_distributors}
                prefix={<TeamOutlined style={{ color: '#722ed1' }} />}
                suffix={
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    ({summary.approved_count} 已批准)
                  </Text>
                }
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable>
              <Statistic
                title="总销售次数"
                value={summary.total_sales}
                prefix={<ShoppingCartOutlined style={{ color: '#1890ff' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable>
              <Statistic
                title="今日销售"
                value={summary.today_sales}
                prefix={<RiseOutlined style={{ color: '#52c41a' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable>
              <Statistic
                title="总预估收益"
                value={summary.total_revenue}
                precision={2}
                prefix={<DollarOutlined style={{ color: '#faad14' }} />}
                suffix={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    (单价 ¥{summary.unit_price})
                  </Text>
                }
              />
            </Card>
          </Col>
        </Row>
      )}

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Select
            placeholder="排序方式"
            value={sortBy}
            onChange={(v) => setSortBy(v)}
            style={{ width: 150 }}
            options={[
              { value: 'total_sales', label: '总销售' },
              { value: 'today_sales', label: '今日销售' },
              { value: 'active_members', label: '活跃成员' },
              { value: 'created_at', label: '注册时间' },
            ]}
          />
          <Select
            placeholder="筛选状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            style={{ width: 150 }}
            allowClear
            options={[
              { value: 'approved', label: '已批准' },
              { value: 'pending', label: '待审核' },
              { value: 'rejected', label: '已拒绝' },
            ]}
          />
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={distributors}
          loading={loading}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showTotal: (t) => `共 ${t} 个分销商`,
            onChange: (p) => setPage(p),
          }}
          scroll={{ x: 1200 }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title={`${selectedDetail?.distributor?.username || '分销商'} 详情`}
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false)
          setSelectedDetail(null)
        }}
        footer={null}
        width={800}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" />
          </div>
        ) : selectedDetail ? (
          <div>
            {/* 基本信息 */}
            <Descriptions title="基本信息" bordered column={2} size="small">
              <Descriptions.Item label="用户名">
                {selectedDetail.distributor.username}
              </Descriptions.Item>
              <Descriptions.Item label="邮箱">
                {selectedDetail.distributor.email}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge
                  status={statusMap[selectedDetail.distributor.approval_status]?.status || 'default'}
                  text={statusMap[selectedDetail.distributor.approval_status]?.text || selectedDetail.distributor.approval_status}
                />
              </Descriptions.Item>
              <Descriptions.Item label="注册时间">
                {new Date(selectedDetail.distributor.created_at).toLocaleString('zh-CN')}
              </Descriptions.Item>
            </Descriptions>

            {/* 销售数据 */}
            <Row gutter={16} style={{ marginTop: 24, marginBottom: 24 }}>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="总销售" value={selectedDetail.distributor.total_sales} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="今日"
                    value={selectedDetail.distributor.today_sales}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="本周" value={selectedDetail.distributor.week_sales} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="本月" value={selectedDetail.distributor.month_sales} />
                </Card>
              </Col>
            </Row>

            {/* 兑换码统计 */}
            <Card title="兑换码统计" size="small" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="总数" value={selectedDetail.codes_summary.total} />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="活跃"
                    value={selectedDetail.codes_summary.active}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="已停用"
                    value={selectedDetail.codes_summary.inactive}
                    valueStyle={{ color: '#999' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="使用率"
                    value={selectedDetail.codes_summary.usage_rate}
                    suffix="%"
                  />
                </Col>
              </Row>
            </Card>

            {/* 近期销售记录 */}
            <Card title="近期销售记录" size="small">
              {selectedDetail.recent_sales.length > 0 ? (
                <Timeline
                  items={selectedDetail.recent_sales.slice(0, 10).map((sale) => ({
                    color: sale.status === 'success' ? 'green' : 'gray',
                    children: (
                      <div>
                        <Text>{sale.email}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {sale.team_name} · <code>{sale.redeem_code}</code> ·{' '}
                          {new Date(sale.created_at).toLocaleString('zh-CN')}
                        </Text>
                      </div>
                    ),
                  }))}
                />
              ) : (
                <Text type="secondary">暂无销售记录</Text>
              )}
            </Card>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

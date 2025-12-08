// 管理员 - 分销商管理
import { useState, useEffect, useCallback } from 'react'
import { Table, Button, message, Badge, Typography, Card, Modal, Input, Select } from 'antd'
import { EyeOutlined, SearchOutlined } from '@ant-design/icons'
import { distributorApi } from '../../api'

const { Title } = Typography

interface Distributor {
  id: number
  username: string
  email: string
  approval_status: string
  created_at: string
  total_codes: number
  active_codes: number
  total_sales: number
}

interface SaleRecord {
  code: string
  email: string
  team_name: string
  status: string
  created_at: string
  accepted_at?: string
}

export default function AdminDistributors() {
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [searchText, setSearchText] = useState('')

  // 销售记录弹窗
  const [salesModalVisible, setSalesModalVisible] = useState(false)
  const [salesLoading, setSalesLoading] = useState(false)
  const [selectedDistributor, setSelectedDistributor] = useState<Distributor | null>(null)
  const [salesRecords, setSalesRecords] = useState<SaleRecord[]>([])

  const fetchDistributors = useCallback(async () => {
    setLoading(true)
    try {
      const res = await distributorApi.list(statusFilter || undefined) as any
      setDistributors(res || [])
    } catch (error) {
      message.error('加载分销商列表失败')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchDistributors()
  }, [fetchDistributors])

  const handleViewSales = async (distributor: Distributor) => {
    setSelectedDistributor(distributor)
    setSalesModalVisible(true)
    setSalesLoading(true)
    try {
      const res = await distributorApi.getSales(distributor.id, 100) as any
      setSalesRecords(res || [])
    } catch (error) {
      message.error('加载销售记录失败')
    } finally {
      setSalesLoading(false)
    }
  }

  const filteredDistributors = distributors.filter(d =>
    d.username.toLowerCase().includes(searchText.toLowerCase()) ||
    d.email.toLowerCase().includes(searchText.toLowerCase())
  )

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
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'approval_status',
      key: 'approval_status',
      width: 100,
      render: (status: string) => {
        const s = statusMap[status] || { status: 'default', text: status }
        return <Badge status={s.status} text={s.text} />
      },
    },
    {
      title: '兑换码数',
      dataIndex: 'total_codes',
      key: 'total_codes',
      width: 100,
      sorter: (a: Distributor, b: Distributor) => a.total_codes - b.total_codes,
    },
    {
      title: '活跃码',
      dataIndex: 'active_codes',
      key: 'active_codes',
      width: 80,
    },
    {
      title: '销售次数',
      dataIndex: 'total_sales',
      key: 'total_sales',
      width: 100,
      sorter: (a: Distributor, b: Distributor) => a.total_sales - b.total_sales,
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
      width: 120,
      render: (_: any, record: Distributor) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => handleViewSales(record)}
        >
          销售记录
        </Button>
      ),
    },
  ]

  const salesColumns = [
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => <code>{text}</code>,
    },
    { title: '用户邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    { title: 'Team', dataIndex: 'team_name', key: 'team_name' },
    { title: '状态', dataIndex: 'status', key: 'status' },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>分销商管理</Title>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Input
            placeholder="搜索用户名或邮箱..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 250 }}
            allowClear
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
          dataSource={filteredDistributors}
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个分销商`,
          }}
        />
      </Card>

      <Modal
        title={`${selectedDistributor?.username} 的销售记录`}
        open={salesModalVisible}
        onCancel={() => setSalesModalVisible(false)}
        footer={null}
        width={800}
      >
        <Table
          rowKey={(r, i) => `${r.code}-${i}`}
          columns={salesColumns}
          dataSource={salesRecords}
          loading={salesLoading}
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Modal>
    </div>
  )
}

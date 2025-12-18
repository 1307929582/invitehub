// 分销商销售统计
import { useState, useEffect, useCallback } from 'react'
import { Table, Typography, Card, Badge, Empty, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { distributorApi } from '../../api'

const { Title } = Typography

interface SaleRecord {
  code: string
  email: string
  team_name: string
  status: string
  created_at: string
  accepted_at?: string
}

export default function DistributorSales() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const res = await distributorApi.getMySales(1000) as any
      setSales(res || [])
    } catch (error) {
      console.error('加载销售记录失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSales()
  }, [fetchSales])

  const filteredSales = sales.filter(s =>
    s.code.toLowerCase().includes(searchText.toLowerCase()) ||
    s.email.toLowerCase().includes(searchText.toLowerCase()) ||
    s.team_name.toLowerCase().includes(searchText.toLowerCase())
  )

  const columns = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_: any, __: any, index: number) => index + 1,  // 从 1 开始，不是从 0
    },
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => (
        <code style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 4 }}>{text}</code>
      ),
    },
    {
      title: '用户邮箱',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
    },
    {
      title: '所属 Team',
      dataIndex: 'team_name',
      key: 'team_name',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          success: { color: 'success', text: '成功' },
          pending: { color: 'processing', text: '待接受' },
          accepted: { color: 'success', text: '已接受' },
          failed: { color: 'error', text: '失败' },
        }
        const s = statusMap[status] || { color: 'default', text: status }
        return <Badge status={s.color as any} text={s.text} />
      },
    },
    {
      title: '兑换时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => text ? new Date(text).toLocaleString('zh-CN') : '-',
      sorter: (a: SaleRecord, b: SaleRecord) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '接受时间',
      dataIndex: 'accepted_at',
      key: 'accepted_at',
      width: 180,
      render: (text: string) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>销售统计</Title>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Input
            placeholder="搜索兑换码、邮箱、Team..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300 }}
            allowClear
          />
        </div>

        {filteredSales.length > 0 ? (
          <Table
            rowKey={(r, i) => `${r.code}-${r.email}-${i}`}
            columns={columns}
            dataSource={filteredSales}
            loading={loading}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
            }}
          />
        ) : (
          <Empty description={loading ? '加载中...' : '暂无销售记录'} />
        )}
      </Card>
    </div>
  )
}

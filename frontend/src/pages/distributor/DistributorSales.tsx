// 分销商销售统计
import { useState, useEffect, useCallback } from 'react'
import { Table, Typography, Card, Badge, Empty, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { distributorApi } from '../../api'
import dayjs from 'dayjs'

const { Title, Text } = Typography

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
    (s.code || '').toLowerCase().includes(searchText.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(searchText.toLowerCase()) ||
    (s.team_name || '').toLowerCase().includes(searchText.toLowerCase())
  )

  const columns = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_: any, __: any, index: number) => (
        <span style={{ color: '#86868b' }}>{index + 1}</span>
      ),
    },
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => (
        <code style={{
          background: 'linear-gradient(135deg, #667eea15 0%, #764ba215 100%)',
          padding: '4px 10px',
          borderRadius: 6,
          fontFamily: 'Monaco, monospace',
          fontSize: 13,
          color: '#667eea',
          border: '1px solid #667eea20',
        }}>
          {text}
        </code>
      ),
    },
    {
      title: '用户邮箱',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      render: (text: string) => <span style={{ color: '#1d1d1f' }}>{text}</span>,
    },
    {
      title: '所属 Team',
      dataIndex: 'team_name',
      key: 'team_name',
      render: (text: string) => (
        <span style={{
          padding: '2px 8px',
          background: '#f0f0f5',
          borderRadius: 4,
          fontSize: 13,
        }}>
          {text}
        </span>
      ),
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
      render: (text: string) => (
        <span style={{ color: '#86868b', fontSize: 13 }}>
          {text ? dayjs(text).format('YYYY-MM-DD HH:mm:ss') : '-'}
        </span>
      ),
      sorter: (a: SaleRecord, b: SaleRecord) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '接受时间',
      dataIndex: 'accepted_at',
      key: 'accepted_at',
      width: 180,
      render: (text: string) => (
        <span style={{ color: '#86868b', fontSize: 13 }}>
          {text ? dayjs(text).format('YYYY-MM-DD HH:mm:ss') : '-'}
        </span>
      ),
    },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700, color: '#1d1d1f' }}>
          销售统计
        </Title>
        <Text style={{ color: '#86868b', fontSize: 14 }}>
          查看所有通过您的兑换码完成的销售记录
        </Text>
      </div>

      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ padding: 20, borderBottom: '1px solid #f0f0f5' }}>
          <Input
            placeholder="搜索兑换码、邮箱、Team..."
            prefix={<SearchOutlined style={{ color: '#86868b' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300, borderRadius: 10 }}
            allowClear
          />
        </div>

        <div style={{ padding: 20 }}>
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
            <Empty
              description={loading ? '加载中...' : '暂无销售记录'}
              style={{ padding: '60px 0' }}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

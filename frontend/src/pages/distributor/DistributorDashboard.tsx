// 分销商 Dashboard
import { useState, useEffect } from 'react'
import { Row, Col, Card, Table, Typography, Spin, Empty, Button, message, Grid } from 'antd'
import {
  GiftOutlined,
  CheckCircleOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  LinkOutlined,
  CopyOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons'
import { distributorApi } from '../../api'
import { useStore } from '../../store'

const { Title, Paragraph, Text } = Typography
const { useBreakpoint } = Grid

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
  const { user } = useStore()
  const screens = useBreakpoint()

  // 从 localStorage 读取自定义前缀
  const customPrefix = localStorage.getItem(`distributor_prefix_${user?.id}`) || `distributor-${user?.id || ''}`

  // 生成分销商白标链接
  const whiteLabelUrl = `https://${customPrefix}.zenscaleai.com/invite`

  const copyWhiteLabelUrl = () => {
    if (whiteLabelUrl) {
      navigator.clipboard.writeText(whiteLabelUrl)
      message.success('链接已复制到剪贴板')
    }
  }

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

  // 统计卡片配置
  const statCards = [
    {
      title: '总兑换码数',
      value: summary?.total_codes_created || 0,
      icon: <GiftOutlined />,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '活跃码数',
      value: summary?.active_codes || 0,
      icon: <CheckCircleOutlined />,
      gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '总销售次数',
      value: summary?.total_sales || 0,
      icon: <ShoppingCartOutlined />,
      gradient: 'linear-gradient(135deg, #007aff 0%, #5ac8fa 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '预估收益',
      value: summary?.total_revenue_estimate || 0,
      icon: <DollarOutlined />,
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
      suffix: '元',
      precision: 2,
    },
  ]

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
      title: 'Team',
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
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => (
        <span style={{ color: '#86868b', fontSize: 13 }}>
          {new Date(text).toLocaleString('zh-CN')}
        </span>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
      }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700, color: '#1d1d1f' }}>
          仪表盘
        </Title>
        <Text style={{ color: '#86868b', fontSize: 14 }}>
          欢迎回来，{user?.username}
        </Text>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        {statCards.map((card, index) => (
          <Col xs={24} sm={12} lg={6} key={index}>
            <Card
              style={{
                background: card.gradient,
                borderRadius: 16,
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                overflow: 'hidden',
              }}
              bodyStyle={{ padding: screens.md ? 24 : 20 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 8 }}>
                    {card.title}
                  </div>
                  <div style={{ color: '#fff', fontSize: screens.md ? 32 : 28, fontWeight: 700, lineHeight: 1.2 }}>
                    {card.precision
                      ? card.value.toFixed(card.precision)
                      : card.value.toLocaleString()}
                    {card.suffix && <span style={{ fontSize: 16, marginLeft: 4 }}>{card.suffix}</span>}
                  </div>
                </div>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: card.iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  color: '#fff',
                }}>
                  {card.icon}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 白标链接展示 */}
      <Card
        style={{
          marginBottom: 28,
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        }}
        bodyStyle={{ padding: screens.md ? 28 : 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(0, 122, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <LinkOutlined style={{ color: '#007aff', fontSize: 18 }} />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>您的客户专属链接</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>白标入口，隐藏价格信息</div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(255,255,255,0.08)',
          padding: '14px 18px',
          borderRadius: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}>
          <code style={{
            flex: 1,
            fontSize: screens.md ? 15 : 13,
            color: '#5ac8fa',
            wordBreak: 'break-all',
            fontFamily: 'Monaco, monospace',
            minWidth: 200,
          }}>
            {whiteLabelUrl}
          </code>
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={copyWhiteLabelUrl}
            style={{
              height: 40,
              borderRadius: 10,
              fontWeight: 500,
              background: '#007aff',
              border: 'none',
            }}
          >
            复制链接
          </Button>
        </div>

        <Paragraph style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          💡 通过此链接访问的客户将看不到平台的购买功能和价格信息，适合您的独立销售渠道
        </Paragraph>
      </Card>

      {/* 最近销售记录 */}
      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{
          padding: screens.md ? '20px 24px' : '16px 20px',
          borderBottom: '1px solid #f0f0f5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Title level={5} style={{ margin: 0, fontWeight: 600 }}>最近销售记录</Title>
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', color: '#007aff' }}
            onClick={() => window.location.href = '/distributor/sales'}
          >
            查看全部 <ArrowRightOutlined />
          </Button>
        </div>

        <div style={{ padding: screens.md ? '0 24px 24px' : '0 16px 16px' }}>
          {recentSales.length > 0 ? (
            <Table
              rowKey={(r, i) => `${r.code}-${i}`}
              dataSource={recentSales}
              columns={columns}
              pagination={false}
              size="middle"
              style={{ marginTop: 16 }}
            />
          ) : (
            <Empty
              description="暂无销售记录"
              style={{ padding: '40px 0' }}
            />
          )}
        </div>
      </Card>
    </div>
  )
}

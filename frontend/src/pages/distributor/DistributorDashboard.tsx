// 分销商 Dashboard
import { useState, useEffect, useMemo } from 'react'
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
import { useNavigate } from 'react-router-dom'
import { distributorApi, configApi } from '../../api'
import { useStore } from '../../store'
import dayjs from 'dayjs'

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
  const [simplePageDomain, setSimplePageDomain] = useState<string>('')
  const { user } = useStore()
  const screens = useBreakpoint()
  const navigate = useNavigate()

  // 纯净页面链接（使用系统设置的纯净页面域名）
  const purePageUrl = simplePageDomain ? `https://${simplePageDomain}/invite` : ''

  // 复制链接（带错误处理）
  const copyPurePageUrl = async () => {
    if (!purePageUrl) {
      message.warning('请先在系统设置中配置纯净页面域名')
      return
    }
    try {
      await navigator.clipboard.writeText(purePageUrl)
      message.success('链接已复制到剪贴板')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  useEffect(() => {
    const abortController = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      try {
        const [summaryRes, salesRes, configRes] = await Promise.all([
          distributorApi.getMySummary(),
          distributorApi.getMySales(5),
          configApi.list(),
        ])
        // 检查是否已取消
        if (abortController.signal.aborted) return
        setSummary(summaryRes as unknown as Summary)
        setRecentSales((salesRes as unknown as SaleRecord[]) || [])
        // 提取纯净页面域名（取第一个）
        const configs = (configRes as any)?.configs || []
        const simpleDomainsConfig = configs.find((c: any) => c.key === 'simple_page_domains')
        if (simpleDomainsConfig?.value) {
          const firstDomain = simpleDomainsConfig.value.split(',')[0]?.trim()
          if (firstDomain) {
            setSimplePageDomain(firstDomain)
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) return
        console.error('加载数据失败:', error)
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }
    fetchData()

    return () => {
      abortController.abort()
    }
  }, [])

  // 统计卡片配置
  const statCards = [
    {
      title: '总兑换码数',
      value: summary?.total_codes_created || 0,
      icon: <GiftOutlined />,
      gradient: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '活跃码数',
      value: summary?.active_codes || 0,
      icon: <CheckCircleOutlined />,
      gradient: 'linear-gradient(135deg, #059669 0%, #34d399 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '总销售次数',
      value: summary?.total_sales || 0,
      icon: <ShoppingCartOutlined />,
      gradient: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
    },
    {
      title: '预估收益',
      value: summary?.total_revenue_estimate || 0,
      icon: <DollarOutlined />,
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
      iconBg: 'rgba(255,255,255,0.2)',
      suffix: '元',
      precision: 2,
    },
  ]

  // 表格列配置（useMemo 优化）
  const columns = useMemo(() => [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_: unknown, __: unknown, index: number) => (
        <span style={{ color: '#86868b' }}>{index + 1}</span>
      ),
    },
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => (
        <code style={{
          background: 'linear-gradient(135deg, #10a37f15 0%, #0d8a6a15 100%)',
          padding: '4px 10px',
          borderRadius: 6,
          fontFamily: 'Monaco, monospace',
          fontSize: 13,
          color: '#10a37f',
          border: '1px solid #10a37f20',
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
          {dayjs(text).format('YYYY-MM-DD HH:mm:ss')}
        </span>
      ),
    },
  ], [])

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
                borderRadius: 16,
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                overflow: 'hidden',
              }}
              styles={{
                body: {
                  padding: screens.md ? 24 : 20,
                  background: card.gradient,
                },
              }}
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

      {/* 纯净页面链接展示 */}
      <Card
        style={{
          marginBottom: 28,
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        styles={{
          body: {
            padding: screens.md ? 28 : 20,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          },
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(16, 163, 127, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <LinkOutlined style={{ color: '#10a37f', fontSize: 18 }} />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>您的客户专属链接</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>纯净页面入口，隐藏购买功能和价格</div>
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
            color: '#34d399',
            wordBreak: 'break-all',
            fontFamily: 'Monaco, monospace',
            minWidth: 200,
          }}>
            {purePageUrl || '请在系统设置中配置纯净页面域名'}
          </code>
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={copyPurePageUrl}
            style={{
              height: 40,
              borderRadius: 10,
              fontWeight: 500,
              background: '#10a37f',
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
        styles={{ body: { padding: 0 } }}
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
            style={{ padding: 0, height: 'auto', color: '#10a37f' }}
            onClick={() => navigate('/distributor/sales')}
          >
            查看全部 <ArrowRightOutlined />
          </Button>
        </div>

        <div style={{ padding: screens.md ? '0 24px 24px' : '0 16px 16px' }}>
          {recentSales.length > 0 ? (
            <Table
              rowKey={(r) => `${r.code}-${r.email}-${r.created_at}`}
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

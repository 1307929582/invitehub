// 分销商兑换码管理
import { useState, useEffect, useCallback } from 'react'
import {
  Table, Button, message, Popconfirm, Badge, Space, Tooltip, Typography, Card,
  Modal, Form, InputNumber, Select, Radio
} from 'antd'
import { DeleteOutlined, CopyOutlined, LinkOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import type { TableRowSelection } from 'antd/es/table/interface'
import { redeemApi, distributorApi, configApi } from '../../api'
import dayjs from 'dayjs'

const { Title, Text } = Typography

interface RedeemCode {
  id: number
  code: string
  code_type: string
  max_uses: number
  used_count: number
  expires_at: string | null
  is_active: boolean
  note: string | null
  group_name: string | null
  created_at: string
  validity_days: number
}

interface CodePlan {
  id: number
  name: string
  price: number
  code_count: number
  code_max_uses: number
  validity_days: number
  description?: string
  is_recommended: boolean
}

export default function DistributorRedeemCodes() {
  const [codes, setCodes] = useState<RedeemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false)
  const [simplePageDomain, setSimplePageDomain] = useState<string>('')
  const [siteUrl, setSiteUrl] = useState<string>('')

  // 购买兑换码相关状态
  const [purchaseModalVisible, setPurchaseModalVisible] = useState(false)
  const [codePlans, setCodePlans] = useState<CodePlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<number | undefined>(undefined)
  const [purchaseQuantity, setPurchaseQuantity] = useState(1)
  const [payType, setPayType] = useState<'alipay' | 'wxpay'>('alipay')
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [purchaseForm] = Form.useForm()

  // 批量选择
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const [res, configRes] = await Promise.all([
        redeemApi.list() as any,
        configApi.list(),
      ])
      setCodes(res.codes || [])
      const configs = (configRes as any)?.configs || []
      // 纯净页面域名
      const simpleDomainsConfig = configs.find((c: any) => c.key === 'simple_page_domains')
      if (simpleDomainsConfig?.value) {
        const firstDomain = simpleDomainsConfig.value.split(',')[0]?.trim()
        if (firstDomain) {
          setSimplePageDomain(firstDomain)
        }
      }
      // site_url（用于官方链接）
      const siteUrlConfig = configs.find((c: any) => c.key === 'site_url')
      if (siteUrlConfig?.value) {
        setSiteUrl(siteUrlConfig.value)
      }
    } catch (error) {
      message.error('加载兑换码失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  const handleDelete = async (id: number) => {
    try {
      await redeemApi.delete(id)
      message.success('删除成功')
      fetchCodes()
    } catch (error: any) {
      // 错误已在 interceptor 中处理
    }
  }

  const handleToggle = async (id: number) => {
    try {
      await redeemApi.toggle(id)
      message.success('操作成功')
      fetchCodes()
    } catch (error) {
      // 错误已在 interceptor 中处理
    }
  }

  // 获取邀请链接
  const getInviteUrl = (code: string, usePurePage: boolean = true) => {
    if (usePurePage && simplePageDomain) {
      return `https://${simplePageDomain}/invite/${code}`
    } else {
      return siteUrl ? `${siteUrl.replace(/\/$/, '')}/invite/${code}` : ''
    }
  }

  // 复制兑换码
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      message.success('已复制兑换码')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 复制链接
  const copyLink = async (code: string, usePurePage: boolean = true) => {
    const url = getInviteUrl(code, usePurePage)
    if (!url) {
      message.warning(usePurePage ? '请先在系统设置中配置纯净页面域名' : '请先在系统设置中配置站点 URL')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      message.success(`已复制${usePurePage ? '纯净页面' : '官方'}链接`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 批量复制链接
  const handleBatchCopyLinks = async (usePurePage: boolean = true) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要复制的兑换码')
      return
    }
    const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
    const links = selectedCodes.map(c => getInviteUrl(c.code, usePurePage)).filter(Boolean)
    if (links.length === 0) {
      message.warning(usePurePage ? '请先在系统设置中配置纯净页面域名' : '请先在系统设置中配置站点 URL')
      return
    }
    try {
      await navigator.clipboard.writeText(links.join('\n'))
      message.success(`已复制 ${links.length} 个${usePurePage ? '纯净页面' : '官方'}链接`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 批量复制兑换码
  const handleBatchCopyCodes = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要复制的兑换码')
      return
    }
    try {
      const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
      const codeTexts = selectedCodes.map(c => c.code).join('\n')
      await navigator.clipboard.writeText(codeTexts)
      message.success(`已复制 ${selectedCodes.length} 个兑换码`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的兑换码')
      return
    }
    const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
    const usedCodes = selectedCodes.filter(c => c.used_count > 0)
    if (usedCodes.length === selectedCodes.length) {
      message.error('所选兑换码都已使用，无法删除')
      return
    }
    setBatchDeleteLoading(true)
    try {
      const res = await redeemApi.batchDelete(selectedRowKeys as number[]) as any
      if (res.deleted > 0) {
        message.success(`成功删除 ${res.deleted} 个兑换码${res.skipped > 0 ? `，跳过 ${res.skipped} 个` : ''}`)
      } else {
        message.warning(`删除失败：${res.errors?.[0] || '未知错误'}`)
      }
      setSelectedRowKeys([])
      fetchCodes()
    } catch (error: any) {
      // 错误已在 interceptor 中处理
    } finally {
      setBatchDeleteLoading(false)
    }
  }

  // 购买兑换码相关函数
  const showPurchaseModal = async () => {
    setPurchaseModalVisible(true)
    try {
      const res = await distributorApi.getCodePlans() as any
      setCodePlans(res || [])
      if (res && res.length > 0) {
        setSelectedPlanId(res[0].id)
        purchaseForm.setFieldsValue({ planId: res[0].id })
      }
    } catch (error) {
      message.error('加载码包列表失败')
    }
  }

  const handlePurchase = async () => {
    if (!selectedPlanId) {
      message.error('请选择码包套餐')
      return
    }
    setPurchaseLoading(true)
    try {
      const res = await distributorApi.createCodeOrder({
        plan_id: selectedPlanId,
        quantity: purchaseQuantity,
        pay_type: payType,
      }) as any
      window.open(res.pay_url, '_blank', 'noopener,noreferrer')
      message.success('订单已创建，请在新窗口中完成支付')
      setPurchaseModalVisible(false)
      purchaseForm.resetFields()
      setTimeout(() => {
        fetchCodes()
      }, 5000)
    } catch (error) {
      // 错误已在 interceptor 中处理
    } finally {
      setPurchaseLoading(false)
    }
  }

  const selectedPlan = codePlans.find(p => p.id === selectedPlanId)
  const totalPrice = selectedPlan ? (selectedPlan.price * purchaseQuantity / 100).toFixed(2) : '0.00'

  const rowSelection: TableRowSelection<RedeemCode> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
    selections: [
      Table.SELECTION_ALL,
      Table.SELECTION_INVERT,
      Table.SELECTION_NONE,
    ],
  }

  const columns = [
    {
      title: '兑换码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => (
        <Space direction="vertical" size={4}>
          <Space size={4}>
            <code style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
              {text}
            </code>
            <Tooltip title="复制兑换码">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyCode(text)}
                aria-label="复制兑换码"
                style={{ color: '#10a37f', padding: 0, height: 'auto' }}
              />
            </Tooltip>
          </Space>
          <Space size={4}>
            <Tooltip title="复制纯净页面链接（隐藏价格）">
              <Button
                type="text"
                size="small"
                onClick={() => copyLink(text, true)}
                aria-label="复制纯净页面链接"
                style={{ color: '#52c41a', fontSize: 12, padding: 0, height: 'auto' }}
              >
                <LinkOutlined /> 纯净链接
              </Button>
            </Tooltip>
            <span style={{ color: '#d9d9d9' }} aria-hidden="true">|</span>
            <Tooltip title="复制官方链接（显示价格）">
              <Button
                type="text"
                size="small"
                onClick={() => copyLink(text, false)}
                aria-label="复制官方链接"
                style={{ color: '#999', fontSize: 12, padding: 0, height: 'auto' }}
              >
                <LinkOutlined /> 官方链接
              </Button>
            </Tooltip>
          </Space>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean) => (
        <Badge status={active ? 'success' : 'default'} text={active ? '有效' : '已禁用'} />
      ),
    },
    {
      title: '使用情况',
      key: 'usage',
      width: 120,
      render: (_: any, record: RedeemCode) => (
        <span>{record.used_count} / {record.max_uses}</span>
      ),
    },
    {
      title: '有效期(天)',
      dataIndex: 'validity_days',
      key: 'validity_days',
      width: 100,
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (text: string) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: RedeemCode) => {
        const canDelete = record.used_count === 0
        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              onClick={() => handleToggle(record.id)}
            >
              {record.is_active ? '禁用' : '启用'}
            </Button>
            <Tooltip title={!canDelete ? '已使用的兑换码无法删除' : ''}>
              <Popconfirm
                title="确定要删除这个兑换码吗？"
                onConfirm={() => handleDelete(record.id)}
                disabled={!canDelete}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="link"
                  danger
                  size="small"
                  disabled={!canDelete}
                  icon={<DeleteOutlined />}
                >
                  删除
                </Button>
              </Popconfirm>
            </Tooltip>
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0, fontWeight: 700, color: '#1d1d1f' }}>
              兑换码管理
            </Title>
            <Text style={{ color: '#86868b', fontSize: 14 }}>
              管理您的兑换码，复制链接分享给客户
            </Text>
          </div>
          <Button
            type="primary"
            icon={<ShoppingCartOutlined />}
            onClick={showPurchaseModal}
            style={{ borderRadius: 8, background: '#10a37f', border: 'none' }}
          >
            购买兑换码
          </Button>
        </div>
      </div>

      {/* 纯净页面域名提示 */}
      {simplePageDomain && (
        <Card
          style={{
            marginBottom: 20,
            borderRadius: 16,
            border: 'none',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}
          styles={{
            body: {
              padding: 20,
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            },
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 2 }}>纯净页面域名</div>
                <code style={{ color: '#34d399', fontSize: 14, fontFamily: 'Monaco, monospace' }}>
                  https://{simplePageDomain}
                </code>
              </div>
            </div>
            <Button
              type="primary"
              ghost
              size="small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`https://${simplePageDomain}`)
                  message.success('已复制域名')
                } catch {
                  message.error('复制失败，请手动复制')
                }
              }}
              style={{ borderRadius: 6 }}
            >
              复制域名
            </Button>
          </div>
        </Card>
      )}

      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* 批量操作栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            margin: 20,
            padding: '14px 20px',
            background: 'linear-gradient(135deg, #10a37f10 0%, #34d39910 100%)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <Text>
              已选择 <Text strong style={{ color: '#10a37f' }}>{selectedRowKeys.length}</Text> 项
            </Text>
            <Space wrap>
              <Button
                icon={<CopyOutlined />}
                onClick={handleBatchCopyCodes}
                style={{ borderRadius: 8 }}
              >
                批量复制兑换码
              </Button>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={() => handleBatchCopyLinks(true)}
                style={{ borderRadius: 8, background: '#34c759', border: 'none' }}
              >
                批量复制纯净链接
              </Button>
              <Button
                icon={<LinkOutlined />}
                onClick={() => handleBatchCopyLinks(false)}
                style={{ borderRadius: 8 }}
              >
                批量复制官方链接
              </Button>
              <Popconfirm
                title="批量删除兑换码"
                description={`确定要删除选中的 ${selectedRowKeys.length} 个兑换码吗？已使用的兑换码会被跳过。`}
                onConfirm={handleBatchDelete}
                okText="确定删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={batchDeleteLoading}
                  style={{ borderRadius: 8 }}
                >
                  批量删除
                </Button>
              </Popconfirm>
              <Button
                type="link"
                onClick={() => setSelectedRowKeys([])}
              >
                取消选择
              </Button>
            </Space>
          </div>
        )}

        <div style={{ padding: 20 }}>
          <Table
            rowKey="id"
            rowSelection={rowSelection}
            columns={columns}
            dataSource={codes}
            loading={loading}
            pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          />
        </div>
      </Card>

      {/* 购买兑换码 Modal */}
      <Modal
        title="购买兑换码"
        open={purchaseModalVisible}
        onOk={handlePurchase}
        onCancel={() => {
          setPurchaseModalVisible(false)
          purchaseForm.resetFields()
          setPurchaseQuantity(1)
        }}
        confirmLoading={purchaseLoading}
        okText="确认购买并支付"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={purchaseForm}
          layout="vertical"
          initialValues={{ quantity: 1, payType: 'alipay' }}
        >
          <Form.Item
            name="planId"
            label="选择码包套餐"
            rules={[{ required: true, message: '请选择码包套餐' }]}
          >
            <Select
              placeholder="请选择码包"
              onChange={(value) => setSelectedPlanId(value)}
              value={selectedPlanId}
            >
              {codePlans.map((plan) => (
                <Select.Option key={plan.id} value={plan.id}>
                  {plan.name} - {plan.code_count}个兑换码 - ¥{(plan.price / 100).toFixed(2)}
                  {plan.is_recommended && ' 🔥推荐'}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {selectedPlan && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: '#666' }}>
                <div>• 包含 {selectedPlan.code_count} 个兑换码</div>
                <div>• 每个码可用 {selectedPlan.code_max_uses} 次</div>
                <div>• 有效期 {selectedPlan.validity_days} 天</div>
                {selectedPlan.description && <div>• {selectedPlan.description}</div>}
              </div>
            </div>
          )}

          <Form.Item
            name="quantity"
            label="购买份数"
            rules={[{ required: true, message: '请输入购买份数' }]}
          >
            <InputNumber
              min={1}
              max={100}
              style={{ width: '100%' }}
              value={purchaseQuantity}
              onChange={(value) => setPurchaseQuantity(value || 1)}
            />
          </Form.Item>

          <Form.Item label="支付方式">
            <Radio.Group
              onChange={(e) => setPayType(e.target.value)}
              value={payType}
            >
              <Radio.Button value="alipay">支付宝</Radio.Button>
              <Radio.Button value="wxpay">微信支付</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <div style={{
            fontSize: 16,
            fontWeight: 'bold',
            padding: '16px 0',
            borderTop: '1px solid #f0f0f0',
            marginTop: 8
          }}>
            <span>总计: </span>
            <span style={{ color: '#ff4d4f', fontSize: 24 }}>¥{totalPrice}</span>
            {selectedPlan && (
              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>
                ({selectedPlan.code_count * purchaseQuantity} 个兑换码)
              </span>
            )}
          </div>
        </Form>
      </Modal>
    </div>
  )
}

// 分销商兑换码管理
import { useState, useEffect, useCallback } from 'react'
import {
  Table, Button, message, Popconfirm, Badge, Space, Tooltip, Typography, Card,
  Modal, Form, InputNumber, Select, Radio, Input, Alert
} from 'antd'
import { DeleteOutlined, CopyOutlined, LinkOutlined, ShoppingCartOutlined, SettingOutlined } from '@ant-design/icons'
import type { TableRowSelection } from 'antd/es/table/interface'
import { redeemApi, distributorApi } from '../../api'
import { useStore } from '../../store'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// 安全清理域名前缀（防止 XSS 和无效字符）
const sanitizePrefix = (prefix: string): string => {
  if (!prefix || typeof prefix !== 'string') return ''
  // 只保留小写字母、数字和连字符，限制长度
  return prefix.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20)
}

// 验证前缀是否有效
const isValidPrefix = (prefix: string): boolean => {
  const prefixRegex = /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/
  const reserved = ['www', 'api', 'admin', 'mail', 'smtp', 'ftp', 'mmw-team', 'backend', 'console']
  return prefixRegex.test(prefix) && !reserved.includes(prefix)
}

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
  const { user } = useStore()

  // 自定义域名前缀（从 localStorage 读取，带安全清理）
  const getDefaultPrefix = useCallback(() => {
    const stored = localStorage.getItem(`distributor_prefix_${user?.id}`)
    const sanitized = sanitizePrefix(stored || '')
    return sanitized && isValidPrefix(sanitized) ? sanitized : `distributor-${user?.id || ''}`
  }, [user?.id])

  const [customPrefix, setCustomPrefix] = useState<string>(getDefaultPrefix)

  // 当 user 变化时更新前缀
  useEffect(() => {
    setCustomPrefix(getDefaultPrefix())
  }, [getDefaultPrefix])
  const [prefixModalVisible, setPrefixModalVisible] = useState(false)
  const [prefixForm] = Form.useForm()

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
      const res = await redeemApi.list() as any
      setCodes(res.codes || [])
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

  // 获取邀请链接（使用分销商白标域名）
  const getInviteUrl = (code: string, useWhiteLabel: boolean = true) => {
    if (useWhiteLabel) {
      // 白标链接（使用自定义前缀）
      return `https://${customPrefix}.zenscaleai.com/invite/${code}`
    } else {
      // 官方链接（显示价格）
      return `https://mmw-team.zenscaleai.com/invite/${code}`
    }
  }

  // 保存自定义前缀
  const handleSavePrefix = async () => {
    const values = await prefixForm.validateFields()
    const prefix = values.prefix.trim().toLowerCase()

    // 前端验证
    const prefixRegex = /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/
    if (!prefixRegex.test(prefix)) {
      message.error('前缀只能包含小写字母、数字和连字符，3-20个字符')
      return
    }

    // 保留词检查
    const reserved = ['www', 'api', 'admin', 'mail', 'smtp', 'ftp', 'mmw-team', 'backend', 'console']
    if (reserved.includes(prefix)) {
      message.error('该前缀为保留词，请使用其他前缀')
      return
    }

    // 保存到 localStorage
    if (user?.id) {
      localStorage.setItem(`distributor_prefix_${user.id}`, prefix)
      setCustomPrefix(prefix)
      message.success('域名前缀已保存')
      setPrefixModalVisible(false)
    }
  }

  // 复制单个兑换码（带错误处理）
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      message.success('已复制兑换码')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 复制链接（带选择和错误处理）
  const copyLink = async (code: string, useWhiteLabel: boolean = true) => {
    try {
      const url = getInviteUrl(code, useWhiteLabel)
      await navigator.clipboard.writeText(url)
      message.success(`已复制${useWhiteLabel ? '白标' : '官方'}链接`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 批量复制链接（带选择和错误处理）
  const handleBatchCopyLinks = async (useWhiteLabel: boolean = true) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要复制的兑换码')
      return
    }

    try {
      const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
      const links = selectedCodes.map(c => getInviteUrl(c.code, useWhiteLabel)).join('\n')
      await navigator.clipboard.writeText(links)
      message.success(`已复制 ${selectedCodes.length} 个${useWhiteLabel ? '白标' : '官方'}链接`)
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  // 批量复制兑换码（带错误处理）
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

    // 检查是否有已使用的兑换码
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

      // 安全打开支付窗口
      window.open(res.pay_url, '_blank', 'noopener,noreferrer')
      message.success('订单已创建，请在新窗口中完成支付')
      setPurchaseModalVisible(false)
      purchaseForm.resetFields()

      // 5秒后刷新列表
      setTimeout(() => {
        fetchCodes()
      }, 5000)
    } catch (error) {
      // 错误已在 interceptor 中处理
    } finally {
      setPurchaseLoading(false)
    }
  }

  // 计算总价
  const selectedPlan = codePlans.find(p => p.id === selectedPlanId)
  const totalPrice = selectedPlan ? (selectedPlan.price * purchaseQuantity / 100).toFixed(2) : '0.00'

  // 表格多选配置
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
                style={{ color: '#1890ff', padding: 0, height: 'auto' }}
              />
            </Tooltip>
          </Space>
          <Space size={4}>
            <Tooltip title="复制白标链接（隐藏价格）">
              <Button
                type="text"
                size="small"
                onClick={() => copyLink(text, true)}
                aria-label="复制白标链接"
                style={{ color: '#52c41a', fontSize: 12, padding: 0, height: 'auto' }}
              >
                <LinkOutlined /> 白标链接
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
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => {
                prefixForm.setFieldsValue({ prefix: customPrefix })
                setPrefixModalVisible(true)
              }}
              style={{ borderRadius: 8 }}
            >
              设置域名前缀
            </Button>
            <Button
              type="primary"
              icon={<ShoppingCartOutlined />}
              onClick={showPurchaseModal}
              style={{ borderRadius: 8, background: '#007aff', border: 'none' }}
            >
              购买兑换码
            </Button>
          </Space>
        </div>
      </div>

      {/* 当前使用的域名前缀提示 */}
      <Card
        style={{
          marginBottom: 20,
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        }}
        bodyStyle={{ padding: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 2 }}>当前白标域名</div>
              <code style={{ color: '#5ac8fa', fontSize: 14, fontFamily: 'Monaco, monospace' }}>
                https://{customPrefix}.zenscaleai.com
              </code>
            </div>
          </div>
          <Button
            type="primary"
            ghost
            size="small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`https://${customPrefix}.zenscaleai.com`)
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

      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* 批量操作栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            margin: 20,
            padding: '14px 20px',
            background: 'linear-gradient(135deg, #007aff10 0%, #5ac8fa10 100%)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <Text>
              已选择 <Text strong style={{ color: '#007aff' }}>{selectedRowKeys.length}</Text> 项
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
                批量复制白标链接
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

      {/* 设置域名前缀 Modal */}
      <Modal
        title="设置域名前缀"
        open={prefixModalVisible}
        onOk={handleSavePrefix}
        onCancel={() => {
          setPrefixModalVisible(false)
          prefixForm.resetFields()
        }}
        okText="保存"
        cancelText="取消"
      >
        <Alert
          message="设置说明"
          description="设置您的专属域名前缀，客户访问此域名时将看不到平台的购买功能和价格。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={prefixForm}
          layout="vertical"
        >
          <Form.Item
            name="prefix"
            label="域名前缀"
            rules={[
              { required: true, message: '请输入域名前缀' },
              { min: 3, message: '前缀至少3个字符' },
              { max: 20, message: '前缀最多20个字符' },
              { pattern: /^[a-z0-9-]+$/, message: '只能包含小写字母、数字和连字符' }
            ]}
            extra="只能包含小写字母、数字和连字符，3-20个字符"
          >
            <Input
              placeholder="例如：vip, abc, dealer"
              addonAfter=".zenscaleai.com"
            />
          </Form.Item>

          <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              实时预览：
            </Text>
            <div style={{ marginTop: 8 }}>
              <Text code>
                https://{prefixForm.getFieldValue('prefix') || customPrefix}.zenscaleai.com
              </Text>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

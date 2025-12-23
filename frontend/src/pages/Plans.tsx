import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Switch, Tooltip, Select, Alert } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, StarFilled } from '@ant-design/icons'
import { planApi } from '../api'
import { formatDate } from '../utils/date'

interface Plan {
  id: number
  name: string
  plan_type?: string  // 套餐类型
  price: number
  original_price?: number
  validity_days: number
  code_count?: number  // 码包数量
  code_max_uses?: number  // 每码可用次数
  description?: string
  features?: string
  is_active: boolean
  is_recommended: boolean
  sort_order: number
  created_at: string
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [planType, setPlanType] = useState<string>('public')  // 监控套餐类型变化

  const fetchPlans = async () => {
    setLoading(true)
    try {
      const res: any = await planApi.list()
      setPlans(res.plans || res || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlans()
  }, [])

  const handleCreate = () => {
    setEditingPlan(null)
    form.resetFields()
    const defaultValues = {
      plan_type: 'public',
      validity_days: 30,
      code_count: 1,
      code_max_uses: 1,
      sort_order: 0,
      is_active: true,
      is_recommended: false
    }
    form.setFieldsValue(defaultValues)
    setPlanType('public')
    setModalOpen(true)
  }

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan)
    const planTypeValue = plan.plan_type || 'public'
    setPlanType(planTypeValue)
    form.setFieldsValue({
      ...plan,
      price: plan.price / 100,
      original_price: plan.original_price ? plan.original_price / 100 : undefined,
      plan_type: planTypeValue,
      code_count: plan.code_count || 1,
      code_max_uses: plan.code_max_uses || 1,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const data = {
        ...values,
        price: Math.round(values.price * 100),
        original_price: values.original_price ? Math.round(values.original_price * 100) : null,
      }

      if (editingPlan) {
        await planApi.update(editingPlan.id, data)
        message.success('更新成功')
      } else {
        await planApi.create(data)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchPlans()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    await planApi.delete(id)
    message.success('删除成功')
    fetchPlans()
  }

  const handleToggle = async (id: number) => {
    const res: any = await planApi.toggle(id)
    message.success(res.message || '状态已切换')
    fetchPlans()
  }

  const columns = [
    {
      title: '套餐名称',
      dataIndex: 'name',
      render: (v: string, r: Plan) => (
        <Space>
          <span style={{ fontWeight: 500 }}>{v}</span>
          {r.is_recommended && <Tag color="gold" icon={<StarFilled />}>推荐</Tag>}
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'plan_type',
      width: 150,
      render: (v: string) => {
        if (v === 'distributor_codes') {
          return <Tag color="purple">分销商码包</Tag>
        }
        return <Tag color="blue">公开套餐</Tag>
      }
    },
    {
      title: '价格',
      dataIndex: 'price',
      width: 120,
      render: (v: number, r: Plan) => (
        <div>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#f5222d' }}>¥{(v / 100).toFixed(2)}</span>
          {r.original_price && (
            <span style={{ marginLeft: 8, color: '#86868b', textDecoration: 'line-through', fontSize: 13 }}>
              ¥{(r.original_price / 100).toFixed(2)}
            </span>
          )}
        </div>
      )
    },
    {
      title: '码包信息',
      width: 150,
      render: (_: any, r: Plan) => {
        if (r.plan_type === 'distributor_codes') {
          return (
            <div style={{ fontSize: 13 }}>
              <div>{r.code_count || 1} 个兑换码</div>
              <div style={{ color: '#999' }}>每码 {r.code_max_uses || 1} 次</div>
            </div>
          )
        }
        return <span style={{ color: '#999' }}>-</span>
      }
    },
    {
      title: '有效天数',
      dataIndex: 'validity_days',
      width: 100,
      render: (v: number) => <span>{v} 天</span>
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string) => <span style={{ color: '#64748b' }}>{v || '-'}</span>
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      render: (v: number) => <span style={{ color: '#86868b' }}>{v}</span>
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '上架' : '下架'}</Tag>
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 140,
      render: (v: string) => <span style={{ color: '#64748b', fontSize: 13 }}>{formatDate(v, 'YYYY-MM-DD HH:mm')}</span>
    },
    {
      title: '操作',
      width: 140,
      render: (_: any, r: Plan) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(r)} />
          </Tooltip>
          <Tooltip title={r.is_active ? '下架' : '上架'}>
            <Switch size="small" checked={r.is_active} onChange={() => handleToggle(r.id)} />
          </Tooltip>
          <Popconfirm title="确定删除此套餐？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Tooltip title="删除">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>套餐管理</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>管理网站销售的套餐，设置价格和有效期</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} size="large" style={{ borderRadius: 12, height: 44 }}>
          新建套餐
        </Button>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={plans}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingPlan ? '编辑套餐' : '新建套餐'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={520}
        okText={editingPlan ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="plan_type" label="套餐类型" rules={[{ required: true }]}>
            <Select onChange={(value) => setPlanType(value)}>
              <Select.Option value="public">公开套餐（终端用户购买）</Select.Option>
              <Select.Option value="distributor_codes">分销商码包（分销商批量购买）</Select.Option>
            </Select>
          </Form.Item>

          {planType === 'distributor_codes' && (
            <Alert
              message="分销商码包说明"
              description="分销商码包用于分销商批量采购兑换码。购买后会自动生成指定数量的兑换码。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item name="name" label="套餐名称" rules={[{ required: true, message: '请输入套餐名称' }]}>
            <Input placeholder={planType === 'distributor_codes' ? '如：100个兑换码套餐' : '如：月卡、季卡、年卡'} />
          </Form.Item>

          {planType === 'distributor_codes' && (
            <Space size="middle" style={{ display: 'flex' }}>
              <Form.Item
                name="code_count"
                label="码包数量"
                rules={[{ required: true, message: '请输入码包数量' }]}
                tooltip="一个码包包含多少个兑换码"
                style={{ flex: 1 }}
              >
                <InputNumber min={1} max={1000} placeholder="100" style={{ width: '100%' }} addonAfter="个" />
              </Form.Item>
              <Form.Item
                name="code_max_uses"
                label="每码可用次数"
                rules={[{ required: true, message: '请输入可用次数' }]}
                tooltip="每个兑换码可以使用多少次"
                style={{ flex: 1 }}
              >
                <InputNumber min={1} max={999} placeholder="1" style={{ width: '100%' }} addonAfter="次" />
              </Form.Item>
            </Space>
          )}

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="price" label="售价（元）" rules={[{ required: true, message: '请输入价格' }]} style={{ flex: 1 }}>
              <InputNumber min={0.01} precision={2} placeholder="0.00" style={{ width: '100%' }} prefix="¥" />
            </Form.Item>
            <Form.Item name="original_price" label="原价（元）" style={{ flex: 1 }}>
              <InputNumber min={0} precision={2} placeholder="划线价（选填）" style={{ width: '100%' }} prefix="¥" />
            </Form.Item>
          </Space>
          <Form.Item name="validity_days" label="有效天数" rules={[{ required: true, message: '请输入有效天数' }]}>
            <InputNumber min={1} max={3650} placeholder="30" style={{ width: '100%' }} addonAfter="天" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="简短描述套餐特点（选填）" />
          </Form.Item>
          <Form.Item name="features" label="特性列表" extra="每行一个特性，用于展示">
            <Input.TextArea rows={3} placeholder="特性1&#10;特性2&#10;特性3" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="sort_order" label="排序" style={{ marginBottom: 0 }}>
              <InputNumber min={0} max={999} placeholder="0" style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="is_active" label="上架状态" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch checkedChildren="上架" unCheckedChildren="下架" />
            </Form.Item>
            <Form.Item name="is_recommended" label="推荐" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}

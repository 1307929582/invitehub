import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Switch, Tooltip } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, StarFilled } from '@ant-design/icons'
import { planApi } from '../api'
import { formatDate } from '../utils/date'

interface Plan {
  id: number
  name: string
  price: number
  original_price?: number
  validity_days: number
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

  const fetchPlans = async () => {
    setLoading(true)
    try {
      const res: any = await planApi.list()
      setPlans(res)
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
    form.setFieldsValue({ validity_days: 30, sort_order: 0, is_active: true, is_recommended: false })
    setModalOpen(true)
  }

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan)
    form.setFieldsValue({
      ...plan,
      price: plan.price / 100,
      original_price: plan.original_price ? plan.original_price / 100 : undefined,
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
          <Form.Item name="name" label="套餐名称" rules={[{ required: true, message: '请输入套餐名称' }]}>
            <Input placeholder="如：月卡、季卡、年卡" />
          </Form.Item>
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

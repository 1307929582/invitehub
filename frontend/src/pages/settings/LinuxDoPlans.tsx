import { useEffect, useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, InputNumber, Switch, message, Spin, Space, Tag, Popconfirm, Progress } from 'antd'
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { planApi } from '../../api'

interface Plan {
  id: number
  name: string
  plan_type: string
  price: number
  original_price?: number
  validity_days: number
  stock?: number | null
  sold_count: number
  remaining_stock?: number | null
  description?: string
  features?: string
  is_active: boolean
  is_recommended: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export default function LinuxDoPlans() {
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()

  const loadPlans = async () => {
    setLoading(true)
    try {
      const res: any = await planApi.list({ plan_type: 'linuxdo' })
      setPlans(res.plans || [])
    } catch {
      message.error('加载套餐列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPlans()
  }, [])

  const handleCreate = () => {
    setEditingPlan(null)
    form.resetFields()
    form.setFieldsValue({
      is_active: true,
      is_recommended: false,
      validity_days: 30,
      sort_order: 0,
    })
    setModalVisible(true)
  }

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan)
    form.setFieldsValue({
      name: plan.name,
      price: plan.price / 100,
      original_price: plan.original_price ? plan.original_price / 100 : undefined,
      validity_days: plan.validity_days,
      stock: plan.stock,
      description: plan.description,
      features: plan.features,
      is_active: plan.is_active,
      is_recommended: plan.is_recommended,
      sort_order: plan.sort_order,
    })
    setModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      const data = {
        name: values.name,
        plan_type: 'linuxdo',
        price: Math.round(values.price * 100),
        original_price: values.original_price ? Math.round(values.original_price * 100) : undefined,
        validity_days: values.validity_days,
        stock: values.stock || undefined,
        description: values.description,
        features: values.features,
        is_active: values.is_active,
        is_recommended: values.is_recommended,
        sort_order: values.sort_order || 0,
      }

      if (editingPlan) {
        await planApi.update(editingPlan.id, data)
        message.success('套餐已更新')
      } else {
        await planApi.create(data)
        message.success('套餐已创建')
      }

      setModalVisible(false)
      loadPlans()
    } catch (error: any) {
      if (error.response?.data?.detail) {
        message.error(error.response.data.detail)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await planApi.delete(id)
      message.success('套餐已删除')
      loadPlans()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败')
    }
  }

  const handleToggle = async (id: number) => {
    try {
      await planApi.toggle(id)
      loadPlans()
    } catch {
      message.error('操作失败')
    }
  }

  const columns = [
    {
      title: '套餐名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Plan) => (
        <Space>
          {name}
          {record.is_recommended && <Tag color="blue">推荐</Tag>}
        </Space>
      ),
    },
    {
      title: 'L 币价格',
      dataIndex: 'price',
      key: 'price',
      render: (price: number, record: Plan) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600, color: '#0066FF' }}>{(price / 100).toFixed(2)} L</span>
          {record.original_price && (
            <span style={{ textDecoration: 'line-through', color: '#999', fontSize: 12 }}>
              {(record.original_price / 100).toFixed(2)} L
            </span>
          )}
        </Space>
      ),
    },
    {
      title: '有效期',
      dataIndex: 'validity_days',
      key: 'validity_days',
      render: (days: number) => `${days} 天`,
    },
    {
      title: '库存',
      key: 'stock',
      render: (_: any, record: Plan) => {
        if (record.stock === null || record.stock === undefined) {
          return <Tag>无限</Tag>
        }
        const remaining = record.remaining_stock ?? 0
        const percent = Math.round((remaining / record.stock) * 100)
        const status = percent > 30 ? 'success' : percent > 10 ? 'normal' : 'exception'
        return (
          <Space direction="vertical" size={0} style={{ width: 100 }}>
            <span style={{ fontSize: 12 }}>{remaining} / {record.stock}</span>
            <Progress percent={percent} size="small" status={status} showInfo={false} />
          </Space>
        )
      },
    },
    {
      title: '已售',
      dataIndex: 'sold_count',
      key: 'sold_count',
      render: (count: number) => count || 0,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        active
          ? <Tag icon={<CheckCircleOutlined />} color="success">上架</Tag>
          : <Tag icon={<CloseCircleOutlined />} color="default">下架</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Plan) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button size="small" onClick={() => handleToggle(record.id)}>
            {record.is_active ? '下架' : '上架'}
          </Button>
          <Popconfirm
            title="确定要删除此套餐吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/admin/settings/linuxdo')}
          style={{ marginBottom: 8 }}
        >
          返回 LinuxDo 设置
        </Button>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>LinuxDo 套餐管理</h2>
        <p style={{ color: '#64748b', margin: '8px 0 0' }}>
          管理 LinuxDo L 币兑换专属套餐（plan_type = linuxdo）
        </p>
      </div>

      <Card
        title={`LinuxDo 套餐列表 (${plans.length})`}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建套餐
          </Button>
        }
      >
        <Table
          dataSource={plans}
          columns={columns}
          rowKey="id"
          pagination={false}
        />
      </Card>

      <Modal
        title={editingPlan ? '编辑套餐' : '新建 LinuxDo 套餐'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        confirmLoading={saving}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="套餐名称"
            rules={[{ required: true, message: '请输入套餐名称' }]}
          >
            <Input placeholder="如：月卡、季卡、年卡" />
          </Form.Item>

          <Form.Item label="价格设置" required style={{ marginBottom: 0 }}>
            <Space>
              <Form.Item
                name="price"
                rules={[{ required: true, message: '请输入价格' }]}
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="L 币价格"
                  addonAfter="L 币"
                  style={{ width: 150 }}
                />
              </Form.Item>
              <Form.Item name="original_price" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="原价（可选）"
                  addonAfter="L 币"
                  style={{ width: 150 }}
                />
              </Form.Item>
            </Space>
          </Form.Item>

          <Form.Item
            name="validity_days"
            label="有效天数"
            rules={[{ required: true, message: '请输入有效天数' }]}
          >
            <InputNumber min={1} max={3650} placeholder="30" addonAfter="天" style={{ width: 150 }} />
          </Form.Item>

          <Form.Item
            name="stock"
            label="库存数量"
            extra="留空表示无限库存"
          >
            <InputNumber min={1} placeholder="无限" addonAfter="份" style={{ width: 150 }} />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="套餐描述（显示在套餐卡片上）" />
          </Form.Item>

          <Form.Item
            name="features"
            label="特性列表"
            extra="多个特性用英文逗号分隔，如：GPT-5 无限制,自助换车,优先支持"
          >
            <Input placeholder="GPT-5 无限制,自助换车,优先支持" />
          </Form.Item>

          <Form.Item label="其他设置" style={{ marginBottom: 0 }}>
            <Space size="large">
              <Form.Item name="is_active" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch checkedChildren="上架" unCheckedChildren="下架" />
              </Form.Item>
              <Form.Item name="is_recommended" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch checkedChildren="推荐" unCheckedChildren="普通" />
              </Form.Item>
              <Form.Item name="sort_order" style={{ marginBottom: 0 }}>
                <InputNumber min={0} placeholder="排序" addonBefore="排序" style={{ width: 120 }} />
              </Form.Item>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

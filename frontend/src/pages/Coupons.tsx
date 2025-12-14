import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Switch, Tooltip, Select, DatePicker, Badge, Typography, Row, Col } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, GiftOutlined, CheckCircleFilled } from '@ant-design/icons'
import { couponApi, planApi } from '../api'
import { formatDate } from '../utils/date'
import dayjs from 'dayjs'

const { Text } = Typography
const { RangePicker } = DatePicker

interface Coupon {
  id: number
  code: string
  discount_type: 'fixed' | 'percentage'
  discount_value: number
  min_amount: number
  max_discount?: number
  max_uses: number
  used_count: number
  valid_from?: string
  valid_until?: string
  applicable_plan_ids?: number[]
  is_active: boolean
  note?: string
  created_by?: number
  created_at: string
}

interface Plan {
  id: number
  name: string
  price: number
  is_active: boolean
}

export default function Coupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  // 批量生成模式
  const [batchMode, setBatchMode] = useState(false)

  const fetchCoupons = async () => {
    setLoading(true)
    try {
      const res: any = await couponApi.list({ page, page_size: pageSize })
      setCoupons(res.coupons || [])
      setTotal(res.total || 0)
    } finally {
      setLoading(false)
    }
  }

  const fetchPlans = async () => {
    try {
      const res: any = await planApi.list()
      setPlans(res || [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchCoupons()
    fetchPlans()
  }, [page, pageSize])

  const handleCreate = (batch = false) => {
    setEditingCoupon(null)
    setBatchMode(batch)
    form.resetFields()
    form.setFieldsValue({
      discount_type: 'fixed',
      count: batch ? 10 : 1,
      max_uses: 1,
      min_amount: 0,
    })
    setModalOpen(true)
  }

  const handleEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon)
    setBatchMode(false)
    form.setFieldsValue({
      ...coupon,
      discount_value: coupon.discount_type === 'fixed' ? coupon.discount_value / 100 : coupon.discount_value,
      min_amount: (coupon.min_amount || 0) / 100,
      max_discount: coupon.max_discount ? coupon.max_discount / 100 : undefined,
      valid_range: coupon.valid_from || coupon.valid_until
        ? [coupon.valid_from ? dayjs(coupon.valid_from) : null, coupon.valid_until ? dayjs(coupon.valid_until) : null]
        : undefined,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const isFixed = values.discount_type === 'fixed'
      const data: any = {
        discount_type: values.discount_type,
        discount_value: isFixed ? Math.round(values.discount_value * 100) : values.discount_value,
        min_amount: Math.round((values.min_amount || 0) * 100),
        max_uses: values.max_uses || 0,
        note: values.note,
        applicable_plan_ids: values.applicable_plan_ids?.length ? values.applicable_plan_ids : null,
      }

      // 百分比折扣时的最大优惠
      if (!isFixed && values.max_discount) {
        data.max_discount = Math.round(values.max_discount * 100)
      }

      // 有效期
      if (values.valid_range?.[0]) {
        data.valid_from = values.valid_range[0].startOf('day').toISOString()
      }
      if (values.valid_range?.[1]) {
        data.valid_until = values.valid_range[1].endOf('day').toISOString()
      }

      if (editingCoupon) {
        // 更新
        if (values.is_active !== undefined) {
          data.is_active = values.is_active
        }
        await couponApi.update(editingCoupon.id, data)
        message.success('更新成功')
      } else {
        // 创建
        if (batchMode) {
          data.prefix = values.prefix || ''
          data.count = values.count || 10
        } else {
          data.code = values.code?.trim().toUpperCase()
          data.count = 1
        }
        const res: any = await couponApi.create(data)
        message.success(`成功创建 ${res.count} 个优惠码`)

        // 如果只创建一个，复制到剪贴板
        if (res.created?.length === 1) {
          navigator.clipboard.writeText(res.created[0])
          message.info({ content: `优惠码已复制：${res.created[0]}`, icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> })
        }
      }
      setModalOpen(false)
      fetchCoupons()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    await couponApi.delete(id)
    message.success('删除成功')
    fetchCoupons()
  }

  const handleToggle = async (id: number) => {
    const res: any = await couponApi.toggle(id)
    message.success(res.message || '状态已切换')
    fetchCoupons()
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    message.success({ content: '已复制', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> })
  }

  const discountType = Form.useWatch('discount_type', form)

  const columns = [
    {
      title: '优惠码',
      dataIndex: 'code',
      width: 180,
      render: (v: string) => (
        <Space>
          <Text code copyable={{ onCopy: () => handleCopy(v) }} style={{ fontSize: 13, fontWeight: 600 }}>{v}</Text>
        </Space>
      )
    },
    {
      title: '折扣',
      width: 140,
      render: (_: any, r: Coupon) => {
        if (r.discount_type === 'fixed') {
          return <Text strong style={{ color: '#f5222d' }}>减 ¥{(r.discount_value / 100).toFixed(2)}</Text>
        }
        return (
          <Space direction="vertical" size={0}>
            <Text strong style={{ color: '#f5222d' }}>{r.discount_value}% 折扣</Text>
            {r.max_discount && (
              <Text type="secondary" style={{ fontSize: 12 }}>最多减 ¥{(r.max_discount / 100).toFixed(2)}</Text>
            )}
          </Space>
        )
      }
    },
    {
      title: '最低消费',
      dataIndex: 'min_amount',
      width: 100,
      render: (v: number) => v > 0 ? <Text type="secondary">满 ¥{(v / 100).toFixed(2)}</Text> : <Text type="secondary">无门槛</Text>
    },
    {
      title: '使用次数',
      width: 100,
      render: (_: any, r: Coupon) => (
        <Badge
          count={r.max_uses > 0 ? `${r.used_count}/${r.max_uses}` : `${r.used_count}/∞`}
          showZero
          style={{
            backgroundColor: r.max_uses > 0 && r.used_count >= r.max_uses ? '#ff4d4f' : '#52c41a',
            fontSize: 12,
          }}
        />
      )
    },
    {
      title: '有效期',
      width: 180,
      render: (_: any, r: Coupon) => {
        const now = new Date()
        const from = r.valid_from ? new Date(r.valid_from) : null
        const until = r.valid_until ? new Date(r.valid_until) : null

        if (!from && !until) return <Text type="secondary">永久有效</Text>

        const isExpired = until && until < now
        const notStarted = from && from > now

        return (
          <Space direction="vertical" size={0}>
            {notStarted && <Tag color="orange">未生效</Tag>}
            {isExpired && <Tag color="red">已过期</Tag>}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {from ? formatDate(r.valid_from!, 'MM-DD HH:mm') : '开始'} ~{' '}
              {until ? formatDate(r.valid_until!, 'MM-DD HH:mm') : '永久'}
            </Text>
          </Space>
        )
      }
    },
    {
      title: '适用套餐',
      width: 120,
      render: (_: any, r: Coupon) => {
        if (!r.applicable_plan_ids?.length) return <Tag>全部套餐</Tag>
        const names = r.applicable_plan_ids
          .map(id => plans.find(p => p.id === id)?.name)
          .filter(Boolean)
        return (
          <Tooltip title={names.join('、')}>
            <Tag color="blue">{names.length} 个套餐</Tag>
          </Tooltip>
        )
      }
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 13 }}>{v || '-'}</Text>
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>
    },
    {
      title: '操作',
      width: 130,
      render: (_: any, r: Coupon) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(r)} />
          </Tooltip>
          <Tooltip title={r.is_active ? '停用' : '启用'}>
            <Switch size="small" checked={r.is_active} onChange={() => handleToggle(r.id)} />
          </Tooltip>
          <Popconfirm title="确定删除此优惠码？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Tooltip title="删除">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={r.used_count > 0} />
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
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>
            <GiftOutlined style={{ marginRight: 12, color: '#eb2f96' }} />
            优惠码管理
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>创建和管理优惠码，支持固定金额和百分比折扣</p>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => handleCreate(true)} size="large" style={{ borderRadius: 12, height: 44 }}>
            批量生成
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => handleCreate(false)} size="large" style={{ borderRadius: 12, height: 44 }}>
            新建优惠码
          </Button>
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={coupons}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
          }}
        />
      </Card>

      <Modal
        title={
          editingCoupon ? '编辑优惠码' :
          batchMode ? '批量生成优惠码' : '新建优惠码'
        }
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={560}
        okText={editingCoupon ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {/* 优惠码 / 批量前缀 */}
          {!editingCoupon && (
            batchMode ? (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="prefix" label="优惠码前缀" extra="如 SUMMER → SUMMER-XXXXXX">
                    <Input placeholder="SUMMER（选填）" style={{ textTransform: 'uppercase' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="count" label="生成数量" rules={[{ required: true }]}>
                    <InputNumber min={1} max={100} placeholder="10" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            ) : (
              <Form.Item name="code" label="优惠码" extra="留空自动生成">
                <Input placeholder="WELCOME2024（选填）" style={{ textTransform: 'uppercase' }} maxLength={30} />
              </Form.Item>
            )
          )}

          {/* 折扣类型和值 */}
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="discount_type" label="折扣类型" rules={[{ required: true }]}>
                <Select disabled={!!editingCoupon}>
                  <Select.Option value="fixed">固定金额</Select.Option>
                  <Select.Option value="percentage">百分比</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="discount_value"
                label={discountType === 'percentage' ? '折扣比例' : '优惠金额'}
                rules={[{ required: true, message: '请输入折扣值' }]}
              >
                <InputNumber
                  min={discountType === 'percentage' ? 1 : 0.01}
                  max={discountType === 'percentage' ? 100 : 99999}
                  precision={discountType === 'percentage' ? 0 : 2}
                  placeholder={discountType === 'percentage' ? '20' : '10.00'}
                  style={{ width: '100%' }}
                  addonAfter={discountType === 'percentage' ? '%' : '元'}
                />
              </Form.Item>
            </Col>
            {discountType === 'percentage' && (
              <Col span={8}>
                <Form.Item name="max_discount" label="最大优惠" extra="百分比时限制">
                  <InputNumber min={0} precision={2} placeholder="50.00" style={{ width: '100%' }} addonAfter="元" />
                </Form.Item>
              </Col>
            )}
          </Row>

          {/* 使用条件 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="min_amount" label="最低消费" extra="0 为无门槛">
                <InputNumber min={0} precision={2} placeholder="0" style={{ width: '100%' }} prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_uses" label="使用次数上限" extra="0 为不限">
                <InputNumber min={0} max={999999} placeholder="0" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* 有效期 */}
          <Form.Item name="valid_range" label="有效期" extra="不设置则永久有效">
            <RangePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder={['开始时间', '结束时间']}
              style={{ width: '100%' }}
            />
          </Form.Item>

          {/* 适用套餐 */}
          <Form.Item name="applicable_plan_ids" label="适用套餐" extra="不选择则适用全部套餐">
            <Select
              mode="multiple"
              placeholder="选择套餐（可多选）"
              allowClear
              options={plans.map(p => ({ label: `${p.name} (¥${(p.price / 100).toFixed(2)})`, value: p.id }))}
            />
          </Form.Item>

          {/* 备注 */}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="内部备注，用户不可见" maxLength={255} showCount />
          </Form.Item>

          {/* 编辑时显示状态开关 */}
          {editingCoupon && (
            <Form.Item name="is_active" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}

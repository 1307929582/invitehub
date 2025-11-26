import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Tooltip, Radio } from 'antd'
import { PlusOutlined, DeleteOutlined, CopyOutlined, StopOutlined, CheckOutlined, LinkOutlined } from '@ant-design/icons'
import { redeemApi } from '../api'
import dayjs from 'dayjs'

interface DirectCode {
  id: number
  code: string
  code_type: string
  max_uses: number
  used_count: number
  expires_at?: string
  is_active: boolean
  note?: string
  created_at: string
}

type FilterType = 'all' | 'available' | 'used' | 'expired'

export default function DirectCodes() {
  const [codes, setCodes] = useState<DirectCode[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newCodes, setNewCodes] = useState<string[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [form] = Form.useForm()

  const fetchCodes = async () => {
    setLoading(true)
    try {
      const res: any = await redeemApi.list(undefined, undefined, 'direct')
      setCodes(res.codes)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCodes()
  }, [])

  // 根据筛选条件过滤
  const filteredCodes = codes.filter(code => {
    const isExpired = code.expires_at && dayjs(code.expires_at).isBefore(dayjs())
    const isUsedUp = code.used_count >= code.max_uses
    const isAvailable = code.is_active && !isExpired && !isUsedUp

    switch (filter) {
      case 'available':
        return isAvailable
      case 'used':
        return isUsedUp
      case 'expired':
        return isExpired
      default:
        return true
    }
  })

  // 统计数量
  const stats = {
    all: codes.length,
    available: codes.filter(c => c.is_active && !(c.expires_at && dayjs(c.expires_at).isBefore(dayjs())) && c.used_count < c.max_uses).length,
    used: codes.filter(c => c.used_count >= c.max_uses).length,
    expired: codes.filter(c => c.expires_at && dayjs(c.expires_at).isBefore(dayjs())).length,
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    setCreating(true)
    try {
      const res: any = await redeemApi.batchCreate({
        ...values,
        code_type: 'direct'
      })
      setNewCodes(res.codes)
      message.success(`成功创建 ${res.count} 个直接链接`)
      fetchCodes()
    } catch {
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    await redeemApi.delete(id)
    message.success('删除成功')
    fetchCodes()
  }

  const handleToggle = async (id: number) => {
    const res: any = await redeemApi.toggle(id)
    message.success(res.message)
    fetchCodes()
  }

  const getInviteUrl = (code: string) => {
    return `${window.location.origin}/invite/${code}`
  }

  const copyUrl = (code: string) => {
    navigator.clipboard.writeText(getInviteUrl(code))
    message.success('链接已复制')
  }

  const copyAllUrls = () => {
    const urls = newCodes.map(code => getInviteUrl(code)).join('\n')
    navigator.clipboard.writeText(urls)
    message.success('已复制全部链接')
  }

  const columns = [
    { 
      title: '邀请链接', 
      dataIndex: 'code', 
      render: (v: string) => (
        <Space>
          <a href={getInviteUrl(v)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            /invite/{v}
          </a>
          <Tooltip title="复制链接">
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyUrl(v)} />
          </Tooltip>
        </Space>
      )
    },
    { 
      title: '备注', 
      dataIndex: 'note', 
      width: 120,
      render: (v: string) => v || <span style={{ color: '#94a3b8' }}>-</span>
    },
    { 
      title: '使用情况', 
      width: 100,
      render: (_: any, r: DirectCode) => (
        <span style={{ color: r.used_count >= r.max_uses ? '#ef4444' : '#64748b' }}>
          {r.used_count} / {r.max_uses}
        </span>
      )
    },
    { 
      title: '过期时间', 
      dataIndex: 'expires_at', 
      width: 120,
      render: (v: string) => v ? (
        <span style={{ color: dayjs(v).isBefore(dayjs()) ? '#ef4444' : '#64748b', fontSize: 13 }}>
          {dayjs(v).format('MM-DD HH:mm')}
        </span>
      ) : <span style={{ color: '#94a3b8' }}>永不</span>
    },
    { 
      title: '状态', 
      dataIndex: 'is_active', 
      width: 80,
      render: (v: boolean, r: DirectCode) => {
        const expired = r.expires_at && dayjs(r.expires_at).isBefore(dayjs())
        const used = r.used_count >= r.max_uses
        if (expired) return <Tag color="default">已过期</Tag>
        if (used) return <Tag color="default">已用完</Tag>
        return <Tag color={v ? 'green' : 'default'}>{v ? '有效' : '禁用'}</Tag>
      }
    },
    {
      title: '操作', 
      width: 100,
      render: (_: any, r: DirectCode) => (
        <Space size={4}>
          <Tooltip title={r.is_active ? '禁用' : '启用'}>
            <Button size="small" type="text" icon={r.is_active ? <StopOutlined /> : <CheckOutlined />} onClick={() => handleToggle(r.id)} />
          </Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
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
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>直接邀请链接</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>无需登录，点击链接即可邀请</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setNewCodes([]); setModalOpen(true) }} size="large" style={{ borderRadius: 12, height: 44 }}>
          生成链接
        </Button>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Radio.Group value={filter} onChange={e => setFilter(e.target.value)} buttonStyle="solid">
            <Radio.Button value="all">全部 ({stats.all})</Radio.Button>
            <Radio.Button value="available">可用 ({stats.available})</Radio.Button>
            <Radio.Button value="used">已用完 ({stats.used})</Radio.Button>
            <Radio.Button value="expired">已过期 ({stats.expired})</Radio.Button>
          </Radio.Group>
        </div>
        <Table 
          dataSource={filteredCodes} 
          columns={columns} 
          rowKey="id" 
          loading={loading} 
          pagination={{ pageSize: 15, showTotal: total => `共 ${total} 个` }} 
        />
      </Card>

      <Modal 
        title="生成直接邀请链接" 
        open={modalOpen} 
        onOk={handleCreate} 
        onCancel={() => setModalOpen(false)} 
        width={520} 
        okText="生成" 
        cancelText="取消"
        confirmLoading={creating}
      >
        {newCodes.length > 0 ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 500 }}>已生成 {newCodes.length} 个邀请链接</span>
              <Button size="small" icon={<CopyOutlined />} onClick={copyAllUrls}>复制全部</Button>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, maxHeight: 300, overflow: 'auto' }}>
              {newCodes.map(code => (
                <div key={code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <a href={getInviteUrl(code)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                      <LinkOutlined style={{ marginRight: 6 }} />
                      {getInviteUrl(code)}
                    </a>
                  </div>
                  <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyUrl(code)} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Form form={form} layout="vertical" initialValues={{ count: 1, max_uses: 1 }}>
            <Form.Item name="count" label="生成数量" rules={[{ required: true }]}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_uses" label="每个链接可用次数" rules={[{ required: true }]} extra="建议设为 1，一人一链接">
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="expires_days" label="有效天数">
              <InputNumber min={1} placeholder="不填则永不过期" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input placeholder="如：发给张三、活动用" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}

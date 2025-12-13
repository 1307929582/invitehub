// 分销商兑换码管理
import { useState, useEffect, useCallback } from 'react'
import {
  Table, Button, Modal, Form, InputNumber, Input, message,
  Popconfirm, Badge, Space, Tooltip, Typography, Card
} from 'antd'
import { PlusOutlined, DeleteOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons'
import type { TableRowSelection } from 'antd/es/table/interface'
import { redeemApi } from '../../api'

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

export default function DistributorRedeemCodes() {
  const [codes, setCodes] = useState<RedeemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [form] = Form.useForm()

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

  const handleCreate = async (values: any) => {
    setCreateLoading(true)
    try {
      const res = await redeemApi.batchCreate({
        max_uses: values.max_uses,
        count: values.count,
        expires_days: values.expires_days || undefined,
        validity_days: values.validity_days,
        note: values.note || undefined,
        code_type: 'direct',
      }) as any
      message.success(`成功创建 ${res.count} 个兑换码`)
      setModalVisible(false)
      form.resetFields()
      fetchCodes()
    } catch (error) {
      // 错误已在 interceptor 中处理
    } finally {
      setCreateLoading(false)
    }
  }

  // 获取邀请链接
  const getInviteUrl = (code: string) => {
    const baseUrl = window.location.origin
    return `${baseUrl}/invite/${code}`
  }

  // 复制单个兑换码
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    message.success('已复制兑换码')
  }

  // 复制单个链接
  const copyLink = (code: string) => {
    const url = getInviteUrl(code)
    navigator.clipboard.writeText(url)
    message.success('已复制邀请链接')
  }

  // 批量复制链接
  const handleBatchCopyLinks = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要复制的兑换码')
      return
    }

    const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
    const links = selectedCodes.map(c => getInviteUrl(c.code)).join('\n')

    navigator.clipboard.writeText(links)
    message.success(`已复制 ${selectedCodes.length} 个邀请链接`)
  }

  // 批量复制兑换码
  const handleBatchCopyCodes = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要复制的兑换码')
      return
    }

    const selectedCodes = codes.filter(c => selectedRowKeys.includes(c.id))
    const codeTexts = selectedCodes.map(c => c.code).join('\n')

    navigator.clipboard.writeText(codeTexts)
    message.success(`已复制 ${selectedCodes.length} 个兑换码`)
  }

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
        <Space>
          <code style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
            {text}
          </code>
          <Tooltip title="复制兑换码">
            <CopyOutlined style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => copyCode(text)} />
          </Tooltip>
          <Tooltip title="复制邀请链接">
            <LinkOutlined style={{ cursor: 'pointer', color: '#52c41a' }} onClick={() => copyLink(text)} />
          </Tooltip>
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
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>兑换码管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          创建兑换码
        </Button>
      </div>

      <Card>
        {/* 批量操作栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            marginBottom: 16,
            padding: '12px 16px',
            background: '#f0f5ff',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Text>
              已选择 <Text strong style={{ color: '#1890ff' }}>{selectedRowKeys.length}</Text> 项
            </Text>
            <Space>
              <Button
                icon={<CopyOutlined />}
                onClick={handleBatchCopyCodes}
              >
                批量复制兑换码
              </Button>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={handleBatchCopyLinks}
              >
                批量复制邀请链接
              </Button>
              <Button
                type="link"
                onClick={() => setSelectedRowKeys([])}
              >
                取消选择
              </Button>
            </Space>
          </div>
        )}

        <Table
          rowKey="id"
          rowSelection={rowSelection}
          columns={columns}
          dataSource={codes}
          loading={loading}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      <Modal
        title="创建兑换码"
        open={modalVisible}
        onCancel={() => { setModalVisible(false); form.resetFields() }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{ count: 1, max_uses: 1, validity_days: 30 }}
        >
          <Form.Item
            name="count"
            label="生成数量"
            rules={[{ required: true, message: '请输入生成数量' }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="max_uses"
            label="每码可用次数"
            rules={[{ required: true, message: '请输入可用次数' }]}
          >
            <InputNumber min={1} max={999} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="validity_days"
            label="用户有效期(天)"
            tooltip="用户激活后的有效天数"
            rules={[{ required: true, message: '请输入有效期' }]}
          >
            <InputNumber min={1} max={365} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="expires_days"
            label="兑换码有效期(天)"
            tooltip="兑换码本身的有效期，留空则永久有效"
          >
            <InputNumber min={1} max={365} style={{ width: '100%' }} placeholder="留空则永久有效" />
          </Form.Item>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="可选，添加备注信息" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setModalVisible(false); form.resetFields() }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={createLoading}>创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

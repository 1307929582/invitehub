// 管理员 - 待审核分销商
import { useState, useEffect, useCallback } from 'react'
import { Table, Button, message, Space, Modal, Input, Typography, Card, Tag, Empty } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { adminApi } from '../../api'

const { Title } = Typography
const { TextArea } = Input

interface PendingDistributor {
  id: number
  username: string
  email: string
  created_at: string
  approval_status: string
  rejection_reason?: string
}

export default function AdminPendingDistributors() {
  const [distributors, setDistributors] = useState<PendingDistributor[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectModalVisible, setRejectModalVisible] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchPending = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.listPendingDistributors() as any
      setDistributors(res || [])
    } catch (error) {
      message.error('加载待审核列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  const handleApprove = async (id: number) => {
    setActionLoading(true)
    try {
      await adminApi.approveDistributor(id)
      message.success('已批准')
      fetchPending()
    } catch (error) {
      // 错误已在 interceptor 中处理
    } finally {
      setActionLoading(false)
    }
  }

  const showRejectModal = (id: number) => {
    setSelectedId(id)
    setRejectionReason('')
    setRejectModalVisible(true)
  }

  const handleReject = async () => {
    if (!selectedId) return
    setActionLoading(true)
    try {
      await adminApi.rejectDistributor(selectedId, rejectionReason || undefined)
      message.success('已拒绝')
      setRejectModalVisible(false)
      fetchPending()
    } catch (error) {
      // 错误已在 interceptor 中处理
    } finally {
      setActionLoading(false)
    }
  }

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '状态',
      dataIndex: 'approval_status',
      key: 'approval_status',
      width: 100,
      render: (status: string) => {
        const map: Record<string, { color: string; text: string }> = {
          pending: { color: 'processing', text: '待审核' },
          rejected: { color: 'error', text: '已拒绝' },
        }
        const s = map[status] || { color: 'default', text: status }
        return <Tag color={s.color}>{s.text}</Tag>
      },
    },
    {
      title: '拒绝原因',
      dataIndex: 'rejection_reason',
      key: 'rejection_reason',
      ellipsis: true,
      render: (text: string) => text || '-',
    },
    {
      title: '申请时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: PendingDistributor) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => handleApprove(record.id)}
            loading={actionLoading}
          >
            批准
          </Button>
          <Button
            danger
            size="small"
            icon={<CloseOutlined />}
            onClick={() => showRejectModal(record.id)}
          >
            拒绝
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>待审核分销商</Title>

      <Card>
        {distributors.length > 0 ? (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={distributors}
            loading={loading}
            pagination={{ pageSize: 10 }}
          />
        ) : (
          <Empty description={loading ? '加载中...' : '暂无待审核的分销商申请'} />
        )}
      </Card>

      <Modal
        title="拒绝申请"
        open={rejectModalVisible}
        onOk={handleReject}
        onCancel={() => setRejectModalVisible(false)}
        okText="确认拒绝"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionLoading }}
      >
        <p style={{ marginBottom: 12 }}>请输入拒绝原因（可选，将发送给申请人）：</p>
        <TextArea
          rows={4}
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          placeholder="例如：资料不完整、不符合条件等"
        />
      </Modal>
    </div>
  )
}

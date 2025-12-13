// 分销商成员管理
import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  Button,
  message,
  Badge,
  Typography,
  Card,
  Modal,
  Input,
  Space,
  Tag,
  Tooltip,
  Empty,
} from 'antd'
import {
  UserDeleteOutlined,
  UserAddOutlined,
  SearchOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { distributorApi } from '../../api'

const { Title, Text } = Typography

interface Member {
  id: number
  email: string
  team_id: number
  team_name: string
  redeem_code: string
  joined_at?: string
  status: 'active' | 'removed'
}

export default function DistributorMembers() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')

  // 移除成员弹窗
  const [removeModalVisible, setRemoveModalVisible] = useState(false)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [removeReason, setRemoveReason] = useState('')

  // 重新邀请弹窗
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [addLoading, setAddLoading] = useState(false)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const res = (await distributorApi.getMyMembers()) as any as Member[]
      setMembers(res || [])
    } catch (error) {
      message.error('加载成员列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const handleRemoveMember = async () => {
    if (!selectedMember) return

    setRemoveLoading(true)
    try {
      await distributorApi.removeMember({
        email: selectedMember.email,
        team_id: selectedMember.team_id,
        reason: removeReason || undefined,
      })
      message.success('成员移除成功，兑换码使用次数已恢复')
      setRemoveModalVisible(false)
      setRemoveReason('')
      setSelectedMember(null)
      fetchMembers()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '移除失败')
    } finally {
      setRemoveLoading(false)
    }
  }

  const handleAddMember = async () => {
    if (!selectedMember) return

    setAddLoading(true)
    try {
      await distributorApi.addMember({
        email: selectedMember.email,
        team_id: selectedMember.team_id,
      })
      message.success('邀请任务已创建，请稍后刷新查看状态')
      setAddModalVisible(false)
      setSelectedMember(null)
      fetchMembers()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '邀请失败')
    } finally {
      setAddLoading(false)
    }
  }

  const openRemoveModal = (member: Member) => {
    setSelectedMember(member)
    setRemoveReason('')
    setRemoveModalVisible(true)
  }

  const openAddModal = (member: Member) => {
    setSelectedMember(member)
    setAddModalVisible(true)
  }

  const filteredMembers = members.filter(
    (m) =>
      m.email.toLowerCase().includes(searchText.toLowerCase()) ||
      m.team_name.toLowerCase().includes(searchText.toLowerCase()) ||
      m.redeem_code.toLowerCase().includes(searchText.toLowerCase())
  )

  // 统计数据
  const activeCount = members.filter((m) => m.status === 'active').length
  const removedCount = members.filter((m) => m.status === 'removed').length

  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
      render: (text: string) => <Text copyable>{text}</Text>,
    },
    {
      title: 'Team',
      dataIndex: 'team_name',
      key: 'team_name',
      render: (text: string) => (
        <Space>
          <TeamOutlined style={{ color: '#1890ff' }} />
          {text}
        </Space>
      ),
    },
    {
      title: '兑换码',
      dataIndex: 'redeem_code',
      key: 'redeem_code',
      render: (text: string) => (
        <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{text}</code>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joined_at',
      key: 'joined_at',
      width: 170,
      render: (text?: string) => (text ? new Date(text).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) =>
        status === 'active' ? (
          <Badge status="success" text="在组" />
        ) : (
          <Badge status="default" text="已移除" />
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: Member) => (
        <Space size="small">
          {record.status === 'active' ? (
            <Tooltip title="移除成员将从 Team 中删除该用户，并恢复兑换码使用次数">
              <Button
                type="link"
                danger
                size="small"
                icon={<UserDeleteOutlined />}
                onClick={() => openRemoveModal(record)}
              >
                移除
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="重新邀请该成员加入 Team">
              <Button
                type="link"
                size="small"
                icon={<UserAddOutlined />}
                onClick={() => openAddModal(record)}
              >
                重新邀请
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          成员管理
        </Title>
        <Space>
          <Tag color="green">在组: {activeCount}</Tag>
          <Tag>已移除: {removedCount}</Tag>
          <Button icon={<ReloadOutlined />} onClick={fetchMembers} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索邮箱、Team 或兑换码..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300 }}
            allowClear
          />
        </div>

        {filteredMembers.length > 0 ? (
          <Table
            rowKey={(r) => `${r.email}-${r.team_id}`}
            columns={columns}
            dataSource={filteredMembers}
            loading={loading}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
            }}
          />
        ) : (
          <Empty
            description={
              searchText
                ? '没有匹配的搜索结果'
                : '暂无成员记录，当用户通过您的兑换码成功加入 Team 后，将会在这里显示'
            }
          />
        )}
      </Card>

      {/* 移除成员弹窗 */}
      <Modal
        title="移除成员"
        open={removeModalVisible}
        onCancel={() => {
          setRemoveModalVisible(false)
          setSelectedMember(null)
          setRemoveReason('')
        }}
        onOk={handleRemoveMember}
        confirmLoading={removeLoading}
        okText="确认移除"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginBottom: 16 }}>
          <Text>
            确定要从 <strong>{selectedMember?.team_name}</strong> 移除成员{' '}
            <strong>{selectedMember?.email}</strong> 吗？
          </Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            移除后，该成员将无法继续使用 ChatGPT Team 服务。对应的兑换码使用次数将恢复，您可以重新邀请其他用户。
          </Text>
        </div>
        <Input.TextArea
          placeholder="移除原因（可选）"
          value={removeReason}
          onChange={(e) => setRemoveReason(e.target.value)}
          rows={3}
        />
      </Modal>

      {/* 重新邀请弹窗 */}
      <Modal
        title="重新邀请成员"
        open={addModalVisible}
        onCancel={() => {
          setAddModalVisible(false)
          setSelectedMember(null)
        }}
        onOk={handleAddMember}
        confirmLoading={addLoading}
        okText="确认邀请"
      >
        <div style={{ marginBottom: 16 }}>
          <Text>
            确定要重新邀请 <strong>{selectedMember?.email}</strong> 加入{' '}
            <strong>{selectedMember?.team_name}</strong> 吗？
          </Text>
        </div>
        <div>
          <Text type="secondary">
            邀请任务将自动创建，系统会使用该成员之前使用的兑换码进行邀请。请确保兑换码仍有可用次数。
          </Text>
        </div>
      </Modal>
    </div>
  )
}

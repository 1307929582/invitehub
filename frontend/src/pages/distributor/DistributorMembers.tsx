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
  Tooltip,
  Empty,
  Row,
  Col,
} from 'antd'
import {
  UserDeleteOutlined,
  UserAddOutlined,
  SearchOutlined,
  ReloadOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
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
      render: (text: string) => <Text copyable style={{ color: '#1d1d1f' }}>{text}</Text>,
    },
    {
      title: 'Team',
      dataIndex: 'team_name',
      key: 'team_name',
      render: (text: string) => (
        <Space>
          <TeamOutlined style={{ color: '#10a37f' }} />
          <span style={{
            padding: '2px 8px',
            background: '#f0f0f5',
            borderRadius: 4,
            fontSize: 13,
          }}>
            {text}
          </span>
        </Space>
      ),
    },
    {
      title: '兑换码',
      dataIndex: 'redeem_code',
      key: 'redeem_code',
      render: (text: string) => (
        <code style={{
          background: 'linear-gradient(135deg, #10a37f15 0%, #0d8a6a15 100%)',
          padding: '4px 10px',
          borderRadius: 6,
          fontFamily: 'Monaco, monospace',
          fontSize: 13,
          color: '#10a37f',
          border: '1px solid #10a37f20',
        }}>
          {text}
        </code>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'joined_at',
      key: 'joined_at',
      width: 170,
      render: (text?: string) => (
        <span style={{ color: '#86868b', fontSize: 13 }}>
          {text ? new Date(text).toLocaleString('zh-CN') : '-'}
        </span>
      ),
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
                style={{ color: '#34c759' }}
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
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0, fontWeight: 700, color: '#1d1d1f' }}>
              成员管理
            </Title>
            <Text style={{ color: '#86868b', fontSize: 14 }}>
              管理通过您的兑换码加入 Team 的用户
            </Text>
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchMembers}
            loading={loading}
            style={{ borderRadius: 8 }}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8} md={6}>
          <Card
            style={{
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              background: 'linear-gradient(135deg, #34c75920 0%, #38ef7d20 100%)',
            }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircleOutlined style={{ fontSize: 24, color: '#34c759' }} />
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1d1d1f' }}>{activeCount}</div>
                <div style={{ fontSize: 13, color: '#86868b' }}>在组成员</div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card
            style={{
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              background: 'linear-gradient(135deg, #86868b20 0%, #a0a0a520 100%)',
            }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MinusCircleOutlined style={{ fontSize: 24, color: '#86868b' }} />
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1d1d1f' }}>{removedCount}</div>
                <div style={{ fontSize: 13, color: '#86868b' }}>已移除</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        style={{
          borderRadius: 16,
          border: 'none',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: 20, borderBottom: '1px solid #f0f0f5' }}>
          <Input
            placeholder="搜索邮箱、Team 或兑换码..."
            prefix={<SearchOutlined style={{ color: '#86868b' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300, borderRadius: 10 }}
            allowClear
          />
        </div>

        <div style={{ padding: 20 }}>
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
              style={{ padding: '60px 0' }}
            />
          )}
        </div>
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

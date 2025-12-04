import { useEffect, useState } from 'react'
import { Table, Button, message, Modal, Tag, Space, Card, Empty } from 'antd'
import { DeleteOutlined, ExclamationCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import axios from 'axios'

interface UnauthorizedMember {
  id: number
  team_id: number
  team_name: string
  email: string
  name: string
  role: string
  chatgpt_user_id: string
  synced_at: string
}

export default function UnauthorizedMembers() {
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState<UnauthorizedMember[]>([])
  const [removing, setRemoving] = useState<number | null>(null)

  const fetchMembers = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/v1/teams/unauthorized/all')
      setMembers(res.data.members || [])
    } catch {
      message.error('获取未授权成员失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const handleRemoveAll = (teamId: number, teamName: string) => {
    const teamMembers = members.filter(m => m.team_id === teamId)
    Modal.confirm({
      title: '确认清理未授权成员？',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>将从 <strong>{teamName}</strong> 删除以下 {teamMembers.length} 个未授权成员：</p>
          <div style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
            {teamMembers.map(m => (
              <div key={m.id} style={{ fontSize: 12 }}>{m.email}</div>
            ))}
          </div>
          <p style={{ color: '#ff4d4f', marginTop: 12 }}>⚠️ 此操作不可撤销！</p>
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setRemoving(teamId)
        try {
          await axios.delete(`/api/v1/teams/${teamId}/unauthorized-members`)
          message.success('清理完成')
          fetchMembers()
        } catch (e: any) {
          message.error(e.response?.data?.detail || '清理失败')
        } finally {
          setRemoving(null)
        }
      }
    })
  }

  // 按 Team 分组
  const groupedByTeam = members.reduce((acc, m) => {
    if (!acc[m.team_id]) {
      acc[m.team_id] = { team_name: m.team_name, members: [] }
    }
    acc[m.team_id].members.push(m)
    return acc
  }, {} as Record<number, { team_name: string; members: UnauthorizedMember[] }>)

  const columns = [
    { title: '邮箱', dataIndex: 'email', key: 'email', render: (v: string) => <code>{v}</code> },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (v: string) => <Tag>{v}</Tag> },
    { 
      title: '同步时间', 
      dataIndex: 'synced_at', 
      key: 'synced_at',
      render: (v: string) => v ? new Date(v).toLocaleString() : '-'
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e' }}>
            <WarningOutlined style={{ marginRight: 12, color: '#ef4444' }} />
            未授权成员
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>
            管理所有 Team 中未通过系统邀请的成员
          </p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchMembers} loading={loading}>
          刷新
        </Button>
      </div>

      {members.length === 0 ? (
        <Card>
          <Empty description="没有未授权成员 🎉" />
        </Card>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {Object.entries(groupedByTeam).map(([teamId, data]) => (
            <Card 
              key={teamId}
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <Tag color="red">{data.members.length}</Tag>
                    {data.team_name}
                  </span>
                  <Button 
                    danger 
                    icon={<DeleteOutlined />}
                    loading={removing === Number(teamId)}
                    onClick={() => handleRemoveAll(Number(teamId), data.team_name)}
                  >
                    清理全部
                  </Button>
                </div>
              }
            >
              <Table
                dataSource={data.members}
                columns={columns}
                rowKey="id"
                pagination={false}
                size="small"
              />
            </Card>
          ))}
        </Space>
      )}
    </div>
  )
}

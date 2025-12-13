import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Button, Space, Tag, Modal, Form, Input, message, Select, Row, Col,
  Progress, Dropdown, Spin, Checkbox, Descriptions, Alert, Divider
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SyncOutlined, SafetyOutlined,
  MoreOutlined, ExportOutlined, SwapOutlined, DownOutlined, CopyOutlined
} from '@ant-design/icons'
import { teamApi, groupApi, TeamStatus } from '../api'
import { useStore } from '../store'

const { TextArea } = Input

// Team 状态配置
const TEAM_STATUS_CONFIG: Record<TeamStatus, { text: string; color: string }> = {
  active: { text: '正常', color: 'success' },
  banned: { text: '封禁', color: 'error' },
  token_invalid: { text: 'Token失效', color: 'warning' },
  paused: { text: '暂停', color: 'default' },
}

const STATUS_FILTER_OPTIONS = [
  { label: '所有状态', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '封禁', value: 'banned' },
  { label: 'Token失效', value: 'token_invalid' },
  { label: '暂停', value: 'paused' },
]

type Team = {
  id: number
  name: string
  description?: string
  account_id: string
  is_active: boolean
  status: TeamStatus
  status_message?: string
  member_count: number
  max_seats: number
  group_id?: number | null
  group_name?: string | null
  created_at: string
}

type Group = {
  id: number
  name: string
  color: string
}

type MigrationPreview = {
  emails: string[]
  total: number
  source_teams: string[]
  destination_team: string
  destination_available_seats: number
  can_migrate: boolean
  message: string
}

export default function Teams() {
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const { teams, setTeams } = useStore()

  // 筛选状态
  const [filterGroupId, setFilterGroupId] = useState<number | undefined>(undefined)
  const [filterStatus, setFilterStatus] = useState<string>('active')  // 默认显示正常状态
  const [searchKeyword, setSearchKeyword] = useState('')

  // 批量选择状态
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([])

  // 迁移模态框状态
  const [migrationModalOpen, setMigrationModalOpen] = useState(false)
  const [migrationTargetId, setMigrationTargetId] = useState<number | null>(null)
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null)
  const [migrationLoading, setMigrationLoading] = useState(false)

  // 导出模态框状态
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'txt'>('csv')

  // 批量状态修改模态框状态
  const [bulkStatusModalOpen, setBulkStatusModalOpen] = useState(false)
  const [bulkTargetStatus, setBulkTargetStatus] = useState<TeamStatus | undefined>(undefined)
  const [bulkStatusReason, setBulkStatusReason] = useState('')
  const [bulkStatusLoading, setBulkStatusLoading] = useState(false)

  const fetchTeams = async (statusFilter?: string) => {
    setLoading(true)
    try {
      const params: any = { include_inactive: true }
      if (statusFilter && statusFilter !== 'all') {
        params.status_filter = statusFilter
      }
      const res: any = await teamApi.list(params)
      setTeams(res.teams as Team[])
    } finally {
      setLoading(false)
    }
  }

  const fetchGroups = async () => {
    try {
      const res: any = await groupApi.list()
      setGroups(res)
    } catch {}
  }

  useEffect(() => { fetchTeams(); fetchGroups() }, [])

  // 筛选后的 Team 列表
  const filteredTeams = useMemo(() => {
    return [...teams]
      .filter(t => {
        const matchGroup = !filterGroupId || t.group_id === filterGroupId
        const matchStatus = filterStatus === 'all' || t.status === filterStatus
        const matchSearch = !searchKeyword || t.name.toLowerCase().includes(searchKeyword.toLowerCase())
        return matchGroup && matchStatus && matchSearch
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  }, [teams, filterGroupId, filterStatus, searchKeyword])

  // 选中的 Team 对象
  const selectedTeams = useMemo(() => {
    return teams.filter(t => selectedTeamIds.includes(t.id))
  }, [teams, selectedTeamIds])

  // 全选逻辑
  const isAllSelected = filteredTeams.length > 0 && selectedTeamIds.length === filteredTeams.length
  const isIndeterminate = selectedTeamIds.length > 0 && selectedTeamIds.length < filteredTeams.length

  const handleSelectAll = (checked: boolean) => {
    setSelectedTeamIds(checked ? filteredTeams.map(t => t.id) : [])
  }

  const handleSelectTeam = (id: number, checked: boolean) => {
    setSelectedTeamIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id))
  }

  // 清除选择
  const clearSelection = () => setSelectedTeamIds([])

  // 基本操作
  const handleCreate = () => { setEditingTeam(null); form.resetFields(); setModalOpen(true) }
  const handleEdit = (team: Team, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingTeam(team)
    form.setFieldsValue({ ...team, group_id: team.group_id })
    setModalOpen(true)
  }
  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确定删除此 Team？',
      content: '删除后无法恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await teamApi.delete(id)
        message.success('删除成功')
        fetchTeams()
      }
    })
  }

  const handleVerify = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await teamApi.verifyToken(id)
      message.success('Token 有效')
    } catch {}
  }

  const handleSync = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setSyncing(id)
    try {
      const res: any = await teamApi.syncMembers(id)
      message.success(`同步成功，共 ${res.total} 人`)
      fetchTeams()
    } catch {}
    finally { setSyncing(null) }
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    try {
      const res: any = await teamApi.syncAll()
      message.success(res.message)
      fetchTeams()
    } catch {}
    finally { setSyncingAll(false) }
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    try {
      if (editingTeam) {
        await teamApi.update(editingTeam.id, values)
        message.success('更新成功')
      } else {
        await teamApi.create(values)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchTeams()
    } catch {}
  }

  // 单个 Team 导出
  const handleExportSingle = async (teamId: number, format: 'csv' | 'json') => {
    try {
      const res: any = await teamApi.exportMembers(teamId, format)
      if (format === 'csv') {
        const blob = new Blob([res], { type: 'text/csv;charset=utf-8' })
        downloadBlob(blob, `team_${teamId}_members.csv`)
      } else {
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
        downloadBlob(blob, `team_${teamId}_members.json`)
      }
      message.success('导出成功')
    } catch {
      message.error('导出失败')
    }
  }

  // 批量导出
  const handleBulkExport = async () => {
    if (selectedTeamIds.length === 0) {
      message.warning('请先选择要导出的 Team')
      return
    }

    try {
      if (exportFormat === 'txt') {
        // 纯邮箱列表
        const res: any = await teamApi.exportEmailsOnly({ team_ids: selectedTeamIds.join(',') })
        downloadBlob(res, 'emails.txt')
      } else {
        const res: any = await teamApi.exportBulkMembers({ team_ids: selectedTeamIds }, exportFormat)
        if (exportFormat === 'csv') {
          downloadBlob(res, 'members_export.csv')
        } else {
          const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
          downloadBlob(blob, 'members_export.json')
        }
      }
      message.success('导出成功')
      setExportModalOpen(false)
    } catch {
      message.error('导出失败')
    }
  }

  // 下载文件辅助函数
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  // 复制邮箱到剪贴板
  const handleCopyEmails = async () => {
    if (selectedTeamIds.length === 0) {
      message.warning('请先选择 Team')
      return
    }
    try {
      const res: any = await teamApi.exportEmailsOnly({ team_ids: selectedTeamIds.join(',') })
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      message.success(`已复制 ${text.split('\n').filter(Boolean).length} 个邮箱`)
    } catch {
      message.error('复制失败')
    }
  }

  // 批量状态修改
  const handleBulkStatusUpdate = async () => {
    if (!bulkTargetStatus) {
      message.warning('请选择目标状态')
      return
    }

    setBulkStatusLoading(true)
    try {
      const res: any = await teamApi.updateStatusBulk({
        team_ids: selectedTeamIds,
        status: bulkTargetStatus,
        status_message: bulkStatusReason.trim() || undefined
      })

      message.success(`批量操作完成：成功 ${res.success_count} 个，失败 ${res.failed_count} 个`)

      if (res.failed_count > 0) {
        Modal.warning({
          title: '部分操作失败',
          content: (
            <div>
              {res.failed_teams.map((f: any) => (
                <div key={f.team_id}>Team {f.team_id}: {f.error}</div>
              ))}
            </div>
          )
        })
      }

      setBulkStatusModalOpen(false)
      setBulkTargetStatus(undefined)
      setBulkStatusReason('')
      clearSelection()
      fetchTeams()
    } catch {
      message.error('批量操作失败')
    } finally {
      setBulkStatusLoading(false)
    }
  }

  // 迁移预览
  const handleOpenMigration = () => {
    if (selectedTeamIds.length === 0) {
      message.warning('请先选择要迁移的 Team')
      return
    }
    setMigrationModalOpen(true)
    setMigrationTargetId(null)
    setMigrationPreview(null)
  }

  const handleMigrationTargetChange = async (targetId: number) => {
    setMigrationTargetId(targetId)
    setMigrationLoading(true)
    try {
      const res: any = await teamApi.previewMigration({
        source_team_ids: selectedTeamIds,
        destination_team_id: targetId
      })
      setMigrationPreview(res)
    } catch {
      message.error('无法获取迁移预览')
    } finally {
      setMigrationLoading(false)
    }
  }

  const handleExecuteMigration = async () => {
    if (!migrationTargetId || !migrationPreview?.can_migrate) return

    Modal.confirm({
      title: '确认执行迁移？',
      content: `将 ${migrationPreview.total} 个成员从 ${migrationPreview.source_teams.join(', ')} 迁移到 ${migrationPreview.destination_team}`,
      okText: '确认迁移',
      cancelText: '取消',
      onOk: async () => {
        try {
          await teamApi.executeMigration({
            source_team_ids: selectedTeamIds,
            destination_team_id: migrationTargetId
          })
          message.success('迁移任务已提交，将在后台执行')
          setMigrationModalOpen(false)
          clearSelection()
          fetchTeams()
        } catch {
          message.error('迁移失败')
        }
      }
    })
  }

  // 可选的迁移目标（排除已选的 Team，只显示正常状态的）
  const availableTargets = useMemo(() => {
    return teams.filter(t =>
      !selectedTeamIds.includes(t.id) && t.status === 'active'
    )
  }, [teams, selectedTeamIds])

  // 批量操作菜单
  const bulkActionItems = [
    {
      key: 'status',
      label: '批量修改状态',
      icon: <SafetyOutlined />,
      onClick: () => setBulkStatusModalOpen(true)
    },
    { type: 'divider' as const },
    {
      key: 'export',
      label: '导出邮箱',
      icon: <ExportOutlined />,
      onClick: () => setExportModalOpen(true)
    },
    {
      key: 'copy',
      label: '复制邮箱',
      icon: <CopyOutlined />,
      onClick: handleCopyEmails
    },
    { type: 'divider' as const },
    {
      key: 'migrate',
      label: '迁移成员',
      icon: <SwapOutlined />,
      onClick: handleOpenMigration
    },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>Team 座位管理</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>管理所有 ChatGPT Team 账号和座位使用情况</p>
        </div>
        <Space>
          <Button icon={<SyncOutlined spin={syncingAll} />} onClick={handleSyncAll} loading={syncingAll} size="large" style={{ borderRadius: 12, height: 44 }}>
            同步全部
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} size="large" style={{ borderRadius: 12, height: 44 }}>
            添加 Team
          </Button>
        </Space>
      </div>

      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Space size="middle" wrap>
            <Checkbox
              checked={isAllSelected}
              indeterminate={isIndeterminate}
              onChange={e => handleSelectAll(e.target.checked)}
            >
              全选
            </Checkbox>
            <Divider type="vertical" />
            <Input.Search
              placeholder="搜索 Team 名称"
              allowClear
              style={{ width: 180 }}
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
            />
            <Select
              placeholder="状态筛选"
              style={{ width: 120 }}
              value={filterStatus}
              onChange={setFilterStatus}
              options={STATUS_FILTER_OPTIONS}
            />
            <Select
              placeholder="全部分组"
              allowClear
              style={{ width: 140 }}
              value={filterGroupId}
              onChange={setFilterGroupId}
            >
              {groups.map(g => (
                <Select.Option key={g.id} value={g.id}>
                  <Space><div style={{ width: 10, height: 10, borderRadius: 2, background: g.color }} />{g.name}</Space>
                </Select.Option>
              ))}
            </Select>
            <span style={{ color: '#94a3b8' }}>共 {filteredTeams.length} 个 Team</span>
          </Space>

          {/* 批量操作按钮 */}
          {selectedTeamIds.length > 0 && (
            <Space>
              <Tag color="blue">{selectedTeamIds.length} 个已选</Tag>
              <Button size="small" onClick={clearSelection}>取消选择</Button>
              <Dropdown menu={{ items: bulkActionItems }} trigger={['click']}>
                <Button type="primary">
                  批量操作 <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          )}
        </div>
      </Card>

      {/* Team 卡片列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : filteredTeams.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
            {teams.length === 0 ? '暂无 Team，点击右上角添加' : '没有匹配的 Team'}
          </div>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filteredTeams.map(team => {
            const memberCount = team.member_count || 0
            const maxSeats = team.max_seats || 5
            const usage = maxSeats > 0 ? Math.round((memberCount / maxSeats) * 100) : 0
            const statusConfig = TEAM_STATUS_CONFIG[team.status] || TEAM_STATUS_CONFIG.active
            const isSelected = selectedTeamIds.includes(team.id)

            const menuItems = [
              { key: 'sync', label: '同步成员', icon: <SyncOutlined spin={syncing === team.id} />, onClick: (e: any) => handleSync(team.id, e.domEvent) },
              { key: 'verify', label: '验证 Token', icon: <SafetyOutlined />, onClick: (e: any) => handleVerify(team.id, e.domEvent) },
              { key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: (e: any) => handleEdit(team, e.domEvent) },
              { type: 'divider' as const },
              { key: 'export-csv', label: '导出 CSV', icon: <ExportOutlined />, onClick: () => handleExportSingle(team.id, 'csv') },
              { key: 'export-json', label: '导出 JSON', icon: <ExportOutlined />, onClick: () => handleExportSingle(team.id, 'json') },
              { type: 'divider' as const },
              { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(team.id) },
            ]

            return (
              <Col xs={12} sm={8} md={6} lg={4} key={team.id}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => navigate(`/admin/teams/${team.id}`)}
                  style={{
                    borderRadius: 12,
                    border: isSelected
                      ? '2px solid #1677ff'
                      : team.status === 'banned'
                        ? '2px solid rgba(239, 68, 68, 0.5)'
                        : team.status === 'token_invalid'
                          ? '2px solid rgba(245, 158, 11, 0.5)'
                          : usage >= 90
                            ? '2px solid rgba(239, 68, 68, 0.5)'
                            : '1px solid rgba(0, 0, 0, 0.06)',
                    background: isSelected ? 'rgba(22, 119, 255, 0.04)' : undefined,
                  }}
                  styles={{ body: { padding: '12px 14px' } }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Checkbox
                        checked={isSelected}
                        onChange={e => { e.stopPropagation(); handleSelectTeam(team.id, e.target.checked) }}
                        onClick={e => e.stopPropagation()}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
                      {team.group_name && (
                        <Tag color={groups.find(g => g.id === team.group_id)?.color} style={{ fontSize: 10, margin: 0, lineHeight: '16px', padding: '0 4px' }}>
                          {team.group_name}
                        </Tag>
                      )}
                    </div>
                  }
                  extra={
                    <Dropdown
                      menu={{ items: menuItems }}
                      trigger={['click']}
                    >
                      <Button type="text" size="small" icon={<MoreOutlined />} onClick={e => e.stopPropagation()} style={{ marginRight: -8 }} />
                    </Dropdown>
                  }
                >
                  {/* 状态标签 */}
                  {team.status !== 'active' && (
                    <div style={{ marginBottom: 8 }}>
                      <Tag color={statusConfig.color}>{statusConfig.text}</Tag>
                    </div>
                  )}
                  <Progress
                    percent={usage}
                    size="small"
                    strokeColor={usage >= 90 ? '#ef4444' : usage >= 70 ? '#f59e0b' : '#10b981'}
                    format={() => <span style={{ fontSize: 12, fontWeight: 600 }}>{memberCount}/{maxSeats}</span>}
                  />
                </Card>
              </Col>
            )
          })}
        </Row>
      )}

      {/* 创建/编辑 Team 模态框 */}
      <Modal
        title={editingTeam ? '编辑 Team' : '添加 Team'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={560}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Team 名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：研发部、市场部" size="large" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="Team 描述（可选）" />
          </Form.Item>
          <Form.Item name="group_id" label="所属分组" extra="选择分组后，该分组的邀请码只会分配到此 Team">
            <Select placeholder="选择分组（可选）" allowClear>
              {groups.map(g => (
                <Select.Option key={g.id} value={g.id}>
                  <Space><div style={{ width: 10, height: 10, borderRadius: 2, background: g.color }} />{g.name}</Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="account_id"
            label="Account ID"
            rules={[{ required: true, message: '请输入 Account ID' }]}
            extra="从 Network 请求 URL 中获取"
          >
            <Input placeholder="eabecad0-0c6a-4932-aeb4-4ad932280677" disabled={!!editingTeam} size="large" />
          </Form.Item>
          <Form.Item
            name="session_token"
            label="Session Token"
            rules={[{ required: !editingTeam, message: '请输入 Token' }]}
            extra="Headers 中 Authorization: Bearer 后面的内容"
          >
            <TextArea rows={2} placeholder="eyJhbGci..." />
          </Form.Item>
          <Form.Item
            name="device_id"
            label="Device ID"
            rules={[{ required: !editingTeam, message: '请输入 Device ID' }]}
            extra="Headers 中 oai-device-id 的值"
          >
            <Input placeholder="0f404cce-2645-42e0-8163-80947354fad3" size="large" />
          </Form.Item>
          <Form.Item
            name="max_seats"
            label="最大座位数"
            extra="Team 的最大成员数量"
            initialValue={5}
          >
            <Input type="number" placeholder="5" size="large" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导出模态框 */}
      <Modal
        title="导出成员邮箱"
        open={exportModalOpen}
        onOk={handleBulkExport}
        onCancel={() => setExportModalOpen(false)}
        okText="导出"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <p>已选择 <strong>{selectedTeamIds.length}</strong> 个 Team</p>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            包含: {selectedTeams.map(t => t.name).join(', ')}
          </p>
        </div>
        <Form layout="vertical">
          <Form.Item label="导出格式">
            <Select value={exportFormat} onChange={setExportFormat} style={{ width: '100%' }}>
              <Select.Option value="csv">CSV（包含详细信息）</Select.Option>
              <Select.Option value="json">JSON（包含详细信息）</Select.Option>
              <Select.Option value="txt">纯文本（仅邮箱，一行一个）</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量状态修改模态框 */}
      <Modal
        title="批量修改 Team 状态"
        open={bulkStatusModalOpen}
        onOk={handleBulkStatusUpdate}
        onCancel={() => {
          setBulkStatusModalOpen(false)
          setBulkTargetStatus(undefined)
          setBulkStatusReason('')
        }}
        confirmLoading={bulkStatusLoading}
        okText="确认修改"
        cancelText="取消"
        okButtonProps={{
          danger: bulkTargetStatus && ['banned', 'token_invalid', 'paused'].includes(bulkTargetStatus)
        }}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p>将要修改 <strong>{selectedTeamIds.length}</strong> 个 Team 的状态</p>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            包含: {selectedTeams.map(t => t.name).join(', ')}
          </p>
        </div>

        {bulkTargetStatus && ['banned', 'token_invalid', 'paused'].includes(bulkTargetStatus) && (
          <Alert
            message="危险操作"
            description="此操作会影响团队成员的正常使用，系统将停止向这些 Team 分配新用户。请谨慎确认。"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form layout="vertical">
          <Form.Item label="目标状态" required>
            <Select
              value={bulkTargetStatus}
              onChange={setBulkTargetStatus}
              placeholder="请选择目标状态"
              style={{ width: '100%' }}
            >
              <Select.Option value="active">
                <Tag color="success">正常 (Active)</Tag>
              </Select.Option>
              <Select.Option value="banned">
                <Tag color="error">封禁 (Banned)</Tag>
              </Select.Option>
              <Select.Option value="token_invalid">
                <Tag color="warning">Token失效 (Token Invalid)</Tag>
              </Select.Option>
              <Select.Option value="paused">
                <Tag color="default">暂停 (Paused)</Tag>
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="变更原因（可选）">
            <TextArea
              rows={3}
              value={bulkStatusReason}
              onChange={e => setBulkStatusReason(e.target.value)}
              placeholder="请输入本次状态变更的原因或备注（status_message）"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 迁移模态框 */}
      <Modal
        title="迁移成员到其他 Team"
        open={migrationModalOpen}
        onCancel={() => setMigrationModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setMigrationModalOpen(false)}>取消</Button>,
          <Button
            key="execute"
            type="primary"
            disabled={!migrationPreview?.can_migrate}
            onClick={handleExecuteMigration}
          >
            确认迁移
          </Button>
        ]}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p><strong>源 Team:</strong></p>
          <Space wrap>
            {selectedTeams.map(t => (
              <Tag key={t.id} color={TEAM_STATUS_CONFIG[t.status]?.color}>{t.name}</Tag>
            ))}
          </Space>
        </div>

        <Form layout="vertical">
          <Form.Item label="目标 Team" required>
            <Select
              placeholder="选择要迁移到的 Team"
              style={{ width: '100%' }}
              value={migrationTargetId}
              onChange={handleMigrationTargetChange}
              showSearch
              optionFilterProp="children"
            >
              {availableTargets.map(t => (
                <Select.Option key={t.id} value={t.id}>
                  {t.name} （剩余 {t.max_seats - t.member_count} 座位）
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>

        {migrationLoading && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Spin />
            <p style={{ color: '#64748b', marginTop: 8 }}>正在计算迁移预览...</p>
          </div>
        )}

        {migrationPreview && !migrationLoading && (
          <>
            {!migrationPreview.can_migrate && (
              <Alert
                type="error"
                message="无法迁移"
                description={migrationPreview.message}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="待迁移成员数">{migrationPreview.total} 人</Descriptions.Item>
              <Descriptions.Item label="目标 Team">{migrationPreview.destination_team}</Descriptions.Item>
              <Descriptions.Item label="目标剩余座位">{migrationPreview.destination_available_seats} 个</Descriptions.Item>
              <Descriptions.Item label="迁移状态">
                {migrationPreview.can_migrate
                  ? <Tag color="success">可以迁移</Tag>
                  : <Tag color="error">座位不足</Tag>
                }
              </Descriptions.Item>
            </Descriptions>

            {migrationPreview.can_migrate && (
              <Alert
                type="info"
                message="迁移说明"
                description="迁移将在后台异步执行。成员会收到新 Team 的邀请邮件，原 Team 中的成员记录不会自动删除。"
                showIcon
                style={{ marginTop: 16 }}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

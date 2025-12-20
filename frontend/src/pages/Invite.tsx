import { useEffect, useMemo, useState } from 'react'
import { Card, Select, Input, Button, Table, Tag, Space, Progress, Row, Col, message, Radio } from 'antd'
import { SendOutlined, CheckCircleOutlined, CloseCircleOutlined, TeamOutlined, AppstoreOutlined, BarsOutlined } from '@ant-design/icons'
import { teamApi, inviteApi, groupApi } from '../api'
import { useStore } from '../store'

const { TextArea } = Input

interface InviteResult {
  email: string
  success: boolean
  error?: string
  team_name?: string
}

interface Group {
  id: number
  name: string
  description?: string
  color: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const parseEmails = (raw: string) => {
  const parts = raw.split(/[\n,;]/).map(e => e.trim()).filter(Boolean)
  const seen = new Set<string>()
  const emails: string[] = []
  let invalidCount = 0
  let duplicateCount = 0
  for (const p of parts) {
    const v = p.toLowerCase()
    if (!EMAIL_RE.test(v)) { invalidCount += 1; continue }
    if (seen.has(v)) { duplicateCount += 1; continue }
    seen.add(v)
    emails.push(v)
  }
  return { emails, invalidCount, duplicateCount }
}

export default function Invite() {
  const [inviteMode, setInviteMode] = useState<'specify' | 'auto'>('specify')
  const [selectedTeam, setSelectedTeam] = useState<number | undefined>(undefined)
  const [selectedGroup, setSelectedGroup] = useState<number | undefined>(undefined)
  const [emailsText, setEmailsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<InviteResult[]>([])
  const { teams, setTeams } = useStore()
  const [groups, setGroups] = useState<Group[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [teamRes, groupRes]: any[] = await Promise.all([teamApi.list(), groupApi.list()])
        if (cancelled) return
        setTeams(teamRes.teams)
        setGroups(groupRes)
      } catch {
        // 全局拦截器已处理
      }
    })()
    return () => { cancelled = true }
  }, [setTeams])

  const { emails, invalidCount, duplicateCount } = useMemo(() => parseEmails(emailsText), [emailsText])

  const handleInvite = async () => {
    if (emails.length === 0) return
    setLoading(true)
    setResults([])
    try {
      let res: any
      if (inviteMode === 'specify') {
        if (!selectedTeam) return
        res = await inviteApi.batchInvite(selectedTeam, emails)
        // 指定 Team 模式下，手动添加 team_name
        const teamName = teams.find(t => t.id === selectedTeam)?.name
        const resultsWithTeam = res.results.map((r: InviteResult) => ({ ...r, team_name: teamName }))
        setResults(resultsWithTeam)
      } else {
        // 自动分配模式
        res = await inviteApi.autoAllocate({ emails, group_id: selectedGroup })
        setResults(res.results)
      }
      const successCount = res.results.filter((r: InviteResult) => r.success).length
      if (successCount > 0) {
        message.success(`成功邀请 ${successCount} 人`)
      }
      if (res.unallocated_count > 0) {
        message.warning(`${res.unallocated_count} 人因座位不足未能分配`)
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || '邀请失败')
    } finally {
      setLoading(false)
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const selectedTeamInfo = teams.find(t => t.id === selectedTeam)

  const isInviteDisabled = loading || emails.length === 0 || (inviteMode === 'specify' && !selectedTeam)

  const columns = [
    { title: '邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'success',
      key: 'success',
      width: 90,
      render: (v: boolean) => (
        <Tag icon={v ? <CheckCircleOutlined /> : <CloseCircleOutlined />} color={v ? 'success' : 'error'}>
          {v ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '分配 Team',
      dataIndex: 'team_name',
      key: 'team_name',
      width: 140,
      ellipsis: true,
      render: (v: string) => v ? (
        <Tag icon={<TeamOutlined />} color="blue">{v}</Tag>
      ) : '-',
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      key: 'error',
      ellipsis: true,
      render: (v: string) => v ? <span style={{ color: '#dc2626', fontSize: 13 }}>{v}</span> : '-'
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e', letterSpacing: '-0.5px' }}>批量邀请</h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>向 Team 批量发送邀请邮件，支持指定 Team 或自动分配</p>
      </div>

      <Row gutter={24}>
        <Col span={14}>
          <Card size="small">
            <Space direction="vertical" style={{ width: '100%' }} size={24}>

              {/* 邀请模式切换 */}
              <div>
                <div style={{ marginBottom: 12, fontWeight: 600, color: '#1a1a2e' }}>邀请模式</div>
                <Radio.Group
                  value={inviteMode}
                  onChange={(e) => {
                    setInviteMode(e.target.value)
                    setResults([])
                  }}
                  style={{ width: '100%' }}
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="specify" style={{ width: '50%', textAlign: 'center', height: 44, lineHeight: '42px' }}>
                    <BarsOutlined style={{ marginRight: 8 }} />
                    指定 Team
                  </Radio.Button>
                  <Radio.Button value="auto" style={{ width: '50%', textAlign: 'center', height: 44, lineHeight: '42px' }}>
                    <AppstoreOutlined style={{ marginRight: 8 }} />
                    自动分配
                  </Radio.Button>
                </Radio.Group>
              </div>

              {/* 根据模式显示不同的选择器 */}
              {inviteMode === 'specify' ? (
                <div>
                  <div style={{ marginBottom: 12, fontWeight: 600, color: '#1a1a2e' }}>选择 Team</div>
                  <Select
                    style={{ width: '100%' }}
                    placeholder="请选择要邀请的 Team"
                    value={selectedTeam}
                    onChange={setSelectedTeam}
                    size="large"
                    options={teams.map(t => ({
                      label: (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <TeamOutlined style={{ color: '#64748b' }} />
                          {t.name}
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>({t.member_count}人)</span>
                        </span>
                      ),
                      value: t.id
                    }))}
                  />
                  {selectedTeamInfo && (
                    <div style={{
                      marginTop: 14,
                      padding: '14px 18px',
                      background: 'rgba(255, 255, 255, 0.6)',
                      borderRadius: 12,
                      fontSize: 13,
                      color: '#64748b',
                      border: '1px solid rgba(0, 0, 0, 0.06)',
                    }}>
                      <TeamOutlined style={{ marginRight: 10, color: '#1a1a2e' }} />
                      当前 <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{selectedTeamInfo.name}</span> 有 {selectedTeamInfo.member_count} 名成员
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 12, fontWeight: 600, color: '#1a1a2e' }}>
                    按分组筛选
                    <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 10, fontSize: 13 }}>
                      可选，默认在所有 Team 中自动分配
                    </span>
                  </div>
                  <Select
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="默认在所有 Team 中分配"
                    value={selectedGroup}
                    onChange={setSelectedGroup}
                    size="large"
                    options={groups.map(g => ({
                      label: (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: g.color || '#94a3b8' }} />
                          {g.name}
                        </span>
                      ),
                      value: g.id
                    }))}
                  />
                  <div style={{
                    marginTop: 14,
                    padding: '14px 18px',
                    background: 'rgba(59, 130, 246, 0.04)',
                    borderRadius: 12,
                    fontSize: 13,
                    color: '#64748b',
                    border: '1px solid rgba(59, 130, 246, 0.12)',
                  }}>
                    <AppstoreOutlined style={{ marginRight: 10, color: '#3b82f6' }} />
                    系统将自动分配邮箱到有空位的 Team，优先填满 ID 小的 Team
                  </div>
                </div>
              )}

              {/* 邮箱输入 */}
              <div>
                <div style={{ marginBottom: 12, fontWeight: 600, color: '#1a1a2e' }}>
                  邮箱列表
                  <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 10, fontSize: 13 }}>
                    每行一个，或用逗号分隔
                  </span>
                </div>
                <TextArea
                  rows={12}
                  placeholder={`user1@company.com\nuser2@company.com\nuser3@company.com`}
                  value={emailsText}
                  onChange={e => setEmailsText(e.target.value)}
                  style={{ fontSize: 14 }}
                />
                <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    color: emails.length > 0 ? '#059669' : '#94a3b8',
                    fontSize: 13,
                    fontWeight: 500,
                  }}>
                    已识别 {emails.length} 个有效邮箱{invalidCount > 0 ? `（忽略 ${invalidCount} 个无效）` : ''}{duplicateCount > 0 ? `（去重 ${duplicateCount} 个）` : ''}
                  </span>
                  {emails.length > 0 && (
                    <Button type="link" size="small" onClick={() => { setEmailsText(''); setResults([]) }} style={{ color: '#64748b' }}>清空</Button>
                  )}
                </div>
              </div>

              {/* 邀请按钮 */}
              <Button
                type="primary"
                icon={<SendOutlined />}
                size="large"
                block
                loading={loading}
                disabled={isInviteDisabled}
                onClick={handleInvite}
                style={{
                  height: 52,
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                {loading ? '邀请中...' : `发送邀请 (${emails.length})`}
              </Button>
            </Space>
          </Card>
        </Col>

        <Col span={10}>
          <Card title="邀请结果" size="small" style={{ height: '100%' }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Progress type="circle" percent={0} status="active" size={80} strokeColor="#1a1a2e" trailColor="rgba(0, 0, 0, 0.06)" />
                <div style={{ marginTop: 20, color: '#64748b', fontSize: 14 }}>正在发送邀请...</div>
              </div>
            )}

            {!loading && results.length > 0 && (
              <>
                <Row gutter={16} style={{ marginBottom: 20 }}>
                  <Col span={12}>
                    <div style={{
                      background: 'rgba(16, 185, 129, 0.08)',
                      padding: 18,
                      borderRadius: 14,
                      textAlign: 'center',
                      border: '1px solid rgba(16, 185, 129, 0.15)',
                    }}>
                      <div style={{ color: '#059669', fontSize: 32, fontWeight: 700 }}>{successCount}</div>
                      <div style={{ color: '#059669', fontSize: 13, fontWeight: 500, marginTop: 4 }}>成功</div>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      padding: 18,
                      borderRadius: 14,
                      textAlign: 'center',
                      border: '1px solid rgba(239, 68, 68, 0.15)',
                    }}>
                      <div style={{ color: '#dc2626', fontSize: 32, fontWeight: 700 }}>{failCount}</div>
                      <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 500, marginTop: 4 }}>失败</div>
                    </div>
                  </Col>
                </Row>
                <Table
                  dataSource={results}
                  columns={columns}
                  rowKey={(_, index) => `result-${index}`}
                  size="small"
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                />
              </>
            )}

            {!loading && results.length === 0 && (
              <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                <SendOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} />
                <div style={{ fontSize: 14 }}>邀请结果将在此显示</div>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}

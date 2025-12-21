import { useEffect, useMemo, useState } from 'react'
import { Card, Select, Input, Button, Table, Tag, Space, Progress, Row, Col, message, Radio, Grid } from 'antd'
import { SendOutlined, CheckCircleOutlined, CloseCircleOutlined, TeamOutlined, AppstoreOutlined, BarsOutlined, MailOutlined } from '@ant-design/icons'
import { teamApi, inviteApi, groupApi } from '../api'
import { useStore } from '../store'

const { TextArea } = Input
const { useBreakpoint } = Grid

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
  const screens = useBreakpoint()
  const isMobile = !screens.md

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
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(170deg, #f0fdf4 0%, #f8fafc 30%, #ffffff 100%)',
      padding: isMobile ? 16 : 24,
      position: 'relative',
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: -100,
        right: -100,
        width: 300,
        height: 300,
        background: 'radial-gradient(circle, rgba(16, 163, 127, 0.08) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* 页面标题 */}
      <div style={{ marginBottom: 32, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <SendOutlined style={{ color: '#fff', fontSize: 20 }} />
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1f2937', letterSpacing: '-0.5px' }}>
            批量邀请
          </h2>
        </div>
        <p style={{ color: '#6b7280', fontSize: 15, margin: '8px 0 0', paddingLeft: 56 }}>
          向 Team 批量发送邀请邮件，支持指定 Team 或自动分配
        </p>
      </div>

      <Row gutter={[24, 24]}>
        {/* 左侧 - 邀请表单 */}
        <Col xs={24} lg={14}>
          <Card
            bordered={false}
            style={{
              borderRadius: 20,
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
            }}
            bodyStyle={{ padding: isMobile ? 20 : 28 }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={28}>

              {/* 邀请模式切换 */}
              <div>
                <div style={{ marginBottom: 14, fontWeight: 600, color: '#1f2937', fontSize: 15 }}>
                  邀请模式
                </div>
                <Radio.Group
                  value={inviteMode}
                  onChange={(e) => {
                    setInviteMode(e.target.value)
                    setResults([])
                  }}
                  style={{ width: '100%' }}
                >
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div
                      onClick={() => { setInviteMode('specify'); setResults([]) }}
                      style={{
                        flex: 1,
                        padding: '18px 20px',
                        borderRadius: 14,
                        border: inviteMode === 'specify' ? '2px solid #10a37f' : '2px solid #e5e7eb',
                        background: inviteMode === 'specify' ? 'rgba(16, 163, 127, 0.06)' : '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Radio value="specify" style={{ display: 'none' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          background: inviteMode === 'specify' ? '#10a37f' : '#f3f4f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <BarsOutlined style={{ fontSize: 18, color: inviteMode === 'specify' ? '#fff' : '#6b7280' }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: inviteMode === 'specify' ? '#10a37f' : '#1f2937' }}>
                            指定 Team
                          </div>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                            手动选择目标 Team
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={() => { setInviteMode('auto'); setResults([]) }}
                      style={{
                        flex: 1,
                        padding: '18px 20px',
                        borderRadius: 14,
                        border: inviteMode === 'auto' ? '2px solid #10a37f' : '2px solid #e5e7eb',
                        background: inviteMode === 'auto' ? 'rgba(16, 163, 127, 0.06)' : '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Radio value="auto" style={{ display: 'none' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          background: inviteMode === 'auto' ? '#10a37f' : '#f3f4f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <AppstoreOutlined style={{ fontSize: 18, color: inviteMode === 'auto' ? '#fff' : '#6b7280' }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: inviteMode === 'auto' ? '#10a37f' : '#1f2937' }}>
                            自动分配
                          </div>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                            智能分配到有空位的 Team
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Radio.Group>
              </div>

              {/* 根据模式显示不同的选择器 */}
              {inviteMode === 'specify' ? (
                <div>
                  <div style={{ marginBottom: 14, fontWeight: 600, color: '#1f2937', fontSize: 15 }}>
                    选择 Team
                  </div>
                  <Select
                    showSearch
                    style={{ width: '100%' }}
                    placeholder="请选择要邀请的 Team"
                    value={selectedTeam}
                    onChange={setSelectedTeam}
                    size="large"
                    filterOption={(input, option) =>
                      String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={teams.map(t => ({
                      label: (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <TeamOutlined style={{ color: '#10a37f' }} />
                          {t.name}
                          <span style={{ color: '#9ca3af', fontSize: 12 }}>({t.member_count} 人)</span>
                        </span>
                      ),
                      value: t.id
                    }))}
                  />
                  {selectedTeamInfo && (
                    <div style={{
                      marginTop: 14,
                      padding: '14px 18px',
                      background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.08) 0%, rgba(16, 163, 127, 0.04) 100%)',
                      borderRadius: 12,
                      fontSize: 14,
                      color: '#0d8a6a',
                      border: '1px solid rgba(16, 163, 127, 0.15)',
                    }}>
                      <TeamOutlined style={{ marginRight: 10 }} />
                      已选择 <span style={{ fontWeight: 600 }}>{selectedTeamInfo.name}</span>，当前有 {selectedTeamInfo.member_count} 名成员
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 14, fontWeight: 600, color: '#1f2937', fontSize: 15 }}>
                    按分组筛选
                    <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 10, fontSize: 13 }}>
                      可选，默认在所有 Team 中分配
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: g.color || '#9ca3af' }} />
                          {g.name}
                        </span>
                      ),
                      value: g.id
                    }))}
                  />
                  <div style={{
                    marginTop: 14,
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.08) 0%, rgba(16, 163, 127, 0.04) 100%)',
                    borderRadius: 12,
                    fontSize: 14,
                    color: '#0d8a6a',
                    border: '1px solid rgba(16, 163, 127, 0.15)',
                  }}>
                    <AppstoreOutlined style={{ marginRight: 10 }} />
                    系统将自动分配邮箱到有空位的 Team，优先填满 ID 小的 Team
                  </div>
                </div>
              )}

              {/* 邮箱输入 */}
              <div>
                <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MailOutlined style={{ color: '#10a37f' }} />
                  <span style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>邮箱列表</span>
                  <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: 13 }}>
                    每行一个，或用逗号分隔
                  </span>
                </div>
                <TextArea
                  rows={10}
                  placeholder={`user1@company.com\nuser2@company.com\nuser3@company.com`}
                  value={emailsText}
                  onChange={e => setEmailsText(e.target.value)}
                  style={{
                    fontSize: 14,
                    padding: 14,
                    borderRadius: 12,
                    border: '2px solid #e5e7eb',
                    resize: 'none',
                  }}
                />
                <div style={{
                  marginTop: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: emails.length > 0 ? 'rgba(16, 163, 127, 0.06)' : '#f9fafb',
                  borderRadius: 10,
                }}>
                  <span style={{
                    color: emails.length > 0 ? '#10a37f' : '#9ca3af',
                    fontSize: 14,
                    fontWeight: 500,
                  }}>
                    <CheckCircleOutlined style={{ marginRight: 8 }} />
                    已识别 <strong>{emails.length}</strong> 个有效邮箱
                    {invalidCount > 0 && <span style={{ color: '#ef4444', marginLeft: 8 }}>（{invalidCount} 个无效）</span>}
                    {duplicateCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>（{duplicateCount} 个重复）</span>}
                  </span>
                  {emails.length > 0 && (
                    <Button
                      type="text"
                      size="small"
                      onClick={() => { setEmailsText(''); setResults([]) }}
                      style={{ color: '#6b7280' }}
                    >
                      清空
                    </Button>
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
                  height: 56,
                  borderRadius: 14,
                  fontSize: 16,
                  fontWeight: 600,
                  background: isInviteDisabled ? '#d1d5db' : 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
                  border: 'none',
                  boxShadow: isInviteDisabled ? 'none' : '0 4px 14px rgba(16, 163, 127, 0.3)',
                }}
              >
                {loading ? '邀请中...' : `发送邀请${emails.length > 0 ? ` (${emails.length})` : ''}`}
              </Button>
            </Space>
          </Card>
        </Col>

        {/* 右侧 - 邀请结果 */}
        <Col xs={24} lg={10}>
          <Card
            bordered={false}
            style={{
              borderRadius: 20,
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
              height: '100%',
              minHeight: 500,
            }}
            bodyStyle={{
              padding: isMobile ? 20 : 28,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              fontWeight: 600,
              color: '#1f2937',
              fontSize: 16,
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <CheckCircleOutlined style={{ color: '#10a37f' }} />
              邀请结果
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Progress
                    type="circle"
                    percent={100}
                    format={() => <SendOutlined style={{ fontSize: 24, color: '#10a37f' }} />}
                    status="active"
                    size={100}
                    strokeColor="#10a37f"
                    trailColor="rgba(16, 163, 127, 0.1)"
                  />
                  <div style={{ marginTop: 24, color: '#6b7280', fontSize: 15 }}>正在发送邀请...</div>
                </div>
              )}

              {!loading && results.length > 0 && (
                <>
                  <Row gutter={16} style={{ marginBottom: 24 }}>
                    <Col span={12}>
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(16, 163, 127, 0.1) 0%, rgba(16, 163, 127, 0.05) 100%)',
                        padding: 20,
                        borderRadius: 16,
                        textAlign: 'center',
                        border: '1px solid rgba(16, 163, 127, 0.2)',
                      }}>
                        <div style={{ color: '#10a37f', fontSize: 36, fontWeight: 700 }}>{successCount}</div>
                        <div style={{ color: '#10a37f', fontSize: 14, fontWeight: 500, marginTop: 4 }}>成功</div>
                      </div>
                    </Col>
                    <Col span={12}>
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)',
                        padding: 20,
                        borderRadius: 16,
                        textAlign: 'center',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                      }}>
                        <div style={{ color: '#ef4444', fontSize: 36, fontWeight: 700 }}>{failCount}</div>
                        <div style={{ color: '#ef4444', fontSize: 14, fontWeight: 500, marginTop: 4 }}>失败</div>
                      </div>
                    </Col>
                  </Row>
                  <Table
                    dataSource={results}
                    columns={columns}
                    rowKey={(_, index) => `result-${index}`}
                    size="small"
                    pagination={{ pageSize: 8, hideOnSinglePage: true, size: 'small' }}
                    style={{ flex: 1 }}
                  />
                </>
              )}

              {!loading && results.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                  <div style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: 'rgba(16, 163, 127, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                  }}>
                    <SendOutlined style={{ fontSize: 32, color: '#10a37f', opacity: 0.5 }} />
                  </div>
                  <div style={{ fontSize: 15, color: '#6b7280' }}>邀请结果将在此显示</div>
                  <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 8 }}>输入邮箱并点击发送邀请</div>
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

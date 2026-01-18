import { useState, useEffect } from 'react'
import { Card, Form, Input, Button, Radio, InputNumber, Alert, Space, Modal, Tag, message, Table, Progress, Drawer } from 'antd'
import { MailOutlined, EyeOutlined, SendOutlined, ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { bulkEmailApi } from '../api'
import dayjs from 'dayjs'

const templateVars = ['{{email}}', '{{expires_at}}', '{{days_left}}', '{{code}}']

interface BulkEmailJob {
  job_id: string
  target: 'expiring' | 'expired' | 'all'
  days?: number
  subject: string
  status: string
  total: number
  sent: number
  failed: number
  fail_rate_limit: number
  fail_reject: number
  fail_invalid: number
  fail_other: number
  progress: number
  created_at: string
  started_at?: string
  finished_at?: string
}

interface BulkEmailLog {
  id: number
  email: string
  status: string
  reason_type?: string
  reason?: string
  created_at: string
}

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '排队中', color: 'default' },
  running: { label: '发送中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
}

const targetMap: Record<string, string> = {
  expiring: '快到期用户',
  expired: '已到期用户',
  all: '所有用户',
}

const reasonTypeMap: Record<string, { label: string; color: string }> = {
  rate_limit: { label: '账号限流', color: 'orange' },
  reject: { label: '拒收', color: 'red' },
  invalid: { label: '无效邮箱', color: 'volcano' },
  other: { label: '其他', color: 'default' },
}

export default function BulkEmail() {
  const [form] = Form.useForm()
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewSamples, setPreviewSamples] = useState<any[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [jobs, setJobs] = useState<BulkEmailJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<BulkEmailJob | null>(null)
  const [jobLogs, setJobLogs] = useState<BulkEmailLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logTotal, setLogTotal] = useState(0)

  const fetchPreview = async (values: any) => {
    setPreviewing(true)
    try {
      const res: any = await bulkEmailApi.preview({
        target: values.target,
        days: values.target === 'expiring' ? values.days : undefined,
      })
      setPreviewCount(res.count)
      setPreviewSamples(res.samples || [])
      return res.count as number
    } catch (e: any) {
      message.error(e.response?.data?.detail || '预览失败')
      return null
    } finally {
      setPreviewing(false)
    }
  }

  const handlePreview = async () => {
    const values = await form.validateFields()
    await fetchPreview(values)
  }

  const fetchJobs = async () => {
    setJobsLoading(true)
    try {
      const res: any = await bulkEmailApi.jobs(20)
      setJobs(res.jobs || [])
    } catch (e) {
      // handled by interceptor
    } finally {
      setJobsLoading(false)
    }
  }

  const fetchLogs = async (jobId: string) => {
    setLogsLoading(true)
    try {
      const res: any = await bulkEmailApi.jobLogs(jobId, { limit: 200 })
      setJobLogs(res.logs || [])
      setLogTotal(res.total || 0)
    } catch (e) {
      // handled by interceptor
    } finally {
      setLogsLoading(false)
    }
  }

  const openJob = (job: BulkEmailJob) => {
    setSelectedJob(job)
    setJobLogs([])
    setLogTotal(0)
  }

  const hasRunning = jobs.some(job => ['pending', 'running'].includes(job.status))

  useEffect(() => {
    fetchJobs()
  }, [])

  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => {
      fetchJobs()
    }, 5000)
    return () => clearInterval(timer)
  }, [hasRunning])

  useEffect(() => {
    if (!selectedJob) return
    const updated = jobs.find(job => job.job_id === selectedJob.job_id)
    if (updated) {
      setSelectedJob(updated)
    }
  }, [jobs, selectedJob?.job_id])

  useEffect(() => {
    if (!selectedJob) return
    fetchLogs(selectedJob.job_id)
  }, [selectedJob?.job_id])

  useEffect(() => {
    if (!selectedJob) return
    if (!['pending', 'running'].includes(selectedJob.status)) return
    const timer = setInterval(() => {
      fetchLogs(selectedJob.job_id)
    }, 5000)
    return () => clearInterval(timer)
  }, [selectedJob?.job_id, selectedJob?.status])

  const handleSend = async () => {
    const values = await form.validateFields()
    const count = await fetchPreview(values)
    if (count === null) return
    if (count === 0) {
      message.warning('没有可发送的用户')
      return
    }

    Modal.confirm({
      title: '确认发送邮件',
      icon: <ExclamationCircleOutlined />,
      content: `将向 ${count} 位用户发送邮件，是否继续？`,
      okText: '确认发送',
      cancelText: '取消',
      onOk: async () => {
        setSending(true)
        try {
          const res: any = await bulkEmailApi.send({
            target: values.target,
            days: values.target === 'expiring' ? values.days : undefined,
            subject: values.subject,
            content: values.content,
            confirm: true
          })
          message.success('发送任务已提交')
          fetchJobs()
          if (res.job_id) {
            const detail: any = await bulkEmailApi.jobDetail(res.job_id)
            openJob(detail)
          }
        } catch (e: any) {
          message.error(e.response?.data?.detail || '发送失败')
        } finally {
          setSending(false)
        }
      }
    })
  }

  const handleTest = async () => {
    const values = await form.validateFields()
    if (!values.test_email) {
      message.error('请填写测试邮箱')
      return
    }
    try {
      await bulkEmailApi.test({
        target: values.target,
        days: values.target === 'expiring' ? values.days : undefined,
        subject: values.subject,
        content: values.content,
        test_email: values.test_email,
      })
      message.success('测试邮件已发送')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '测试邮件发送失败')
    }
  }

  const jobColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => <span style={{ color: '#64748b', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>
    },
    {
      title: '对象',
      dataIndex: 'target',
      width: 120,
      render: (v: string) => targetMap[v] || v
    },
    {
      title: '标题',
      dataIndex: 'subject',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => {
        const info = statusMap[v] || { label: v, color: 'default' }
        return <Tag color={info.color}>{info.label}</Tag>
      }
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 180,
      render: (_: any, job: BulkEmailJob) => {
        const total = job.total || 0
        const done = (job.sent || 0) + (job.failed || 0)
        const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
        const status = job.status === 'failed' ? 'exception' : job.status === 'completed' ? 'success' : 'active'
        return <Progress percent={percent} size="small" status={status} />
      }
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 140,
      render: (_: any, job: BulkEmailJob) => (
        <span style={{ fontSize: 12, color: '#475569' }}>
          {job.sent}/{job.failed}/{job.total}
        </span>
      )
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 90,
      render: (_: any, job: BulkEmailJob) => (
        <Button size="small" onClick={() => openJob(job)}>查看</Button>
      )
    }
  ]

  const logColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => <span style={{ color: '#64748b', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</span>
    },
    { title: '邮箱', dataIndex: 'email', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'sent' ? 'green' : 'red'}>{v === 'sent' ? '成功' : '失败'}</Tag>
      )
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      render: (_: any, log: BulkEmailLog) => {
        if (log.status === 'sent') return '-'
        const info = reasonTypeMap[log.reason_type || 'other'] || reasonTypeMap.other
        return (
          <span>
            <Tag color={info.color}>{info.label}</Tag>
            <span style={{ color: '#64748b' }}>{log.reason || '-'}</span>
          </span>
        )
      }
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e' }}>
          <MailOutlined style={{ marginRight: 12, color: '#10b981' }} />
          邮件群发
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>向用户发送公告或到期提醒</p>
      </div>

      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="模板变量"
          description={
            <Space size={[8, 8]} wrap>
              {templateVars.map(item => (
                <Tag key={item} color="blue">{item}</Tag>
              ))}
              <span style={{ color: '#64748b', fontSize: 12 }}>（在标题和正文中均可使用）</span>
            </Space>
          }
        />

        <Form
          form={form}
          layout="vertical"
          initialValues={{ target: 'expiring', days: 7 }}
          style={{ maxWidth: 720 }}
        >
          <Form.Item name="target" label="发送对象" rules={[{ required: true, message: '请选择发送对象' }]}>
            <Radio.Group>
              <Radio value="expiring">快到期用户</Radio>
              <Radio value="expired">已到期用户</Radio>
              <Radio value="all">所有用户（公告）</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item shouldUpdate={(prev, cur) => prev.target !== cur.target} noStyle>
            {() => (
              form.getFieldValue('target') === 'expiring' ? (
                <Form.Item
                  name="days"
                  label="快到期天数"
                  rules={[{ required: true, message: '请输入天数' }]}
                >
                  <InputNumber min={0} style={{ width: 200 }} />
                </Form.Item>
              ) : null
            )}
          </Form.Item>

          <Form.Item name="subject" label="邮件标题" rules={[{ required: true, message: '请输入邮件标题' }]}>
            <Input placeholder="请输入邮件标题" size="large" />
          </Form.Item>

          <Form.Item name="content" label="邮件内容（支持 HTML）" rules={[{ required: true, message: '请输入邮件内容' }]}>
            <Input.TextArea rows={10} placeholder="<h2>公告</h2>..." />
          </Form.Item>

          <Form.Item name="test_email" label="测试邮箱">
            <Input placeholder="test@example.com" size="large" />
          </Form.Item>

          {previewCount !== null && (
            <div style={{ marginBottom: 16, color: '#10b981', fontWeight: 600 }}>
              预计发送人数：{previewCount}
            </div>
          )}

          {previewSamples.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>预览样例（去重后）</div>
              <Table
                size="small"
                pagination={false}
                rowKey="email"
                scroll={{ x: 520 }}
                dataSource={previewSamples}
                columns={[
                  { title: '邮箱', dataIndex: 'email', ellipsis: true },
                  { title: '到期日', dataIndex: 'expires_at', width: 120 },
                  { title: '剩余天数', dataIndex: 'days_left', width: 100 },
                  { title: '兑换码', dataIndex: 'code', width: 140, ellipsis: true },
                ]}
              />
            </div>
          )}

          <Space size="middle">
            <Button icon={<EyeOutlined />} onClick={handlePreview} loading={previewing}>
              预览人数
            </Button>
            <Button icon={<MailOutlined />} onClick={handleTest}>
              发送测试邮件
            </Button>
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={sending}>
              发送邮件
            </Button>
          </Space>
        </Form>
      </Card>

      <Card style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>发送进度</h3>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
              显示最近的群发任务与进度
            </p>
          </div>
          <Button icon={<ReloadOutlined />} onClick={fetchJobs} loading={jobsLoading}>刷新</Button>
        </div>
        <Table
          rowKey="job_id"
          dataSource={jobs}
          columns={jobColumns}
          loading={jobsLoading}
          pagination={{ pageSize: 8, showTotal: total => `共 ${total} 条记录` }}
        />
      </Card>

      <Drawer
        title="发送过程日志"
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        width={860}
      >
        {selectedJob && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{selectedJob.subject}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {targetMap[selectedJob.target]}
                {selectedJob.target === 'expiring' && selectedJob.days !== undefined ? ` · 快到期 ${selectedJob.days} 天` : ''}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Progress
                percent={selectedJob.total > 0 ? Math.min(100, Math.round(((selectedJob.sent + selectedJob.failed) / selectedJob.total) * 100)) : 0}
                status={selectedJob.status === 'failed' ? 'exception' : selectedJob.status === 'completed' ? 'success' : 'active'}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                已发送 {selectedJob.sent} / 失败 {selectedJob.failed} / 总数 {selectedJob.total}
              </div>
            </div>

            {selectedJob.failed > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>失败原因统计</div>
                <Space wrap>
                  <Tag color="orange">账号限流 {selectedJob.fail_rate_limit}</Tag>
                  <Tag color="red">拒收 {selectedJob.fail_reject}</Tag>
                  <Tag color="volcano">无效邮箱 {selectedJob.fail_invalid}</Tag>
                  <Tag>其他 {selectedJob.fail_other}</Tag>
                </Space>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>
                发送日志
                <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>
                  共 {logTotal} 条，显示最新 {jobLogs.length} 条
                </span>
              </div>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchLogs(selectedJob.job_id)} loading={logsLoading}>
                刷新
              </Button>
            </div>

            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={jobLogs}
              columns={logColumns}
              loading={logsLoading}
            />
          </div>
        )}
      </Drawer>
    </div>
  )
}

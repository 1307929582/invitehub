import { useState } from 'react'
import { Card, Form, Input, Button, Radio, InputNumber, Alert, Space, Modal, Tag, message, Table } from 'antd'
import { MailOutlined, EyeOutlined, SendOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { bulkEmailApi } from '../api'

const templateVars = ['{{email}}', '{{expires_at}}', '{{days_left}}', '{{code}}']

export default function BulkEmail() {
  const [form] = Form.useForm()
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewSamples, setPreviewSamples] = useState<any[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)

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
          await bulkEmailApi.send({
            target: values.target,
            days: values.target === 'expiring' ? values.days : undefined,
            subject: values.subject,
            content: values.content,
            confirm: true
          })
          message.success('发送任务已提交')
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
    </div>
  )
}

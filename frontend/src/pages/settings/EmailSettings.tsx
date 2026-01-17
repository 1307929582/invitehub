import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, InputNumber, Button, message, Alert, Switch, Space, Divider } from 'antd'
import { SaveOutlined, ArrowLeftOutlined, MailOutlined, SendOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { configApi } from '../../api'

export default function EmailSettings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [mailSyncing, setMailSyncing] = useState(false)
  const [mailScanning, setMailScanning] = useState(false)
  const [form] = Form.useForm()

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const res: any = await configApi.list()
      const values: Record<string, any> = {}
      res.configs.forEach((c: any) => {
        if (c.key === 'smtp_accounts') {
          try {
            const parsed = JSON.parse(c.value || '[]')
            values[c.key] = Array.isArray(parsed) ? parsed : []
          } catch {
            values[c.key] = []
          }
          return
        }
        values[c.key] = c.value || ''
      })
      form.setFieldsValue(values)
    } catch {
      message.error('获取配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const configs = Object.entries(values)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => {
          if (key === 'smtp_accounts') {
            const list = Array.isArray(value) ? value : []
            const cleaned = list.map((item: any) => ({
              host: String(item?.host || '').trim(),
              port: Number(item?.port || 0),
              user: String(item?.user || '').trim(),
              password: String(item?.password || '').trim(),
              daily_limit: item?.daily_limit === '' || item?.daily_limit === null || item?.daily_limit === undefined
                ? undefined
                : Number(item?.daily_limit),
              enabled: item?.enabled !== false,
            })).filter((item: any) => item.host && item.port && item.user && item.password)
            return {
              key,
              value: cleaned.length ? JSON.stringify(cleaned) : '',
              description: null,
            }
          }

          return {
            key,
            value: typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value || ''),
            description: null,
          }
        })
      await configApi.batchUpdate(configs)
      message.success('配置已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    setTesting(true)
    try {
      await configApi.testEmail()
      message.success('测试邮件已发送，请检查收件箱')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '发送失败，请检查 SMTP 配置')
    } finally {
      setTesting(false)
    }
  }

  const handleMailSync = async () => {
    setMailSyncing(true)
    try {
      await configApi.syncMailboxes()
      message.success('邮箱同步任务已提交')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '提交失败')
    } finally {
      setMailSyncing(false)
    }
  }

  const handleMailScan = async () => {
    setMailScanning(true)
    try {
      await configApi.scanBanEmails()
      message.success('封禁邮件扫描任务已提交')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '提交失败')
    } finally {
      setMailScanning(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <Button 
          type="text" 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate('/admin/settings')}
          style={{ marginBottom: 12, padding: 0 }}
        >
          返回设置
        </Button>
        <h2 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#1a1a2e' }}>
          <MailOutlined style={{ marginRight: 12, color: '#f59e0b' }} />
          邮件通知配置
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>配置 SMTP 邮件服务</p>
      </div>

      <Card loading={loading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="SMTP 配置说明"
          description={
            <div style={{ fontSize: 13 }}>
              <p style={{ margin: '4px 0' }}>• Gmail: smtp.gmail.com 端口 587，需要开启两步验证并生成应用专用密码</p>
              <p style={{ margin: '4px 0' }}>• Outlook: smtp.office365.com 端口 587</p>
              <p style={{ margin: '4px 0' }}>• QQ邮箱: smtp.qq.com 端口 587，需要开启 SMTP 服务并获取授权码</p>
            </div>
          }
        />

        <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item 
            name="email_enabled" 
            label="启用邮件通知"
            valuePropName="checked"
            getValueFromEvent={(checked) => checked}
            getValueProps={(value) => ({ checked: value === 'true' || value === true })}
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item name="smtp_from_name" label="发件人显示名（统一）" extra="为空则显示发件邮箱">
            <Input placeholder="ZenScale AI" size="large" />
          </Form.Item>

          <Divider style={{ margin: '24px 0 16px' }}>SMTP 账号池（轮询）</Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="填写多个 SMTP 账号后将按轮询发送，并支持单账号每日限额；未填写时使用下方单账号配置。"
          />

          <Form.List name="smtp_accounts">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 16,
                      background: '#fafafa'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontWeight: 600 }}>账号 {field.name + 1}</div>
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </div>

                    <Form.Item
                      {...field}
                      name={[field.name, 'enabled']}
                      label="启用"
                      valuePropName="checked"
                      getValueFromEvent={(checked) => checked}
                      getValueProps={(value) => ({ checked: value !== false })}
                    >
                      <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                    </Form.Item>

                    <Form.Item {...field} name={[field.name, 'host']} label="SMTP 服务器" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                      <Input placeholder="smtp.gmail.com" size="large" />
                    </Form.Item>

                    <Form.Item {...field} name={[field.name, 'port']} label="SMTP 端口" rules={[{ required: true, message: '请输入端口' }]}>
                      <InputNumber placeholder="587" size="large" style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item {...field} name={[field.name, 'user']} label="发件邮箱" rules={[{ required: true, message: '请输入发件邮箱' }]}>
                      <Input placeholder="your-email@gmail.com" size="large" />
                    </Form.Item>

                    <Form.Item {...field} name={[field.name, 'password']} label="邮箱应用密码" rules={[{ required: true, message: '请输入应用密码' }]}>
                      <Input.Password placeholder="应用专用密码" size="large" />
                    </Form.Item>

                    <Form.Item {...field} name={[field.name, 'daily_limit']} label="每日限额" extra="为空表示不限制">
                      <InputNumber placeholder="450" size="large" style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </div>
                ))}

                <Button
                  icon={<PlusOutlined />}
                  onClick={() => add({ port: 587, daily_limit: 450, enabled: true })}
                >
                  添加账号
                </Button>
              </>
            )}
          </Form.List>

          <Divider style={{ margin: '24px 0 16px' }}>单账号备用</Divider>

          <Form.Item name="smtp_host" label="SMTP 服务器" extra="如 smtp.gmail.com">
            <Input placeholder="smtp.gmail.com" size="large" />
          </Form.Item>

          <Form.Item name="smtp_port" label="SMTP 端口" extra="587 (TLS) 或 465 (SSL)">
            <Input placeholder="587" size="large" type="number" />
          </Form.Item>

          <Form.Item name="smtp_user" label="发件邮箱">
            <Input placeholder="your-email@gmail.com" size="large" />
          </Form.Item>

          <Form.Item name="smtp_password" label="邮箱应用密码" extra="Gmail 需要应用专用密码">
            <Input.Password placeholder="应用专用密码" size="large" />
          </Form.Item>

          <Form.Item name="admin_email" label="管理员邮箱" extra="接收预警通知的邮箱">
            <Input placeholder="admin@example.com" size="large" />
          </Form.Item>

          <Space size="middle">
            <Button type="primary" icon={<SaveOutlined />} size="large" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
            <Button icon={<SendOutlined />} size="large" loading={testing} onClick={handleTestEmail}>
              发送测试邮件
            </Button>
          </Space>

          <Divider style={{ margin: '32px 0 16px' }}>临时邮箱封禁检测</Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="用于自动识别封禁邮件并更新 Team 状态（无需刷新 Token）"
          />

          <Form.Item
            name="mail_api_enabled"
            label="启用封禁邮件检测"
            valuePropName="checked"
            getValueFromEvent={(checked) => checked}
            getValueProps={(value) => ({ checked: value === 'true' || value === true })}
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item name="mail_api_base" label="邮箱 API Base URL">
            <Input placeholder="https://mail.xmdbd.com/api" size="large" />
          </Form.Item>

          <Form.Item name="mail_api_key" label="邮箱 API Key">
            <Input.Password placeholder="API Key" size="large" />
          </Form.Item>

          <Form.Item name="mail_domain" label="邮箱域名" extra="如 xmdbd.com">
            <Input placeholder="xmdbd.com" size="large" />
          </Form.Item>

          <Form.Item name="mail_address_prefix" label="邮箱前缀" extra="如 xygpt+">
            <Input placeholder="xygpt+" size="large" />
          </Form.Item>

          <Form.Item name="mail_sender_keywords" label="发件人关键字" extra="逗号分隔，如 openai,chatgpt">
            <Input placeholder="openai,chatgpt" size="large" />
          </Form.Item>

          <Form.Item name="mail_ban_keywords" label="封禁关键词" extra="逗号分隔，如 banned,suspended,terminated">
            <Input placeholder="banned,suspended,terminated" size="large" />
          </Form.Item>

          <Form.Item name="mail_team_id_regex" label="Team ID 提取正则（可选）" extra="默认使用前缀+数字+域名解析">
            <Input placeholder="^xygpt\\+(\\d+)@xmdbd\\.com$" size="large" />
          </Form.Item>

          <Space size="middle">
            <Button loading={mailSyncing} onClick={handleMailSync}>
              立即同步邮箱
            </Button>
            <Button type="primary" loading={mailScanning} onClick={handleMailScan}>
              立即扫描封禁邮件
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}

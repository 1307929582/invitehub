import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message } from 'antd'
import { SaveOutlined, ArrowLeftOutlined, SafetyOutlined } from '@ant-design/icons'
import { configApi } from '../../api'

export default function WhitelistSettings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const res: any = await configApi.list()
      const values: Record<string, string> = {}
      res.configs.forEach((c: any) => {
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
        .map(([key, value]) => ({ key, value: String(value || ''), description: null }))
      await configApi.batchUpdate(configs)
      message.success('配置已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
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
          <SafetyOutlined style={{ marginRight: 12, color: '#6366f1' }} />
          白名单配置
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>配置管理员邮箱后缀白名单，这些邮箱不会被标记为未授权成员</p>
      </div>

      <Card loading={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item 
            name="admin_email_suffix" 
            label="白名单邮箱后缀" 
            extra="多个后缀用逗号分隔，例如：@xmdbd.com, @admin.com"
          >
            <Input placeholder="@xmdbd.com" size="large" />
          </Form.Item>

          <div style={{ padding: 16, background: '#f8fafc', borderRadius: 8, marginBottom: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 说明</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#64748b', fontSize: 13 }}>
              <li>以这些后缀结尾的邮箱在同步成员时不会被标记为"未授权成员"</li>
              <li>适用于 Team 号主或管理员的域名邮箱</li>
              <li>修改后需要重新同步成员才能生效</li>
            </ul>
          </div>

          <Button type="primary" icon={<SaveOutlined />} size="large" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </Form>
      </Card>
    </div>
  )
}

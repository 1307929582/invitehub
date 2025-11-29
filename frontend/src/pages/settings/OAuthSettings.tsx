import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Alert, Space } from 'antd'
import { SaveOutlined, ArrowLeftOutlined, SafetyOutlined } from '@ant-design/icons'
import { configApi } from '../../api'

export default function OAuthSettings() {
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
          <SafetyOutlined style={{ marginRight: 12, color: '#3b82f6' }} />
          LinuxDO OAuth 配置
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>配置 LinuxDO 登录授权</p>
      </div>

      <Card loading={loading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="配置说明"
          description={
            <div>
              <p>1. 访问 <a href="https://connect.linux.do" target="_blank" rel="noreferrer">connect.linux.do</a> 创建 OAuth 应用</p>
              <p>2. 回调地址填写：<code>http://你的域名/callback</code></p>
              <p>3. 将获取的 Client ID 和 Client Secret 填入下方</p>
            </div>
          }
        />

        <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item name="linuxdo_client_id" label="Client ID" extra="LinuxDO OAuth 应用的 Client ID">
            <Input placeholder="输入 Client ID" size="large" />
          </Form.Item>

          <Form.Item name="linuxdo_client_secret" label="Client Secret" extra="已保存的不会显示">
            <Input.Password placeholder="输入 Client Secret" size="large" />
          </Form.Item>

          <Form.Item name="linuxdo_redirect_uri" label="回调地址" extra="如 http://localhost:5173/callback">
            <Input placeholder="http://localhost:5173/callback" size="large" />
          </Form.Item>

          <Form.Item name="min_trust_level" label="最低信任等级" extra="LinuxDO 用户需要达到的最低信任等级（0-4）">
            <Input placeholder="0" size="large" type="number" />
          </Form.Item>

          <Button type="primary" icon={<SaveOutlined />} size="large" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </Form>
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Space, Divider } from 'antd'
import { SaveOutlined, ArrowLeftOutlined, BellOutlined, SyncOutlined } from '@ant-design/icons'
import { configApi } from '../../api'

export default function AlertSettings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
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

  const handleCheckAlerts = async () => {
    setChecking(true)
    try {
      const res: any = await configApi.checkAlerts()
      if (res.alerts?.length > 0) {
        message.warning(`发现 ${res.alerts.length} 个预警，已发送邮件通知`)
      } else {
        message.success('检查完成，暂无预警')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '检查失败')
    } finally {
      setChecking(false)
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
          <BellOutlined style={{ marginRight: 12, color: '#ef4444' }} />
          预警设置
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>配置预警阈值和规则</p>
      </div>

      <Card loading={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
          <h4 style={{ marginBottom: 16, color: '#1a1a2e' }}>Team 预警</h4>
          
          <Form.Item 
            name="alert_member_threshold" 
            label="超员预警阈值"
            extra="Team 成员超过此数量时发送预警（建议设为 5）"
          >
            <Input placeholder="5" size="large" type="number" />
          </Form.Item>

          <Form.Item 
            name="alert_token_days" 
            label="Token 过期预警天数"
            extra="Token 剩余天数少于此值时发送预警"
          >
            <Input placeholder="7" size="large" type="number" />
          </Form.Item>

          <Divider />

          <h4 style={{ marginBottom: 16, color: '#1a1a2e' }}>分组预警</h4>

          <Form.Item 
            name="group_seat_warning_threshold" 
            label="分组空位预警阈值"
            extra="分组剩余空位少于此数量时发送预警邮件"
          >
            <Input placeholder="5" size="large" type="number" />
          </Form.Item>

          <Divider />

          <Space size="middle">
            <Button type="primary" icon={<SaveOutlined />} size="large" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
            <Button icon={<SyncOutlined />} size="large" loading={checking} onClick={handleCheckAlerts}>
              立即检查预警
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}

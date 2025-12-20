import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Divider, Typography } from 'antd'
import { SaveOutlined, ArrowLeftOutlined, GlobalOutlined, StarOutlined } from '@ant-design/icons'
import { configApi } from '../../api'

const { Text } = Typography

const defaultFeatures = `[
  {"icon": "SafetyOutlined", "title": "安全稳定", "description": "官方 Team 账号，数据隔离，稳定可靠"},
  {"icon": "ThunderboltOutlined", "title": "GPT-4 无限", "description": "Team 版本无消息限制，畅享强大能力"},
  {"icon": "CustomerServiceOutlined", "title": "自助换车", "description": "Team 失效时可自助换车，无需等待"}
]`

export default function SiteSettings() {
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

  const validateFeaturesJson = (_: any, value: string) => {
    if (!value || value.trim() === '') return Promise.resolve()
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        return Promise.reject(new Error('必须是 JSON 数组格式'))
      }
      for (const item of parsed) {
        if (!item.icon || !item.title || !item.description) {
          return Promise.reject(new Error('每项必须包含 icon、title、description'))
        }
      }
      return Promise.resolve()
    } catch {
      return Promise.reject(new Error('JSON 格式无效'))
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
          <GlobalOutlined style={{ marginRight: 12, color: '#10b981' }} />
          站点配置
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>自定义站点显示内容</p>
      </div>

      <Card loading={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item
            name="site_url"
            label="站点 URL"
            extra="你的站点域名，用于生成直接邀请链接和 Telegram Bot Webhook"
            rules={[{ type: 'url', message: '请输入有效的 URL' }]}
          >
            <Input placeholder="https://team.example.com" size="large" />
          </Form.Item>

          <Form.Item name="site_title" label="站点标题" extra="显示在首页和浏览器标签上">
            <Input placeholder="ChatGPT Team 自助上车" size="large" />
          </Form.Item>

          <Form.Item name="site_description" label="站点描述" extra="显示在首页标题下方">
            <Input placeholder="使用兑换码加入 Team" size="large" />
          </Form.Item>

          <Form.Item name="home_notice" label="首页公告" extra="显示在首页的公告信息，留空则不显示">
            <Input.TextArea placeholder="例如：限时优惠中..." rows={3} />
          </Form.Item>

          <Form.Item name="success_message" label="成功提示" extra="兑换成功后显示的提示信息">
            <Input placeholder="邀请已发送！请查收邮箱并接受邀请" size="large" />
          </Form.Item>

          <Form.Item name="footer_text" label="页脚文字" extra="显示在页面底部，留空则不显示">
            <Input placeholder="例如：联系方式、版权信息等" size="large" />
          </Form.Item>

          <Divider>
            <GlobalOutlined style={{ marginRight: 8 }} />
            纯净页面配置
          </Divider>

          <Form.Item
            name="simple_page_domains"
            label="纯净页面域名"
            extra="配置哪些域名使用纯净版（只显示兑换表单，不显示左侧广告）。多个域名用英文逗号分隔。"
          >
            <Input.TextArea
              placeholder="例如：simple.zenscaleai.com, lite.zenscaleai.com"
              rows={2}
            />
          </Form.Item>

          <Divider>
            <StarOutlined style={{ marginRight: 8 }} />
            兑换页面左侧面板
          </Divider>

          <Form.Item
            name="hero_title"
            label="Hero 大标题"
            extra="兑换页面左侧的大标题，留空使用默认"
          >
            <Input placeholder="欢迎加入 Team" size="large" />
          </Form.Item>

          <Form.Item
            name="hero_subtitle"
            label="Hero 副标题"
            extra="兑换页面左侧的副标题说明"
          >
            <Input.TextArea
              placeholder="自助兑换服务，为您提供稳定、可靠的 ChatGPT Team 邀请。"
              rows={2}
            />
          </Form.Item>

          <Form.Item
            name="features"
            label="特性列表"
            extra={
              <div>
                <Text type="secondary">
                  JSON 数组格式，每项包含 icon、title、description。
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  可用图标：SafetyOutlined, ThunderboltOutlined, TeamOutlined, CustomerServiceOutlined, StarOutlined, RocketOutlined
                </Text>
              </div>
            }
            rules={[{ validator: validateFeaturesJson }]}
          >
            <Input.TextArea
              placeholder={defaultFeatures}
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>

          <Button type="primary" icon={<SaveOutlined />} size="large" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </Form>
      </Card>
    </div>
  )
}

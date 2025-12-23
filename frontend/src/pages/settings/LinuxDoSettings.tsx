import { useEffect, useState } from 'react'
import { Card, Form, Input, Button, message, Spin, Switch, Descriptions, Alert, Space, Divider } from 'antd'
import { ArrowLeftOutlined, SafetyCertificateOutlined, LinkOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { configApi, planApi } from '../../api'

interface LinuxDoConfig {
  enabled: boolean
  gateway_url: string
  pid: string
  key: string
}

interface Plan {
  id: number
  name: string
  price: number
  validity_days: number
  is_active: boolean
  stock?: number | null
  sold_count: number
  remaining_stock?: number | null
}

export default function LinuxDoSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [planCount, setPlanCount] = useState(0)
  const [config, setConfig] = useState<LinuxDoConfig>({
    enabled: false,
    gateway_url: 'https://credit.linux.do/epay',
    pid: '',
    key: '',
  })
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      configApi.list(),
      planApi.list({ plan_type: 'linuxdo' }),
    ]).then(([configRes, planRes]: any[]) => {
      const configs = configRes.configs || []
      const getValue = (key: string) => configs.find((c: any) => c.key === key)?.value || ''

      setConfig({
        enabled: getValue('linuxdo_enabled') === 'true',
        gateway_url: getValue('linuxdo_gateway_url') || 'https://credit.linux.do/epay',
        pid: getValue('linuxdo_pid'),
        key: getValue('linuxdo_key'),
      })
      setPlanCount((planRes.plans || []).filter((p: Plan) => p.is_active).length)
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    const gatewayUrl = config.gateway_url.trim()
    const pid = config.pid.trim()
    const key = config.key.trim()

    if (config.enabled && (!gatewayUrl || !pid || !key)) {
      message.error('请填写完整的 LinuxDo 配置')
      return
    }

    if (config.enabled) {
      try {
        const parsed = new URL(gatewayUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          message.error('支付网关地址必须是 http/https')
          return
        }
      } catch {
        message.error('支付网关地址无效')
        return
      }
    }

    if (config.enabled && planCount === 0) {
      message.error('请先创建 LinuxDo 套餐')
      return
    }

    setSaving(true)
    try {
      await configApi.batchUpdate([
        { key: 'linuxdo_enabled', value: config.enabled.toString() },
        { key: 'linuxdo_gateway_url', value: gatewayUrl },
        { key: 'linuxdo_pid', value: pid },
        { key: 'linuxdo_key', value: key },
      ])
      message.success('LinuxDo 配置已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/admin/settings')}
          style={{ marginBottom: 8 }}
        >
          返回设置
        </Button>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>LinuxDo 配置</h2>
        <p style={{ color: '#64748b', margin: '8px 0 0' }}>
          配置 LinuxDo 积分兑换接口，允许用户使用 L 币购买
        </p>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label="启用 LinuxDo 兑换">
            <Space>
              <Switch
                checked={config.enabled}
                onChange={v => setConfig({ ...config, enabled: v })}
                checkedChildren="已启用"
                unCheckedChildren="已关闭"
              />
              <span style={{ color: '#64748b' }}>
                {config.enabled ? '用户可使用 L 币兑换' : '暂不开放 L 币兑换'}
              </span>
            </Space>
          </Form.Item>

          <Divider />

          <Form.Item
            label={<Space><LinkOutlined />支付网关</Space>}
            extra="LinuxDo 积分支付网关地址"
            required={config.enabled}
          >
            <Input
              value={config.gateway_url}
              onChange={e => setConfig({ ...config, gateway_url: e.target.value })}
              placeholder="https://credit.linux.do/epay"
              disabled={!config.enabled}
            />
          </Form.Item>

          <Form.Item
            label={<Space><SafetyCertificateOutlined />商户 ID (PID)</Space>}
            extra="LinuxDo 积分支付分配的商户 ID"
            required={config.enabled}
          >
            <Input
              value={config.pid}
              onChange={e => setConfig({ ...config, pid: e.target.value })}
              placeholder="1000"
              disabled={!config.enabled}
            />
          </Form.Item>

          <Form.Item
            label={<Space><SafetyCertificateOutlined />商户密钥 (Key)</Space>}
            extra="LinuxDo 积分支付分配的商户密钥"
            required={config.enabled}
          >
            <Input.Password
              value={config.key}
              onChange={e => setConfig({ ...config, key: e.target.value })}
              placeholder="请输入商户密钥"
              disabled={!config.enabled}
            />
          </Form.Item>

          <Divider>套餐管理</Divider>

          <Form.Item
            label={<Space><AppstoreOutlined />LinuxDo 专属套餐</Space>}
            extra="LinuxDo 套餐独立管理，不与公开套餐共用。点击下方按钮管理套餐。"
          >
            <Space>
              <Button
                type="primary"
                onClick={() => navigate('/admin/settings/linuxdo/plans')}
              >
                管理 LinuxDo 套餐
              </Button>
              <span style={{ color: planCount > 0 ? '#52c41a' : '#ff4d4f' }}>
                当前已有 {planCount} 个上架套餐
              </span>
            </Space>
          </Form.Item>

          <Form.Item>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Alert
        type="info"
        showIcon
        message="回调地址配置"
        description={
          <div>
            <p style={{ margin: '8px 0 4px' }}>请在 LinuxDo 积分支付后台配置以下异步回调地址：</p>
            <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4 }}>
              {window.location.origin}/api/v1/linuxdo/notify
            </code>
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      <Alert
        type="warning"
        showIcon
        message="兑换页面访问"
        description={
          <div>
            <p style={{ margin: '8px 0 4px' }}>LinuxDo 用户专属兑换页面：</p>
            <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4 }}>
              {window.location.origin}/linuxdo/redeem
            </code>
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      <Card title="使用说明">
        <Descriptions column={1}>
          <Descriptions.Item label="支付平台">
            LinuxDo 积分支付（基于易支付协议）
          </Descriptions.Item>
          <Descriptions.Item label="兑换流程">
            用户选择套餐 → 跳转 LinuxDo 认证 → 使用 L 币支付 → 支付成功后自动生成兑换码
          </Descriptions.Item>
          <Descriptions.Item label="价格转换">
            套餐价格（分）将自动转换为 L 币（1元 = 1 L 币）
          </Descriptions.Item>
          <Descriptions.Item label="兑换码规则">
            支付成功后自动生成单次使用兑换码，有效期为套餐对应天数
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}

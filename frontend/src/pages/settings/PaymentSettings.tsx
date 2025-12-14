import { useEffect, useState } from 'react'
import { Card, Form, Input, Button, message, Spin, Switch, Descriptions, Alert, Space, Divider } from 'antd'
import { ArrowLeftOutlined, SafetyCertificateOutlined, AlipayCircleOutlined, WechatOutlined, LinkOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { configApi } from '../../api'

interface EpayConfig {
  enabled: boolean
  api_url: string
  pid: string
  key: string
  alipay_enabled: boolean
  wxpay_enabled: boolean
}

export default function PaymentSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<EpayConfig>({
    enabled: false,
    api_url: '',
    pid: '',
    key: '',
    alipay_enabled: true,
    wxpay_enabled: false,
  })
  const navigate = useNavigate()

  useEffect(() => {
    configApi.list().then((res: any) => {
      const configs = res.configs || []
      const getValue = (key: string) => configs.find((c: any) => c.key === key)?.value || ''
      setConfig({
        enabled: getValue('epay_enabled') === 'true',
        api_url: getValue('epay_api_url'),
        pid: getValue('epay_pid'),
        key: getValue('epay_key'),
        alipay_enabled: getValue('epay_alipay_enabled') !== 'false',
        wxpay_enabled: getValue('epay_wxpay_enabled') === 'true',
      })
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (config.enabled && (!config.api_url || !config.pid || !config.key)) {
      message.error('请填写完整的支付配置')
      return
    }

    setSaving(true)
    try {
      await configApi.batchUpdate([
        { key: 'epay_enabled', value: config.enabled.toString() },
        { key: 'epay_api_url', value: config.api_url },
        { key: 'epay_pid', value: config.pid },
        { key: 'epay_key', value: config.key },
        { key: 'epay_alipay_enabled', value: config.alipay_enabled.toString() },
        { key: 'epay_wxpay_enabled', value: config.wxpay_enabled.toString() },
      ])
      message.success('支付配置已保存')
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
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>支付配置</h2>
        <p style={{ color: '#64748b', margin: '8px 0 0' }}>
          配置易支付接口，启用首页在线购买功能
        </p>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label="启用在线购买">
            <Space>
              <Switch
                checked={config.enabled}
                onChange={v => setConfig({ ...config, enabled: v })}
                checkedChildren="已启用"
                unCheckedChildren="已关闭"
              />
              <span style={{ color: '#64748b' }}>
                {config.enabled ? '首页将显示购买入口' : '首页不显示购买入口'}
              </span>
            </Space>
          </Form.Item>

          <Divider />

          <Form.Item
            label={<Space><LinkOutlined />API 地址</Space>}
            extra="易支付平台提供的 API 地址，如 https://pay.example.com"
            required={config.enabled}
          >
            <Input
              value={config.api_url}
              onChange={e => setConfig({ ...config, api_url: e.target.value })}
              placeholder="https://pay.example.com"
              disabled={!config.enabled}
            />
          </Form.Item>

          <Form.Item
            label={<Space><SafetyCertificateOutlined />商户 ID (PID)</Space>}
            extra="易支付平台分配的商户 ID"
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
            extra="易支付平台分配的商户密钥，用于签名验证"
            required={config.enabled}
          >
            <Input.Password
              value={config.key}
              onChange={e => setConfig({ ...config, key: e.target.value })}
              placeholder="请输入商户密钥"
              disabled={!config.enabled}
            />
          </Form.Item>

          <Divider>支付方式</Divider>

          <Form.Item label={<Space><AlipayCircleOutlined style={{ color: '#1677ff' }} />支付宝</Space>}>
            <Switch
              checked={config.alipay_enabled}
              onChange={v => setConfig({ ...config, alipay_enabled: v })}
              disabled={!config.enabled}
            />
          </Form.Item>

          <Form.Item label={<Space><WechatOutlined style={{ color: '#07c160' }} />微信支付</Space>}>
            <Switch
              checked={config.wxpay_enabled}
              onChange={v => setConfig({ ...config, wxpay_enabled: v })}
              disabled={!config.enabled}
            />
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
            <p style={{ margin: '8px 0 4px' }}>请在易支付后台配置以下异步回调地址：</p>
            <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4 }}>
              {window.location.origin}/api/v1/public/shop/notify
            </code>
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      <Card title="使用说明">
        <Descriptions column={1}>
          <Descriptions.Item label="支持平台">
            支持任何兼容易支付协议的支付平台（彩虹易支付等）
          </Descriptions.Item>
          <Descriptions.Item label="支付流程">
            用户选择套餐 → 选择支付方式 → 跳转支付 → 支付成功后自动生成兑换码
          </Descriptions.Item>
          <Descriptions.Item label="兑换码规则">
            支付成功后自动生成 BUY_ 前缀的兑换码，有效期为套餐对应天数
          </Descriptions.Item>
          <Descriptions.Item label="订单管理">
            可在「订单管理」页面查看所有订单记录和收入统计
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}

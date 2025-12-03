import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Button, message, Spin, Descriptions } from 'antd'
import { ArrowLeftOutlined, DollarOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { configApi } from '../../api'

export default function PriceSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [price, setPrice] = useState<number>(0)
  const navigate = useNavigate()

  useEffect(() => {
    configApi.list().then((res: any) => {
      const priceConfig = res.configs.find((c: any) => c.key === 'redeem_unit_price')
      if (priceConfig?.value) {
        setPrice(parseFloat(priceConfig.value) || 0)
      }
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await configApi.update('redeem_unit_price', price.toString())
      message.success('价格配置已保存')
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
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>价格配置</h2>
        <p style={{ color: '#64748b', margin: '8px 0 0' }}>
          配置兑换码单价，用于销售统计计算
        </p>
      </div>

      <Card>
        <Form layout="vertical">
          <Form.Item 
            label="兑换码单价（元）"
            help="设置每个兑换码的价格，用于计算销售额统计"
          >
            <InputNumber
              prefix={<DollarOutlined />}
              value={price}
              onChange={v => setPrice(v || 0)}
              min={0}
              step={0.01}
              precision={2}
              style={{ width: 200 }}
              placeholder="0.00"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Form.Item>
        </Form>

        <Descriptions title="说明" column={1} style={{ marginTop: 24 }}>
          <Descriptions.Item label="销售额计算">
            销售额 = 激活的兑换码数量 × 单价
          </Descriptions.Item>
          <Descriptions.Item label="统计周期">
            支持今日、本周、本月销售额统计
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}

import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { HomeOutlined, QuestionCircleOutlined } from '@ant-design/icons'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f7 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <Result
        status="404"
        title={<span style={{ color: '#1d1d1f', fontWeight: 700 }}>页面不存在</span>}
        subTitle={<span style={{ color: '#86868b' }}>抱歉，您访问的页面不存在或已被移除</span>}
        extra={[
          <Button
            key="home"
            type="primary"
            icon={<HomeOutlined />}
            onClick={() => navigate('/')}
            style={{
              height: 44,
              borderRadius: 10,
              fontWeight: 600,
              background: '#007aff',
              border: 'none',
            }}
          >
            返回首页
          </Button>,
          <Button
            key="faq"
            icon={<QuestionCircleOutlined />}
            onClick={() => navigate('/faq')}
            style={{
              height: 44,
              borderRadius: 10,
              fontWeight: 500,
            }}
          >
            常见问题
          </Button>,
        ]}
      />
    </div>
  )
}

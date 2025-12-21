import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import App from './App'
import './index.css'

// 配置 dayjs 使用 UTC+8 时区
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Shanghai')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#007aff',
          colorSuccess: '#34c759',
          colorWarning: '#ff9500',
          colorError: '#ff3b30',
          colorInfo: '#5ac8fa',
          borderRadius: 10,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 40,
          },
          Card: {
            borderRadius: 16,
          },
          Input: {
            borderRadius: 10,
          },
          Select: {
            borderRadius: 10,
          },
          Modal: {
            borderRadius: 16,
          },
          Message: {
            contentBg: '#fff',
            contentPadding: '12px 16px',
          },
          Notification: {
            borderRadius: 12,
          },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)

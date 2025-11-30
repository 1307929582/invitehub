import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import axios from 'axios'

interface VersionInfo {
  current_version: string
  latest_version: string | null
  has_update: boolean
  update_url: string | null
}

export default function VersionChecker() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // 检查是否已经dismiss过这个版本
    const dismissedVersion = localStorage.getItem('dismissed_version')
    
    axios.get('/api/v1/setup/version')
      .then(res => {
        const info = res.data
        setVersionInfo(info)
        
        // 如果是新版本，重置dismiss状态
        if (info.latest_version && dismissedVersion !== info.latest_version) {
          setDismissed(false)
        } else if (dismissedVersion === info.latest_version) {
          setDismissed(true)
        }
      })
      .catch(() => {})
  }, [])

  const handleDismiss = () => {
    if (versionInfo?.latest_version) {
      localStorage.setItem('dismissed_version', versionInfo.latest_version)
    }
    setDismissed(true)
  }

  if (!versionInfo?.has_update || dismissed) {
    return null
  }

  return (
    <Alert
      message={
        <span>
          <SyncOutlined spin style={{ marginRight: 8 }} />
          发现新版本 <strong>v{versionInfo.latest_version}</strong>（当前 v{versionInfo.current_version}）
        </span>
      }
      type="info"
      showIcon={false}
      closable
      onClose={handleDismiss}
      action={
        <Button 
          size="small" 
          type="primary"
          onClick={() => window.open(versionInfo.update_url || '', '_blank')}
        >
          查看更新
        </Button>
      }
      style={{ marginBottom: 16 }}
    />
  )
}

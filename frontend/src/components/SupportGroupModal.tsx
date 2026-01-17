import { Modal, Button, Space, Typography, message } from 'antd'
import { SendOutlined, MessageOutlined } from '@ant-design/icons'

const { Paragraph } = Typography

interface SupportGroupModalProps {
  open: boolean
  onClose: () => void
  messageText?: string
  tgLink?: string
  qqGroup?: string
  title?: string
}

const defaultMessage = '欢迎加入售后交流群，获取使用答疑与公告。'

export default function SupportGroupModal({
  open,
  onClose,
  messageText,
  tgLink,
  qqGroup,
  title,
}: SupportGroupModalProps) {
  const safeTg = (tgLink || '').trim()
  const safeQq = (qqGroup || '').trim()

  if (!safeTg && !safeQq) return null

  const openTelegram = () => {
    if (!safeTg) return
    window.open(safeTg, '_blank', 'noopener,noreferrer')
  }

  const copyQqGroup = async () => {
    if (!safeQq) return
    try {
      await navigator.clipboard.writeText(safeQq)
      message.success('QQ群号已复制')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const resolvedMessage = messageText !== undefined ? messageText : defaultMessage

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      title={title || '加入售后交流群'}
    >
      {resolvedMessage !== '' && (
        <Paragraph style={{ marginBottom: 16, color: '#1d1d1f' }}>
          {resolvedMessage}
        </Paragraph>
      )}
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {safeTg && (
          <Button type="primary" block icon={<SendOutlined />} onClick={openTelegram}>
            加入 Telegram 群
          </Button>
        )}
        {safeQq && (
          <Button block icon={<MessageOutlined />} onClick={copyQqGroup}>
            复制 QQ 群号 {safeQq}
          </Button>
        )}
        <Button block onClick={onClose}>稍后再说</Button>
      </Space>
    </Modal>
  )
}

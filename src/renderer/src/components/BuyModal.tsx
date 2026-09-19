import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Btn } from './ui'
import { useToast } from '../stores/ui'

// 购买授权弹窗：展示作者联系方式（后台填的 buy_contact），主播购买后后台开通立即生效
export default function BuyModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useToast((s) => s.toast)
  const [contact, setContact] = useState('')

  useEffect(() => {
    if (open) {
      window.api.emailBuyContact().then((c) => setContact(c || ''))
    }
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contact)
      toast('联系方式已复制', 'success')
    } catch {
      toast('复制失败，请手动复制', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="购买游戏授权"
      width={440}
      footer={<Btn onClick={onClose}>知道了</Btn>}
    >
      <div className="space-y-3 text-sm leading-6 text-[var(--text-2)]">
        <p>
          联系作者购买后，作者在后台为你的邮箱开通授权，客户端会立即显示「已授权」，无需重启。
        </p>
        {contact ? (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
            <div className="text-xs text-[var(--text-4)]">作者联系方式</div>
            <div className="select-text mt-1 break-all font-mono text-[var(--text)]">
              {contact}
            </div>
            <Btn size="sm" variant="secondary" onClick={copy} className="mt-2">
              复制
            </Btn>
          </div>
        ) : (
          <p className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
            作者还没填写联系方式，请稍后再来。
          </p>
        )}
        <p className="text-xs text-[var(--text-4)]">
          已购买？去「启动游戏」页申请对应游戏授权即可。
        </p>
      </div>
    </Modal>
  )
}

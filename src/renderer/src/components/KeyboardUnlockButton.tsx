import { Btn } from './ui'
import { useToast } from '../stores/ui'

export function KeyboardUnlockButton() {
  const toast = useToast((s) => s.toast)
  return <Btn variant="secondary" title="整蛊导致按键失灵时使用；平时无需操作，也可按 Esc 恢复" onClick={async () => {
    try {
      const result = await window.api.entertainmentCommand('key-unlock')
      toast(result.ok ? '键盘已解锁' : result.error || '解锁失败，请按 Esc 重试', result.ok ? 'success' : 'error')
    } catch {
      toast('解锁请求失败，请按 Esc 解锁', 'error')
    }
  }}>紧急恢复键盘</Btn>
}

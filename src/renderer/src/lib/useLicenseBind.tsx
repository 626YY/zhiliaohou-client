import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { Btn } from '../components/ui'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/ui'
import { CARD_PLATFORM_PRODUCT, useCardStore } from './useCardAccess'

// 直播间绑定 + 卡密授权门禁复用逻辑：
// 绑定前检查授权 → 未授权弹申请引导 → 提交申请后等待作者审批 → 获批自动绑定
// 卡密平台模式（本机配置了卡密平台）：主进程按当前账号的卡密权益决定能不能绑，
// 没权益时不走「提交申请等审批」，直接弹卡密激活，激活后重新点绑定即可。
export function useLicenseBind() {
  const toast = useToast((s) => s.toast)
  const updateRooms = useAuth((s) => s.updateRooms)
  const cardEnabled = useCardStore((s) => !!s.snapshot?.enabled)
  const openCardPrompt = useCardStore((s) => s.openPrompt)
  const [confirmRoom, setConfirmRoom] = useState('')
  const [waiting, setWaiting] = useState('')

  useEffect(() => {
    return window.api.onRoomAutoBound(({ room, boundRooms }) => {
      updateRooms(boundRooms)
      setWaiting('')
      setConfirmRoom('')
      toast(`授权通过，已自动绑定直播间 ${room}`, 'success')
    })
  }, [toast, updateRooms])

  const tryBind = async (room: string): Promise<boolean> => {
    const r = room.trim()
    if (!r) return false
    if (waiting === r) {
      toast('该直播间申请审批中，通过后自动绑定', 'info')
      return false
    }
    const res = await window.api.bindRoomWithLicense(r)
    if (res.ok && res.boundRooms) {
      updateRooms(res.boundRooms)
      toast('直播间号已绑定', 'success')
      return true
    }
    if (cardEnabled && (res.needApply || res.pending)) {
      toast('当前账号还没有激活娱乐助手卡密，激活后再绑定直播间', 'info')
      openCardPrompt(CARD_PLATFORM_PRODUCT)
      return false
    }
    if (res.pending) {
      setWaiting(r)
      toast('该直播间申请审批中，通过后自动绑定', 'info')
      return false
    }
    if (res.needApply) {
      setConfirmRoom(r)
      return false
    }
    toast(res.error ?? '绑定失败', 'error')
    return false
  }

  const submitApply = async () => {
    const room = confirmRoom
    setConfirmRoom('')
    const res = await window.api.submitRoomApply(room)
    // 服务器发现该房已授权（作者已批过）→ 主进程已直接完成绑定，不用等审批
    if (res.ok && res.bound) {
      if (res.boundRooms) updateRooms(res.boundRooms)
      toast(`直播间 ${room} 已获授权，已直接绑定`, 'success')
      return
    }
    if (res.ok) {
      setWaiting(room)
      toast('申请已提交，等待作者审批（通过后自动绑定）', 'info')
    } else {
      toast(res.error ?? '申请提交失败', 'error')
    }
  }

  const cancel = () => setConfirmRoom('')

  const modal = waiting ? (
    <Modal
      open
      onClose={() => setWaiting('')}
      title="已提交申请"
      width={420}
      footer={<Btn variant="secondary" onClick={() => setWaiting('')}>知道了</Btn>}
    >
      <p className="text-sm leading-6 text-[var(--text-2)]">
        直播间「{waiting}」的购买申请已提交，等待作者审批。
        请保持连接器连接该直播间，授权通过后会自动绑定到本账号。
      </p>
    </Modal>
  ) : (
    <Modal
      open={!!confirmRoom}
      onClose={cancel}
      title="需要申请授权"
      width={420}
      footer={
        <>
          <Btn variant="secondary" onClick={cancel}>
            取消
          </Btn>
          <Btn onClick={submitApply}>提交申请</Btn>
        </>
      }
    >
      <p className="text-sm leading-6 text-[var(--text-2)]">
        直播间「{confirmRoom}」尚未获得授权，请先激活卡密，再绑定直播间。
        提交后等待作者审批，通过即自动绑定。
      </p>
    </Modal>
  )

  return { tryBind, modal }
}

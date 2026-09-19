// 直播间名额快照：一个 RoomManager 实例一份，操作后手动 refresh；卡密快照里带 roomQuota 变化时也跟着刷。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../stores/auth'
import { useCardStore } from '../../lib/useCardAccess'
import { resolveRoomApi, type RoomApi, type RoomQuotaState } from './roomApi'

export type RoomQuotaHook = {
  api: RoomApi | null
  quota: RoomQuotaState | null
  loaded: boolean
  error: string
  refresh: () => Promise<RoomQuotaState | null>
  /** 主进程命令直接回了 quota / boundRooms 时就地更新，省一次往返 */
  apply: (quota?: RoomQuotaState | null, boundRooms?: string[]) => void
}

const sameRooms = (a: string[], b: string[]) => a.length === b.length && a.every((r, i) => r === b[i])

export function useRoomQuota(): RoomQuotaHook {
  const api = resolveRoomApi()
  const updateRooms = useAuth((s) => s.updateRooms)
  const boundRooms = useAuth((s) => s.user?.boundRooms)
  const accountId = useAuth((s) => s.user?.id)
  const [quota, setQuota] = useState<RoomQuotaState | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const ticket = useRef(0)
  const boundRef = useRef<string[] | undefined>(boundRooms)
  boundRef.current = boundRooms

  const apply = useCallback(
    (next?: RoomQuotaState | null, rooms?: string[]) => {
      if (next) {
        setQuota(next)
        setError('')
        setLoaded(true)
        const list = Array.isArray(next.rooms) ? next.rooms : []
        if (!sameRooms(list, boundRef.current ?? [])) updateRooms(list)
      } else if (rooms) {
        setQuota((q) => (q ? { ...q, rooms } : q))
        if (!sameRooms(rooms, boundRef.current ?? [])) updateRooms(rooms)
      }
    },
    [updateRooms]
  )

  const refresh = useCallback(async () => {
    if (!api) {
      setLoaded(true)
      return null
    }
    const mine = ++ticket.current
    try {
      const r = await api.cardRooms()
      if (!alive.current || mine !== ticket.current) return null
      if (r.ok && r.quota) {
        apply(r.quota)
        return r.quota
      }
      setError(r.error || '暂时读不到直播间名额')
      setLoaded(true)
      return null
    } catch (e) {
      if (!alive.current || mine !== ticket.current) return null
      setError(e instanceof Error ? e.message : '暂时读不到直播间名额')
      setLoaded(true)
      return null
    }
    // 接口对象每次 render 重新解析，但成员都指向同一份 window.api，依赖只看它在不在
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!api, apply])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh, accountId])

  // 卡密快照（轮询）里若带 roomQuota，变了就同步（兑换名额卡 / 后台改名额都能立刻反映）
  const snapQuota = useCardStore((s) => (s.snapshot as { roomQuota?: RoomQuotaState } | null)?.roomQuota)
  const snapKey = snapQuota ? JSON.stringify(snapQuota) : ''
  useEffect(() => {
    if (snapQuota) apply(snapQuota)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey])

  return { api, quota, loaded, error, refresh, apply }
}

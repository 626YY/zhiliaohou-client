// 特色整蛊盲盒事件库（主进程存着，几处页面共用：特色整蛊页、礼物触发、基础引导、整蛊遥控、转盘类动作）。
// 哪里改了事件库主进程都会广播 SpecialChanged，各处跟着刷新，勾选奖池时看到的总是最新的事件。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpecialBoxEvent } from '@shared/specialGames'

export function useSpecialBoxEvents(): {
  events: SpecialBoxEvent[]
  loaded: boolean
  refresh: () => Promise<void>
  save: (next: SpecialBoxEvent[]) => Promise<SpecialBoxEvent[]>
} {
  const [events, setEvents] = useState<SpecialBoxEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  // 特色整蛊页别处一有改动（开窗、改玩法设置）都会广播：事件库没变就别换数组，不然整个事件库和每个礼物的奖池都跟着重画
  const sig = useRef('')
  const refresh = useCallback(async () => {
    const list = await window.api.specialBoxEvents().catch(() => null)
    if (list) {
      const next = JSON.stringify(list)
      if (next !== sig.current) { sig.current = next; setEvents(list) }
    }
    setLoaded(true)
  }, [])
  useEffect(() => {
    void refresh()
    return window.api.onSpecialChanged(() => void refresh())
  }, [refresh])
  const save = useCallback(async (next: SpecialBoxEvent[]) => {
    setEvents(next)
    const r = await window.api.specialBoxEventsSave(next)
    sig.current = JSON.stringify(r.events)
    setEvents(r.events)
    return r.events
  }, [])
  return { events, loaded, refresh, save }
}

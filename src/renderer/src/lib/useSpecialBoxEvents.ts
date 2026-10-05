// 特色整蛊盲盒事件库（主进程存着，几处页面共用：特色整蛊页、礼物触发、基础引导、整蛊遥控、转盘类动作）。
// 哪里改了事件库主进程都会广播 SpecialChanged，各处跟着刷新，勾选奖池时看到的总是最新的事件。
import { useCallback, useEffect, useState } from 'react'
import type { SpecialBoxEvent } from '@shared/specialGames'

export function useSpecialBoxEvents(): {
  events: SpecialBoxEvent[]
  loaded: boolean
  refresh: () => Promise<void>
  save: (next: SpecialBoxEvent[]) => Promise<SpecialBoxEvent[]>
} {
  const [events, setEvents] = useState<SpecialBoxEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const refresh = useCallback(async () => {
    const list = await window.api.specialBoxEvents().catch(() => null)
    if (list) setEvents(list)
    setLoaded(true)
  }, [])
  useEffect(() => {
    void refresh()
    return window.api.onSpecialChanged(() => void refresh())
  }, [refresh])
  const save = useCallback(async (next: SpecialBoxEvent[]) => {
    setEvents(next)
    const r = await window.api.specialBoxEventsSave(next)
    setEvents(r.events)
    return r.events
  }, [])
  return { events, loaded, refresh, save }
}

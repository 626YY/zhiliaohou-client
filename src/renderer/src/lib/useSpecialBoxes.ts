// 特色整蛊盲盒列表（主进程存着，几处页面共用：特色整蛊页、礼物触发、基础引导、整蛊遥控、转盘类动作）
import { useCallback, useEffect, useState } from 'react'
import type { SpecialBox } from '@shared/specialGames'

export function useSpecialBoxes(): { boxes: SpecialBox[]; refresh: () => Promise<void>; setBoxes: (b: SpecialBox[]) => void } {
  const [boxes, setBoxes] = useState<SpecialBox[]>([])
  const refresh = useCallback(async () => { setBoxes(await window.api.specialBoxes().catch(() => [])) }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { boxes, refresh, setBoxes }
}

import {useCardStore,cardRightValid} from './useCardAccess'
import {useAuth} from '../stores/auth'
import { useCallback, useEffect, useState } from 'react'
import type { GameItem, EmailLicense } from '@shared/types'
import { getCachedAuth, fetchAuth } from './gameAuthCache'

// 游戏授权选择：读游戏清单 + 当前邮箱账号的 per-game 授权。
// 授权走全局缓存（登录时预取），切页面不再请求服务器。
// 未登录邮箱（auth=null）不设限（兼容卡密用户）；登录后该游戏必须在 games 里才算已授权。
// 选中游戏会同步到主进程（bridge/config/launcher/connector 全部按它路由）。
export function useGameAuth() {
  const card=useCardStore(s=>s.snapshot)
  const accountId=useAuth(s=>s.user?.id)
  const [games, setGames] = useState<GameItem[]>([])
  const [auth, setAuth] = useState<EmailLicense | null>(null)
  const [ready, setReady] = useState(false)
  const [gameId, setGameIdState] = useState('')

  const setGameId = useCallback((id: string) => {
    setGameIdState(id)
    if (id) void window.api.setGameCurrent(id)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [g, s, st] = await Promise.all([
        window.api.gamesList(),
        window.api.session(),
        window.api.getSettings()
      ])
      if (!alive) return
      setGames(g)
      const em = s?.email ?? ''
      let a = getCachedAuth(em)
      if (a === undefined) a = await fetchAuth(em)
      if (!alive) return
      setAuth(a)
      // 初始选中：主进程当前游戏优先（别的页面刚切过就跟上），否则第一个已授权游戏
      const ok = (id: string) => g.some((x) => x.id === id) && (a ? !!a.games?.[id] : true)
      const mainCur = st.settings.currentGameId ?? ''
      const firstAuthed = g.find((x) => ok(x.id))
      const initId = (mainCur && ok(mainCur) ? mainCur : '') || firstAuthed?.id || g[0]?.id || ''
      setGameIdState(initId)
      // 初始选择也同步主进程，保证 bridge/config 路由一致
      if (initId) void window.api.setGameCurrent(initId)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  // 游戏是否可修改参数：未登录邮箱 → 放行；已登录 → games 含该游戏且未封禁
  const authorized = useCallback(
    (id: string): boolean => {
      if(card?.enabled)return card.ok&&card.user?.id===accountId&&cardRightValid(card.rights?.find(r=>r.id==='platform:assistant'))&&cardRightValid(card.rights?.find(r=>r.id==='game:'+id))
      if (!auth) return true
      if (auth.banned) return false
      return !!auth.games?.[id]
    },
    [auth,card,accountId]
  )

  const authedGames = games.filter((g) => authorized(g.id))

  return { games, auth, ready, gameId, setGameId, authorized, authedGames }
}

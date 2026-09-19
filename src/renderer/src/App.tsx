import { lazy, Suspense, useEffect, useRef } from 'react'
import { Loading } from './components/ui'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './stores/auth'
import { useToast } from './stores/ui'
import { useNotify } from './stores/notify'
import { usePrankStore } from './stores/pranks'
import { loadCred } from './lib/cred'
import { preloadAuth } from './lib/gameAuthCache'
import { applyTheme } from './lib/theme'
import { ToastHost } from './components/Toast'
import UpdateModal from './components/UpdateModal'
import { AuthLoading } from './components/AuthLoading'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import {AssetOnboarding} from './components/AssetLibrarySetup'
import { CardAccessHost, EntertainmentCardBar } from './components/CardAccess'
import Login from './pages/Login'
import Library from './pages/Library'
const ModDetail = lazy(() => import('./pages/ModDetail'))
const ConfigEditor = lazy(() => import('./pages/ConfigEditor'))
const LaunchGame = lazy(() => import('./pages/LaunchGame'))
const PrankControl = lazy(() => import('./pages/PrankControl'))
const Stats = lazy(() => import('./pages/Stats'))
const Connector = lazy(() => import('./pages/Connector'))
const News = lazy(() => import('./pages/News'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Settings = lazy(() => import('./pages/Settings'))
const Guide = lazy(() => import('./pages/Guide'))
const Entertainment = lazy(() => import('./pages/Entertainment'))
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { openWidgets, readAutoOpenIds } from './lib/widgetLaunchers'
import { modUpdateAvailable } from './lib/version'

function Splash() {
  return <AuthLoading />
}

export default function App() {
  const { user, loading, setUser, setLoading } = useAuth()
  const toast = useToast((s) => s.toast)
  const bumpNotify = useNotify((s) => s.bump)
  const navigate = useNavigate()
  const location = useLocation()
  const prevRunning = useRef(false)

  // 整蛊菜单（定义包）：启动拉一次；主进程从更新源刷到新定义包会广播，再拉一次 → 上新整蛊不用发客户端
  const loadPranks = usePrankStore((s) => s.load)
  useEffect(() => {
    void loadPranks()
    return window.api.onPrankCatalogChanged(() => {
      void loadPranks()
    })
  }, [loadPranks])

  // 新通知（后台解绑/换绑、购买成功、授权开通）→ 弹 toast + 侧边栏未读 +1
  useEffect(() => {
    return window.api.onNotifyNew((n) => {
      toast(n.text, 'info')
      bumpNotify()
    })
  }, [toast, bumpNotify])

  // 邮箱绑定同步（主进程在通知轮询发现后台解绑/换绑后触发）→ 刷新房间列表
  const updateRooms = useAuth((s) => s.updateRooms)
  useEffect(() => {
    return window.api.onRoomsSynced((p) => {
      updateRooms(p.boundRooms)
    })
  }, [updateRooms])

  // 规则音效由主进程广播给常驻根组件。页面切换不会截断播放，也不会让礼物规则
  // 因为设置页卸载而失效；unique 模式只阻止同一路径的重叠播放。
  useEffect(() => {
    const active = new Map<string, HTMLAudioElement>()
    const toUrl = (value: string) => {
      if (/^(?:https?:|data:|file:)/i.test(value)) return value
      const slash = value.replace(/\\/g, '/')
      return new URL(`file:///${slash}`).toString()
    }
    const off = window.api.onEntertainmentSound((event) => {
      const source = String(event?.path || '').trim()
      if (!source) return
      const url = toUrl(source)
      // 音量：规则里 0~100，不填=100
      const volume = Math.max(0, Math.min(1, (Number(event.volume ?? 100) || 0) / 100))
      if (event.mode === 'unique') {
        const current = active.get(source)
        if (current && !current.paused && !current.ended) return
        const audio = current || new Audio()
        audio.src = url
        audio.currentTime = 0
        audio.volume = volume
        active.set(source, audio)
        void audio.play().catch(() => {})
        return
      }
      const audio = new Audio(url)
      audio.volume = volume
      audio.addEventListener('ended', () => audio.remove())
      void audio.play().catch(() => {})
    })
    return () => {
      off()
      for (const audio of active.values()) {
        audio.pause()
        audio.src = ''
      }
      active.clear()
    }
  }, [])

  // 主题：启动应用一次；自动模式每分钟重算（按时段切黑夜/白天）
  useEffect(() => {
    applyTheme()
    const t = setInterval(() => applyTheme(), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    ;(async () => {
      let u: Awaited<ReturnType<typeof window.api.session>> = null
      try {
        u = await window.api.session()
      } catch {
        u = null   // 会话读取失败就当没登录，别让启动画面常驻
      }
      if (!u) {
        try {
          const { settings } = await window.api.getSettings()
          if (settings.autoLogin) {
            const cred = await loadCred()
            if (cred) {
              let res = await window.api.login(cred.username, cred.password)
              // login 只服务本地用户名账号，邮箱账号会被拒（不能绕过服务器校验），改用服务器登录
              if (!res.ok && /@/.test(cred.username)) {
                res = await window.api.emailLogin(cred.username, cred.password)
              }
              if (res.ok && res.user) u = res.user
            }
          }
        } catch {
          /* 自动登录失败则停留在登录页 */
        }
      }
      setUser(u)
      setLoading(false)
    })()
  }, [setUser, setLoading])

  // 登录/会话恢复时预取一次游戏授权，之后各页面直接用缓存，不再每次切界面查服务器
  useEffect(() => {
    if (user?.email) preloadAuth(user.email)
  }, [user?.email])

  // 邮箱账号登录后主动对齐一次绑定：后台有本地没有 → 恢复（换机/重装场景）；
  // 后台解绑/换绑过 → 本地跟随。通知轮询的基线也会做一次，这里是登录即刻生效。
  const syncedEmail = useRef('')
  useEffect(() => {
    const email = user?.email
    if (!email || syncedEmail.current === email) return
    syncedEmail.current = email
    void window.api.syncEmailRooms().then((res) => {
      if (!res.ok) return
      if (res.boundRooms) updateRooms(res.boundRooms)
      if (res.restored?.length) {
        toast(`已从服务器恢复绑定直播间 ${res.restored.join('、')}`, 'success')
      }
      if (res.removed?.length) {
        toast(`直播间 ${res.removed.join('、')} 已被后台解绑，本地已同步`, 'info')
      }
    })
  }, [user?.email, updateRooms, toast])

  // 主播头像自动同步：登录后对首个绑定房间查一次抖音公开资料，头像变了自动更新（6h 节流）
  useEffect(() => {
    if (!user) return
    const room = user.boundRooms?.[0]
    if (!room) return
    const key = `zl-avatar-refresh:${user.username}`
    const last = Number(localStorage.getItem(key) ?? 0)
    if (Date.now() - last < 6 * 3600_000) return
    localStorage.setItem(key, String(Date.now()))
    ;(async () => {
      const r = await window.api.roomLookup(room)
      if (r.ok && r.avatar && r.avatar !== user.avatar) {
        const u = await window.api.updateAvatar(r.avatar)
        if (u) setUser(u)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username])

  // 登录小窗 ↔ 主界面大窗（参考 Steam：登录窗小巧，进主界面再放大）
  useEffect(() => {
    if (loading) return
    if (user) window.api.windowResize(1280, 820, 1024, 700)
    else window.api.windowResize(840, 500, 780, 460)
  }, [user, loading])

  // 启动自动检查更新：有新版就弹窗询问；检查失败/已是最新都静默，不打扰主播
  useEffect(() => {
    window.api.checkForUpdates(true)
  }, [])

  // 下拉展开着滚页面时，系统画的选项框不会跟着走，会卡在原地盖住内容 —— 滚动就收起它。
  useEffect(() => {
    const close = () => {
      const active = document.activeElement
      if (active instanceof HTMLSelectElement) active.blur()
    }
    document.addEventListener('scroll', close, { passive: true, capture: true })
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      document.removeEventListener('scroll', close, { capture: true } as EventListenerOptions)
      window.removeEventListener('wheel', close)
    }
  }, [])

  // 打开游戏后自动跳到整蛊遥控（覆盖从外部 Steam 直接启动的情况）
  useEffect(() => {
    if (!user) {
      prevRunning.current = false
      return
    }
    let alive = true
    let first = true
    const tick = async () => {
      const st = await window.api.gameState()
      if (!alive) return
      if (first) {
        first = false
        prevRunning.current = st.running
        return
      }
      if (st.running && !prevRunning.current) navigate('/remote')
      prevRunning.current = st.running
    }
    tick()
    const t = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [user, navigate])

  // 首次使用向导：登录后还没看过 → 自动进 /guide 全屏展示（跳过/完成即不再弹）
  useEffect(() => {
    if (!user) return
    let alive = true
    window.api.getSettings().then(({ settings }) => {
      if (!alive) return
      const seen = settings.guideSeen || !!localStorage.getItem('zl-guide-seen')
      if (!seen) navigate('/guide', { replace: true })
    })
    return () => {
      alive = false
    }
  }, [user, navigate])

  // 挂件总控里勾了「自动」的挂件：登录后自动打开一次（本次会话只做一次，退出登录再登录不重复开）
  // 只盯「是否已登录」这个布尔值：user 对象刷新、toast 函数换新都不能把 1.5 秒定时器打断
  //（之前依赖 [user, toast]，会话校验一换 user 对象就清掉定时器，导致从来没开成）
  const autoOpened = useRef(false)
  const toastRef = useRef(toast)
  toastRef.current = toast
  const loggedIn = !!user
  useEffect(() => {
    if (!loggedIn || autoOpened.current) return
    autoOpened.current = true
    const ids = readAutoOpenIds()
    if (!ids.length) return
    const timer = window.setTimeout(() => {
      void openWidgets(ids).then((failed) => {
        if (failed.length) toastRef.current(`有 ${failed.length} 个窗口未能自动开启，去娱乐助手 → 管理播放窗口查看，并按提示配置`, 'error')
        else toastRef.current(`已自动打开 ${ids.length} 个挂件`, 'success')
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [loggedIn])

  // 已装的 mod 在游戏库里有新版本：登录后提示一次（同一个版本不重复念叨）
  const modUpdateChecked = useRef(false)
  useEffect(() => {
    if (!loggedIn || modUpdateChecked.current) return
    modUpdateChecked.current = true
    const timer = window.setTimeout(() => {
      void window.api.listMods().then(({ mods, installed }) => {
        const seen = (() => {
          try {
            return JSON.parse(localStorage.getItem('zl-mod-update-seen') || '{}') as Record<string, string>
          } catch {
            return {} as Record<string, string>
          }
        })()
        const fresh = mods.filter((m) => modUpdateAvailable(m.version, installed[m.id]?.version) && seen[m.id] !== m.version)
        if (!fresh.length) return
        toastRef.current(`${fresh.map((m) => `${m.name} v${m.version}`).join('、')} 有新版本，去游戏库更新`, 'info')
        for (const m of fresh) seen[m.id] = m.version
        localStorage.setItem('zl-mod-update-seen', JSON.stringify(seen))
      }).catch(() => {})
    }, 4000)
    return () => clearTimeout(timer)
  }, [loggedIn])

  if (loading) return <Splash />

  if (user && location.pathname === '/guide') {
    return (
      <>
        <Suspense fallback={<Loading />}><Guide /></Suspense>
        <UpdateModal />
      </>
    )
  }

  if (!user) {
    return (
      <>
        <Login />
        <ToastHost />
        <UpdateModal />
      </>
    )
  }

  return (
    <div className="flex h-full">
      <AssetOnboarding />
      {/* 卡密平台：轮询授权快照 + 接主进程「需要激活」事件；本机没配置卡密平台时什么都不渲染 */}
      <CardAccessHost />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="zl-scroll min-h-0 flex-1 overflow-y-auto">
          <PageErrorBoundary>
          <Suspense fallback={<Loading text="正在加载页面…" />}><Routes>
            <Route path="/" element={<Library />} />
            <Route path="/mod/:id" element={<ModDetail />} />
            <Route path="/config" element={<ConfigEditor />} />
            <Route path="/launch" element={<LaunchGame />} />
            <Route path="/remote" element={<PrankControl />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/ent" element={<><EntertainmentCardBar /><Entertainment /></>} />
            <Route path="/connector" element={<Connector />} />
            <Route path="/news" element={<News />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></Suspense>
          </PageErrorBoundary>
        </main>
      </div>
      <ToastHost />
      <UpdateModal />
    </div>
  )
}

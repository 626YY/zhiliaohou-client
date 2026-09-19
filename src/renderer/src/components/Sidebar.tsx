import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  SlidersHorizontal,
  Play,
  Zap,
  Radio,
  Megaphone,
  Bell,
  Settings,
  RefreshCw,
  Repeat,
  CreditCard,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Sparkles
} from 'lucide-react'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/ui'
import { useNotify } from '../stores/notify'
import { clearCred } from '../lib/cred'
import type { UpdateStatusPayload } from '@shared/types'
import { PopLayer } from './ui'
import BuyModal from './BuyModal'
import { Avatar } from './Avatar'

const items = [
  { to: '/', label: '游戏库', icon: LayoutGrid },
  { to: '/config', label: '参数调整', icon: SlidersHorizontal },
  { to: '/remote', label: '整蛊遥控', icon: Zap },
  { to: '/launch', label: '启动游戏', icon: Play },
  { to: '/stats', label: '直播统计', icon: TrendingUp },
  { to: '/ent', label: '娱乐助手', icon: Sparkles },
  { to: '/connector', label: '直播连接器', icon: Radio },
  { to: '/news', label: '公告', icon: Megaphone },
  { to: '/notifications', label: '通知', icon: Bell },
  { to: '/settings', label: '设置', icon: Settings }
]

export default function Sidebar() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const toast = useToast((s) => s.toast)
  const unread = useNotify((s) => s.unread)
  const setUnread = useNotify((s) => s.setUnread)
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [upd, setUpd] = useState<UpdateStatusPayload | null>(null)
  const [buyOpen, setBuyOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [buyContact, setBuyContact] = useState('')

  // 后台填了购买授权联系方式才显示「购买授权」入口；空则完全不显示
  useEffect(() => {
    let alive = true
    window.api.emailBuyContact().then((c) => {
      if (alive) setBuyContact(c || '')
    })
    return () => {
      alive = false
    }
  }, [])

  // 启动时同步一次未读数（新通知由 App.tsx 监听 NotifyNew 实时 +1）
  useEffect(() => {
    if (!user?.email) return
    let alive = true
    window.api.emailNotifyList(user.email).then((res) => {
      if (alive && res.ok && res.list) {
        setUnread(res.list.filter((n) => !n.read).length)
      }
    })
    return () => {
      alive = false
    }
  }, [user?.email, setUnread])

  // 发现新版本/下载进度/重启提示都交给 UpdateModal 弹窗，这里只管侧边栏按钮的检查状态
  useEffect(() => {
    return window.api.onUpdateStatus((p: UpdateStatusPayload) => {
      setUpd(p)
      if (p.state !== 'downloading' && p.state !== 'checking') setChecking(false)
    })
  }, [])

  const checkUpdate = async () => {
    setChecking(true)
    const res = await window.api.checkForUpdates()
    if (!res.ok) {
      toast(res.error ?? '检查更新失败', 'error')
      setChecking(false)
    }
  }

  const logout = async () => {
    await window.api.logout()
    clearCred()
    window.api.saveSettings({ autoLogin: false })
    setUser(null)
    navigate('/')
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-side)]">
      {/* 顶部不再放品牌区（参考 Steam 主界面无 logo），只留窗口拖拽条 */}
      <div className="drag-region h-10 shrink-0" />

      <nav className="flex-1 space-y-0.5 px-2 pt-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]'
              }`
            }
          >
            <Icon size={18} strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            {to === '/notifications' && unread > 0 && (
              <span className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="relative border-t border-[var(--line)] p-3">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="账号菜单"
          className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-[var(--bg-elev)]"
        >
          <Avatar
            name={user?.nickname || user?.username || '?'}
            avatar={user?.avatar}
            className="h-8 w-8 text-sm"
          />
          <div className="min-w-0 flex-1 text-left leading-tight">
            <div className="truncate text-sm text-[var(--text)]">
              {user?.nickname || user?.username}
            </div>
            <div className="truncate text-[10px] text-[var(--text-3)]">
              @{user?.username}
            </div>
          </div>
          {menuOpen ? (
            <ChevronUp size={15} className="shrink-0 text-[var(--text-4)]" />
          ) : (
            <ChevronDown size={15} className="shrink-0 text-[var(--text-4)]" />
          )}
        </button>

        {/* 昵称/账号已在触发按钮上展示，菜单内不再重复渲染 */}
        <PopLayer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          className="bottom-full left-2 right-2 mb-2 overflow-hidden"
        >
          {buyContact && (
            <button
              onClick={() => {
                setMenuOpen(false)
                setBuyOpen(true)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-2)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
            >
              <CreditCard size={15} className="text-[var(--text-4)]" /> 购买授权
            </button>
          )}
          <button
            onClick={() => {
              setMenuOpen(false)
              if (upd?.state === 'downloaded') window.api.updateInstall()
              else checkUpdate()
            }}
            disabled={checking || upd?.state === 'downloading'}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-2)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <RefreshCw size={15} className={checking || upd?.state === 'downloading' ? 'animate-spin text-[var(--accent-2)]' : 'text-[var(--text-4)]'} />
            {checking
              ? '检查中…'
              : upd?.state === 'downloaded'
                ? '重启安装'
                : upd?.state === 'downloading'
                  ? '下载中…'
                  : upd?.state === 'available'
                    ? '发现新版本'
                    : '检查更新'}
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 border-t border-[var(--line)] px-3 py-2 text-sm text-[var(--text-2)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          >
            <Repeat size={15} className="text-[var(--text-4)]" /> 切换账号
          </button>
        </PopLayer>
      </div>
      <BuyModal open={buyOpen} onClose={() => setBuyOpen(false)} />
    </aside>
  )
}

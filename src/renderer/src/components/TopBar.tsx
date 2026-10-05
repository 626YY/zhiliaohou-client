import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Pin, PinOff, Minus, Square, Copy, X } from 'lucide-react'
import ConfigurationMode from './ConfigurationMode'
import PageHelp from './PageHelp'
import { CardAccessButton } from './CardAccess'

// 与 App.tsx 的 Routes 一一对应；/mod/:id 走前缀判断，/guide 全屏渲染无顶栏（仅兜底）
const titles: Record<string, string> = {
  '/': '游戏库',
  '/config': '参数配置',
  '/ent': '娱乐助手',
  '/special': '特色整蛊',
  '/launch': '启动游戏',
  '/remote': '整蛊遥控',
  '/stats': '数据统计',
  '/connector': '直播连接器',
  '/news': '公告',
  '/notifications': '通知',
  '/settings': '设置',
  '/guide': '新手指引'
}

export default function TopBar() {
  const loc = useLocation()
  const [maximized, setMaximized] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const base = '/' + (loc.pathname.split('/')[1] || '')
  const title = loc.pathname.startsWith('/mod/')
    ? 'Mod 详情'
    : titles[base] ?? '游戏库'

  useEffect(() => {
    const off = window.api.onMaximizedChange(setMaximized)
    window.api.getSettings().then(({ settings }) => setAlwaysOnTop(!!settings.alwaysOnTop))
    return off   // 退出/重新登录会重挂顶栏，不取消就每次多一个监听
  }, [])

  const toggleTop = async () => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    await window.api.windowSetAlwaysOnTop(next)
  }

  return (
    <div className="drag-region flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--bg-side)] px-4">
      <div className="text-sm font-medium text-[var(--text)]">{title}</div>
      <div className="no-drag flex items-center gap-1">
        {/* 本机配置了卡密平台才出现；没配置时渲染为空，顶栏和原来一样 */}
        <CardAccessButton />
        <PageHelp /><ConfigurationMode />
        <button
          onClick={toggleTop}
          title={alwaysOnTop ? '取消窗口总在最前' : '窗口总在最前'}
          className={`flex h-8 w-9 items-center justify-center rounded-md transition ${
            alwaysOnTop
              ? 'bg-[var(--accent-soft)] text-[var(--accent-2)]'
              : 'text-[var(--text-3)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]'
          }`}
          aria-label="窗口总在最前"
        >
          {alwaysOnTop ? <Pin size={15} fill="currentColor" /> : <PinOff size={15} />}
        </button>
        <button
          onClick={() => window.api.windowMinimize()}
          className="flex h-8 w-9 items-center justify-center rounded-md text-[var(--text-3)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          aria-label="最小化"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => window.api.windowMaximizeToggle()}
          className="flex h-8 w-9 items-center justify-center rounded-md text-[var(--text-3)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
          aria-label="最大化/还原"
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button
          onClick={() => window.api.windowClose()}
          className="ml-1 flex h-8 w-9 items-center justify-center rounded-md text-[var(--text-3)] transition hover:bg-[var(--danger)] hover:text-white"
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

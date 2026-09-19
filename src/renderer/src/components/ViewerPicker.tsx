// 选观众：输入框 + 下拉名单（头像 + 昵称），给大哥进场的「昵称等于 / 昵称包含」和「试一试」用。
//   · 名单来自主进程的「已出现的观众」（本机送礼 / 进场 / 弹幕记录 + 连接器缓存的头像），不是抖音粉丝列表。
//   · 手填照旧：直接打字就是手填昵称；从下拉里选人才会把头像和观众 id 一起带上。
//   · 改动昵称文字（和已选的不一样）就把头像 / id 清掉，避免张冠李戴。
//   · 重名：有观众 id 的显示 id 尾号，两条都列出来，主播按 id 挑；没 id 的只能按昵称。
import { Crown, Search } from 'lucide-react'
import EmojiText from './EmojiText'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ViewerRow } from '@shared/types'
import { mediaUrl } from '../utils/mediaUrl'
import { Input, PopLayer, Tag } from './ui'

export type ViewerPick = { name: string; avatar: string; uid: string }

function whenLabel(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ViewerAvatar({ src, size = 24, className }: { src?: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  const url = src ? mediaUrl(src) : ''
  if (url && !broken) {
    return <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} data-viewer-avatar="image"
      className={`shrink-0 rounded-full object-cover bg-[var(--bg-elev)] ${className || ''}`} style={{ width: size, height: size }} />
  }
  return <span aria-hidden="true" data-viewer-avatar="default" style={{ width: size, height: size }}
    className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-2)] ${className || ''}`}>
    <Crown size={Math.round(size * 0.55)} />
  </span>
}

export default function ViewerPicker({
  value,
  avatar,
  uid,
  onChange,
  placeholder,
  className,
  ariaLabel
}: {
  value: string
  avatar?: string
  uid?: string
  onChange: (pick: ViewerPick) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  // 点开时先看全名单（框里已有的昵称不当搜索词）；打字之后才按输入过滤
  const [typed, setTyped] = useState(false)
  const [rows, setRows] = useState<ViewerRow[] | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    window.api.viewerList(1000).then((res) => setRows(res.rows)).catch(() => setRows([]))
  }
  useEffect(() => {
    if (!open) return
    load()
    // 名单开着时有人进场/送礼，主进程会推进场变化；顺手刷一遍名单
    return window.api.onEntranceChanged(() => load())
  }, [open])

  const query = typed ? value.trim().toLowerCase() : ''
  const shown = useMemo(() => {
    const list = rows || []
    const filtered = query ? list.filter((row) => row.name.toLowerCase().includes(query) || (row.uid || '').toLowerCase().includes(query)) : list
    return filtered.slice(0, 60)
  }, [rows, query])
  useEffect(() => setActive(0), [query, rows])

  const show = () => { setTyped(false); setOpen(true) }
  const pick = (row: ViewerRow) => {
    onChange({ name: row.name, avatar: row.avatar || '', uid: row.uid || '' })
    setOpen(false)
    inputRef.current?.blur()
  }

  const type = (next: string) => {
    // 打字改了昵称：和已选的人不一样就把头像 / id 清掉
    const same = next.trim() === value.trim()
    onChange({ name: next, avatar: same ? avatar || '' : '', uid: same ? uid || '' : '' })
    setTyped(true)
    if (!open) setOpen(true)
  }

  return (
    <div className={`relative flex min-w-0 items-center gap-1.5 ${className || ''}`} data-viewer-picker>
      <ViewerAvatar src={avatar} size={24} />
      <Input ref={inputRef} value={value} placeholder={placeholder} aria-label={ariaLabel} role="combobox" aria-expanded={open}
        aria-autocomplete="list" autoComplete="off" className="min-w-0 flex-1 text-xs"
        onFocus={show} onClick={() => { if (!open) show() }}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); return }
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { show(); return }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
          if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active]) }
        }} />
      <PopLayer open={open} onClose={() => setOpen(false)} className="left-0 top-full mt-1 w-72 max-w-[90vw] p-1">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[var(--text-4)]">
          <span>已出现的观众{rows ? ` · ${rows.length} 人` : ''}</span>
          {query && <span className="inline-flex items-center gap-1"><Search size={11} />{shown.length} 个匹配</span>}
        </div>
        {rows === null ? (
          <div className="px-2 py-3 text-xs text-[var(--text-4)]">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-5 text-[var(--text-3)]" data-viewer-empty>
            暂无观众记录。连接直播间后，送礼、进场、弹幕过的观众会出现在这里；现在可以直接手填昵称。
          </div>
        ) : shown.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-5 text-[var(--text-3)]" data-viewer-nomatch>
            没有包含「{value.trim()}」的观众，按现在填的昵称匹配。
          </div>
        ) : (
          <ul role="listbox" className="max-h-64 overflow-y-auto" data-viewer-list>
            {shown.map((row, i) => (
              <li key={`${row.uid || ''}|${row.name}`} role="option" aria-selected={i === active}>
                <button type="button" data-viewer-option={row.name} data-viewer-uid={row.uid || ''}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-[var(--bg-elev)] ${i === active ? 'bg-[var(--bg-elev)]' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(row)}>
                  <ViewerAvatar src={row.avatar} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[var(--text)]"><EmojiText text={row.name} /></span>
                      {row.uid && <span className="tnum shrink-0 text-[10px] text-[var(--text-4)]" title={`观众 id ${row.uid}`}>#{row.uid.slice(-4)}</span>}
                      {row.sim && <Tag>模拟</Tag>}
                    </span>
                    <span className="block text-[10px] text-[var(--text-4)]">最近 {whenLabel(row.lastSeen)} · {row.seen} 次{row.avatar ? '' : ' · 暂无头像'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopLayer>
    </div>
  )
}

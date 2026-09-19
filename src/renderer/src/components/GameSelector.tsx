import {useCardStore} from '../lib/useCardAccess'
import { useState } from 'react'
import { ChevronDown, Gamepad2 } from 'lucide-react'
import type { GameItem } from '@shared/types'
import { Pill, PopLayer } from './ui'

interface Props {
  games: GameItem[]
  gameId: string
  authorized: (id: string) => boolean
  onSelect: (id: string) => void
}

export default function GameSelector({ games, gameId, authorized, onSelect }: Props) {
  const cardMode=useCardStore(s=>!!s.snapshot?.enabled)
  const [open, setOpen] = useState(false)
  const current = games.find((g) => g.id === gameId) ?? games[0]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 py-2 text-sm text-[var(--text)] transition hover:border-[var(--text-4)] hover:bg-[var(--bg-card)]"
      >
        <Gamepad2 size={15} className="text-[var(--accent-2)]" />
        <span className="font-medium">{current?.name ?? '选择游戏'}</span>
        {current && (
          <Pill tone={authorized(current.id) ? 'ok' : 'muted'}>
            {authorized(current.id) ? (cardMode?'已激活':'已授权') : (cardMode?'未激活':'未授权')}
          </Pill>
        )}
        <ChevronDown size={14} className={`text-[var(--text-4)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <PopLayer
        open={open}
        onClose={() => setOpen(false)}
        className="left-0 top-full mt-1 w-64 overflow-hidden"
      >
        <div role="listbox" className="py-1">
          {games.map((g) => {
            const ok = authorized(g.id)
            return (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={g.id === current?.id}
                disabled={!ok}
                title={ok ? undefined : cardMode?'未激活，请先激活':'未授权，请先在「启动游戏」页申请授权'}
                onClick={() => {
                  setOpen(false)
                  onSelect(g.id)
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-[var(--bg-elev)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${
                  g.id === current?.id ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <span className="text-sm text-[var(--text)]">{g.name}</span>
                <Pill tone={ok ? 'ok' : 'muted'}>{ok ? (cardMode?'已激活':'已授权') : (cardMode?'未激活':'未授权')}</Pill>
              </button>
            )
          })}
        </div>
      </PopLayer>
    </div>
  )
}

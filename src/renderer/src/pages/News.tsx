import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import type { NewsItem } from '@shared/types'
import { EmptyState, Loading, PageHeader, Pill } from '../components/ui'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'accent'

const catTone: Record<string, Tone> = {
  发布: 'ok',
  公告: 'accent',
  修复: 'info'
}

export default function News() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.listNews().then((list) => {
      setItems(list)
      setLoaded(true)
    })
  }, [])

  return (
    <div className="p-6">
      <PageHeader
        icon={<Megaphone size={20} className="text-[var(--accent-2)]" />}
        title="工作室公告"
        desc="新版本发布、重要更新与修复说明。"
      />

      <div className="mt-5 space-y-3">
        {!loaded ? (
          <Loading text="正在加载公告…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Megaphone size={36} />}
            title="暂无公告"
            desc="有新版本或重要更新会发在这里。"
          />
        ) : (
          items.map((n) => (
            <article
              key={n.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-5 transition duration-150 hover:-translate-y-0.5 hover:border-[var(--line-strong)]"
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-center gap-2">
                <Pill tone={catTone[n.category] ?? 'muted'}>{n.category}</Pill>
                <span className="tnum text-xs text-[var(--text-4)]">{n.date}</span>
              </div>
              <h3 className="mt-2 text-base font-semibold text-[var(--text)]">{n.title}</h3>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--text-2)]">
                {n.content}
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

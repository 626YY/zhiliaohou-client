import { useEffect, useMemo, useState } from 'react'
import type { ModsListResult } from '@shared/types'
import { ModCard } from '../components/ModCard'
import { Search, PackageSearch } from 'lucide-react'
import { Btn, EmptyState, Input, Loading, PageHeader } from '../components/ui'

export default function Library() {
  const [data, setData] = useState<ModsListResult | null>(null)
  const [q, setQ] = useState('')

  const load = () => window.api.listMods().then(setData)
  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!data) return []
    const kw = q.trim().toLowerCase()
    return data.mods.filter(
      (m) =>
        !kw ||
        m.name.toLowerCase().includes(kw) ||
        m.tagline.toLowerCase().includes(kw) ||
        m.tags.some((t) => t.toLowerCase().includes(kw))
    )
  }, [data, q])

  if (!data) {
    return <Loading text="正在加载游戏库…" />
  }

  return (
    <div className="p-6">
      <PageHeader
        title="游戏库"
        desc={
          <>
            知了猴工作室出品 · <span className="tnum">{data.mods.length}</span> 款 Mod
          </>
        }
        actions={
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 Mod…"
              className="w-56 pl-9"
            />
          </div>
        }
      />

      <div className="mt-5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<PackageSearch size={36} />}
            title={q ? '没有匹配的 Mod' : '游戏库暂无内容'}
            desc={
              q
                ? `未找到与「${q.trim()}」相关的 Mod，换个关键词试试。`
                : '工作室上新 Mod 后会出现在这里。'
            }
            action={
              q ? (
                <Btn variant="secondary" size="sm" onClick={() => setQ('')}>
                  清空搜索
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                installed={data.installed[mod.id]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

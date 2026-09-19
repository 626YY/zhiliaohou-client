import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import type { CustomBox } from '@shared/types'
import { prankGroups, usePrankCatalog } from '../lib/pranks'
import { PRESET_GIFTS, genBoxId } from '../lib/blindbox'
import { Field, Input, Toggle } from './ui'

export default function CustomBoxEditor({
  boxes,
  onChange,
  gameId = 'wheellive'
}: {
  boxes: CustomBox[]
  onChange: (boxes: CustomBox[]) => void
  gameId?: string
}) {
  // 奖池按游戏取法术表（图书管理员整蛊）；致命开关是轮椅专属。菜单来自定义包，订阅一下刷新时重渲染
  usePrankCatalog()
  const groups = prankGroups(gameId)
  const showKillToggle = gameId !== 'librarian'
  const [poolOpen, setPoolOpen] = useState<number | null>(null)
  // 礼物建议 = 预设 + 连接器实际下载过礼物的名字（礼物图/抖音/*.png）。没抓全就靠主播手打，所以这里必须能自由输入。
  const [giftNames, setGiftNames] = useState<string[]>(PRESET_GIFTS)

  useEffect(() => {
    window.api.entertainmentListGiftImages().then((list) => {
      if (!Array.isArray(list)) return
      const seen = new Set(PRESET_GIFTS)
      for (const g of list) if (g?.name) seen.add(g.name)
      setGiftNames([...seen])
    })
  }, [])

  const set = (i: number, patch: Partial<CustomBox>) =>
    onChange(boxes.map((b, idx) => (idx === i ? { ...b, ...patch } : b)))

  const remove = (i: number) =>
    onChange(boxes.filter((_, idx) => idx !== i))

  const add = () =>
    onChange([
      ...boxes,
      {
        Id: genBoxId(),
        Name: `盲盒${boxes.length + 1}`,
        Gift: '',
        AllowKill: false,
        Pool: [],
        OpenCount: 3
      }
    ])

  const togglePool = (i: number, id: string) => {
    const pool = boxes[i].Pool.includes(id)
      ? boxes[i].Pool.filter((x) => x !== id)
      : [...boxes[i].Pool, id]
    set(i, { Pool: pool })
  }

  return (
    <div className="space-y-3">
      {boxes.map((box, i) => (
        <div
          key={box.Id}
          className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <Input
              type="text"
              value={box.Name}
              onChange={(e) => set(i, { Name: e.target.value })}
              placeholder="盲盒名称"
              aria-label="盲盒名称"
              className="flex-1 py-1.5 font-medium"
            />
            <span className="select-text rounded bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
              id:{box.Id}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="删除该盲盒"
              title="删除该盲盒"
              className="rounded-md p-1.5 text-[var(--text-3)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="触发礼物">
              <Input
                type="text"
                list={`zl-gift-suggest-${box.Id}`}
                value={box.Gift}
                onChange={(e) => set(i, { Gift: e.target.value })}
                placeholder="输入礼物名，如 保时捷（留空 = 不绑礼物）"
                spellCheck={false}
                className="py-1.5"
              />
              <datalist id={`zl-gift-suggest-${box.Id}`}>
                {giftNames.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
            <Field label="每次连开箱数">
              <Input
                type="number"
                min={1}
                value={box.OpenCount}
                onChange={(e) =>
                  set(i, { OpenCount: Math.max(1, Number(e.target.value) || 1) })
                }
                className="tnum py-1.5"
              />
            </Field>
            {showKillToggle && (
              <div className="flex items-end pb-1.5">
                <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                  <Toggle
                    value={box.AllowKill}
                    onChange={(v) => set(i, { AllowKill: v })}
                  />
                  {gameId === 'dontscream' ? '可开出猎人追杀，且这个盒开出的猎人真的能抓死主播' : '可开出致命整蛊'}
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPoolOpen(poolOpen === i ? null : i)}
              aria-expanded={poolOpen === i}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--line-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-2)] transition hover:border-[var(--text-4)] hover:bg-[var(--bg-elev)]"
            >
              <span>
                奖池
                <span className="tnum ml-2 text-xs text-[var(--text-3)]">
                  已选 {box.Pool.length} 个整蛊（空 = 退回大盲盒全库随机）
                </span>
              </span>
              <ChevronDown
                size={16}
                className={`transition-transform ${poolOpen === i ? 'rotate-180' : ''}`}
              />
            </button>
            {poolOpen === i && (
              <div className="zl-scroll mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg-card)] p-3">
                {groups.map((group) => (
                  <div key={group.id}>
                    <div className="mb-1 text-xs font-semibold text-[var(--text)]">
                      {group.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((p) => {
                        const on = box.Pool.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => togglePool(i, p.id)}
                            className={`rounded-md px-2 py-1 text-xs transition ${
                              on
                                ? 'bg-[var(--accent-soft-2)] text-[var(--accent-2)]'
                                : 'bg-[var(--bg-elev)] text-[var(--text-3)] hover:text-[var(--text)]'
                            }`}
                          >
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] py-3 text-sm text-[var(--text-3)] transition hover:border-[var(--accent)] hover:text-[var(--accent-2)]"
      >
        <Plus size={16} /> 添加自定义盲盒
      </button>
    </div>
  )
}

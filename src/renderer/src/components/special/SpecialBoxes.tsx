// 特色整蛊盲盒：一个盒子里放好几种特色整蛊（各带概率、数量可随机），送礼开盒随机开出一种。
// 宫格页上一排盲盒卡片：开一次（发到直播窗口）/ 绑定礼物（存成礼物触发规则）/ 编辑。
// 基础模式：概率用「稀有 / 普通 / 常见」三档；高级模式：直接填权重，还能选操作和大小种类、开盒提示开关。
import { useMemo, useState } from 'react'
import { Gift, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { Btn, Field, Input, Segmented, Select, Toggle } from '../ui'
import { Modal } from '../Modal'
import { CountInput } from '../SpecialActionFields'
import { LinkModal, GiftIcon } from './SpecialLinks'
import { specialArtUrls } from '../../lib/specialArt'
import { useConfigurationLevel } from '../../lib/configurationLevel'
import { useToast } from '../../stores/ui'
import {
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  joinSpecialParam,
  parseSpecialBoxParam,
  parseSpecialParam,
  specialActionText,
  specialDefaultParam,
  type SpecialBox,
  type SpecialGameId
} from '@shared/specialGames'
import type { EntertainmentRule } from '@shared/types'

const RARITY = [
  { value: '1', label: '稀有' },
  { value: '3', label: '普通' },
  { value: '6', label: '常见' }
] as const
const rarityOf = (w: number): '1' | '3' | '6' => (w <= 1.5 ? '1' : w <= 4.5 ? '3' : '6')

/** 盲盒触发规则（主动作是 special-box、且指向这个盲盒） */
export function boxLinksOf(rules: EntertainmentRule[], box: SpecialBox): EntertainmentRule[] {
  return rules.filter((r) => r.actionType === 'command' && r.commandCmd === 'special-box' && parseSpecialBoxParam(r.commandParam).id === box.id)
}

function percent(weight: number, total: number, count: number): string {
  if (total <= 0) return count ? `${Math.round(100 / count)}%` : '—'
  const p = (Math.max(0, weight) / total) * 100
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

function BoxEditor({ box, onClose, onSaved }: { box: SpecialBox | null; onClose: () => void; onSaved: (boxes: SpecialBox[]) => void }) {
  const { level } = useConfigurationLevel()
  const toast = useToast((s) => s.toast)
  const [draft, setDraft] = useState<SpecialBox>(() => box ? { ...box, entries: box.entries.map((e) => ({ ...e })) } : {
    id: '', name: '我的整蛊盲盒', opens: 1, announce: true,
    entries: [{ param: specialDefaultParam('catch_duck'), weight: 3 }, { param: specialDefaultParam('throw_poop'), weight: 3 }, { param: specialDefaultParam('chain_challenge'), weight: 1 }]
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const total = draft.entries.reduce((s, e) => s + Math.max(0, e.weight), 0)
  const setEntry = (i: number, patch: Partial<SpecialBox['entries'][number]>) => setDraft((d) => ({ ...d, entries: d.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))

  const save = async () => {
    setBusy(true)
    const r = await window.api.specialBoxSave(draft)
    setBusy(false)
    if (!r.ok) { toast(r.error || '保存失败', 'error'); return }
    toast(`盲盒「${draft.name}」已保存`, 'success')
    onSaved(r.boxes)
  }
  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    const r = await window.api.specialBoxRemove(draft.id)
    toast(`盲盒「${draft.name}」已删除；绑着它的礼物规则会提示找不到盲盒`, 'info')
    onSaved(r.boxes)
  }

  return (
    <Modal
      open
      closeOnBackdrop={false}
      onClose={onClose}
      title={box ? `编辑盲盒 · ${box.name}` : '新建特色整蛊盲盒'}
      width={680}
      fixedFooter
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {box ? <Btn variant={confirmDelete ? 'danger' : 'ghost'} onClick={() => void remove()}><Trash2 size={13} />{confirmDelete ? '再点一次删除' : '删除盲盒'}</Btn> : <span />}
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>取消</Btn>
            <Btn disabled={busy || !draft.name.trim() || !draft.entries.length} onClick={() => void save()}>保存</Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
          <Field label="盲盒名字" hint="开盒时画面上会显示">
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="如：整蛊大礼包" />
          </Field>
          <Field label="每次开几个" hint="一次连抽几种">
            <Input type="number" min={1} value={draft.opens} onChange={(e) => setDraft((d) => ({ ...d, opens: Math.max(1, Math.trunc(Number(e.target.value) || 1)) }))} />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-3)]">盲盒里有什么（{draft.entries.length} 种）</span>
            <Btn size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, entries: [...d.entries, { param: specialDefaultParam('fruit_slice'), weight: 3 }] }))}><Plus size={13} />加一种</Btn>
          </div>
          <div className="space-y-2">
            {draft.entries.map((entry, i) => {
              const p = parseSpecialParam(entry.param)
              const meta = p.id ? SPECIAL_GAME_MAP[p.id] : SPECIAL_GAMES[0]
              const op = meta.ops.find((o) => o.value === p.op) ?? meta.ops[0]
              const emit = (patch: Partial<typeof p>) => setEntry(i, { param: joinSpecialParam({ ...p, id: meta.id, ...patch }) })
              return (
                <div key={i} className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5" data-box-entry={i}>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="玩法" className="w-36">
                      <Select aria-label={`第 ${i + 1} 种玩法`} value={meta.id} onChange={(e) => setEntry(i, { param: specialDefaultParam(e.target.value as SpecialGameId) })}>
                        {SPECIAL_GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="操作" className="w-32" advanced>
                      <Select aria-label={`第 ${i + 1} 种操作`} value={op.value} onChange={(e) => emit({ op: e.target.value })}>
                        {meta.ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </Field>
                    {op.count !== false && (
                      <Field label={`${op.countLabel || '数量'}${op.countLabel === '倍数' ? '' : `（${meta.unit}）`}`}>
                        <CountInput value={p.count} def={meta.countDef} range={meta.countRange} onChange={(count) => emit({ count })} idp={`box-${i}`} />
                      </Field>
                    )}
                    <div className="ml-auto flex items-end gap-2">
                      {level === 'basic' ? (
                        <Field label="出现概率">
                          <Segmented size="sm" value={rarityOf(entry.weight)} onChange={(v) => setEntry(i, { weight: Number(v) })} options={RARITY.map((r) => ({ value: r.value, label: r.label }))} />
                        </Field>
                      ) : (
                        <Field label="权重" className="w-20">
                          <Input aria-label={`第 ${i + 1} 种权重`} type="number" min={0} step={1} value={entry.weight} onChange={(e) => setEntry(i, { weight: Math.max(0, Number(e.target.value) || 0) })} />
                        </Field>
                      )}
                      <span className="tnum mb-2 w-10 text-right text-sm font-semibold text-[var(--accent-2)]" title="开出这一种的概率">{percent(entry.weight, total, draft.entries.length)}</span>
                      <Btn size="sm" variant="ghost" className="mb-1" aria-label={`删掉第 ${i + 1} 种`} disabled={draft.entries.length <= 1} onClick={() => setDraft((d) => ({ ...d, entries: d.entries.filter((_, j) => j !== i) }))}><X size={14} /></Btn>
                    </div>
                  </div>
                  {(meta.fields ?? []).length > 0 && op.value !== 'clear' && op.value !== 'reset' && (
                    <div className="mt-2 flex flex-wrap gap-2" data-advanced-field style={level === 'basic' ? { display: 'none' } : undefined}>
                      {(meta.fields ?? []).map((f) => (
                        <Field key={f.key} label={f.label} className="w-40">
                          <Select value={p.fields[f.key] || f.def} onChange={(e) => emit({ fields: { ...p.fields, [f.key]: e.target.value } })}>
                            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </Select>
                        </Field>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-[var(--text-4)]">开出：{specialActionText(entry.param)}</p>
                </div>
              )
            })}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-2)]" data-advanced-field style={level === 'basic' ? { display: 'none' } : undefined}>
          <span>开盒提示<span className="ml-1 text-[var(--text-4)]">（画面上显示「某某的盲盒开出：…」）</span></span>
          <Toggle value={draft.announce} onChange={(v) => setDraft((d) => ({ ...d, announce: v }))} label="开盒提示" />
        </label>
      </div>
    </Modal>
  )
}

export default function SpecialBoxes({
  boxes,
  setBoxes,
  rules,
  images,
  assetDir,
  onRulesChanged
}: {
  boxes: SpecialBox[]
  setBoxes: (b: SpecialBox[]) => void
  rules: EntertainmentRule[]
  images: Record<string, string>
  assetDir: string
  onRulesChanged: () => void
}) {
  const toast = useToast((s) => s.toast)
  const [editing, setEditing] = useState<SpecialBox | null | undefined>(undefined)
  const [linking, setLinking] = useState<SpecialBox | null>(null)
  const links = useMemo(() => Object.fromEntries(boxes.map((b) => [b.id, boxLinksOf(rules, b)])), [boxes, rules])

  const test = async (box: SpecialBox) => {
    const r = await window.api.specialBoxTest(box.id)
    if (!r.ok) toast(r.error || '开盒失败', 'error')
    else toast(`「${box.name}」开出：${(r.opened ?? []).map((p) => specialActionText(p)).join('、')}`, 'success')
  }
  const unlink = async (rule: EntertainmentRule) => {
    await window.api.entertainmentRuleRemove(rule.id)
    onRulesChanged()
  }

  return (
    <section className="mb-6" data-testid="special-boxes">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">🎁 特色整蛊盲盒</h3>
        <span className="text-xs text-[var(--text-3)]">送礼开盒，随机开出一种特色整蛊，数量也随机</span>
        <Btn size="sm" variant="secondary" className="ml-auto" onClick={() => setEditing(null)}><Plus size={13} />新建盲盒</Btn>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-3">
        {boxes.map((box) => {
          const ids = [...new Set(box.entries.map((e) => parseSpecialParam(e.param).id).filter(Boolean))] as SpecialGameId[]
          const boxLinks = links[box.id] || []
          return (
            <div key={box.id} className="zl-card flex flex-col p-3" data-special-box={box.id}>
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: 'linear-gradient(135deg, #ff7a18, #ff3d7f 60%, #8b5cf6)' }}>🎁</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-[var(--text)]">{box.name}</div>
                  <div className="text-xs text-[var(--text-3)]">{box.entries.length} 种结果 · 每次开 {box.opens} 个</div>
                </div>
                <Btn size="sm" variant="ghost" aria-label={`编辑${box.name}`} onClick={() => setEditing(box)}><Pencil size={14} /></Btn>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {ids.slice(0, 8).map((id) => {
                  const art = specialArtUrls(id, assetDir)[0]
                  return (
                    <span key={id} title={SPECIAL_GAME_MAP[id].name} className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: SPECIAL_GAME_MAP[id].tint }}>
                      {art ? <img src={art} alt="" className="h-5 w-5 object-contain" /> : <span className="text-xs">{SPECIAL_GAME_MAP[id].emoji}</span>}
                    </span>
                  )
                })}
                {ids.length > 8 && <span className="self-center text-[11px] text-[var(--text-3)]">+{ids.length - 8}</span>}
              </div>
              <div className="mt-2.5 flex min-h-[26px] flex-wrap items-center gap-1.5">
                {boxLinks.length ? boxLinks.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-elev)] py-0.5 pl-1 pr-1.5 text-xs text-[var(--text-2)]">
                    {(r.triggerType || 'gift') === 'gift' ? <GiftIcon name={r.giftName} images={images} size={18} /> : <Gift size={12} />}
                    {(r.triggerType || 'gift') === 'gift' ? r.giftName : r.triggerType === 'follow' ? '关注' : r.triggerType === 'like' ? '点赞' : r.triggerType === 'member' ? '进场' : '弹幕'}
                    <button aria-label={`解绑 ${r.giftName || '联动'}`} onClick={() => void unlink(r)} className="text-[var(--text-4)] hover:text-[var(--danger)]"><X size={12} /></button>
                  </span>
                )) : <span className="text-[11px] text-[var(--text-4)]">还没绑礼物</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <Btn size="sm" className="flex-1" onClick={() => setLinking(box)}><Gift size={13} />绑定礼物</Btn>
                <Btn size="sm" variant="secondary" className="flex-1" title="发到直播窗口开一次（窗口没开会先打开）" onClick={() => void test(box)}><Sparkles size={13} />开一次试试</Btn>
              </div>
            </div>
          )
        })}
      </div>
      {editing !== undefined && (
        <BoxEditor box={editing} onClose={() => setEditing(undefined)} onSaved={(b) => { setBoxes(b); setEditing(undefined) }} />
      )}
      {linking && (
        <LinkModal box={linking} rule={null} images={images} onClose={() => setLinking(null)} onSaved={() => { setLinking(null); onRulesChanged() }} />
      )}
    </section>
  )
}

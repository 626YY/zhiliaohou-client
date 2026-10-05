// 特色整蛊详情页的「礼物联动」：这个玩法被哪些礼物规则触发。
// 联动就是娱乐助手里的普通礼物规则（动作 = 特色整蛊），这里只是按玩法筛出来、给个顺手的增改入口；
// 在「礼物触发」里看到、改到的是同一份数据。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gift, Pencil, Plus, Trash2, ExternalLink } from 'lucide-react'
import { Btn, Card, EmptyState, Field, Input, Segmented, Select, Toggle } from '../ui'
import { Modal } from '../Modal'
import EmojiText from '../EmojiText'
import SpecialActionFields from '../SpecialActionFields'
import GamePrankSelect from '../GamePrankSelect'
import AdvancedSection from '../AdvancedSection'
import SpecialBoxPool, { defaultSpecialBoxParam } from './SpecialBoxPool'
import { useConfigurationLevel } from '../../lib/configurationLevel'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { actionLabel } from '@shared/entertainmentLabels'
import { specialLinksOf, triggerText } from '../../lib/specialArt'
import { DOUYIN_GIFT_NAMES } from '../../data/douyinGifts'
import { normalizeGiftName } from '@shared/giftName'
import { SPECIAL_BOX_DEFAULT_NAME, SPECIAL_GAME_MAP, parseSpecialBoxParam, specialActionText, specialBoxText, specialDefaultParam, type SpecialGameId } from '@shared/specialGames'
import type { EntertainmentRule, EntertainmentTriggerType } from '@shared/types'
import { useToast } from '../../stores/ui'

const TRIGGERS: { value: EntertainmentTriggerType; label: string }[] = [
  { value: 'gift', label: '送礼物' },
  { value: 'follow', label: '关注' },
  { value: 'like', label: '点赞' },
  { value: 'member', label: '进场' },
  { value: 'comment', label: '弹幕' }
]

export function GiftIcon({ name, images, size = 28 }: { name: string; images: Record<string, string>; size?: number }) {
  const src = images[normalizeGiftName(name)]
  if (src) return <img src={src} alt="" className="shrink-0 object-contain" style={{ width: size, height: size }} />
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-2)]" style={{ width: size, height: size }}>
      <Gift size={Math.round(size * 0.55)} />
    </span>
  )
}

// 联动弹窗：绑一个玩法（id）或一个特色整蛊盲盒（box：勾选奖池）。基础模式只填「谁触发 + 礼物 + 数量/奖池」，其余收进「更多选项」
export function LinkModal({
  id,
  box = false,
  rule,
  images,
  onClose,
  onSaved
}: {
  id?: SpecialGameId
  box?: boolean
  rule: EntertainmentRule | null
  images: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const meta = id ? SPECIAL_GAME_MAP[id] : undefined
  const { level } = useConfigurationLevel()
  const toast = useToast((s) => s.toast)
  const { events, loaded } = useSpecialBoxEvents()
  const [form, setForm] = useState<EntertainmentRule>(
    () =>
      rule ?? {
        id: '',
        name: box ? '特色整蛊盲盒' : `特色整蛊·${meta?.name ?? ''}`,
        group: '特色整蛊',
        giftName: '',
        triggerType: 'gift',
        actionType: 'command',
        commandCmd: box ? 'special-box' : 'special-play',
        commandParam: box ? '' : specialDefaultParam(id!),
        times: 1,
        repeat: 1,
        multiply: true,
        queueMode: 'instant',
        enabled: true
      }
  )
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<EntertainmentRule>) => setForm((f) => ({ ...f, ...patch }))
  // 新建盲盒：奖池默认勾上事件库里所有启用的事件，主播再去掉不要的（只在打开时填一次，主播自己清空了不再填回去）
  const boxInited = useRef(!box || !!rule)
  useEffect(() => {
    if (boxInited.current || !loaded) return
    boxInited.current = true
    setForm((f) => (f.commandParam ? f : { ...f, commandParam: defaultSpecialBoxParam(events) }))
  }, [loaded, events])
  const boxName = box ? parseSpecialBoxParam(form.commandParam).name || SPECIAL_BOX_DEFAULT_NAME : ''
  const title = box ? `盲盒「${boxName}」` : meta?.name ?? ''
  const boxEmpty = box && (() => { const p = parseSpecialBoxParam(form.commandParam); return !p.all && !p.ids.length })()
  const trigger = form.triggerType || 'gift'
  // 「同时触发游戏整蛊」= 规则上的一条附加动作（game-prank），其它附加动作原样保留
  const extras = form.extraActions ?? []
  const prankExtra = extras.find((a) => a.actionType === 'command' && a.commandCmd === 'game-prank')
  const setPrank = (param: string) => {
    const rest = extras.filter((a) => a !== prankExtra)
    set({ extraActions: param ? [...rest, { actionType: 'command', commandCmd: 'game-prank', commandParam: param, delayMs: 0 }] : rest })
  }
  const invalid = (trigger === 'gift' && !form.giftName.trim()) || boxEmpty

  const save = async () => {
    setBusy(true)
    // 盲盒规则名跟着盲盒名字走（礼物触发列表里一眼看出是哪个盲盒）
    const oldName = String(form.name || '').trim()
    const next = box && (!oldName || oldName.startsWith('特色整蛊盲盒')) ? { ...form, name: `特色整蛊盲盒·${boxName}` } : form
    const r = next.id ? await window.api.entertainmentRuleUpdate(next) : await window.api.entertainmentRuleAdd(next)
    setBusy(false)
    if (!r.ok) { toast(r.error || '保存失败', 'error'); return }
    toast(next.id ? '联动已更新' : `已联动：${triggerText(next)} → ${box ? '盲盒' + specialBoxText(next.commandParam) : specialActionText(next.commandParam)}`, 'success')
    onSaved()
  }

  return (
    <Modal
      open
      closeOnBackdrop={false}
      onClose={onClose}
      title={form.id ? `编辑联动 · ${title}` : `添加联动 · ${title}`}
      width={box ? 620 : 500}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>取消</Btn>
          <Btn disabled={invalid || busy} onClick={() => void save()}>{form.id ? '保存' : '添加联动'}</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="观众做什么时触发">
          <Segmented size="sm" value={trigger} onChange={(v) => set({ triggerType: v, ...(v === 'gift' || v === 'comment' ? {} : { giftName: '' }) })} options={TRIGGERS} />
        </Field>
        {(trigger === 'gift' || trigger === 'comment') && (
          <Field label={trigger === 'gift' ? '礼物' : '弹幕关键词'} hint={trigger === 'gift' ? '输入或从列表选礼物名' : '弹幕里包含这个词就触发，留空 = 任何弹幕'}>
            <div className="flex items-center gap-2">
              {trigger === 'gift' && <GiftIcon name={form.giftName} images={images} size={34} />}
              <Input
                autoFocus
                value={form.giftName}
                list={trigger === 'gift' ? 'special-gift-names' : undefined}
                placeholder={trigger === 'gift' ? '如：小心心 / 人气票 / 玫瑰' : '如：锁住他'}
                onChange={(e) => set({ giftName: e.target.value })}
              />
              <datalist id="special-gift-names">
                {DOUYIN_GIFT_NAMES.map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>
          </Field>
        )}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          {box ? (
            <SpecialBoxPool value={form.commandParam} onChange={(v) => set({ commandParam: v })} idp="special-link-box" />
          ) : (
            <SpecialActionFields fixedId={id} value={form.commandParam} onChange={(v) => set({ commandParam: v })} idp="special-link" simple={level === 'basic'} />
          )}
        </div>
        <AdvancedSection title="更多选项">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label={trigger === 'like' ? '每多少个赞触发一次' : trigger === 'gift' ? '每多少个礼物触发一次' : '每几次触发一次'}>
                <Input type="number" min={1} value={form.times ?? 1} onChange={(e) => set({ times: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />
              </Field>
              <Field label="执行时机" hint="立即：不和别的整蛊排队">
                <Select value={form.queueMode ?? 'instant'} onChange={(e) => set({ queueMode: e.target.value as EntertainmentRule['queueMode'] })}>
                  <option value="instant">立即执行</option>
                  <option value="jump">插队</option>
                  <option value="normal">普通排队</option>
                </Select>
              </Field>
            </div>
            <Field label="同时触发游戏整蛊（可选）" hint="一个礼物既整画面又整游戏；游戏在跑、选中的就是这款游戏时才会发出">
              <GamePrankSelect value={prankExtra?.commandParam} onChange={setPrank} allowNone label="同时触发的游戏整蛊" />
            </Field>
            <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-2)]">
              <span>送多个就执行多次<span className="ml-1 text-[var(--text-4)]">（关掉则一次送礼只算一次）</span></span>
              <Toggle value={form.multiply !== false} onChange={(v) => set({ multiply: v })} label="按数量倍数执行" />
            </label>
          </div>
        </AdvancedSection>
      </div>
    </Modal>
  )
}

export default function SpecialLinks({
  id,
  rules,
  images,
  onChanged
}: {
  id: SpecialGameId
  rules: EntertainmentRule[]
  images: Record<string, string>
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const links = useMemo(() => specialLinksOf(rules, id), [rules, id])
  const [editing, setEditing] = useState<EntertainmentRule | null | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState('')

  const toggle = async (rule: EntertainmentRule, on: boolean) => {
    await window.api.entertainmentRuleUpdate({ ...rule, enabled: on })
    onChanged()
  }
  const remove = async (rule: EntertainmentRule) => {
    if (confirmDelete !== rule.id) { setConfirmDelete(rule.id); setTimeout(() => setConfirmDelete((c) => (c === rule.id ? '' : c)), 3000); return }
    await window.api.entertainmentRuleRemove(rule.id)
    setConfirmDelete('')
    onChanged()
  }

  return (
    <Card
      title={<span className="flex items-center gap-2">礼物联动{links.length > 0 && <span className="tnum rounded-full bg-[var(--accent-soft)] px-1.5 text-[11px] text-[var(--accent-2)]">{links.length}</span>}</span>}
      actions={<Btn size="sm" onClick={() => setEditing(null)}><Plus size={13} />添加联动</Btn>}
    >
      {links.length === 0 ? (
        <EmptyState
          compact
          icon={<Gift size={26} />}
          title="还没有礼物联动"
          desc="绑定一个礼物，观众送礼就自动触发这个玩法；也可以用关注、点赞、弹幕触发。"
          action={<Btn size="sm" onClick={() => setEditing(null)}><Plus size={13} />添加联动</Btn>}
        />
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {links.map(({ rule, param, primary }) => (
            <div key={`${rule.id}-${param}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              {(rule.triggerType || 'gift') === 'gift' ? <GiftIcon name={rule.giftName} images={images} /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--info-soft)] text-[11px] font-semibold text-[var(--info)]">{triggerText(rule).slice(0, 2)}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--text)]">
                  <EmojiText text={triggerText(rule)} />
                  {(rule.times ?? 1) > 1 && <span className="ml-1 text-xs text-[var(--text-3)]">每 {rule.times} 个</span>}
                </div>
                <div className="truncate text-xs text-[var(--text-3)]">
                  → {specialActionText(param).replace(SPECIAL_GAME_MAP[id].name, '').trim() || SPECIAL_GAME_MAP[id].name}
                  {(rule.extraActions ?? []).filter((a) => a.actionType === 'command' && a.commandCmd === 'game-prank').map((a, i) => (
                    <span key={i} className="ml-1.5 rounded bg-[var(--info-soft)] px-1 py-px text-[10px] text-[var(--info)]">+ {actionLabel(a)}</span>
                  ))}
                  {!primary && <span className="ml-1 text-[var(--text-4)]">（规则「{rule.name || rule.giftName}」里的附加动作）</span>}
                </div>
              </div>
              <Toggle value={rule.enabled !== false} onChange={(v) => void toggle(rule, v)} label="启用这条联动" />
              {primary ? (
                <Btn size="sm" variant="ghost" title="编辑" aria-label="编辑联动" onClick={() => setEditing(rule)}><Pencil size={14} /></Btn>
              ) : (
                <Btn size="sm" variant="ghost" title="在礼物触发里编辑" aria-label="在礼物触发里编辑" onClick={() => navigate('/ent?tool=gift')}><ExternalLink size={14} /></Btn>
              )}
              <Btn
                size="sm"
                variant={confirmDelete === rule.id ? 'danger' : 'ghost'}
                title={primary ? '删除这条联动' : '删除整条规则'}
                aria-label="删除联动"
                onClick={() => void remove(rule)}
              >
                {confirmDelete === rule.id ? '再点删除' : <Trash2 size={14} />}
              </Btn>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => navigate('/ent?tool=gift')} className="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--text-3)] hover:text-[var(--accent-2)]">
        联动就是「礼物触发」里的规则，在那里能设优先级、加更多动作 <ExternalLink size={11} />
      </button>
      {editing !== undefined && (
        <LinkModal
          id={id}
          rule={editing}
          images={images}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); onChanged() }}
        />
      )}
    </Card>
  )
}

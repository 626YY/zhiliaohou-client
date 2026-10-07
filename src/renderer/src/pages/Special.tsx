// 特色整蛊：17 个叠在直播画面上的互动小游戏（锁链、抓鸭子、粉丝来电…），全部在一个直播窗口「特色整蛊」里，各玩各的。
// 宫格页按真实美术展示玩法；详情页 = 可直接上手玩的预览舞台 + 礼物联动 + 分组设置。
// 触发统一走娱乐助手的礼物规则（动作「特色整蛊」/「特色整蛊盲盒」），转盘/九宫格/时间盲盒也能当中奖动作用。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Sparkles, Volume2, VolumeX, RotateCcw, Search, Gift, Radio, Repeat } from 'lucide-react'
import { Btn, Card, Field, Input, PageHeader, Pill, Segmented, Select } from '../components/ui'
import SpecialStage, { type SpecialStageHandle, type StageBackdrop } from '../components/special/SpecialStage'
import SpecialParamField from '../components/special/SpecialParamField'
import SpecialLinks from '../components/special/SpecialLinks'
import SpecialBoxes from '../components/special/SpecialBoxes'
import SpecialWindowBar from '../components/special/SpecialWindowBar'
import MicTest from '../components/special/MicTest'
import AdvancedSection from '../components/AdvancedSection'
import { AdvancedFields } from '../lib/configurationLevel'
import { specialArtUrls, specialLinksOf } from '../lib/specialArt'
import { mediaUrl } from '../utils/mediaUrl'
import { useToast } from '../stores/ui'
import { normalizeGiftName } from '@shared/giftName'
import {
  DEFAULT_SPECIAL_WINDOW,
  SPECIAL_CATEGORY_LABELS,
  SPECIAL_GAMES,
  SPECIAL_GAME_MAP,
  SPECIAL_WINDOW_TITLE,
  defaultSpecialConfig,
  resolveSpecialCount,
  type SpecialCategory,
  type SpecialGameConfig,
  type SpecialGameId,
  type SpecialGameMeta,
  type SpecialParamSpec,
  type SpecialWindowConfig
} from '@shared/specialGames'
import type { EntertainmentRule } from '@shared/types'

type CfgMap = Partial<Record<SpecialGameId, SpecialGameConfig>>
type Filter = 'all' | 'linked' | SpecialCategory

const PREF_KEY = 'zl-special-stage'
function readPrefs(): { backdrop: StageBackdrop; muted: boolean; demo: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    return { backdrop: ['scene', 'green', 'checker'].includes(v.backdrop) ? v.backdrop : 'scene', muted: v.muted !== false, demo: v.demo !== false }
  } catch {
    return { backdrop: 'scene', muted: true, demo: true }
  }
}

// 页面共用的数据：直播窗口（全部玩法共用）、各玩法配置、礼物规则、礼物图标
function useSpecialData() {
  const [win, setWin] = useState<SpecialWindowConfig & { open: boolean }>({ ...DEFAULT_SPECIAL_WINDOW, open: false })
  const [cfgs, setCfgs] = useState<CfgMap>({})
  const [assetDir, setAssetDir] = useState('')
  const [rules, setRules] = useState<EntertainmentRule[]>([])
  const [images, setImages] = useState<Record<string, string>>({})

  // 广播一来就重读，但内容没变就不换状态（换了整页都要重画：17 张卡片、盲盒、事件库）
  const sigs = useRef({ win: '', cfgs: '' })
  const refreshState = useCallback(async () => {
    const st = await window.api.specialState()
    const c: CfgMap = {}
    for (const g of st.games) c[g.id] = g.config
    const w = JSON.stringify(st.window)
    const k = JSON.stringify(c)
    if (w !== sigs.current.win) { sigs.current.win = w; setWin(st.window) }
    if (k !== sigs.current.cfgs) { sigs.current.cfgs = k; setCfgs(c) }
    setAssetDir(st.assetDir || '')
  }, [])
  const refreshRules = useCallback(async () => setRules(await window.api.entertainmentRulesList()), [])

  useEffect(() => {
    void refreshState()
    void refreshRules()
    void window.api.entertainmentListGiftImages().then((list) => {
      const map: Record<string, string> = {}
      for (const g of list) {
        const key = normalizeGiftName(g.name)
        if (!map[key] || g.canonical) map[key] = mediaUrl(g.path)
      }
      setImages(map)
    })
    const off = window.api.onSpecialChanged(() => void refreshState())
    const onFocus = () => { void refreshState(); void refreshRules() }
    window.addEventListener('focus', onFocus)
    return () => { off(); window.removeEventListener('focus', onFocus) }
  }, [refreshState, refreshRules])

  return { win, cfgs, setCfgs, assetDir, rules, images, refreshRules, refreshState }
}

export default function Special() {
  const [params, setParams] = useSearchParams()
  const active = (SPECIAL_GAMES.find((g) => g.id === params.get('tool'))?.id ?? null) as SpecialGameId | null
  const data = useSpecialData()

  const setActive = (id: SpecialGameId | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('tool', id)
    else next.delete('tool')
    setParams(next)
  }
  useEffect(() => { document.querySelector('main')?.scrollTo({ top: 0 }) }, [active])

  if (active === null) return <SpecialGrid data={data} onPick={setActive} />
  return <SpecialDetail key={active} id={active} data={data} onBack={() => setActive(null)} />
}

// ================= 宫格页 =================

function SpecialGrid({ data, onPick }: { data: ReturnType<typeof useSpecialData>; onPick: (id: SpecialGameId) => void }) {
  const navigate = useNavigate()
  const toast = useToast((s) => s.toast)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const linkCount = useMemo(() => {
    const out: Partial<Record<SpecialGameId, EntertainmentRule[]>> = {}
    for (const g of SPECIAL_GAMES) out[g.id] = specialLinksOf(data.rules, g.id).map((l) => l.rule)
    return out
  }, [data.rules])
  const totalLinks = SPECIAL_GAMES.reduce((n, g) => n + (linkCount[g.id]?.length || 0), 0)
  const q = query.trim().toLowerCase()
  const list = SPECIAL_GAMES.filter((g) => {
    if (filter === 'linked' && !linkCount[g.id]?.length) return false
    if (filter !== 'all' && filter !== 'linked' && g.category !== filter) return false
    return !q || `${g.name} ${g.desc} ${g.how}`.toLowerCase().includes(q)
  })

  // 卡片上的「试一下」：发到直播窗口（窗口没开会先打开），和详情页「在直播窗口试」一样
  const tryLive = async (g: SpecialGameMeta) => {
    const r = await window.api.specialTest(g.id)
    if (!r.ok) toast(r.error ?? '试一试失败', 'error')
    void data.refreshState()
  }

  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'linked', label: `已联动${totalLinks ? ` ${totalLinks}` : ''}` },
    ...(Object.keys(SPECIAL_CATEGORY_LABELS) as SpecialCategory[]).map((c) => ({ value: c as Filter, label: SPECIAL_CATEGORY_LABELS[c] }))
  ]

  return (
    <div className="p-6">
      <div className="mb-4">
        <PageHeader
          icon={<Sparkles size={22} className="text-[var(--accent-2)]" />}
          title="特色整蛊"
          desc="叠在直播画面上的互动小游戏：观众送礼放出鸭子、锁链、蚊子，主播亲手化解。绑定礼物自动触发，转盘、九宫格、时间盲盒里也能当奖励。"
          actions={
            <>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
                <Input aria-label="搜索玩法" placeholder="搜索玩法" value={query} onChange={(e) => setQuery(e.target.value)} className="w-52 pl-8" />
              </div>
              <Btn variant="secondary" onClick={() => navigate('/ent?tool=gift')}><Gift size={14} />礼物触发</Btn>
            </>
          }
        />
      </div>

      {/* 直播窗口：17 个玩法共用一个（和娱乐助手「管理播放窗口」里那一行是同一份开关和自动开启名单） */}
      <SpecialWindowBar win={data.win} onChange={() => void data.refreshState()} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setFilter(c.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === c.value ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]' : 'border-[var(--line)] text-[var(--text-3)] hover:border-[var(--line-strong)] hover:text-[var(--text)]'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filter === 'all' && !query.trim() && (
        <SpecialBoxes rules={data.rules} images={data.images} onRulesChanged={() => void data.refreshRules()} />
      )}

      {list.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--text-3)]">没有符合条件的玩法，换个关键词试试。</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2 min-[980px]:grid-cols-3 min-[1360px]:grid-cols-4">
          {list.map((g) => (
            <GameCard
              key={g.id}
              meta={g}
              art={specialArtUrls(g.id, data.assetDir)}
              links={linkCount[g.id] || []}
              images={data.images}
              onOpen={() => onPick(g.id)}
              onTry={() => void tryLive(g)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GameCard({
  meta,
  art,
  links,
  images,
  onOpen,
  onTry
}: {
  meta: SpecialGameMeta
  art: string[]
  links: EntertainmentRule[]
  images: Record<string, string>
  onOpen: () => void
  onTry: () => void
}) {
  const [artOk, setArtOk] = useState(true)
  const gifts = [...new Set(links.filter((r) => (r.triggerType || 'gift') === 'gift' && r.giftName).map((r) => r.giftName))]
  const others = links.filter((r) => (r.triggerType || 'gift') !== 'gift').length
  return (
    <div
      role="button"
      tabIndex={0}
      data-special-card={meta.id}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="zl-card zl-card-hover group flex cursor-pointer flex-col overflow-hidden text-left outline-none focus-visible:border-[var(--accent)]"
    >
      <div
        className="relative aspect-[16/10] overflow-hidden"
        style={{ background: `radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, ${meta.tint} 92%, #fff) 0%, ${meta.tint} 45%, color-mix(in srgb, ${meta.tint} 45%, #05070a) 100%)` }}
      >
        {/* 细点纹理 + 底部压暗，主图更立体 */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.9) 1px, transparent 1.2px)', backgroundSize: '14px 14px' }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
        {art.length > 0 && artOk ? (
          <>
            {/* 点缀：左下、右下各一张小图，悬停时往两边散开一点 */}
            {art.slice(1, 3).map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                className={`absolute bottom-[6%] h-[38%] w-[30%] object-contain transition-transform duration-300 ease-out ${i === 0 ? 'left-[6%] -rotate-12 group-hover:-translate-x-1' : 'right-[6%] rotate-12 group-hover:translate-x-1'}`}
                style={{ filter: 'drop-shadow(0 6px 8px rgb(0 0 0 / 0.35))' }}
              />
            ))}
            <img
              src={art[0]}
              alt=""
              draggable={false}
              onError={() => setArtOk(false)}
              className={`absolute inset-0 m-auto h-[74%] object-contain transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.06] ${art.length > 1 ? 'w-[62%]' : 'w-[80%]'}`}
              style={{ filter: 'drop-shadow(0 10px 14px rgb(0 0 0 / 0.38))' }}
            />
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-6xl" style={{ filter: 'drop-shadow(0 6px 10px rgb(0 0 0 / 0.4))' }}>{meta.emoji}</span>
        )}
        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {SPECIAL_CATEGORY_LABELS[meta.category]}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-3.5 pb-3 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold text-[var(--text)]">{meta.name}</div>
          <button
            type="button"
            title={`在直播窗口「${SPECIAL_WINDOW_TITLE}」里试一下（窗口没开会先打开）`}
            aria-label={`在直播窗口试「${meta.name}」`}
            onClick={(e) => { e.stopPropagation(); onTry() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text-3)] transition hover:border-[var(--accent)] hover:text-[var(--accent-2)]"
          >
            <Radio size={13} />
          </button>
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-[18px] text-[var(--text-3)]">{meta.desc}</div>
        <div className="mt-auto flex items-center gap-1.5 pt-3">
          {gifts.length || others ? (
            <>
              {gifts.slice(0, 5).map((name) => (
                images[normalizeGiftName(name)] ? (
                  <img key={name} src={images[normalizeGiftName(name)]} title={name} alt={name} className="h-6 w-6 rounded-md bg-[var(--bg-elev)] object-contain p-0.5" />
                ) : (
                  <span key={name} title={name} className="max-w-[72px] truncate rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent-2)]">{name}</span>
                )
              ))}
              {gifts.length > 5 && <span className="text-[11px] text-[var(--text-3)]">+{gifts.length - 5}</span>}
              {others > 0 && <span className="rounded-md bg-[var(--info-soft)] px-1.5 py-0.5 text-[10px] text-[var(--info)]">关注/点赞/弹幕 {others}</span>}
            </>
          ) : (
            <span className="text-[11px] text-[var(--text-4)]">还没联动礼物</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ================= 详情页 =================

const GROUP_TITLES: Record<NonNullable<SpecialParamSpec['group']>, string> = {
  play: '玩法',
  look: '外观',
  sound: '声音',
  media: '自定义素材'
}

function SpecialDetail({ id, data, onBack }: { id: SpecialGameId; data: ReturnType<typeof useSpecialData>; onBack: () => void }) {
  const meta = SPECIAL_GAME_MAP[id]
  const toast = useToast((s) => s.toast)
  const cfg = data.cfgs[id] ?? defaultSpecialConfig(meta)
  const isOpen = data.win.open
  const stage = useRef<SpecialStageHandle>(null)
  const [prefs, setPrefs] = useState(readPrefs)
  const [testOp, setTestOp] = useState(meta.ops[0].value)
  const [testCount, setTestCount] = useState(String(meta.countDef))
  const [testFields, setTestFields] = useState<Record<string, string>>({})
  const [stat, setStat] = useState<number | null>(null)
  const linkCount = useMemo(() => specialLinksOf(data.rules, id).length, [data.rules, id])
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const savePrefs = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch { /* 下次用默认 */ }
  }

  // 改配置即存即推（主进程持久化 + 直播窗口开着就热更新；预览舞台由 SpecialStage 自己推）
  const patch = (p: Partial<SpecialGameConfig>) => {
    data.setCfgs((prev) => ({ ...prev, [id]: { ...cfg, ...p } }))
    void window.api.specialConfigure(id, p)
  }
  const patchParam = (key: string, value: number | string | boolean) => {
    const nextParams = { ...cfg.params, [key]: value }
    data.setCfgs((prev) => ({ ...prev, [id]: { ...cfg, params: nextParams } }))
    void window.api.specialConfigure(id, { params: nextParams })
  }

  const opSpec = meta.ops.find((o) => o.value === testOp) ?? meta.ops[0]
  const testCmd = (demo = false) => {
    const fields: Record<string, string> = {}
    for (const f of meta.fields ?? []) fields[f.key] = testFields[f.key] || f.def
    // 自动演示一律用默认操作（不会自己清空/暂停），手动「在预览里试」按选的来
    const op = demo ? meta.ops[0] : opSpec
    return { operation: op.value, count: resolveSpecialCount(demo ? meta.countDef : testCount, meta.countDef), username: '示例观众', avatar: '', gift: '小心心', test: true, ...fields }
  }
  const demo = () => stage.current?.apply(testCmd(true))
  const onStageReady = () => { if (prefs.demo) demo() }
  // 只有画面真空了才再演示一波：锁链挂着等点、鸭子躺着等抓的时候动画是停的，但不能再往上叠
  const onStageIdle = (empty: boolean) => {
    if (!prefs.demo || !empty) return
    if (demoTimer.current) clearTimeout(demoTimer.current)
    demoTimer.current = setTimeout(demo, 1400)
  }
  useEffect(() => () => { if (demoTimer.current) clearTimeout(demoTimer.current) }, [])

  const testLive = async () => {
    const fields: Record<string, string> = {}
    for (const f of meta.fields ?? []) fields[f.key] = testFields[f.key] || f.def
    const r = await window.api.specialTest(id, { op: opSpec.value, count: resolveSpecialCount(testCount, meta.countDef), fields })
    if (!r.ok) toast(r.error ?? '试一试失败', 'error')
    void data.refreshState()
  }

  // 累计统计：窗口开着时每 2 秒读一次
  useEffect(() => {
    if (!meta.statLabel || !isOpen) { setStat(null); return }
    let alive = true
    const read = async () => { const r = await window.api.specialStats(id); if (alive) setStat(typeof r.value === 'number' ? r.value : null) }
    void read()
    const t = setInterval(() => void read(), 2000)
    return () => { alive = false; clearInterval(t) }
  }, [id, isOpen, meta.statLabel])

  const groups = useMemo(() => {
    const out: Record<string, SpecialParamSpec[]> = {}
    for (const p of meta.params) (out[p.group || 'play'] ||= []).push(p)
    return out
  }, [meta])
  // 用麦克风的玩法给个「麦克风测试」：符咒听喊声，其余听拍手；手势拍蚊子/苍蝇只在开了声控时才有
  const micKind: 'clap' | 'shout' | null = !meta.params.some((p) => p.key === 'micDevice')
    ? null
    : id === 'talisman_seal' ? 'shout' : cfg.params.controlMode === 'mouse' ? null : 'clap'

  return (
    <div className="p-6">
      {/* 顶栏 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn variant="ghost" size="sm" onClick={onBack}><ChevronLeft size={14} />全部玩法</Btn>
        <span className="text-lg font-bold text-[var(--text)]">{meta.name}</span>
        <Pill tone="muted">{SPECIAL_CATEGORY_LABELS[meta.category]}</Pill>
      </div>
      <SpecialWindowBar win={data.win} onChange={() => void data.refreshState()} compact />

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        {/* 预览舞台 + 试玩 */}
        <div className="zl-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
            <span className="text-sm font-semibold text-[var(--text)]">预览</span>
            <span className="text-[11px] text-[var(--text-4)]">{meta.interactive ? '可以直接在画面上点、拖、挥，手感和直播里一样' : '和直播窗口里看到的一样'}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Segmented
                size="sm"
                value={prefs.backdrop}
                onChange={(v) => savePrefs({ backdrop: v })}
                options={[{ value: 'scene', label: '直播画面' }, { value: 'green', label: '绿幕' }, { value: 'checker', label: '透明' }]}
              />
              <Btn size="sm" variant="ghost" title={prefs.muted ? '打开预览声音' : '预览静音'} aria-label={prefs.muted ? '打开预览声音' : '预览静音'} onClick={() => savePrefs({ muted: !prefs.muted })}>
                {prefs.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </Btn>
              <AdvancedFields>
                <Btn size="sm" variant={prefs.demo ? 'secondary' : 'ghost'} title="空闲时自动再来一波" aria-pressed={prefs.demo} onClick={() => savePrefs({ demo: !prefs.demo })}>
                  <Repeat size={13} />自动演示
                </Btn>
                <Btn size="sm" variant="ghost" title="重新载入预览" aria-label="重新载入预览" onClick={() => stage.current?.reload()}><RotateCcw size={14} /></Btn>
              </AdvancedFields>
            </div>
          </div>
          <div className="p-4">
            <SpecialStage ref={stage} id={id} config={cfg} screen={data.win} backdrop={prefs.backdrop} muted={prefs.muted} onReady={onStageReady} onIdle={onStageIdle} />
            {/* 试玩：选操作和数量，在预览里或直播窗口里来一下 */}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="操作" className="w-36" advanced>
                <Select value={opSpec.value} onChange={(e) => setTestOp(e.target.value)}>
                  {meta.ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              {opSpec.count !== false && (
                <Field label={`${opSpec.countLabel || '数量'}${opSpec.countLabel === '倍数' ? '' : `（${meta.unit}）`}`} className="w-28">
                  <Input value={testCount} inputMode="numeric" onChange={(e) => setTestCount(e.target.value.replace(/[^\d~～,，-]/g, ''))} />
                </Field>
              )}
              {opSpec.value !== 'clear' && opSpec.value !== 'reset' && (meta.fields ?? []).map((f) => (
                <Field key={f.key} label={f.label} className="w-36" advanced>
                  <Select value={testFields[f.key] || f.def} onChange={(e) => setTestFields((p) => ({ ...p, [f.key]: e.target.value }))}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
              ))}
              <div className="ml-auto flex gap-2">
                <Btn variant="secondary" onClick={() => stage.current?.apply(testCmd())}><Sparkles size={14} />在预览里试</Btn>
                <Btn variant="secondary" onClick={() => void testLive()} title="发到直播窗口（没开会先打开）"><Radio size={14} />在直播窗口试</Btn>
              </div>
            </div>
          </div>
        </div>

        {/* 右栏：怎么玩 + 上直播三步 */}
        <div className="space-y-4">
          <Card title="怎么玩">
            <p className="text-[13px] leading-6 text-[var(--text-2)]">{meta.how}</p>
            {meta.statLabel && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-[var(--bg-elev)] px-3 py-2">
                <div>
                  <div className="text-[11px] text-[var(--text-3)]">{meta.statLabel}</div>
                  <div className="tnum text-xl font-bold text-[var(--text)]">{stat == null ? '—' : stat}<span className="ml-1 text-xs font-normal text-[var(--text-3)]">{meta.unit}</span></div>
                </div>
                {meta.ops.some((o) => o.value === 'reset') && (
                  <Btn size="sm" variant="ghost" disabled={!isOpen} onClick={() => void window.api.specialTest(id, { op: 'reset' }).then(() => setStat(0))}>清零</Btn>
                )}
              </div>
            )}
          </Card>
          <Card title="上直播三步">
            <ol className="space-y-3 text-[13px]">
              <Step n={1} done={isOpen} title="开启直播窗口">
                {isOpen ? '窗口已开。' : '点上面的「开启窗口」。'}17 个玩法共用这一个窗口，收到联动时窗口没开也会自动打开。
              </Step>
              <Step n={2} title="在直播伴侣里添加">
                添加「窗口采集」，选「{SPECIAL_WINDOW_TITLE}」，加一次所有玩法都能用；{data.win.background === 'green' ? '绿幕底色记得加「色度键」抠掉。' : '透明底色直接叠加。'}
              </Step>
              <Step n={3} done={linkCount > 0} title="绑定礼物">
                {linkCount > 0 ? `已联动 ${linkCount} 条，观众送礼就会触发。` : '在下面「礼物联动」里绑一个礼物。'}
              </Step>
            </ol>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 min-[1100px]:grid-cols-2">
        <SpecialLinks id={id} rules={data.rules} images={data.images} onChanged={() => void data.refreshRules()} />

        <Card title="玩法设置">
          <div className="space-y-5">
            {(['play', 'look', 'sound'] as const).filter((g) => groups[g]?.length).map((g) => (
              <section key={g}>
                <h4 className="mb-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-3)]">{GROUP_TITLES[g]}</h4>
                <div className="grid gap-x-5 gap-y-3.5 min-[1360px]:grid-cols-2">
                  {groups[g].map((p) => (
                    <SpecialParamField key={p.key} spec={p} value={cfg.params[p.key]} onChange={(v) => patchParam(p.key, v)} />
                  ))}
                </div>
              </section>
            ))}
            {micKind && (
              <section>
                <h4 className="mb-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-3)]">麦克风测试</h4>
                <MicTest key={id} kind={micKind} params={cfg.params} />
              </section>
            )}
            {/* 自定义素材：基础模式收起来（点开就能换），高级模式直接展开 */}
            {!!groups.media?.length && (
              <AdvancedSection title={GROUP_TITLES.media} hint="换成自己的图片、音效、视频或音乐；留空就用内置的。">
                <div className="grid gap-x-5 gap-y-3.5 min-[1360px]:grid-cols-2">
                  {groups.media.map((p) => (
                    <SpecialParamField key={p.key} spec={p} value={cfg.params[p.key]} onChange={(v) => patchParam(p.key, v)} />
                  ))}
                </div>
              </AdvancedSection>
            )}
            {/* 这个玩法自己的快慢和上限；窗口尺寸、底色是全部玩法共用的，在上面的「直播窗口」里 */}
            <AdvancedFields>
              {/* 外层是 display:contents，吃不到 space-y 的上边距，这里自己留 */}
              <section className="mt-5">
                <h4 className="mb-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-3)]">通用</h4>
                <div className="grid gap-x-5 gap-y-3.5 min-[1360px]:grid-cols-2">
                  <SpecialParamField spec={{ key: 'speed', label: '整体速度', type: 'number', min: 0.25, max: 8, step: 0.25, unit: '倍', def: 1, hint: '这个玩法所有动画的快慢', advanced: true }} value={cfg.speed} onChange={(v) => patch({ speed: Number(v) })} />
                  <SpecialParamField spec={{ key: 'countCap', label: '单次最多生成', type: 'number', min: 0, max: 100000, step: 10, def: 0, hint: '0 = 不限；弱机可以设个上限兜底', advanced: true }} value={cfg.countCap} onChange={(v) => patch({ countCap: Math.trunc(Number(v)) })} />
                </div>
              </section>
            </AdvancedFields>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-[var(--ok)] text-[var(--bg)]' : 'bg-[var(--bg-elev)] text-[var(--text-3)]'}`}>{done ? '✓' : n}</span>
      <div className="min-w-0">
        <div className="font-medium text-[var(--text)]">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-[var(--text-3)]">{children}</div>
      </div>
    </li>
  )
}

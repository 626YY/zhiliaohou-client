import SkinPicker from '../components/SkinPicker'
import { useEffect, useState } from 'react'
import { Gift, Heart, Plus, Trash2, RotateCcw, MonitorPlay, Music2, FileCode2, X } from 'lucide-react'
import type { ProgressConfig, ProgressState, WishConfig, WishGroup, WishItem, WishWidgetState } from '@shared/types'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

function fileName(value?: string): string {
  if (!value) return ''
  const parts = value.split(/[/\\]/)
  return parts[parts.length - 1] || value
}

async function pickFile(kind: 'sound' | 'script'): Promise<string | null> {
  const res = await window.api.selectFile({
    title: kind === 'sound' ? '选择音效' : '选择脚本或程序',
    filters: kind === 'sound'
      ? [{ name: '音效', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
      : [{ name: '脚本或程序', extensions: ['bat', 'cmd', 'exe', 'ps1', 'vbs', 'py'] }],
    properties: ['openFile']
  })
  return res.ok && res.path ? res.path : null
}

// 达成动作（音效 / 脚本）的小选择器，里程碑和心愿共用
function ActionPickers({ sound, script, onChange }: { sound?: string; script?: string; onChange: (v: { sound?: string; script?: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Btn size="sm" variant="ghost" title={sound ? `音效：${sound}` : '达成时播音效'} onClick={async () => { const p = await pickFile('sound'); if (p) onChange({ sound: p }) }}>
        <Music2 size={13} className={sound ? 'text-[var(--accent-2)]' : ''} />
        {sound && <span className="max-w-[80px] truncate text-[11px]">{fileName(sound)}</span>}
      </Btn>
      {sound && <Btn size="sm" variant="ghost" onClick={() => onChange({ sound: '' })} title="移除音效"><X size={11} /></Btn>}
      <Btn size="sm" variant="ghost" title={script ? `脚本：${script}` : '达成时执行脚本/程序'} onClick={async () => { const p = await pickFile('script'); if (p) onChange({ script: p }) }}>
        <FileCode2 size={13} className={script ? 'text-[var(--accent-2)]' : ''} />
        {script && <span className="max-w-[80px] truncate text-[11px]">{fileName(script)}</span>}
      </Btn>
      {script && <Btn size="sm" variant="ghost" onClick={() => onChange({ script: '' })} title="移除脚本"><X size={11} /></Btn>}
    </div>
  )
}

export default function EntertainmentProgress() {
  const toast = useToast((s) => s.toast)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [wishState, setWishState] = useState<WishWidgetState | null>(null)
  const [newScoreGift, setNewScoreGift] = useState('')
  const [newScore, setNewScore] = useState(10)
  const [newWish, setNewWish] = useState<[string, string]>(['', ''])
  const [newWishTarget, setNewWishTarget] = useState<[number, number]>([1, 1])

  useEffect(() => {
    window.api.progressState().then(setProgress)
    window.api.wishState().then(setWishState)
    // 计分、心愿计数都在主进程；这里只收推送来显示
    const offA = window.api.onProgressChanged(setProgress)
    const offB = window.api.onWishChanged(setWishState)
    return () => {
      offA()
      offB()
    }
  }, [])

  if (!progress || !wishState) return null
  const cfg = progress.config
  const wishCfg = wishState.config

  const patch = (value: Partial<ProgressConfig>) => {
    setProgress({ ...progress, config: { ...cfg, ...value } })
    void window.api.progressConfigure(value)
  }
  const patchWish = (value: Partial<WishConfig>) => {
    setWishState({ ...wishState, config: { ...wishCfg, ...value } })
    void window.api.wishConfigure(value)
  }
  const patchGroup = (index: 0 | 1, value: Partial<WishGroup>) => {
    const groups: [WishGroup, WishGroup] = [{ ...wishCfg.groups[0] }, { ...wishCfg.groups[1] }]
    groups[index] = { ...groups[index], ...value }
    patchWish({ groups })
  }
  const patchWishItem = (index: 0 | 1, gift: string, value: Partial<WishItem>) => {
    patchGroup(index, { wishes: wishCfg.groups[index].wishes.map((w) => (w.gift === gift ? { ...w, ...value } : w)) })
  }

  const toggleProgressWindow = async () => {
    if (progress.open) {
      await window.api.progressClose()
      setProgress({ ...progress, open: false })
      toast('已关闭积分条窗口', 'info')
      return
    }
    const r = await window.api.progressOpen()
    if (!r.ok) return toast(r.error ?? '开启失败', 'error')
    setProgress({ ...progress, open: true })
    toast('积分条窗口已开启（绿幕背景，OBS / 直播伴侣采集后抠像上直播）', 'success')
  }

  const toggleWishWindow = async () => {
    if (wishState.open) {
      await window.api.wishClose()
      setWishState({ ...wishState, open: false })
      toast('已关闭心愿窗口', 'info')
      return
    }
    const r = await window.api.wishOpen()
    if (!r.ok) return toast(r.error ?? '开启失败', 'error')
    setWishState({ ...wishState, open: true })
    toast('心愿窗口已开启（绿幕背景，OBS / 直播伴侣采集后抠像上直播）', 'success')
  }

  const addGiftScore = () => {
    const gift = newScoreGift.trim()
    if (!gift) return toast('先填礼物名', 'error')
    if (cfg.giftScores.some((g) => g.gift === gift)) return toast('这个礼物已经在积分表里', 'error')
    patch({ giftScores: [...cfg.giftScores, { gift, score: Math.max(0, newScore) }] })
    setNewScoreGift('')
  }

  const addWish = (index: 0 | 1) => {
    const gift = newWish[index].trim()
    if (!gift) return
    if (wishCfg.groups[index].wishes.some((w) => w.gift === gift)) return toast('该礼物已在这组心愿里', 'error')
    patchGroup(index, { wishes: [...wishCfg.groups[index].wishes, { gift, target: Math.max(1, newWishTarget[index]), count: 0 }] })
    setNewWish((prev) => (index === 0 ? ['', prev[1]] : [prev[0], '']))
  }

  const pct = cfg.target > 0 ? Math.min(100, (progress.score / cfg.target) * 100) : 0

  const renderGroup = (index: 0 | 1) => {
    const group = wishCfg.groups[index]
    return (
      <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-semibold text-[var(--text-3)]">{index === 0 ? '心愿 A' : '心愿 B'}</span>
          <Input value={group.title} onChange={(e) => patchGroup(index, { title: e.target.value })} placeholder="窗口里的标题" className="flex-1 text-xs" />
          <Btn size="sm" variant="ghost" onClick={() => window.api.wishReset(index)} title="这组全部清零"><RotateCcw size={13} /></Btn>
        </div>
        <div className="flex gap-2">
          <Input
            value={newWish[index]}
            onChange={(e) => setNewWish((prev) => (index === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
            list="ent-progress-gifts"
            placeholder="心愿礼物名，如：嘉年华"
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && addWish(index)}
          />
          <Input
            type="number"
            min={1}
            value={newWishTarget[index]}
            onChange={(e) => setNewWishTarget((prev) => (index === 0 ? [Math.max(1, Number(e.target.value) || 1), prev[1]] : [prev[0], Math.max(1, Number(e.target.value) || 1)]))}
            title="送满几个达成"
            className="w-20"
          />
          <Btn variant="secondary" onClick={() => addWish(index)}><Plus size={14} /></Btn>
        </div>
        {group.wishes.length === 0 && <span className="block text-xs text-[var(--text-4)]">还没有心愿礼物。填礼物名 + 目标数量，观众送满即达成。</span>}
        {group.wishes.map((w) => {
          const done = w.count >= w.target
          const wpct = Math.min(100, (w.count * 100) / w.target)
          return (
            <div key={w.gift} className={`space-y-1 rounded-lg border px-2.5 py-1.5 ${done ? 'border-[var(--ok-line)] bg-[var(--ok-soft)]' : 'border-[var(--line)] bg-[var(--bg-card)]'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-28 truncate text-xs font-medium ${done ? 'text-[var(--ok)]' : 'text-[var(--text-2)]'}`}>{done ? '✓ ' : ''}{w.gift}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--bg)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-2)] to-[var(--accent)] transition-all" style={{ width: `${Math.max(2, wpct)}%` }} />
                </div>
                <span className="tnum w-14 shrink-0 text-right text-xs text-[var(--text-3)]">{w.count} / {w.target}</span>
                <Input type="number" min={1} value={w.target} onChange={(e) => patchWishItem(index, w.gift, { target: Math.max(1, Number(e.target.value) || 1) })} className="w-16 text-xs" title="目标数量" />
                <button onClick={() => window.api.wishReset(index, w.gift)} title="清零进度" className="shrink-0 text-[11px] text-[var(--text-4)] hover:text-[var(--text)]">清零</button>
                <button onClick={() => patchGroup(index, { wishes: group.wishes.filter((x) => x.gift !== w.gift) })} className="shrink-0 text-[var(--text-4)] hover:text-[var(--danger)]" title="删除">×</button>
              </div>
              <div className="flex items-center gap-2 pl-1 text-[11px] text-[var(--text-4)]">
                达成时
                <ActionPickers sound={w.sound} script={w.script} onChange={(v) => patchWishItem(index, w.gift, v)} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <datalist id="ent-progress-gifts">
        {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
      </datalist>

      <Card title="展示皮肤">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <SkinPicker label="积分条皮肤" value={cfg.skin} onChange={(skin) => patch({ skin })} />
          <SkinPicker label="心愿皮肤" value={wishCfg.skin} onChange={(skin) => patchWish({ skin })} />
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Gift size={16} className="text-[var(--accent-2)]" /> 礼物积分进度条
          </div>
          <Btn variant={progress.open ? 'secondary' : 'primary'} onClick={toggleProgressWindow} title="打开绿幕积分条窗口">
            <MonitorPlay size={14} /> {progress.open ? '关闭窗口' : '积分条窗口'}
          </Btn>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="标题（窗口内金色大字）">
              <Input value={cfg.title} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <Field label="目标积分">
              <Input type="number" min={1} value={cfg.target} onChange={(e) => patch({ target: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-[var(--text-3)]">
              <span className="tnum">当前积分：{progress.score}</span>
              <span className="tnum">目标：{cfg.target}</span>
            </div>
            <div className="h-5 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg-elev)]">
              <div className="flex h-full items-center justify-end rounded-full bg-gradient-to-r from-[var(--accent-2)] to-[var(--accent)] pr-2 text-[10px] font-bold text-white transition-all" style={{ width: `${pct}%` }}>
                {pct >= 15 && `${Math.floor(pct)}%`}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={() => window.api.progressAdjust(1)}><Plus size={14} /> +1</Btn>
            <Btn variant="secondary" onClick={() => window.api.progressAdjust(10)}><Plus size={14} /> +10</Btn>
            <Btn variant="secondary" onClick={() => window.api.progressAdjust(-10)}>-10</Btn>
            <Btn variant="secondary" onClick={() => window.api.progressReset()} title="积分清零，里程碑重新计"><RotateCcw size={14} /> 清零</Btn>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.autoAdd} onChange={(v) => patch({ autoAdd: v })} />
              收到礼物自动加分
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.resetOnTarget} onChange={(v) => patch({ resetOnTarget: v })} />
              到达目标后自动清零重来
            </label>
          </div>
          <Field label="计分方式">
            <Segmented
              size="sm"
              value={cfg.scoreMode}
              onChange={(v) => patch({ scoreMode: v })}
              options={[{ value: 'count', label: '每个礼物 1 分' }, { value: 'diamond', label: '按钻石价' }, { value: 'table', label: '按积分表' }]}
            />
          </Field>
          {cfg.scoreMode === 'table' && (
            <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="礼物" className="min-w-[140px] flex-1">
                  <Input value={newScoreGift} onChange={(e) => setNewScoreGift(e.target.value)} list="ent-progress-gifts" placeholder="如：火箭" onKeyDown={(e) => e.key === 'Enter' && addGiftScore()} />
                </Field>
                <Field label="每个几分" className="w-24">
                  <Input type="number" min={0} value={newScore} onChange={(e) => setNewScore(Number(e.target.value) || 0)} />
                </Field>
                <Btn onClick={addGiftScore}><Plus size={14} /> 加入积分表</Btn>
                <Field label="表里没有的礼物" className="w-32">
                  <Input type="number" min={0} value={cfg.defaultScore} onChange={(e) => patch({ defaultScore: Math.max(0, Number(e.target.value) || 0) })} title="不在表里的礼物每个算几分；0=不计分" />
                </Field>
              </div>
              {cfg.giftScores.length === 0 ? (
                <span className="block text-xs text-[var(--text-4)]">积分表是空的，所有礼物都按「表里没有的礼物」那个分值算。</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cfg.giftScores.map((g) => (
                    <span key={g.gift} className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-card)] px-2 py-0.5 text-xs text-[var(--text-2)]">
                      {g.gift}
                      <Input type="number" min={0} value={g.score} onChange={(e) => patch({ giftScores: cfg.giftScores.map((x) => (x.gift === g.gift ? { ...x, score: Math.max(0, Number(e.target.value) || 0) } : x)) })} className="w-14 !py-0 text-[11px]" />
                      分
                      <button onClick={() => patch({ giftScores: cfg.giftScores.filter((x) => x.gift !== g.gift) })} className="text-[var(--text-4)] hover:text-[var(--danger)]">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            「积分条窗口」= 绿幕积分条（金边深紫面板 · 胶囊进度条 · 里程碑圆点 · #00FF00 绿幕），积分实时同步，OBS / 直播伴侣窗口采集 + 色度键抠像即可上直播。
          </p>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text)]">多目标里程碑</span>
          <Btn size="sm" onClick={() => patch({ milestones: [...cfg.milestones, { score: cfg.target, note: '达成目标' }] })}>
            <Plus size={13} /> 添加目标
          </Btn>
        </div>
        <div className="space-y-2">
          {cfg.milestones.map((m, i) => (
            <div key={i} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 ${progress.reached.includes(m.score) ? 'border-[var(--ok-line)] bg-[var(--ok-soft)]' : 'border-[var(--line)]'}`}>
              <Input type="number" min={0} value={m.score} onChange={(e) => patch({ milestones: cfg.milestones.map((x, idx) => (idx === i ? { ...x, score: Number(e.target.value) || 0 } : x)) })} className="w-24" />
              <Input value={m.note} onChange={(e) => patch({ milestones: cfg.milestones.map((x, idx) => (idx === i ? { ...x, note: e.target.value } : x)) })} placeholder="窗口里显示的说明" className="min-w-[140px] flex-1" />
              <ActionPickers sound={m.sound} script={m.script} onChange={(v) => patch({ milestones: cfg.milestones.map((x, idx) => (idx === i ? { ...x, ...v } : x)) })} />
              <Btn size="sm" variant="ghost" onClick={() => patch({ milestones: cfg.milestones.filter((_, idx) => idx !== i) })} title="删除"><Trash2 size={13} /></Btn>
            </div>
          ))}
          {cfg.milestones.length === 0 && <span className="block text-xs text-[var(--text-4)]">还没有里程碑。积分越过某个分值就触发一次音效/脚本，清零后重新计。</span>}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Heart size={16} className="text-[var(--danger)]" /> 礼物心愿
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
              <Toggle value={wishCfg.autoAdd} onChange={(v) => patchWish({ autoAdd: v })} />收到礼物自动累计
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
              <Toggle value={wishCfg.showB} onChange={(v) => patchWish({ showB: v })} />开启心愿 B
            </label>
            <Btn variant={wishState.open ? 'secondary' : 'primary'} onClick={toggleWishWindow} title="打开绿幕心愿窗口">
              <MonitorPlay size={14} /> {wishState.open ? '关闭窗口' : '心愿窗口'}
            </Btn>
          </div>
        </div>
        <div className={`grid gap-3 ${wishCfg.showB ? 'md:grid-cols-2' : ''}`}>
          {renderGroup(0)}
          {wishCfg.showB && renderGroup(1)}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-4)]">
            「心愿窗口」= 绿幕心愿面板（金边深紫 · 礼物图 + 进度条 · 达成金色高亮，A/B 两组并排），进度实时同步，OBS / 直播伴侣窗口采集 + 色度键抠像上直播。
        </p>
      </Card>
    </div>
  )
}

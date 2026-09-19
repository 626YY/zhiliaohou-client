import { ENTRANCE_EFFECTS, entranceEffectMarkup, isEntranceEffect } from '@shared/entranceEffects'
import EmojiText from '../components/EmojiText'
import { MODERN_WIDGET_SKINS, normalizeWidgetSkin } from '@shared/widgetSkins'
import { useEffect, useState } from 'react'
import { Crown, MonitorPlay, Plus, Trash2, Play, FolderOpen, Music2, X } from 'lucide-react'
import type { EntranceBannerStyle, EntranceConfig, EntranceMatch, EntranceRecent, EntranceRule } from '@shared/types'
import { Btn, Card, Field, Input, Select, Segmented, Toggle } from '../components/ui'
import ViewerPicker, { type ViewerPick } from '../components/ViewerPicker'
import { useToast } from '../stores/ui'

const MATCH_OPTIONS: { value: EntranceMatch; label: string }[] = [
  { value: 'any', label: '任何人' },
  { value: 'equals', label: '昵称等于' },
  { value: 'contains', label: '昵称包含' }
]

function fileName(value: string): string {
  if (!value) return ''
  const parts = value.split(/[/\\]/)
  return parts[parts.length - 1] || value
}

function timeLabel(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function EntertainmentEntrance() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<EntranceConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<EntranceRecent[]>([])
  // 「试一试」：从已出现的观众里选人就带头像，手填照旧
  const [testWho, setTestWho] = useState<ViewerPick>({ name: '榜一大哥', avatar: '', uid: '' })
  const testName = testWho.name

  useEffect(() => {
    window.api.entranceState().then((s) => {
      setCfg(s.config)
      setOpen(s.open)
      setRecent(s.recent)
    })
    // 进场记录由主进程推过来：页面开着就能看到谁刚进来、命中了哪条规则
    return window.api.onEntranceChanged((s) => {
      setOpen(s.open)
      setRecent(s.recent)
    })
  }, [])

  // 配置存在主进程：改一项推一项
  const patch = (value: Partial<EntranceConfig>) => {
    if (!cfg) return
    setCfg({ ...cfg, ...value })
    void window.api.entranceConfigure(value)
  }

  const patchRule = (index: number, value: Partial<EntranceRule>) => {
    if (!cfg) return
    patch({ rules: cfg.rules.map((rule, i) => (i === index ? { ...rule, ...value } : rule)) })
  }

  const addRule = () => {
    if (!cfg) return
    patch({
      rules: [
        ...cfg.rules,
        {
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          enabled: true,
          match: cfg.rules.length === 0 ? 'any' : 'equals',
          name: '',
          text: cfg.rules.length === 0 ? '欢迎 {name} 进入直播间' : '大哥 {name} 驾到，全体起立！',
          video: '',
          videoWindow: 'video',
          sound: '',
          dedupeSeconds: 60
        }
      ]
    })
  }

  const pickFile = async (index: number, key: 'video' | 'sound') => {
    const res = await window.api.selectFile({
      title: key === 'video' ? '选择进场视频' : '选择进场音效',
      filters: key === 'video'
        ? [{ name: '视频', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi'] }]
        : [{ name: '音效', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) patchRule(index, { [key]: res.path })
  }

  const toggleWindow = async () => {
    if (open) {
      await window.api.entranceClose()
      setOpen(false)
      toast('进场横幅窗口已关闭', 'info')
      return
    }
    const r = await window.api.entranceOpen()
    if (!r.ok) return toast(r.error || '打开进场横幅窗口失败', 'error')
    setOpen(true)
    toast('进场横幅窗口已开启（透明，鼠标可穿透）', 'success')
  }

  const test = async () => {
    const r = await window.api.entranceTest(testName, testWho.avatar)
    if (!r.ok) toast(r.error || '测试失败', 'error')
  }

  // 下拉选人：昵称、头像、观众 id 一起写进规则；手填只改昵称（组件会把不匹配的头像清掉）
  const pickViewer = (index: number, pick: ViewerPick) => patchRule(index, { name: pick.name, avatar: pick.avatar || undefined, uid: pick.uid || undefined })

  if (!cfg) return null
  const previewName = testName.trim() || '榜一大哥'
  const previewRule = cfg.rules.find((rule) => rule.enabled && (rule.match === 'any' ||
    (rule.name.trim() && (rule.match === 'equals' ? previewName === rule.name.trim() : previewName.includes(rule.name.trim())))))
  const ruleText = previewRule?.text.trim() || '欢迎 {name} 进入直播间'
  const previewText = ruleText.includes('{name}') ? ruleText : `${ruleText} {name}`
  // 预览按命中规则的专属皮肤，没有就是全局皮肤
  const previewStyle: EntranceBannerStyle = previewRule?.bannerStyle || cfg.bannerStyle

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Crown size={16} className="text-[var(--accent-2)]" /> 大哥进场
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
              总开关
            </label>
            <Btn onClick={toggleWindow} variant={open ? 'secondary' : 'primary'}>
              <MonitorPlay size={14} /> {open ? '关闭横幅窗口' : '开启横幅窗口'}
            </Btn>
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          观众进直播间时按下面的规则从上到下找第一条匹配的：弹欢迎横幅、播进场视频、放进场音效。横幅窗口是透明置顶的，直接盖在游戏画面上，也可以让 OBS / 直播伴侣采集。
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="横幅样式">
            <Select aria-label="进场皮肤" value={cfg.bannerStyle} onChange={(e) => patch({ bannerStyle: e.target.value as EntranceConfig['bannerStyle'] })}>
              <option value="gold">金牌红底</option>
              <option value="neon">霓虹</option>
              <option value="clean">简洁黑底</option>
              {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
              <optgroup label="高能进场特效">{ENTRANCE_EFFECTS.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</optgroup>
            </Select>
          </Field>
          <Field label="横幅位置">
            <Select value={cfg.bannerPosition} onChange={(e) => patch({ bannerPosition: e.target.value as EntranceConfig['bannerPosition'] })}>
              <option value="top">屏幕顶部</option>
              <option value="center">屏幕中间</option>
              <option value="bottom">屏幕底部</option>
            </Select>
          </Field>
          <Field label="横幅停留（秒）">
            <Input type="number" min={1} value={cfg.bannerSeconds} onChange={(e) => patch({ bannerSeconds: Number(e.target.value) || 5 })} />
          </Field>
          <Field advanced label="视频最长（秒）" hint="0=播完为止">
            <Input type="number" min={0} value={cfg.videoSeconds} onChange={(e) => patch({ videoSeconds: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field advanced label="横幅宽度">
            <Input type="number" min={200} value={cfg.bannerWidth} onChange={(e) => patch({ bannerWidth: Number(e.target.value) || 640 })} />
          </Field>
          <Field advanced label="横幅高度">
            <Input type="number" min={60} value={cfg.bannerHeight} onChange={(e) => patch({ bannerHeight: Number(e.target.value) || 140 })} />
          </Field>
          <Field label="试一试" hint="从已出现的观众里选，或手填昵称" className="col-span-2">
            <div className="flex gap-2">
              <ViewerPicker value={testWho.name} avatar={testWho.avatar} uid={testWho.uid} onChange={setTestWho} placeholder="观众昵称" ariaLabel="试一试观众" className="flex-1" />
              <Btn variant="secondary" onClick={test}><Play size={14} /> 模拟进场</Btn>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="高能进场特效">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ENTRANCE_EFFECTS.map((effect) => <Btn key={effect.id} variant="secondary" size="sm"
            aria-label={`进场特效：${effect.name}`} aria-pressed={cfg.bannerStyle === effect.id}
            onClick={() => patch({ bannerStyle: effect.id })}
            className={`!block !p-2 ${cfg.bannerStyle === effect.id ? '!border-[var(--accent)] !bg-[var(--accent-soft)]' : ''}`}>
            <span data-entrance-effect={effect.id} className="arrival-choice-mark">{effect.mark}</span>
            <span className="mt-1 block text-[11px]">{effect.name}</span>
          </Btn>)}
        </div>
        <div className="widget-preview-stage overflow-hidden p-4" aria-label="进场横幅预览">
          {isEntranceEffect(previewStyle)
            ? <div key={previewStyle} dangerouslySetInnerHTML={{__html: entranceEffectMarkup(previewStyle, previewName, previewText)}} />
            : <div data-widget-skin={normalizeWidgetSkin(previewStyle)} className="flex justify-center">
              <div className={`entrance-banner skin-panel entrance-preview-${previewStyle}`}>
                <div className="avatar" aria-hidden="true"><Crown size={24} /></div>
                <div className="text">{previewText.split('{name}').map((part, i) => <span key={i}>{i > 0 && <b>{previewName}</b>}{part}</span>)}</div>
              </div>
            </div>}
        </div>
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--text)]">进场规则</div>
          <Btn size="sm" onClick={addRule}><Plus size={13} /> 添加规则</Btn>
        </div>
        {cfg.rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-5 text-center text-xs text-[var(--text-4)]">
            暂无进场规则。加一条「任何人」规则给所有观众打招呼，再加几条指定昵称的大哥专属规则放前面。
          </div>
        ) : (
          <div className="space-y-2">
            {cfg.rules.map((rule, index) => (
              <div key={rule.id} className={`space-y-2 rounded-lg border px-3 py-2.5 ${rule.enabled ? 'border-[var(--line)] bg-[var(--bg-elev)]' : 'border-dashed border-[var(--line)] opacity-60'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-5 text-right tnum text-xs text-[var(--text-4)]">{index + 1}</span>
                  <Toggle value={rule.enabled} onChange={(v) => patchRule(index, { enabled: v })} />
                  <Select value={rule.match} onChange={(e) => patchRule(index, { match: e.target.value as EntranceMatch })} className="w-28 text-xs">
                    {MATCH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </Select>
                  {rule.match !== 'any' && (
                    <ViewerPicker value={rule.name} avatar={rule.avatar} uid={rule.uid} onChange={(pick) => pickViewer(index, pick)}
                      placeholder={rule.match === 'equals' ? '选观众或填昵称' : '昵称里的关键词'} ariaLabel={`规则 ${index + 1} 观众`} className="w-56" />
                  )}
                  <Input value={rule.text} onChange={(e) => patchRule(index, { text: e.target.value })} placeholder="横幅文案，{name} 换成昵称" className="min-w-[200px] flex-1 text-xs" />
                  <div className="flex items-center gap-1 text-[11px] text-[var(--text-4)]">
                    去重
                    <Input type="number" min={0} value={rule.dedupeSeconds} onChange={(e) => patchRule(index, { dedupeSeconds: Math.max(0, Number(e.target.value) || 0) })} className="w-16 text-xs" title="同一观众多少秒内只迎一次；0=每次都迎" />
                    秒
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => index > 0 && patch({ rules: cfg.rules.map((r, i, arr) => (i === index - 1 ? arr[index] : i === index ? arr[index - 1] : r)) })} disabled={index === 0} title="上移（靠前的规则先匹配）">↑</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => patch({ rules: cfg.rules.filter((_, i) => i !== index) })} title="删除"><Trash2 size={14} /></Btn>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <div className="flex items-center gap-1">
                    <Btn size="sm" variant="secondary" onClick={() => pickFile(index, 'video')} title="选择进场视频"><FolderOpen size={13} /> 视频</Btn>
                    <span className="max-w-[160px] truncate text-[11px] text-[var(--text-3)]" title={rule.video}>{fileName(rule.video) || '不放视频'}</span>
                    {rule.video && <Btn size="sm" variant="ghost" onClick={() => patchRule(index, { video: '' })} title="移除视频"><X size={12} /></Btn>}
                  </div>
                  {rule.video && (
                    <Segmented
                      size="sm"
                      value={rule.videoWindow}
                      onChange={(v) => patchRule(index, { videoWindow: v })}
                      options={[{ value: 'video', label: '视频播放器窗' }, { value: 'green', label: '绿幕窗' }]}
                    />
                  )}
                  <div className="flex items-center gap-1 text-[11px] text-[var(--text-4)]">
                    皮肤
                    <Select aria-label={`规则 ${index + 1} 皮肤`} value={rule.bannerStyle || ''} onChange={(e) => patchRule(index, { bannerStyle: (e.target.value || undefined) as EntranceBannerStyle | undefined })} className="w-32 text-xs" title="这条规则专属的横幅皮肤；不选就跟上面的全局样式">
                      <option value="">跟全局</option>
                      <option value="gold">金牌红底</option>
                      <option value="neon">霓虹</option>
                      <option value="clean">简洁黑底</option>
                      {MODERN_WIDGET_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
                      <optgroup label="高能进场特效">{ENTRANCE_EFFECTS.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</optgroup>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Btn size="sm" variant="secondary" onClick={() => pickFile(index, 'sound')} title="选择进场音效"><Music2 size={13} /> 音效</Btn>
                    <span className="max-w-[160px] truncate text-[11px] text-[var(--text-3)]" title={rule.sound}>{fileName(rule.sound) || '不放音效'}</span>
                    {rule.sound && <Btn size="sm" variant="ghost" onClick={() => patchRule(index, { sound: '' })} title="移除音效"><X size={12} /></Btn>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 text-sm font-semibold text-[var(--text)]">最近进场</div>
        {recent.length === 0 ? (
          <div className="text-xs text-[var(--text-4)]">暂无进场记录，连上直播间后这里会显示谁进来了、命中了哪条规则。</div>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {recent.map((item, i) => (
              <div key={`${item.ts}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="tnum w-16 shrink-0 text-[var(--text-4)]">{timeLabel(item.ts)}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]"><EmojiText text={item.name} /></span>
                <span className={`shrink-0 ${item.rule ? 'text-[var(--ok)]' : 'text-[var(--text-4)]'}`}><EmojiText text={item.rule || '未命中规则'} /></span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

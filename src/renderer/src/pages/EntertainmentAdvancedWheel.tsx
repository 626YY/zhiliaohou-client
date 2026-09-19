import { useEffect, useState } from 'react'
import { Download, FileCode2, FileImage, MonitorPlay, Music2, Play, Upload } from 'lucide-react'
import type { AdvancedWheelConfig, AdvancedWheelOption } from '@shared/types'
import { Btn, Field, Input, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'

const CONFIG_KEY = 'ent-advanced-wheel-configs'
const COLORS = [
  '#E74C3C', '#E67E22', '#F1C40F', '#2ECC71',
  '#1ABC9C', '#3498DB', '#9B59B6', '#E91E63',
  '#00BCD4', '#8BC34A', '#FF5722', '#607D8B',
  '#795548', '#CDDC39', '#FF9800', '#673AB7'
]

type Source = 1 | 2
type ConfigSet = Record<Source, AdvancedWheelConfig>

function defaultOption(index: number): AdvancedWheelOption {
  return {
    text: `选项${index + 1}`,
    bgColor: COLORS[index],
    textColor: '#FFFFFF',
    bgImage: '',
    bgImageScale: 1,
    bgImageOffsetX: 0,
    bgImageOffsetY: 0,
    weight: 1,
    sound: '',
    scriptCategory: '',
    script: ''
  }
}

function defaultConfig(source: Source): AdvancedWheelConfig {
  return {
    source,
    sectorCount: 12,
    options: Array.from({ length: 16 }, (_, index) => defaultOption(index)),
    centerImage: '',
    centerScale: 1,
    spinSound: '',
    triggerGift: '',
    hotkey: ''
  }
}

function normalizeConfig(source: Source, value: Partial<AdvancedWheelConfig> | undefined): AdvancedWheelConfig {
  const base = defaultConfig(source)
  const sectorCount = value?.sectorCount
  return {
    ...base,
    ...value,
    source,
    sectorCount: sectorCount === 10 || sectorCount === 14 || sectorCount === 16 ? sectorCount : 12,
    options: Array.from({ length: 16 }, (_, index) => ({ ...base.options[index], ...value?.options?.[index] }))
  }
}

function readConfigs(): ConfigSet {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<Record<Source, AdvancedWheelConfig>>
    return { 1: normalizeConfig(1, saved[1]), 2: normalizeConfig(2, saved[2]) }
  } catch {
    return { 1: defaultConfig(1), 2: defaultConfig(2) }
  }
}

const fileFilters = {
  image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  sound: [{ name: '音效', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }],
  script: [{ name: '脚本或程序', extensions: ['bat', 'cmd', 'exe', 'ps1', 'vbs', 'py'] }]
}

function shortPath(value: string): string {
  if (!value) return '未设置'
  const parts = value.split(/[/\\]/)
  return parts[parts.length - 1] || value
}

export default function EntertainmentAdvancedWheel() {
  const toast = useToast((s) => s.toast)
  const [source, setSource] = useState<Source>(1)
  const [configs, setConfigs] = useState<ConfigSet>(readConfigs)
  const [open, setOpen] = useState<Record<Source, boolean>>({ 1: false, 2: false })
  const config = configs[source]

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(configs))
  }, [configs])

  useEffect(() => {
    void window.api.advancedWheelState().then((state) => setOpen({ 1: state.one, 2: state.two }))
  }, [])

  const commit = (next: AdvancedWheelConfig) => {
    setConfigs((previous) => ({ ...previous, [next.source]: next }))
    void window.api.advancedWheelUpdate(next).then((result) => {
      if (result.error) toast(result.error, 'error')
    })
  }

  const patch = (value: Partial<AdvancedWheelConfig>) => commit({ ...config, ...value })

  const patchOption = (index: number, value: Partial<AdvancedWheelOption>) => {
    const options = config.options.map((option, optionIndex) =>
      optionIndex === index ? { ...option, ...value } : option
    )
    patch({ options })
  }

  const selectFile = async (kind: keyof typeof fileFilters, apply: (path: string) => void) => {
    const result = await window.api.selectFile({
      title: kind === 'image' ? '选择图片' : kind === 'sound' ? '选择音效' : '选择脚本或程序',
      filters: fileFilters[kind],
      properties: ['openFile']
    })
    if (result.ok && result.path) apply(result.path)
  }

  const toggleWindow = async () => {
    if (open[source]) {
      await window.api.advancedWheelClose(source)
      setOpen((current) => ({ ...current, [source]: false }))
      toast(`已关闭高级转盘 ${source}`, 'info')
      return
    }
    const result = await window.api.advancedWheelOpen(config)
    if (!result.ok) {
      toast(result.error ?? '高级转盘打开失败', 'error')
      return
    }
    setOpen((current) => ({ ...current, [source]: true }))
    toast(result.error ?? `高级转盘 ${source} 已开启`, result.error ? 'error' : 'success')
  }

  const spin = async () => {
    if (!open[source]) return toast('请先开启该实例的绿幕转盘窗口', 'error')
    const result = await window.api.advancedWheelSpin(source)
    if (!result.ok || result.result == null) return toast('转盘当前不可用', 'error')
    toast(`抽中：${config.options[result.result]?.text || `选项${result.result + 1}`}`, 'success')
  }

  const importConfig = async () => {
    const result = await window.api.advancedWheelImport(source)
    if (!result.ok || !result.config) {
      if (result.error !== '已取消') toast(result.error ?? '导入配置失败', 'error')
      return
    }
    commit(normalizeConfig(source, result.config))
    toast(`高级转盘 ${source} 配置已导入`, 'success')
  }

  const exportConfig = async () => {
    const result = await window.api.advancedWheelExport(config)
    if (result.ok) toast('高级转盘配置已保存', 'success')
    else if (result.error !== '已取消') toast(result.error ?? '保存配置失败', 'error')
  }

  return (
    <section className="border-t border-[var(--line)] pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-[var(--text)]">高级转盘</div>
          <div className="mt-1 text-xs text-[var(--text-4)]">两套独立实例，支持 10/12/14/16 扇区、权重、音效、脚本、礼物和全局热键。</div>
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="secondary" onClick={importConfig} title="导入原版兼容的 JSON 配置"><Upload size={14} /> 导入</Btn>
          <Btn size="sm" variant="secondary" onClick={exportConfig} title="导出原版兼容的 JSON 配置"><Download size={14} /> 导出</Btn>
        </div>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[150px_1fr_auto] lg:items-end">
        <Field label="实例">
          <Select value={source} onChange={(event) => setSource(Number(event.target.value) === 2 ? 2 : 1)}>
            <option value={1}>转盘 1</option>
            <option value={2}>转盘 2</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="扇区数">
            <Select value={config.sectorCount} onChange={(event) => patch({ sectorCount: Number(event.target.value) as AdvancedWheelConfig['sectorCount'] })}>
              <option value={10}>10</option>
              <option value={12}>12</option>
              <option value={14}>14</option>
              <option value={16}>16</option>
            </Select>
          </Field>
          <Field label="触发礼物">
            <Input value={config.triggerGift} onChange={(event) => patch({ triggerGift: event.target.value })} placeholder="礼物名" />
          </Field>
          <Field label="全局热键">
            <Input value={config.hotkey} onChange={(event) => patch({ hotkey: event.target.value })} placeholder="Ctrl+Shift+1" />
          </Field>
          <Field label="中心图缩放">
            <Input type="number" min="0.3" max="3" step="0.1" value={config.centerScale} onChange={(event) => patch({ centerScale: Number(event.target.value) || 1 })} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Btn variant={open[source] ? 'secondary' : 'primary'} onClick={toggleWindow} title="打开或关闭此实例的绿幕转盘窗口"><MonitorPlay size={14} /> {open[source] ? '关闭窗口' : '开启窗口'}</Btn>
          <Btn onClick={spin} disabled={!open[source]} title="立即按权重抽取"><Play size={14} /> 抽取</Btn>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field label="中心图片">
          <div className="flex min-w-0 gap-2">
            <Input value={config.centerImage} readOnly title={config.centerImage} placeholder="未选择" />
            <Btn variant="secondary" onClick={() => void selectFile('image', (centerImage) => patch({ centerImage }))} title="选择中心图片"><FileImage size={14} /></Btn>
            {config.centerImage && <Btn variant="ghost" onClick={() => patch({ centerImage: '' })} title="移除中心图片">×</Btn>}
          </div>
        </Field>
        <Field label="旋转音效" hint="不选就用内置的转动哒哒声">
          <div className="flex min-w-0 gap-2">
            <Input value={config.spinSound} readOnly title={config.spinSound} placeholder="用内置音效" />
            <Btn variant="secondary" onClick={() => void selectFile('sound', (spinSound) => patch({ spinSound }))} title="选择旋转音效"><Music2 size={14} /></Btn>
            {config.spinSound && <Btn variant="ghost" onClick={() => patch({ spinSound: '' })} title="移除旋转音效">×</Btn>}
          </div>
        </Field>
        <Field label="内置音效" hint="没配自己的音效文件时，转动和抽中都有声">
          <Toggle label="内置音效" value={config.builtinSound !== false} onChange={(on) => patch({ builtinSound: on })} />
        </Field>
        <Field label="平时不出现在直播画面里" hint="画面平时是空的，触发才亮出来">
          <Toggle label="平时不出现在直播画面里" value={config.idleHide !== false} onChange={(on) => patch({ idleHide: on })} />
        </Field>
        {config.idleHide !== false && (
          <Field label="抽中后停留（秒）">
            <Input type="number" min={0} max={120} value={String(config.holdSeconds ?? 6)}
              onChange={(e) => patch({ holdSeconds: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} />
          </Field>
        )}
      </div>

      <div className="overflow-x-auto border-y border-[var(--line)]">
        <div className="min-w-[1120px]">
          <div className="grid grid-cols-[42px_155px_48px_48px_160px_75px_70px_70px_78px_150px_120px_160px] gap-2 border-b border-[var(--line)] px-2 py-2 text-[11px] font-medium text-[var(--text-4)]">
            <span>#</span><span>文字</span><span>底色</span><span>字色</span><span>扇区图片</span><span>缩放</span><span>X</span><span>Y</span><span>权重</span><span>中奖音效</span><span>脚本分类</span><span>脚本/程序</span>
          </div>
          {config.options.slice(0, config.sectorCount).map((option, index) => (
            <div key={index} className="grid grid-cols-[42px_155px_48px_48px_160px_75px_70px_70px_78px_150px_120px_160px] items-center gap-2 border-b border-[var(--line)] px-2 py-2 last:border-b-0">
              <span className="text-xs text-[var(--text-4)]">{index + 1}</span>
              <Input value={option.text} onChange={(event) => patchOption(index, { text: event.target.value })} />
              <input aria-label={`选项${index + 1}底色`} type="color" value={option.bgColor} onChange={(event) => patchOption(index, { bgColor: event.target.value })} className="h-9 w-10 cursor-pointer rounded border border-[var(--line)] bg-transparent p-1" />
              <input aria-label={`选项${index + 1}字色`} type="color" value={option.textColor} onChange={(event) => patchOption(index, { textColor: event.target.value })} className="h-9 w-10 cursor-pointer rounded border border-[var(--line)] bg-transparent p-1" />
              <div className="flex min-w-0 items-center gap-1">
                <Input value={shortPath(option.bgImage)} readOnly title={option.bgImage} />
                <Btn size="sm" variant="ghost" onClick={() => void selectFile('image', (bgImage) => patchOption(index, { bgImage }))} title="选择扇区背景图片"><FileImage size={13} /></Btn>
              </div>
              <Input type="number" min="0.1" max="2" step="0.1" value={option.bgImageScale} onChange={(event) => patchOption(index, { bgImageScale: Number(event.target.value) || 1 })} />
              <Input type="number" min="-260" max="260" value={option.bgImageOffsetX} onChange={(event) => patchOption(index, { bgImageOffsetX: Number(event.target.value) || 0 })} />
              <Input type="number" min="-260" max="260" value={option.bgImageOffsetY} onChange={(event) => patchOption(index, { bgImageOffsetY: Number(event.target.value) || 0 })} />
              <Input type="number" min="0" max="100000" value={option.weight} onChange={(event) => patchOption(index, { weight: Math.max(0, Number(event.target.value) || 0) })} />
              <div className="flex min-w-0 items-center gap-1">
                <Input value={shortPath(option.sound)} readOnly title={option.sound} />
                <Btn size="sm" variant="ghost" onClick={() => void selectFile('sound', (sound) => patchOption(index, { sound }))} title="选择中奖音效"><Music2 size={13} /></Btn>
              </div>
              <Input value={option.scriptCategory} onChange={(event) => patchOption(index, { scriptCategory: event.target.value })} placeholder="分类" />
              <div className="flex min-w-0 items-center gap-1">
                <Input value={shortPath(option.script)} readOnly title={option.script} />
                <Btn size="sm" variant="ghost" onClick={() => void selectFile('script', (script) => patchOption(index, { script }))} title="选择抽中后执行的脚本或程序"><FileCode2 size={13} /></Btn>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

import KeySequencePicker from '../components/KeySequencePicker'
import EmojiText from '../components/EmojiText'
import SkinPicker from '../components/SkinPicker'
import RuleSetupWizard from '../components/RuleSetupWizard'
import type {SetupKind} from '../lib/ruleSetup'
import {AdvancedFields,useConfigurationLevel} from '../lib/configurationLevel'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Play, Volume2, Download, Upload, Power, ListOrdered, MonitorPlay, Eraser, FileInput, ChevronUp, ChevronDown, FolderInput, FolderPlus, Save, Layers } from 'lucide-react'
import type { EntertainmentAction, EntertainmentActionType, EntertainmentPreset, EntertainmentCommandCmd, EntertainmentObsAction, EntertainmentRule, EntertainmentSystemCmd, ExecQueueSnapshot, ObsPanelState, PinyouImportResult, PinyouItemActions, PinyouProjectInfo, PinyouProjectItem, QueueWidgetConfig, TimeBlindBoxEvent } from '@shared/types'
import { ruleActionLabel, splitVideoParam, joinVideoParam } from '@shared/entertainmentLabels'
import { splitTargetSuffix, joinTargetSuffix } from '../utils/videoTarget'
import { ruleActions } from '@shared/entertainmentActions'
import { mergeImportedBlindBoxEvents } from '@shared/timeBlindBox'
import { Btn, Input, Segmented, Toggle, Card, EmptyState, Pill, Field, Select } from '../components/ui'
import { Modal } from '../components/Modal'
import { KeyboardUnlockButton } from '../components/KeyboardUnlockButton'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

const ACTION_LABEL: Record<EntertainmentActionType, string> = {
  key: '键鼠',
  script: '脚本',
  sound: '音效',
  system: '系统',
  command: '动作命令',
  obs: 'OBS'
}

const OBS_ACTION_OPTIONS: { value: EntertainmentObsAction; label: string; hint: string }[] = [
  { value: 'filter-toggle', label: '切换滤镜', hint: '开着就关、关着就开' },
  { value: 'filter-on', label: '打开滤镜', hint: '' },
  { value: 'filter-off', label: '关闭滤镜', hint: '' },
  { value: 'filter-flash', label: '滤镜亮几秒', hint: '打开滤镜，过 N 秒自动关，适合「送礼物画面抖一下」' },
  { value: 'scene', label: '切换场景', hint: '切到指定场景' }
]

const SYSTEM_OPTIONS: { value: EntertainmentSystemCmd; label: string }[] = [
  { value: 'shutdown', label: '自动关机' },
  { value: 'lock', label: '锁定屏幕' },
  { value: 'displayoff', label: '显示器息屏' },
  { value: 'kill', label: '结束进程' }
]

// 动作命令（复刻参考软件「动作命令」子执行器 0x4d8942）
const COMMAND_OPTIONS: { value: EntertainmentCommandCmd; label: string; hint: string }[] = [
  { value: 'countdown-adjust', label: '倒计时加减', hint: '秒数，可填 -1000,1000 表示范围内随机' },
  { value: 'countdown-clear', label: '倒计时清零', hint: '清零时间插件挂件' },
  { value: 'send-text', label: '发送文本', hint: '向当前焦点窗口发送文本（可加回车）' },
  { value: 'paste-text', label: '粘贴文本', hint: '复制到剪贴板并粘贴' },
  { value: 'run-file', label: '运行文件/创建进程', hint: '运行 .exe/.bat/.ps1 路径' },
  { value: 'kill', label: '结束进程', hint: '进程名，如 notepad.exe' },
  { value: 'mouse', label: '鼠标操作', hint: '左键/右键 单击/双击/按住/弹起/移动' },
  { value: 'video-play', label: '播放视频', hint: '视频文件路径：整段播完自动收；写成「路径|秒数」只播这几秒' },
  { value: 'video-random', label: '随机播放视频', hint: '视频目录路径；每次触发从目录随机选一个，播完自动收' },
  {
    value: 'blindbox-open',
    label: '开时间盲盒',
    hint: '开一次时间盲盒：填盲盒事件名，留空就从全部启用的事件里随机抽（要先在倒计时挂件里配好盲盒事件）'
  },
  {
    value: 'project-random',
    label: '触发项目（文件夹）',
    hint: '一个文件夹就是一个项目：从里面随机抽一条视频播，旁边有同名 .脚本 就把脚本里的动作（加班加减、计数、锁键盘…）一起执行。素材文件夹直接选就行'
  },
  { value: 'sound-random', label: '随机播放音效', hint: '音效目录路径；每次触发从目录随机选一个' },
  { value: 'video-gif', label: '播放动图', hint: 'GIF/动图文件路径' },
  { value: 'video-stop', label: '停止视频', hint: '停掉规则触发的视频（含还在排队的）' },
  { value: 'mobile', label: '手游动作', hint: '自动抬头/低头/转圈/蹦迪/前进/后退/左右移动' },
  { value: 'wheel-spin', label: '转盘抽奖', hint: '触发绿幕转盘窗口转动（需先在转盘模块开启窗口）' },
  { value: 'nine-spin', label: '九宫格抽奖', hint: '触发绿幕九宫格窗口转动（需先在九宫格模块开启窗口）' },
  { value: 'count-adjust', label: '计时加减', hint: '联动计数挑战/加班挂件（秒数，支持 -100,100 范围随机）' },
  { value: 'count-clear', label: '计时清零', hint: '计数挑战/加班挂件归零' },
  { value: 'count-mul', label: '计时乘以', hint: '当前值 ×N（参考命令「计时：×」），参数如 2' },
  { value: 'count-div', label: '计时除以', hint: '当前值 ÷N（参考命令「计时：÷」），参数如 10' },
  { value: 'overtime-adjust', label: '加班加减', hint: '加班器当前值加减，参数可填 -100,100 表示范围内随机' },
  { value: 'overtime-mul', label: '加班乘以', hint: '加班器当前值 ×N，参数如 2' },
  { value: 'overtime-div', label: '加班除以', hint: '加班器当前值 ÷N，参数如 10' },
  { value: 'overtime-clear', label: '加班清零', hint: '加班器当前值归零' },
  { value: 'key-hold', label: '键盘按住', hint: '真按住不放：键名,毫秒，如 W,3000；毫秒可写 1000~3000 随机。键名认字母数字、F1~F12、空格/回车/上下左右/Shift/Ctrl/Alt' },
  { value: 'key-sequence', label: '按键序列', hint: 'SendKeys 序列，如 ^a、{F3}' },
  { value: 'key-up', label: '弹起按键', hint: '弹起脚本中按住的键，如 W' },
  { value: 'key-lock', label: '锁定键盘 / 调整锁定时长', hint: '全部|3000 或 W,A,S,D|5000（毫秒）；新锁定替换当前锁定。调整|-1000 减少剩余 1 秒，调整|1000 增加 1 秒；未锁定时调整无效。到期自动解锁，随时按 Esc 或点「解锁键盘」立即解锁' },
  { value: 'key-unlock', label: '解锁键盘', hint: '立即解除所有键盘锁定，无需参数；也可随时按 Esc 解锁' },
  { value: 'script-sequence', label: '脚本序列', hint: '导入 .脚本 后自动生成的动作序列' },
  { value: 'random-script', label: '随机执行脚本', hint: '从目录里随机挑一个 bat/cmd/exe/ps1/vbs/py 运行' }
]

const MOBILE_OPTIONS: { value: string; label: string }[] = [
  { value: 'up', label: '自动抬头' },
  { value: 'down', label: '自动低头' },
  { value: 'turn', label: '原地转圈' },
  { value: 'turnfire', label: '原地转圈+开火' },
  { value: 'dance', label: '蹦迪-经典' },
  { value: 'dance2', label: '蹦迪-偷袭' },
  { value: 'fwd', label: '自动前进' },
  { value: 'back', label: '自动后退' },
  { value: 'lmove', label: '自动左移' },
  { value: 'rmove', label: '自动右移' }
]

const MOUSE_COMMAND_OPTIONS: { value: string; label: string }[] = [
  { value: 'click-left', label: '左键单击' },
  { value: 'click-right', label: '右键单击' },
  { value: 'dblclick-left', label: '左键双击' },
  { value: 'down-left', label: '左键按住' },
  { value: 'up-left', label: '左键弹起' },
  { value: 'down-right', label: '右键按住' },
  { value: 'up-right', label: '右键弹起' }
]

// 礼物名下拉：参考软件内置的抖音礼物库（146 个，含抖币价）
const GIFT_PRESETS = DOUYIN_GIFT_NAMES

// 新建项目：在素材目录里建一个文件夹，挑一批视频复制进去，自动按条目建好规则。
// 这样主播自己攒的素材也是「项目」——能整组开关、能导出给别人（2026-09-08 用户要求）。
function NewProjectModal({
  open,
  onClose,
  onDone
}: {
  open: boolean
  onClose: () => void
  onDone: (msg: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pick = async () => {
    const r = await window.api.selectFile({
      title: '选择要放进这个项目的视频（可多选）',
      filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (!r.ok) return
    const picked = r.paths?.length ? r.paths : r.path ? [r.path] : []
    setFiles((prev) => [...new Set([...prev, ...picked])])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建项目"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-4)]">选了 {files.length} 个视频</span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>取消</Btn>
            <Btn
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true)
                setErr('')
                try {
                  const r = await window.api.projectCreate(name.trim(), files)
                  if (!r.ok) {
                    setErr(r.error || '建不了')
                    return
                  }
                  onClose()
                  setName('')
                  setFiles([])
                  onDone(
                    `项目「${name.trim()}」已建好：复制了 ${r.copied || 0} 个视频，自动建了 ${r.added || 0} 条规则。填上礼物名再打开项目开关`
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? '建立中…' : '建立项目'}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="项目名" hint="就是素材目录里那个文件夹的名字，比如「翻牌子时间」">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="项目名" />
        </Field>
        <Field label="视频" hint="复制进项目文件夹；视频旁边有同名 .脚本 会一起带过来">
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => void pick()}>选视频</Btn>
            {files.length > 0 && (
              <Btn variant="ghost" size="sm" onClick={() => setFiles([])}>清空</Btn>
            )}
          </div>
          {files.length > 0 && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded border border-[var(--line)] bg-[var(--bg-input)] p-1">
              {files.map((f) => (
                <div key={f} className="truncate px-2 py-1 text-xs text-[var(--text-3)]" title={f}>
                  {f.split(/[\\/]/).pop()}
                </div>
              ))}
            </div>
          )}
        </Field>
        <p className="text-[11px] leading-4 text-[var(--text-4)]">
          建好后每个视频一条规则（规则名 = 视频名，默认停用）。之后可以在项目标题右边把整个项目导出成一个文件夹发给别人。
        </p>
        {err && <p role="alert" className="text-sm text-[var(--danger)]">{err}</p>}
      </div>
    </Modal>
  )
}

export default function EntertainmentGiftRules() {
  const {level,setLevel}=useConfigurationLevel()
  const [wizard,setWizard]=useState<{rule?:EntertainmentRule;kind?:SetupKind}|null>(null)
  const toast = useToast((s) => s.toast)
  const [rules, setRules] = useState<EntertainmentRule[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EntertainmentRule | null>(null)

// 批量导入品游「项目」：素材目录里一个文件夹就是一个项目
  const [projectImport, setProjectImport] = useState(false)

  // 导入品游（娱乐助手Pro）配置：主进程选文件并转好规则，这里只做预览 + 确认
  const [pinyou, setPinyou] = useState<PinyouImportResult | null>(null)
  const [pinyouPlan, setPinyouPlan] = useState(0)
  const [pinyouReplace, setPinyouReplace] = useState(true)
  const [pinyouBusy, setPinyouBusy] = useState(false)
  const pinyouApplying = useRef(false)
  const [pinyouApplied, setPinyouApplied] = useState<Record<number, string>>({})
  const [pinyouError, setPinyouError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // 项目预设：一套「今晚开哪几个项目」。分组一般就是品游项目名（导入时自动填）
  const [presets, setPresets] = useState<EntertainmentPreset[]>([])
  const [presetPick, setPresetPick] = useState('')
  const [presetName, setPresetName] = useState('')
  const [newProject, setNewProject] = useState(false)
  // 行内改礼物名：草稿存在这里，失焦/回车才写库（每敲一个字都写库会卡）
  const [giftDraft, setGiftDraft] = useState<Record<string, string>>({})
  const [giftSaving, setGiftSaving] = useState('')
  // 回车跳到下一条的输入框：连着填一个项目的礼物不用碰鼠标
  const giftInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const soundElRef = useRef<HTMLAudioElement | null>(null)

  const load = async () => {
    const r = await window.api.entertainmentRulesList()
    setRules(r)
    try {
      const list = await window.api.entertainmentPresetList()
      setPresets(list.presets || [])
      // 选中的预设可能已经被删/被导入覆盖成新 id：清掉，别留个按不动的「导出这个预设」
      setPresetPick((cur) => (cur && (list.presets || []).some((p) => p.id === cur) ? cur : ''))
    } catch {
      /* 预设读不到不影响规则列表 */
    }
  }
  useEffect(() => {
    load()
  }, [])

  const triggerAction = async (rule: EntertainmentAction) => {
    if (rule.actionType === 'key' && rule.keySeq) {
      const r = await window.api.entertainmentSendKeys(rule.keySeq)
      if (!r.ok) toast(r.error ?? '按键发送失败', 'error')
    } else if (rule.actionType === 'script' && rule.scriptPath) {
      const r = await window.api.entertainmentRunScript(rule.scriptPath)
      if (!r.ok) toast(r.error ?? '脚本执行失败', 'error')
    } else if (rule.actionType === 'sound' && rule.soundPath) {
      const url = 'file:///' + rule.soundPath.replace(/\\/g, '/')
      if (rule.soundMode === 'unique') {
        // 相同音效不重叠：复用单实例，正在播就不重播
        if (!soundElRef.current) soundElRef.current = new Audio()
        const a = soundElRef.current
        // a.src 是浏览器规范化过的 URL（中文/空格会被百分号编码），跟拼出来的字符串永远不相等 → 每次点都重头播；用 dataset 记原始路径比
        if (a.dataset.src !== url) {
          a.src = url
          a.dataset.src = url
        }
        if (!a.paused) return
        a.currentTime = 0
        a.play().catch(() => toast(`音效播放失败：${rule.soundPath}（文件不存在或格式不支持）`, 'error'))
      } else {
        // play() 的失败是异步 rejection，try/catch 抓不到；导入来的裸文件名 / 已删掉的音效以前点了毫无反应
        new Audio(url).play().catch(() => toast(`音效播放失败：${rule.soundPath}（文件不存在或格式不支持）`, 'error'))
      }
    } else if (rule.actionType === 'system' && rule.systemCmd) {
      const r = await window.api.entertainmentSystemAction(rule.systemCmd, rule.systemParam)
      if (!r.ok) toast(r.error ?? '系统动作执行失败', 'error')
    } else if (rule.actionType === 'command' && rule.commandCmd) {
      const r = await window.api.entertainmentCommand(rule.commandCmd, rule.commandParam)
      if (!r.ok) toast(r.error ?? '动作命令执行失败', 'error')
    } else if (rule.actionType === 'obs') {
      // OBS 动作在主进程执行（要走 websocket 连接），这里借场景切换/滤镜接口直接调
      if (rule.obsAction === 'scene') {
        const r = await window.api.obsSetScene(rule.obsScene || '')
        if (!r.ok) toast(r.error ?? 'OBS 切场景失败', 'error')
      } else if (rule.obsSource && rule.obsFilter) {
        const wantOn = rule.obsAction === 'filter-on' || rule.obsAction === 'filter-flash'
          ? true
          : rule.obsAction === 'filter-off'
            ? false
            : undefined
        const state = await window.api.obsState()
        const current = state.filters.find((f) => f.source === rule.obsSource && f.filter === rule.obsFilter)
        const r = await window.api.obsSetFilter(rule.obsSource, rule.obsFilter, wantOn ?? !(current?.enabled ?? false))
        if (!r.ok) toast(r.error ?? 'OBS 滤镜操作失败', 'error')
        else if (rule.obsAction === 'filter-flash') {
          window.setTimeout(() => void window.api.obsSetFilter(rule.obsSource!, rule.obsFilter!, false), Math.max(100, (Number(rule.obsSeconds) || 3) * 1000))
        }
      } else toast('这条 OBS 规则还没填源和滤镜', 'error')
    }
  }

  // ▶ 测试触发跟真实触发一样：主动作 + 附加动作按顺序来，「先等几秒」也照等
  const trigger = async (rule: EntertainmentRule) => {
    for (const action of ruleActions(rule)) {
      const wait = Math.max(0, Number(action.delayMs) || 0)
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
      await triggerAction(action)
    }
  }

  const openEdit = (rule?: EntertainmentRule) => {
    if(level==='basic'){setWizard({rule});return}
    setEditing(
      rule ?? {
        id: '',
        giftName: '',
        actionType: 'key',
        keySeq: '',
        enabled: true
      }
    )
    setOpen(true)
  }

  const savingRef = useRef(false)
  const save = async (rule: EntertainmentRule) => {
    if (savingRef.current) return   // 连点两下「保存」以前会新增两条同样的规则，送一次礼触发两次
    savingRef.current = true
    try {
      const r = rule.id
        ? await window.api.entertainmentRuleUpdate(rule)
        : await window.api.entertainmentRuleAdd(rule)
      if (!r.ok) return toast(r.error ?? '保存失败', 'error')
      setOpen(false)
      setEditing(null)
      await load()
      toast('规则已保存', 'success')
    } finally {
      savingRef.current = false
    }
  }

  // 行内存礼物名。★没绑礼物的规则本来就是停用的，这里【只存礼物名不自动启用】——
  //   一次导入几十条，自动启用等于突然全部生效，主播该自己按项目开关打开。
  const saveGiftName = async (rule: EntertainmentRule, next: string) => {
    const value = next.trim()
    if (value === String(rule.giftName || '').trim()) {
      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[rule.id]; return copy })
      return true
    }
    setGiftSaving(rule.id)
    try {
      const r = await window.api.entertainmentRuleUpdate({ ...rule, giftName: value })
      if (!r.ok) {
        toast(r.error ?? '保存失败', 'error')
        return false
      }
      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[rule.id]; return copy })
      await load()
      return true
    } finally {
      setGiftSaving('')
    }
  }

  // 从文件夹导入项目：别人发来的项目文件夹（带 项目规则.json）或者任意装着视频的文件夹
  const importFolder = async () => {
    const r = await window.api.projectImportFolder()
    if (r.canceled) return
    if (!r.ok) return toast(r.error || '导入失败', 'error')
    await load()
    const how = r.fromManifest ? '按对方的规则' : '按里面的视频'
    const copy = r.copied ? `，素材复制了 ${r.copied} 个文件` : ''
    toast(`项目「${r.project}」已导入：${how}建了 ${r.added} 条规则${copy}。填上礼物名再打开项目开关`, 'success')
  }

  const remove = async (id: string) => {
    await window.api.entertainmentRuleRemove(id)
    await load()
  }

  // ---- 项目分组：一个组 = 一个品游项目（导入时自动填 group），主播按组整开整关 ----
  const UNGROUPED = '未分组'
  const groupOf = (r?: EntertainmentRule) => (r ? String(r.group || '').trim() || UNGROUPED : '')
  // 有项目的排前面、同项目挨着；组内保持原顺序（sort 是稳定的）
  const ordered = [...rules].sort((a, b) => {
    const ga = groupOf(a)
    const gb = groupOf(b)
    if (ga === gb) return 0
    if (ga === UNGROUPED) return 1
    if (gb === UNGROUPED) return -1
    return ga.localeCompare(gb, 'zh')
  })
  const groupStat = (name: string) => {
    const list = rules.filter((r) => groupOf(r) === name)
    return {
      total: list.length,
      enabled: list.filter((r) => r.enabled !== false).length,
      // 没绑礼物的规则开了也不触发（主进程会拦），这里明说，免得主播以为开了
      unbound: list.filter((r) => (r.triggerType || 'gift') === 'gift' && !String(r.giftName || '').trim()).length
    }
  }
  const toggleGroup = async (name: string, on: boolean) => {
    const r = await window.api.entertainmentGroupToggle(name, on)
    await load()
    if (!r.ok) return toast('整组开关没生效', 'error')
    const tail = r.skipped && on ? `，${r.skipped} 条还没绑礼物（绑了才能启用）` : ''
    toast(`「${name}」已${on ? '启用' : '停用'} ${r.changed} 条${tail}`, r.skipped && on ? 'info' : 'success')
  }

  const applyPreset = async (id: string) => {
    setPresetPick(id)
    if (!id) return
    const r = await window.api.entertainmentPresetApply(id)
    await load()
    if (!r.ok) return toast(r.error || '应用预设失败', 'error')
    const tail = r.skipped ? `，${r.skipped} 条没绑礼物` : ''
    toast(`已应用预设：开 ${r.on} 条、关 ${r.off} 条${tail}`, 'success')
  }
  const savePreset = async () => {
    const on = [
      ...new Set(
        rules
          .filter((r) => r.enabled !== false && String(r.group || '').trim())
          .map((r) => String(r.group).trim())
      )
    ]
    if (!on.length) return toast('当前没有启用的项目，先开几个再存预设', 'error')
    const name = presetName.trim() || `直播方案${presets.length + 1}`
    const r = await window.api.entertainmentPresetSave({ name, groups: on })
    if (!r.ok) return toast(r.error || '保存预设失败', 'error')
    setPresetName('')
    setPresetPick(r.id || '')
    await load()
    toast(`预设「${name}」已保存：${on.length} 个项目`, 'success')
  }
  const deletePreset = async () => {
    if (!presetPick) return
    await window.api.entertainmentPresetRemove(presetPick)
    setPresetPick('')
    await load()
  }

  const openPinyou = async () => {
    setPinyouBusy(true)
    try {
      const r = await window.api.entertainmentPinyouImport()
      if (r.canceled) return
      if (!r.ok || !r.plans?.length) {
        toast(r.error || '没认出这个配置文件', 'error')
        return
      }
      setPinyouPlan(0)
      setPinyouApplied({})
      setPinyouError('')
      setPinyou(r)
    } catch (e) {
      toast(`读取配置失败：${(e as Error).message}`, 'error')
    } finally {
      setPinyouBusy(false)
    }
  }

  const confirmPinyou = async () => {
    const plan = pinyou?.plans?.[pinyouPlan]
    if (!plan || pinyouApplying.current || pinyouApplied[pinyouPlan]) return
    pinyouApplying.current = true
    setPinyouBusy(true)
    setPinyouError('')
    try {
      const result = await window.api.entertainmentPinyouApply(plan.rules, pinyouReplace)
      if (!result.ok) throw new Error(result.error || '导入失败，请重试')
      const summary = `已导入 ${result.added} 条规则，替换 ${result.removed} 条旧规则，${plan.skipped.length} 条未导入`
      setPinyouApplied((previous) => ({ ...previous, [pinyouPlan]: summary }))
      toast(summary, 'success')
      try { await load() } catch { toast('规则已保存，列表刷新失败，请重新进入此页', 'error') }
    } catch (e) {
      const message = (e as Error).message
      setPinyouError(message)
      toast(message, 'error')
    } finally {
      pinyouApplying.current = false
      setPinyouBusy(false)
    }
  }

  // 存成 JSON 文件（浏览器下载那套，Electron 里会落到下载目录）
  const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
  const today = () => new Date().toISOString().slice(0, 10)

  // 单个项目导出成【一个文件夹】：视频 + 同名脚本 + 项目规则.json，
  // 别的主播拿到整个文件夹，点「导入项目」就能直接用（2026-09-08 用户要求）
  const exportGroup = async (group: string) => {
    const rows = rules.filter((r) => String(r.group || '').trim() === group)
    if (!rows.length) return toast('这个项目下没有规则', 'error')
    const r = await window.api.projectExport(group, rows)
    if (r.canceled) return
    if (!r.ok) return toast(r.error || '导出失败', 'error')
    const size = r.bytes ? `，素材 ${(r.bytes / 1024 / 1024).toFixed(1)} MB` : ''
    toast(
      r.withMedia
        ? `项目「${group}」已导出到 ${r.dir}：${rows.length} 条规则、${r.files} 个文件${size}。整个文件夹发给对方，他点「导入项目」就能用`
        : `项目「${group}」已导出到 ${r.dir}，但没找到它的素材文件夹，只带了规则——对方还需要你把视频发给他`,
      r.withMedia ? 'success' : 'info'
    )
  }

  // 单个预设导出：预设 + 它涉及的那些项目的规则，一份文件就能让对方复现这套直播方案
  const exportPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return toast('先在下拉里选一个预设', 'error')
    const want = new Set(preset.groups)
    const rows = rules.filter((r) => want.has(String(r.group || '').trim()))
    downloadJson(
      {
        kind: 'zhiliao-ent-rules',
        version: 1,
        exportedAt: new Date().toISOString(),
        rules: rows,
        presets: [{ id: preset.id, name: preset.name, groups: preset.groups }]
      },
      `预设_${preset.name}_${today()}.json`
    )
    toast(`已导出预设「${preset.name}」：${preset.groups.length} 个项目、${rows.length} 条规则`, 'success')
  }

  // 导出配置为 JSON 文件：规则 + 项目预设一整包（换台电脑、换个直播方案都能带走）
  const exportConfig = () => {
    const payload = {
      kind: 'zhiliao-ent-rules',
      version: 1,
      exportedAt: new Date().toISOString(),
      rules,
      presets
    }
    downloadJson(payload, `礼物触发规则_${today()}.json`)
    toast('配置已导出（含项目预设）', 'success')
  }

  // 导入配置 JSON
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const parsed = JSON.parse(await f.text())
      // 老版本导出的是一个裸数组，新版本是 { rules, presets } —— 两种都认
      const arr: EntertainmentRule[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rules)
          ? parsed.rules
          : []
      if (!arr.length) throw new Error('格式不对')
      // ★别人导出的路径是他机器上的（盘符/目录都不一样）：按项目文件夹名改到本机素材目录，
      //   改不动的如实报出来——对方缺的是视频素材本身。
      let moved = 0
      let missing: string[] = []
      let list = arr
      try {
        const fixed = await window.api.pinyouRelocateRules(arr)
        list = fixed.rules
        moved = fixed.moved
        missing = fixed.missing
      } catch {
        /* 改不了就按原样导入，不因为这一步整个失败 */
      }
      let added = 0
      let skipped = 0
      for (const r of list) {
        // 规则名或礼物名有一个就收（导入品游项目建的规则本来就还没绑礼物）
        if (!r || ((r.triggerType || 'gift') === 'gift' && !r.giftName && !r.name)) {
          skipped++
          continue
        }
        const res = await window.api.entertainmentRuleAdd({ ...r, id: '' })
        if (res.ok) added++
        else skipped++
      }
      let presetAdded = 0
      for (const p of Array.isArray(parsed?.presets) ? parsed.presets : []) {
        if (!p?.name) continue
        const res = await window.api.entertainmentPresetSave({
          name: String(p.name),
          groups: Array.isArray(p.groups) ? p.groups.map(String) : []
        })
        if (res.ok) presetAdded++
      }
      await load()
      const tail = [
        skipped ? `${skipped} 条没导入（缺规则名和礼物名）` : '',
        presetAdded ? `${presetAdded} 个预设` : '',
        moved ? `${moved} 处素材路径已改到本机素材目录` : ''
      ].filter(Boolean).join('，')
      toast(`已导入 ${added} 条规则${tail ? '，' + tail : ''}`, added ? 'success' : 'error')
      if (missing.length) {
        toast(`本机素材目录里没有这些项目文件夹：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}——把对方的视频文件夹放进素材目录再试`, 'info')
      }
    } catch {
      toast('导入失败：请选择导出的 JSON 配置', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-[var(--text-3)]">
          收到礼物时自动执行对应动作（键鼠 / 脚本 / 音效 / 系统动作）。礼物名来自连接器日志，
          如「火箭」「小心心」——<b className="text-[var(--text-2)]">直接在下面每行填礼物名</b>，
          回车就存并跳到下一条；整个项目的开关在项目名那一行。测试触发用 ▶ 按钮。
        </p>
        <div className="flex flex-wrap gap-2">
          <KeyboardUnlockButton />
          <Btn onClick={()=>setWizard({kind:'box'})}><FolderPlus size={14}/>创建视频盲盒</Btn>
          <AdvancedFields>
          <Btn variant="secondary" onClick={exportConfig}>
            <Download size={14} /> 导出配置
          </Btn>
          <Btn variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> 导入配置
          </Btn>
          <Btn variant="secondary" onClick={openPinyou} disabled={pinyouBusy} title="读旧软件（娱乐助手Pro）的礼物配置文件，转成这里的规则">
            <FileInput size={14} /> 导入旧软件配置
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => setProjectImport(true)}
            title="把素材目录里的项目（一个文件夹一个项目）批量建成规则：触发时随机播一条视频并执行它的脚本动作"
          >
            <FolderInput size={14} /> 导入项目
          </Btn>
          <Btn variant="secondary" onClick={() => setNewProject(true)} title="在素材目录里建一个新项目：挑一批视频进去，自动建好规则">
            <FolderPlus size={14} /> 新建项目
          </Btn>
          </AdvancedFields>
          <Btn variant="secondary" onClick={() => openEdit()}>
            <Plus size={14} /> 新增规则
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFile}
          />
        </div>
      </div>

      {/* 项目预设：不同直播开不同项目，存一套选一套；透明图菜单也按当前开着的项目生成 */}
      {rules.some((r) => String(r.group || '').trim()) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-3 py-2"
          aria-label="项目预设"
        >
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-2)]">
            <Layers size={13} /> 项目预设
          </span>
          <Select
            aria-label="选择项目预设"
            value={presetPick}
            onChange={(e) => void applyPreset(e.target.value)}
            className="w-48"
          >
            <option value="">选择预设（选中即应用）</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.groups.length} 个项目）
              </option>
            ))}
          </Select>
          {presetPick && (
            <>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => exportPreset(presetPick)}
                title="把这个预设连它的项目规则一起导出，发给别的主播"
                aria-label="导出这个预设"
              >
                <Download size={13} />
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => void deletePreset()} title="删除这个预设">
                <Trash2 size={13} />
              </Btn>
            </>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="预设名"
            className="w-28"
            aria-label="预设名"
          />
          <Btn size="sm" variant="secondary" onClick={() => void savePreset()} title="把当前开着的项目存成一个预设">
            <Save size={12} /> 存为预设
          </Btn>
          <span className="text-[11px] text-[var(--text-4)]">存的是「开哪几个项目」，切直播换一套就行</span>
        </div>
      )}

      {/* 礼物名候选（146 个抖音礼物）：弹窗和列表行内的输入框共用这一份 */}
      <datalist id="ent-gift-presets" data-page-level>
        {GIFT_PRESETS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <ProjectImportModal
        open={projectImport}
        onClose={() => setProjectImport(false)}
        onDone={(msg) => { void load(); toast(msg, 'success') }}
        onImportFolder={() => { setProjectImport(false); void importFolder() }}
      />

      <NewProjectModal
        open={newProject}
        onClose={() => setNewProject(false)}
        onDone={(msg) => { void load(); toast(msg, 'success') }}
      />
      {wizard&&<RuleSetupWizard initialRule={wizard.rule} initialKind={wizard.kind} onClose={()=>setWizard(null)} onSaved={()=>void load()} onAdvanced={draft=>{setWizard(null);setEditing(draft);setOpen(true);setLevel('advanced')}}/>}

      {pinyou?.plans?.length ? (
        <PinyouPreviewModal
          result={pinyou}
          planIndex={pinyouPlan}
          onPlanChange={(index) => { if (!pinyouApplying.current) { setPinyouPlan(index); setPinyouError('') } }}
          replace={pinyouReplace}
          onReplaceChange={setPinyouReplace}
          busy={pinyouBusy}
          applied={pinyouApplied[pinyouPlan]}
          error={pinyouError}
          onClose={() => { if (!pinyouApplying.current) setPinyou(null) }}
          onConfirm={confirmPinyou}
        />
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          title="暂无礼物触发规则"
          desc="添加一条规则：填礼物名 + 选动作类型，连接器收到该礼物即自动触发。"
          action={
            <Btn onClick={() => openEdit()}>
              <Plus size={14} /> 新增规则
            </Btn>
          }
        />
      ) : (
        <div className="space-y-2">
          {ordered.map((r, i) => (
            <Fragment key={r.id}>
              {groupOf(r) !== groupOf(ordered[i - 1]) && (
                <GroupHeaderRow
                  name={groupOf(r)}
                  stat={groupStat(groupOf(r))}
                  onToggle={toggleGroup}
                  onExport={exportGroup}
                />
              )}
            <div
              className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--bg-card)] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">
                    {r.name || r.giftName || '未命名规则'}
                  </span>
                  {/* 规则名和礼物名是两回事：名字是人认的，礼物名才是触发条件。
                      礼物名的输入框就在这一行右边，不用再进弹窗改 */}
                  <Pill tone="ok" dot>
                    {ACTION_LABEL[r.actionType]}
                  </Pill>
                  {(r.extraActions?.length ?? 0) > 0 && (
                    <Pill tone="muted" className="ent-extra-count">+{r.extraActions!.length} 动作</Pill>
                  )}
                  {r.enabled === false && <Pill tone="muted">停用</Pill>}
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--text-3)]" title={ruleActionLabel(r)}>
                  {(r.extraActions?.length ?? 0) > 0
                    ? ruleActionLabel(r)
                    : r.actionType === 'key'
                    ? `按键 ${r.keySeq}`
                    : r.actionType === 'script'
                      ? `脚本 ${r.scriptPath}`
                      : r.actionType === 'sound'
                        ? `音效 ${r.soundPath}`
                        : r.actionType === 'command'
                          ? ruleActionLabel(r)
                          : r.actionType === 'obs'
                            ? `${ruleActionLabel(r)}${r.obsAction !== 'scene' && r.obsSource ? ` · ${r.obsSource}` : ''}`
                            : `系统 · ${SYSTEM_OPTIONS.find((s) => s.value === r.systemCmd)?.label || r.systemCmd}${r.systemCmd === 'kill' && r.systemParam ? ' · ' + r.systemParam : ''}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* 礼物名直接在这儿填：回车存下并跳到下一条 */}
                <Input
                  aria-label={`规则 ${r.name || r.giftName || ''} 的礼物名`}
                  value={giftDraft[r.id] ?? r.giftName ?? ''}
                  list="ent-gift-presets"
                  placeholder="填礼物名"
                  disabled={giftSaving === r.id}
                  ref={(el) => { giftInputs.current[r.id] = el }}
                  onChange={(e) => setGiftDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  onBlur={(e) => void saveGiftName(r, e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') {
                      setGiftDraft((prev) => { const copy = { ...prev }; delete copy[r.id]; return copy })
                      e.currentTarget.blur()
                      return
                    }
                    if (e.key !== 'Enter') return
                    const ok = await saveGiftName(r, e.currentTarget.value)
                    if (!ok) return
                    // 跳到下一条（列表当前顺序），连着填一个项目不用碰鼠标
                    const index = ordered.findIndex((x) => x.id === r.id)
                    const next = ordered[index + 1]
                    if (next) giftInputs.current[next.id]?.focus()
                    else e.currentTarget.blur()
                  }}
                  className={`h-8 w-28 text-xs ${r.giftName ? '' : 'border-[var(--warn)]'}`}
                />
                <Btn size="sm" variant="ghost" onClick={() => trigger(r)} title="测试触发">
                  <Play size={14} />
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => openEdit(r)} title="编辑">
                  <Pencil size={14} />
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => remove(r.id)} title="删除">
                  <Trash2 size={14} />
                </Btn>
              </div>
            </div>
            </Fragment>
          ))}
        </div>
      )}

      <QueueWidgetCard />

      {open && (
        <RuleModal
          rule={editing}
          onClose={() => {
            setOpen(false)
            setEditing(null)
          }}
          onSave={save}
          onBasic={draft=>{setOpen(false);setWizard({rule:draft});setLevel('basic')}}
        />
      )}
    </div>
  )
}

// 分组标题行：一个组 = 一个品游项目，右边小开关整组开停。
// ★没绑礼物的规则开了也不会触发（主进程拦着），所以这里把条数标出来。
function GroupHeaderRow({
  name,
  stat,
  onToggle,
  onExport
}: {
  name: string
  stat: { total: number; enabled: number; unbound: number }
  onToggle: (name: string, on: boolean) => void | Promise<void>
  onExport: (name: string) => void
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 px-1 pt-1 first:mt-0" aria-label={`项目 ${name}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-semibold text-[var(--text-2)]">{name}</span>
        <span className="tnum shrink-0 text-[11px] text-[var(--text-4)]">
          {stat.enabled}/{stat.total} 启用
        </span>
        {stat.unbound > 0 && <Pill tone="warn">{stat.unbound} 条未绑礼物</Pill>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* 单个项目导出：别的主播想要这个项目，把这个文件发给他就行 */}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => onExport(name)}
          title={`导出「${name}」这一个项目的规则（发给别的主播用；视频素材要另外发）`}
          aria-label={`导出项目 ${name}`}
        >
          <Download size={12} />
        </Btn>
        <Toggle value={stat.enabled > 0} onChange={(on) => void onToggle(name, on)} />
      </div>
    </div>
  )
}

// 整蛊排队展示：规则按优先级排队执行，这个窗口把「正在执行 + 排队中」摆上直播画面
// 品游配置导入预览：让主播先看清哪些礼物导过来了、哪些导不了（品游自家脚本/随机目录/物理硬件），再确认
function PinyouPreviewModal({
  result,
  planIndex,
  onPlanChange,
  replace,
  onReplaceChange,
  busy,
  applied,
  error,
  onClose,
  onConfirm
}: {
  result: PinyouImportResult
  planIndex: number
  onPlanChange: (i: number) => void
  replace: boolean
  onReplaceChange: (v: boolean) => void
  busy: boolean
  applied?: string
  error?: string
  onClose: () => void
  onConfirm: () => void
}) {
  const plans = result.plans || []
  const plan = plans[Math.min(planIndex, plans.length - 1)]
  if (!plan) return null
  const triggerLabel = (r: EntertainmentRule): string => {
    const t = r.triggerType || 'gift'
    if (t === 'follow') return '关注'
    if (t === 'like') return `点赞${r.times ? `×${r.times}` : ''}`
    if (t === 'member') return '进场'
    if (t === 'comment') return `弹幕「${r.giftName}」`
    return r.giftName
  }
  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={busy}
      title="导入旧软件配置"
      width={640}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={busy}>
            {applied ? '关闭' : '取消'}
          </Btn>
          <Btn onClick={onConfirm} disabled={busy || !!applied || plan.rules.length === 0}>
            {busy ? '导入中…' : applied ? '已导入' : `导入 ${plan.rules.length} 条`}
          </Btn>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {applied && <p role="status" className="text-xs text-[var(--ok)]">{applied}</p>}
        {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="text-xs leading-5 text-[var(--text-3)]">
          {result.root ? (
            <>已认出素材目录：{result.root}，音效 / 视频按它的「音效」「视频」文件夹定位。</>
          ) : (
            <>没找到对应的素材目录（音效 / 视频只带了文件名），导入后请在规则里重新选一次文件。</>
          )}
        </div>
        {plans.length > 1 ? (
          <Field label="方案">
            <Select
              disabled={busy}
              value={String(planIndex)}
              onChange={(e) => onPlanChange(Number(e.target.value))}
            >
              {plans.map((p, i) => (
                <option key={i} value={String(i)}>
                  {p.name}（{p.rules.length} 条）
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div>
          方案「{plan.name}」：可导入 <b>{plan.rules.length}</b> 条
          {plan.skipped.length ? <>，导不了 <b>{plan.skipped.length}</b> 条</> : null}
          {plan.empty ? <>，原配置里空着的礼物 {plan.empty} 个</> : null}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Toggle value={replace} onChange={onReplaceChange} disabled={busy || !!applied} />
          替换同一触发来源、同名礼物的旧规则（关闭则追加）
        </label>
        <div className="max-h-56 overflow-auto rounded border border-[var(--line)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-2)] text-left text-[var(--text-3)]">
              <tr>
                <th className="px-2 py-1">触发</th>
                <th className="px-2 py-1">动作</th>
                <th className="px-2 py-1">阈值 / 次数 / 队列</th>
              </tr>
            </thead>
            <tbody>
              {plan.rules.map((r, i) => (
                <tr key={i} className="border-t border-[var(--line)]">
                  <td className="px-2 py-1 whitespace-nowrap">{triggerLabel(r)}</td>
                  <td className="px-2 py-1 break-all">{ruleActionLabel(r)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.times && r.times > 1 ? `${r.times} 个` : '1 个'}
                    {' / '}{r.repeat && r.repeat > 1 ? `${r.repeat} 次` : '1 次'}
                    {' / '}{r.multiply === false ? '单次' : '倍数'}
                    {' / '}{r.queueMode === 'jump' ? '插队' : r.queueMode === 'instant' ? '即时' : '排队'}
                    {r.priority ? ` / 优先 ${r.priority}` : ''}
                  </td>
                </tr>
              ))}
              {plan.rules.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-center text-[var(--text-3)]" colSpan={3}>
                    这个方案里没有能直接转过来的规则
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {plan.skipped.length ? (
          <div className="space-y-1">
            <div className="text-xs font-medium">导不了的（要在这边手动补）：</div>
            <ul className="max-h-32 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-[var(--text-3)]">
              {plan.skipped.map((s, i) => (
                <li key={i}>
                  {s.gift}（{s.category}）：{s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {plan.notes.length ? (
          <div className="space-y-1">
            <div className="text-xs font-medium">导过来但要留意：</div>
            <ul className="max-h-32 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-[var(--text-3)]">
              {plan.notes.map((n, i) => (
                <li key={i}>
                  {n.gift}：{n.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function QueueWidgetCard() {
  const toast = useToast((s) => s.toast)
  const [cfg, setCfg] = useState<QueueWidgetConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ExecQueueSnapshot>({ running: null, pending: [] })

  useEffect(() => {
    window.api.queueState().then((s) => {
      setCfg(s.config)
      setOpen(s.open)
      setSnapshot(s.snapshot)
    })
    return window.api.onQueueChanged(setSnapshot)
  }, [])

  const patch = (value: Partial<QueueWidgetConfig>) => {
    if (!cfg) return
    setCfg({ ...cfg, ...value })
    void window.api.queueConfigure(value)
  }

  const toggle = async () => {
    if (open) {
      await window.api.queueClose()
      setOpen(false)
      toast('排队窗口已关闭', 'info')
      return
    }
    const r = await window.api.queueOpen()
    if (!r.ok) return toast(r.error || '打开排队窗口失败', 'error')
    setOpen(true)
    toast('排队窗口已开启', 'success')
  }

  const clear = async () => {
    const r = await window.api.queueClear()
    toast(r.cleared ? `已清空 ${r.cleared} 条排队` : '队列本来就是空的', 'info')
  }

  const skip = async () => {
    const r = await window.api.queueSkip(1)
    toast(r.skipped ? '已跳过下一条' : '队列里没有可跳过的', 'info')
  }

  if (!cfg) return null

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <ListOrdered size={16} className="text-[var(--accent-2)]" /> 整蛊排队
          <Pill tone={snapshot.running ? 'ok' : 'muted'} dot pulse={!!snapshot.running}>
            {snapshot.running ? `执行中：${snapshot.running.gift}` : '空闲'}
          </Pill>
          <span className="tnum text-xs text-[var(--text-3)]">排队 {snapshot.total ?? snapshot.pending.length} 条</span>
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="secondary" onClick={skip} title="丢掉排在最前面的一条，不执行">跳过下一条</Btn>
          <Btn size="sm" variant="secondary" onClick={clear} title="丢掉还没执行的排队礼物"><Eraser size={13} /> 清空队列</Btn>
          <Btn size="sm" onClick={toggle} variant={open ? 'secondary' : 'primary'}>
            <MonitorPlay size={13} /> {open ? '关闭排队窗口' : '排队窗口'}
          </Btn>
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
        规则里的「排队方式 / 优先等级」决定顺序：优先等级高的先执行，插队的排到最前，即时的不进队列。窗口显示正在执行哪条、后面排着谁送的什么。
      </p>
      <div className="mb-4"><SkinPicker label="排队皮肤" value={cfg.skin} onChange={(skin) => patch({ skin })} /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="窗口标题">
          <Input value={cfg.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field advanced label="最多显示几条">
          <Input type="number" min={1} max={100} value={cfg.maxRows} onChange={(e) => patch({ maxRows: Number(e.target.value) || 8 })} />
        </Field>
        <Field label="窗口背景">
          <Segmented size="sm" value={cfg.background} onChange={(v) => patch({ background: v })} options={[{ value: 'green', label: '绿幕' }, { value: 'transparent', label: '透明' }]} />
        </Field>
        <div className="flex flex-col justify-end gap-1.5 pb-1">
          <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Toggle value={cfg.showSender} onChange={(v) => patch({ showSender: v })} />显示送礼人</label>
          <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Toggle value={cfg.showAction} onChange={(v) => patch({ showAction: v })} />显示动作</label>
        </div>
      </div>
      {snapshot.pending.length > 0 && (
        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2">
          {snapshot.pending.slice(0, 30).map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 text-xs">
              <span className="tnum w-5 text-right text-[var(--text-4)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--text)]"><EmojiText text={item.gift} />{item.sender ? <> · <EmojiText text={item.sender} /></> : null}</span>
              <span className="shrink-0 text-[var(--text-3)]">{item.action}</span>
            </div>
          ))}
          {(snapshot.total ?? snapshot.pending.length) > 30 && <div className="text-center text-[11px] text-[var(--text-4)]">还有 {(snapshot.total ?? snapshot.pending.length) - 30} 条</div>}
        </div>
      )}
    </Card>
  )
}

function RuleModal({
  rule,
  onClose,
  onSave,
  onBasic
}: {
  rule: EntertainmentRule | null
  onClose: () => void
  onSave: (r: EntertainmentRule) => void
  onBasic: (r: EntertainmentRule) => void
}) {
  const [form, setForm] = useState<EntertainmentRule>(
    rule ?? { id: '', giftName: '', actionType: 'key', keySeq: '', enabled: true }
  )
  const set = (patch: Partial<EntertainmentRule>) =>
    setForm((p) => ({ ...p, ...patch }))
  // 附加动作：主动作之后按顺序执行；每个可设「先等几秒」
  const extras = form.extraActions ?? []
  const setExtra = (i: number, patch: Partial<EntertainmentAction>) =>
    setForm((p) => {
      const list = [...(p.extraActions ?? [])]
      list[i] = { ...list[i], ...patch }
      return { ...p, extraActions: list }
    })
  const addExtra = () =>
    setForm((p) => ({ ...p, extraActions: [...(p.extraActions ?? []), { actionType: 'key', keySeq: '', delayMs: 0 }] }))
  const removeExtra = (i: number) =>
    setForm((p) => ({ ...p, extraActions: (p.extraActions ?? []).filter((_, j) => j !== i) }))
  const moveExtra = (i: number, dir: -1 | 1) =>
    setForm((p) => {
      const list = [...(p.extraActions ?? [])]
      const j = i + dir
      if (j < 0 || j >= list.length) return p
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...p, extraActions: list }
    })
  // OBS 动作要选源/滤镜/场景：任何一个动作是 OBS 就从滤镜设置页同一份状态里拿列表
  const needObs = form.actionType === 'obs' || extras.some((a) => a.actionType === 'obs')
  const [obs, setObs] = useState<ObsPanelState | null>(null)
  useEffect(() => {
    if (needObs && !obs) window.api.obsState().then(setObs)
  }, [needObs, obs])

  return (
    <Modal
      closeOnBackdrop={false}
      open
      onClose={onClose}
      title={form.id ? '编辑规则' : '新增规则'}
      width={520}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            取消
          </Btn>
          <Btn onClick={() => onSave(form)} disabled={((!form.triggerType||form.triggerType==='gift')&&!form.giftName.trim())||(form.actionType==='key'&&!form.keySeq)||(form.actionType==='sound'&&!form.soundPath?.trim())||(form.actionType==='command'&&form.commandCmd==='video-play'&&!form.commandParam?.split('|')[0]?.trim())}>保存</Btn>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[var(--text-3)]">填写触发礼物，再选择要播放的素材或效果。</p><Btn size="sm" variant="secondary" onClick={()=>onBasic(form)}>返回基础引导</Btn></div>
        <Field label="规则名" hint="给这条规则起个名字，方便认（导入项目时会自动填成视频名/项目名）">
          <Input
            value={form.name ?? ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="如：-10分 / 虚拟主播时间"
          />
        </Field>
        {(!form.triggerType || form.triggerType === 'gift' || form.triggerType === 'comment') && <Field label={form.triggerType === 'comment' ? '弹幕关键词' : '礼物名'} hint={form.triggerType === 'comment' ? '留空匹配全部弹幕' : '留空的礼物规则不会触发，也不能启用'}>
          <Input
            value={form.giftName}
            onChange={(e) => set({ giftName: e.target.value })}
            list={form.triggerType === 'comment' ? undefined : 'ent-gift-presets'}
            placeholder={form.triggerType === 'comment' ? '如：加油；留空匹配全部' : '如：火箭 / 小心心'}
          />
          <datalist id="ent-gift-presets">
            {GIFT_PRESETS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="触发来源">
            <Select
              value={form.triggerType ?? 'gift'}
              onChange={(e) => set({ triggerType: e.target.value as EntertainmentRule['triggerType'] })}
            >
              <option value="gift">送礼物</option>
              <option value="follow">关注</option>
              <option value="like">点赞</option>
              <option value="member">进场</option>
              <option value="comment">弹幕关键词</option>
            </Select>
          </Field>
          <Field label="多少个礼物触发一次" hint="累计达到数量才触发；关注/进场按 1 次算">
            <Input
              type="number"
              min={1}
              step={1}
              value={form.times ?? 1}
              onChange={(e) => set({ times: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field advanced label="连续执行次数">
            <Input
              type="number"
              min={1}
              step={1}
              value={form.repeat ?? 1}
              onChange={(e) => set({ repeat: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
          <Field advanced label="优先等级" hint="数字越大越先执行">
            <Input
              type="number"
              step={1}
              value={form.priority ?? 0}
              onChange={(e) => set({ priority: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field advanced label="排队方式">
            <Select
              value={form.queueMode ?? 'normal'}
              onChange={(e) => set({ queueMode: e.target.value as EntertainmentRule['queueMode'] })}
            >
              <option value="normal">普通排队</option>
              <option value="jump">插队</option>
              <option value="instant">即时执行</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--text-3)]">
          <Toggle
            value={form.multiply !== false}
            onChange={(v) => set({ multiply: v })}
          />
          按收到数量倍数执行
        </label>

        {/* 动作 1（主动作）：字段直接存在规则上 */}
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3" data-testid="action-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text)]">动作 1{extras.length ? '（先执行）' : ''}</span>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
              先等 <SecondsInput ms={form.delayMs} onChange={(ms) => set({ delayMs: ms })} title="收到礼物后先等几秒再执行这个动作；0 = 立刻" /> 秒
            </label>
          </div>
          <ActionEditor value={form} onChange={set} obs={obs} idp="ent-a0" />
        </div>

        {/* 动作 2…N（附加动作） */}
        {extras.map((a, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3" data-testid={`action-${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text)]">动作 {i + 2}</span>
              <div className="flex items-center gap-1">
                <label className="mr-1 flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
                  先等 <SecondsInput ms={a.delayMs} onChange={(ms) => setExtra(i, { delayMs: ms })} title="上一个动作开始后先等几秒再执行这个；0 = 紧跟着（等于同时触发）" /> 秒
                </label>
                <Btn size="sm" variant="ghost" onClick={() => moveExtra(i, -1)} disabled={i === 0} title="上移">
                  <ChevronUp size={14} />
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => moveExtra(i, 1)} disabled={i === extras.length - 1} title="下移">
                  <ChevronDown size={14} />
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => removeExtra(i)} title="删除这个动作">
                  <Trash2 size={14} />
                </Btn>
              </div>
            </div>
            <ActionEditor value={a} onChange={(patch) => setExtra(i, patch)} obs={obs} idp={`ent-a${i + 1}`} />
          </div>
        ))}
        <div className="flex items-start gap-3">
          <Btn variant="secondary" size="sm" onClick={addExtra} title="给这条规则再加一个动作">
            <Plus size={14} /> 添加动作
          </Btn>
          <span className="text-[11px] leading-4 text-[var(--text-4)]">
            一条规则可以带多个动作，收到礼物后按顺序执行；「先等几秒」填 0 就是紧跟上一个（等于同时触发）。比如：播放视频 → 等 2 秒按 F1 → 再放个音效。
          </span>
        </div>

        <label className="flex items-center gap-2 pt-1 text-sm text-[var(--text-2)]">
          <Toggle
            value={form.enabled !== false}
            onChange={(v) => set({ enabled: v })}
          />
          启用该规则
        </label>
      </div>
    </Modal>
  )
}

// 秒数输入：内部存毫秒，界面按秒显示；用本地草稿让「0.」「1.」这种中间态能打出来
function SecondsInput({ ms, onChange, title }: { ms?: number; onChange: (ms: number) => void; title?: string }) {
  const toText = (v?: number) => String(Math.max(0, Number(v) || 0) / 1000)
  const [draft, setDraft] = useState(() => toText(ms))
  const msRef = useRef(Math.max(0, Number(ms) || 0))
  useEffect(() => {
    // 外面换了值（比如上移/下移换了位置）才重置草稿；自己敲出来的不动
    const next = Math.max(0, Number(ms) || 0)
    if (msRef.current !== next) {
      msRef.current = next
      setDraft(toText(next))
    }
  }, [ms])
  const commit = (text: string) => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) return
    const next = Math.max(0, Math.round(n * 1000))
    msRef.current = next
    onChange(next)
  }
  return (
    <Input
      className="w-16 px-1.5 py-0.5 text-center text-xs"
      value={draft}
      title={title}
      inputMode="decimal"
      aria-label="先等几秒"
      onChange={(e) => {
        setDraft(e.target.value)
        commit(e.target.value)
      }}
      onBlur={() => {
        const n = Number(draft)
        const next = Number.isFinite(n) && draft.trim() !== '' ? Math.max(0, Math.round(n * 1000)) : msRef.current
        msRef.current = next
        setDraft(toText(next))
        onChange(next)
      }}
    />
  )
}

const ACTION_TYPE_OPTIONS: { value: EntertainmentActionType; label: string }[] = [
  { value: 'key', label: '键鼠按键' },
  { value: 'script', label: '执行脚本' },
  { value: 'sound', label: '播放音效' },
  { value: 'system', label: '系统动作' },
  { value: 'command', label: '动作命令' },
  { value: 'obs', label: 'OBS' }
]

// 一个动作的编辑器：主动作和附加动作字段完全一样，只是数据落在不同位置。
// idp 是 datalist id 前缀：同一个弹窗里有好几个编辑器，id 不能撞。
function ActionEditor({
  value: form,
  onChange: set,
  obs,
  idp
}: {
  value: EntertainmentAction
  onChange: (patch: Partial<EntertainmentAction>) => void
  obs: ObsPanelState | null
  idp: string
}) {
  const obsSources = obs ? [...new Set(obs.filters.map((f) => f.source))] : []
  const obsFilters = obs ? obs.filters.filter((f) => f.source === form.obsSource) : []

  const pickFile = async (
    key: 'scriptPath' | 'soundPath',
    title: string,
    exts: string[]
  ) => {
    const res = await window.api.selectFile({
      title,
      filters: [{ name: title, extensions: exts }],
      properties: ['openFile']
    })
    if (res.ok && res.path) set({ [key]: res.path })
  }

  const playSound = () => {
    if (!form.soundPath) return
    try {
      new Audio('file:///' + form.soundPath.replace(/\\/g, '/')).play()
    } catch {
      /* 试听失败忽略 */
    }
  }

  return (
    <>
        <Field advanced label="动作类型">
          <Segmented
            value={form.actionType}
            onChange={(v) => {
              // 下拉框显示的默认值也要真的写进规则：以前选「动作命令」不碰下拉框直接保存，
              // commandCmd 是空的，规则存下来却什么都不执行（系统动作、OBS 同理）。
              const patch: Partial<EntertainmentAction> = { actionType: v }
              if (v === 'command' && !form.commandCmd) patch.commandCmd = 'countdown-adjust'
              if (v === 'system' && !form.systemCmd) patch.systemCmd = 'shutdown'
              if (v === 'obs' && !form.obsAction) patch.obsAction = 'filter-toggle'
              set(patch)
            }}
            size="sm"
            options={ACTION_TYPE_OPTIONS}
          />
        </Field>
        {form.actionType === 'obs' && (
          <>
            <Field label="OBS 动作" hint={OBS_ACTION_OPTIONS.find((o) => o.value === (form.obsAction ?? 'filter-toggle'))?.hint}>
              <Select value={form.obsAction ?? 'filter-toggle'} onChange={(e) => set({ obsAction: e.target.value as EntertainmentObsAction })}>
                {OBS_ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            {form.obsAction === 'scene' ? (
              <Field label="场景">
                <Input value={form.obsScene ?? ''} onChange={(e) => set({ obsScene: e.target.value })} list={`${idp}-obs-scenes`} placeholder="场景名" />
                <datalist id={`${idp}-obs-scenes`}>
                  {(obs?.scenes.scenes ?? []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="源">
                    <Input value={form.obsSource ?? ''} onChange={(e) => set({ obsSource: e.target.value })} list={`${idp}-obs-sources`} placeholder="如：游戏采集" />
                    <datalist id={`${idp}-obs-sources`}>
                      {obsSources.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </Field>
                  <Field label="滤镜">
                    <Input value={form.obsFilter ?? ''} onChange={(e) => set({ obsFilter: e.target.value })} list={`${idp}-obs-filters`} placeholder="如：色彩校正" />
                    <datalist id={`${idp}-obs-filters`}>
                      {obsFilters.map((f) => <option key={f.filter} value={f.filter} />)}
                    </datalist>
                  </Field>
                </div>
                {form.obsAction === 'filter-flash' && (
                  <Field label="亮几秒">
                    <Input type="number" min={0.1} step={0.5} value={form.obsSeconds ?? 3} onChange={(e) => set({ obsSeconds: Number(e.target.value) || 3 })} />
                  </Field>
                )}
              </>
            )}
            <p className="text-[11px] leading-4 text-[var(--text-4)]">
              {obs?.connection.connected
                ? `已连接 OBS，下拉列表来自当前场景集合（${obs.filters.length} 个滤镜）。`
                : '还没连接 OBS：列表按本机场景集合离线读取，规则触发时需要 OBS 已连接才会生效（滤镜设置模块里连）。'}
            </p>
          </>
        )}
        {form.actionType === 'key' && (
          <KeySequencePicker value={form.keySeq??''} onChange={keySeq=>set({keySeq})}/>
        )}
        {form.actionType === 'script' && (
          <Field label="脚本 / 程序路径">
            <div className="flex gap-2">
              <Input
                value={form.scriptPath ?? ''}
                onChange={(e) => set({ scriptPath: e.target.value })}
                placeholder="选择 .bat / .exe / .ps1"
              />
              <Btn
                variant="secondary"
                onClick={() => pickFile('scriptPath', '选择脚本', ['bat', 'exe', 'cmd', 'ps1'])}
              >
                选择
              </Btn>
            </div>
          </Field>
        )}
        {form.actionType === 'sound' && (
          <>
            <Field label="音效文件">
              <div className="flex gap-2">
                <Input
                  value={form.soundPath ?? ''}
                  onChange={(e) => set({ soundPath: e.target.value })}
                  placeholder="选择 .mp3 / .wav"
                />
                <Btn
                  variant="secondary"
                  onClick={() => pickFile('soundPath', '选择音效', ['mp3', 'wav', 'ogg'])}
                >
                  选择
                </Btn>
                <Btn variant="secondary" onClick={playSound} title="试听">
                  <Volume2 size={14} />
                </Btn>
              </div>
            </Field>
            <Field advanced label="音效播放方式">
              <Segmented
                value={form.soundMode ?? 'sync'}
                onChange={(v) => set({ soundMode: v })}
                size="sm"
                options={[
                  { value: 'sync', label: '同步·完整播放' },
                  { value: 'unique', label: '相同不重叠' }
                ]}
              />
            </Field>
            <Field label={`音量 ${form.soundVolume ?? 100}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={form.soundVolume ?? 100}
                onChange={(e) => set({ soundVolume: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
          </>
        )}
        {form.actionType === 'system' && (
          <>
            <Field label="系统动作">
              <Select
                value={form.systemCmd ?? 'shutdown'}
                onChange={(e) => set({ systemCmd: e.target.value as EntertainmentSystemCmd })}
              >
                {SYSTEM_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </Field>
            {form.systemCmd === 'kill' && (
              <Field label="进程名" hint="如 notepad.exe">
                <Input
                  value={form.systemParam ?? ''}
                  onChange={(e) => set({ systemParam: e.target.value })}
                  placeholder="notepad.exe"
                />
              </Field>
            )}
            <p className="text-[11px] leading-4 text-[var(--text-4)]">
              对应参考软件「动作分类」的系统项：自动关机（5 秒后）/ 锁定屏幕 / 显示器息屏 / 结束进程。谨慎使用。
            </p>
          </>
        )}
        {form.actionType === 'command' && (
          <>
            <Field advanced label="动作命令">
              <Select
                value={form.commandCmd ?? 'countdown-adjust'}
                onChange={(e) => {
                  const v = e.target.value as EntertainmentCommandCmd
                  set({ commandCmd: v })
                  if (v === 'mouse') set({ commandParam: 'click-left' })
                }}
              >
                {COMMAND_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
            {form.commandCmd === 'mouse' ? (
              <>
                <Field label="鼠标动作">
                  <Select
                    value={(form.commandParam ?? 'click-left').split('|')[0]}
                    onChange={(e) => {
                      const parts = (form.commandParam ?? '').split('|')
                      set({ commandParam: parts.length >= 3 ? `${e.target.value}|${parts[1]}|${parts[2]}` : e.target.value })
                    }}
                  >
                    {MOUSE_COMMAND_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field advanced label="屏幕坐标" hint="可留空；格式 x,y">
                  <Input
                    value={(() => { const p = (form.commandParam ?? '').split('|'); return p.length >= 3 ? `${p[1]},${p[2]}` : '' })()}
                    placeholder="如：960,540"
                    onChange={(e) => {
                      const m = e.target.value.match(/^\s*(-?\d+)\s*[,，]\s*(-?\d+)\s*$/)
                      const action = (form.commandParam ?? 'click-left').split('|')[0]
                      set({ commandParam: m ? `${action}|${m[1]}|${m[2]}` : action })
                    }}
                  />
                </Field>
              </>
            ) : form.commandCmd === 'mobile' ? (
              <Field label="手游动作">
                <Select
                  value={form.commandParam ?? 'up'}
                  onChange={(e) => set({ commandParam: e.target.value })}
                >
                  {MOBILE_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
            ) : form.commandCmd === 'random-script' ? (
              <Field label="脚本目录" hint={COMMAND_OPTIONS.find((c) => c.value === 'random-script')?.hint}>
                <div className="flex gap-2">
                  <Input value={form.commandParam ?? ''} onChange={(e) => set({ commandParam: e.target.value })} placeholder="选择一个放脚本的文件夹" className="flex-1" />
                  <Btn
                    variant="secondary"
                    onClick={async () => {
                      const res = await window.api.selectFile({ title: '选择脚本目录', properties: ['openDirectory'] })
                      if (res.ok && res.path) set({ commandParam: res.path })
                    }}
                  >
                    选择
                  </Btn>
                </div>
              </Field>
            ) : form.commandCmd === 'project-random' ? (
              <>
                <ProjectPicker
                  value={form.commandParam ?? ''}
                  onChange={(v) => set({ commandParam: v })}
                />
                <ProjectItemActions value={form.commandParam ?? ''} obs={obs} />
              </>
            ) : form.commandCmd === 'video-random' || form.commandCmd === 'sound-random' ? (
              <>
                <Field label={form.commandCmd === 'video-random' ? '视频目录' : '音效目录'} hint={COMMAND_OPTIONS.find((c) => c.value === form.commandCmd)?.hint}>
                  <div className="flex gap-2">
                    <Input value={splitTargetSuffix(form.commandParam ?? '').rest} onChange={(e) => set({ commandParam: joinTargetSuffix(e.target.value, splitTargetSuffix(form.commandParam ?? '').target, splitTargetSuffix(form.commandParam ?? '').overflow) })} placeholder="选择目录" className="flex-1" />
                    <Btn variant="secondary" onClick={async () => { const res = await window.api.selectFile({ title: '选择目录', properties: ['openDirectory'] }); if (res.ok && res.path) set({ commandParam: joinTargetSuffix(res.path, splitTargetSuffix(form.commandParam ?? '').target, splitTargetSuffix(form.commandParam ?? '').overflow) }) }}>选择</Btn>
                  </div>
                </Field>
                {form.commandCmd === 'video-random' ? (
                  <Field label="指定播放窗口" hint="不选就播到设置里的默认播放窗口">
                    <VideoTargetSelect value={form.commandParam ?? ''} onChange={(v) => set({ commandParam: v })} />
                  </Field>
                ) : null}
              </>
            ) : form.commandCmd === 'video-play' || form.commandCmd === 'video-gif' ? (
              <>
                <Field label={form.commandCmd === 'video-play' ? '视频文件' : 'GIF/动图文件'}>
                  <div className="flex gap-2">
                    <Input
                      value={splitVideoParam(form.commandParam).path}
                      onChange={(e) => set({ commandParam: joinVideoParam(e.target.value, splitVideoParam(form.commandParam).seconds, splitVideoParam(form.commandParam).target, splitVideoParam(form.commandParam).overflow !== false) })}
                      placeholder="选择视频/GIF 文件"
                      className="flex-1"
                    />
                    <Btn
                      variant="secondary"
                      onClick={async () => {
                        const res = await window.api.selectFile({
                          title: '选择视频/GIF',
                          filters: form.commandCmd === 'video-play'
                            ? [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }]
                            : [{ name: '动图', extensions: ['gif', 'apng', 'webp'] }],
                          properties: ['openFile']
                        })
                        // 只换文件、保留播放秒数和播到哪里：品游导入的一次性视频带着秒数，换个文件不该变成无限循环
                        if (res.ok && res.path) set({ commandParam: joinVideoParam(res.path, splitVideoParam(form.commandParam).seconds, splitVideoParam(form.commandParam).target, splitVideoParam(form.commandParam).overflow !== false) })
                      }}
                    >
                      选择
                    </Btn>
                  </div>
                </Field>
                <Field label="播放秒数" hint="默认整段播完结束；填秒数可限制时长。独立视频窗口留空时才循环">
                  <Input
                    value={splitVideoParam(form.commandParam).seconds ?? ''}
                    placeholder="如：3 或 0.9"
                    onChange={(e) => set({ commandParam: joinVideoParam(splitVideoParam(form.commandParam).path, e.target.value, splitVideoParam(form.commandParam).target, splitVideoParam(form.commandParam).overflow !== false) })}
                  />
                </Field>
                <Field label="指定播放窗口" hint="不选就播到设置里的默认播放窗口">
                  <VideoTargetSelect value={form.commandParam ?? ''} onChange={(v) => set({ commandParam: v })} videoMode />
                </Field>
              </>
            ) : (
              <Field
                label={form.commandCmd === 'send-text' || form.commandCmd === 'paste-text' ? '文本内容' : '命令参数'}
                hint={COMMAND_OPTIONS.find((c) => c.value === form.commandCmd)?.hint}
              >
                <Input
                  value={form.commandParam ?? ''}
                  onChange={(e) => set({ commandParam: e.target.value })}
                  placeholder={form.commandCmd === 'run-file' ? 'C:\\path\\app.exe' : form.commandCmd === 'kill' ? 'notepad.exe' : '30'}
                />
              </Field>
            )}
            {['project-random', 'video-play', 'video-play-wait', 'video-random', 'video-gif'].includes(form.commandCmd || '') ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-2 py-1.5">
                <span className="min-w-0 text-xs leading-5 text-[var(--text-3)]">绿幕抠图（视频自带绿背景时扣成透明，参数在设置页）</span>
                <Toggle label="绿幕抠图" value={form.chroma === true} onChange={(on) => set({ chroma: on })} />
              </div>
            ) : null}
            <p className="text-[11px] leading-4 text-[var(--text-4)]">
              对应参考软件「动作命令」子执行器：倒计时加减/清零（联动时间插件挂件）、发送/粘贴文本、运行文件、结束进程、鼠标操作。参数支持 -1000,1000 范围内随机。
            </p>
          </>
        )}
    </>
  )
}

// 「播到哪里」下拉：默认窗口（跟随设置页的默认播放窗口）/ 绿幕 1~4 / 视频窗口。
// videoMode = 参数带「路径|秒数」语义（video-play/video-gif），否则参数直接挂后缀（目录/项目）。
function VideoTargetSelect({ value, onChange, videoMode }: { value: string; onChange: (v: string) => void; videoMode?: boolean }): React.JSX.Element {
  // 指定的窗口是最优先窗口；「本窗口忙时去别的窗口」默认开，关了就只在自己那个窗口排队（后缀写成 绿幕N固定 / 固定）
  const parsed = videoMode
    ? (() => { const v = splitVideoParam(value); const t = v.target; return { target: t === '视频' ? 'v' : (/^绿幕([1-4])$/.exec(t || '')?.[1] ?? '0'), overflow: v.overflow !== false } })()
    : (() => { const v = splitTargetSuffix(value); return { target: v.target, overflow: v.overflow } })()
  const apply = (t: string, overflow: boolean): void => {
    if (videoMode) {
      const v = splitVideoParam(value)
      onChange(joinVideoParam(v.path, v.seconds, t === 'v' ? '视频' : t === '0' ? undefined : `绿幕${t}`, overflow))
    } else {
      onChange(joinTargetSuffix(splitTargetSuffix(value).rest, t as Parameters<typeof joinTargetSuffix>[1], overflow))
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select aria-label="指定播放窗口" value={parsed.target} onChange={(e) => apply(e.target.value, parsed.overflow)} className="min-w-[170px]">
        <option value="0">默认窗口（跟随设置）</option>
        <option value="1">绿幕 1</option>
        <option value="2">绿幕 2</option>
        <option value="3">绿幕 3</option>
        <option value="4">绿幕 4</option>
        <option value="v">视频窗口</option>
      </Select>
      {parsed.target !== 'v' ? (
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]" title="关掉就只在上面那个窗口排队等">
          <Toggle value={parsed.overflow} onChange={(on) => apply(parsed.target, on)} />本窗口忙时去别的窗口
        </label>
      ) : null}
    </div>
  )
}

// 「触发项目（文件夹）」的参数编辑器。
// 参数格式：<目录>[|绿幕N] / <目录>|视频 —— 和品游脚本里「播放视频:哈喽体力转盘\随机播放[绿幕2]」同一套语义；
// 不写后缀 = 默认窗口（跟随设置页的默认播放窗口，忙了按排队开关等它或分流）。
// 不让主播手打路径：素材目录里扫到的项目直接列出来，每项写清有几个视频、几个带动作。
// 读取项目后给里面每条视频单独配动作（用户 2026-09-11：「读取项目以后应该也可以设置里面视频的动作」）：
// 品游脚本里的动作照跑（可关），整蛊台里再加的按顺序执行；存在客户端，不往素材文件夹写东西
function ProjectItemActions({ value, obs }: { value: string; obs: ObsPanelState | null }): React.JSX.Element | null {
  const dir = splitTargetSuffix(value).rest
  const [data, setData] = useState<{ items: PinyouProjectItem[]; actions: Record<string, PinyouItemActions> } | null>(null)
  const [editing, setEditing] = useState<PinyouProjectItem | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    if (!dir) { setData(null); return }
    const r = await window.api.pinyouItemActionsGet(dir)
    setData(r.ok ? { items: r.items, actions: r.actions } : null)
  }, [dir])
  useEffect(() => { void load() }, [load])
  if (!dir || !data || !data.items.length) return null
  const configured = Object.values(data.actions).filter((a) => (a.actions?.length ?? 0) > 0 || a.useScript === false).length
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2" data-testid="project-items">
      <button type="button" className="flex w-full items-center justify-between text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-semibold text-[var(--text)]">项目里的视频 {data.items.length} 条{configured ? `，${configured} 条配了动作` : ''}</span>
        <span className="text-[var(--text-4)]">{open ? '收起' : '展开，给单条视频配动作'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <div className="rounded bg-[var(--bg-input)] px-2 py-1 text-[11px] leading-relaxed text-[var(--text-4)]">
            品游脚本里的「再来一次」会接着在上一条视频的那个窗口播，脚本里写的绿幕几号不算数，以上面选的播放窗口为准。
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
          {data.items.map((it) => {
            const cfg = data.actions[it.name]
            const n = cfg?.actions?.length ?? 0
            return (
              <div key={it.name} className="flex items-center justify-between gap-2 rounded border border-[var(--line)] px-2 py-1 text-xs" data-testid={`project-item-${it.name}`}>
                <div className="min-w-0">
                  <div className="truncate text-[var(--text)]"><EmojiText text={it.name} /></div>
                  <div className="truncate text-[11px] text-[var(--text-4)]">
                    {it.hasScript ? (cfg?.useScript === false ? '品游脚本已关' : `品游脚本：${it.script.join('；') || '（空）'}`) : '没有脚本'}
                    {n ? `　整蛊台动作 ${n} 个` : ''}
                  </div>
                </div>
                <Btn size="sm" variant="secondary" onClick={() => setEditing(it)} aria-label={`配动作 ${it.name}`}>
                  {n || cfg?.useScript === false ? '改动作' : '配动作'}
                </Btn>
              </div>
            )
          })}
          </div>
        </div>
      )}
      {editing && (
        <ItemActionsModal dir={dir} item={editing} initial={data.actions[editing.name]} obs={obs} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </div>
  )
}

function ItemActionsModal({ dir, item, initial, obs, onClose, onSaved }: {
  dir: string
  item: PinyouProjectItem
  initial?: PinyouItemActions
  obs: ObsPanelState | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [useScript, setUseScript] = useState(initial?.useScript !== false)
  const [list, setList] = useState<EntertainmentAction[]>(initial?.actions ?? [])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const setAt = (i: number, patch: Partial<EntertainmentAction>) => setList((p) => { const next = [...p]; next[i] = { ...next[i], ...patch }; return next })
  const move = (i: number, d: -1 | 1) => setList((p) => { const j = i + d; if (j < 0 || j >= p.length) return p; const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next })
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const nothing = useScript && !list.length
      const r = await window.api.pinyouItemActionsSet(dir, item.name, nothing ? null : { actions: list, useScript })
      if (!r.ok) { setErr(r.error || '保存失败'); return }
      onSaved()
    } finally { setSaving(false) }
  }
  return (
    <Modal
      open
      closeOnBackdrop={false}
      onClose={onClose}
      title={`「${item.name}」的动作`}
      width={520}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>取消</Btn>
          <Btn onClick={() => void save()} disabled={saving}>保存</Btn>
        </>
      }
    >
      <div className="space-y-3">
        {item.hasScript && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            <Toggle value={useScript} onChange={setUseScript} />
            视频旁边的品游脚本照跑{item.script.length ? `（${item.script.join('；')}）` : ''}
          </label>
        )}
        <p className="text-[11px] leading-4 text-[var(--text-4)]">
          抽到这条视频时先播视频，{item.hasScript ? '再跑品游脚本（开着的话），' : ''}然后按顺序执行下面的动作；「先等几秒」填 0 就是紧跟上一个。要「再抽一次」就加一个「触发项目」动作指回这个项目。
        </p>
        {list.map((a, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3" data-testid={`item-action-${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text)]">动作 {i + 1}</span>
              <div className="flex items-center gap-1">
                <label className="mr-1 flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
                  先等 <SecondsInput ms={a.delayMs} onChange={(ms) => setAt(i, { delayMs: ms })} title="上一个动作开始后先等几秒再执行这个；0 = 紧跟着" /> 秒
                </label>
                <Btn size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="上移"><ChevronUp size={14} /></Btn>
                <Btn size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === list.length - 1} title="下移"><ChevronDown size={14} /></Btn>
                <Btn size="sm" variant="ghost" onClick={() => setList((p) => p.filter((_, j) => j !== i))} title="删除这个动作"><Trash2 size={14} /></Btn>
              </div>
            </div>
            <ActionEditor value={a} onChange={(patch) => setAt(i, patch)} obs={obs} idp={`item-a${i}`} />
          </div>
        ))}
        <Btn variant="secondary" size="sm" onClick={() => setList((p) => [...p, { actionType: 'key', keySeq: '', delayMs: 0 }])} title="给这条视频再加一个动作">
          <Plus size={14} /> 添加动作
        </Btn>
        {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
      </div>
    </Modal>
  )
}

function ProjectPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [projects, setProjects] = useState<PinyouProjectInfo[]>([])
  const [root, setRoot] = useState('')
  const [err, setErr] = useState('')
  const [testing, setTesting] = useState(false)
  const [tip, setTip] = useState('')

  const dir = splitTargetSuffix(value).rest
  const setDir = (d: string): void => onChange(joinTargetSuffix(d, splitTargetSuffix(value).target, splitTargetSuffix(value).overflow))
  const setTarget = (t: string): void => onChange(joinTargetSuffix(dir, t as Parameters<typeof joinTargetSuffix>[1], splitTargetSuffix(value).overflow))

  const load = useCallback(async () => {
    const r = await window.api.pinyouProjects()
    setProjects(r.projects || [])
    setRoot(r.root || '')
    setErr(r.error || '')
  }, [])
  useEffect(() => { void load() }, [load])

  const current = projects.find((p) => p.dir === dir)
  return (
    <>
      <Field
        label="项目（文件夹）"
        hint={
          err
            ? '还没设置素材目录，点「换素材目录」选一次；也可以直接用「浏览」选任意文件夹'
            : `素材目录：${root || '未设置'}　扫到 ${projects.length} 个项目`
        }
      >
        <div className="flex flex-wrap gap-2">
          <Select
            value={projects.some((p) => p.dir === dir) ? dir : ''}
            onChange={(e) => { if (e.target.value) setDir(e.target.value) }}
            className="min-w-[220px] flex-1"
          >
            <option value="">{projects.length ? '选一个项目…' : '素材目录里没有项目'}</option>
            {projects.map((p) => (
              <option key={p.dir} value={p.dir}>
                {p.name}（{p.videos} 个视频{p.paired ? ` · ${p.paired} 个带动作` : ''}）
              </option>
            ))}
          </Select>
          <Btn
            variant="secondary"
            onClick={async () => {
              const res = await window.api.selectFile({ title: '选择项目文件夹', properties: ['openDirectory'] })
              if (res.ok && res.path) setDir(res.path)
            }}
          >
            浏览
          </Btn>
          <Btn
            variant="secondary"
            onClick={async () => {
              const r = await window.api.pinyouAssetRootPick()
              if (r.ok) { setProjects(r.projects || []); setRoot(r.root || ''); setErr('') }
            }}
          >
            换素材目录
          </Btn>
        </div>
      </Field>
      <Field label="目录" hint="也可以直接填写/粘贴路径">
        <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="项目文件夹路径" />
      </Field>
      <Field label="指定播放窗口" hint="不选就播到设置里的默认播放窗口">
        <div className="flex flex-wrap items-center gap-2">
          <VideoTargetSelect value={value} onChange={onChange} />
          <Btn
            variant="secondary"
            disabled={!dir || testing}
            onClick={async () => {
              setTesting(true)
              setTip('')
              const r = await window.api.entertainmentCommand('project-random', value)
              setTesting(false)
              setTip(r.ok ? '触发成功（随机抽了一条）' : r.error || '触发失败')
            }}
          >
            {testing ? '触发中…' : '试触发'}
          </Btn>
          {tip ? <span className="text-xs text-[var(--text-3)]">{tip}</span> : null}
          {current && !current.paired ? (
            <span className="text-xs text-[var(--text-4)]">这个项目只有视频，没有附带动作</span>
          ) : null}
        </div>
      </Field>
    </>
  )
}

// 批量导入品游「项目」：一个文件夹一个项目，勾选后各建一条规则。
function ProjectImportModal({
  open,
  onClose,
  onDone,
  onImportFolder
}: {
  open: boolean
  onClose: () => void
  onDone: (msg: string) => void
  onImportFolder: () => void
}): React.JSX.Element {
  const [projects, setProjects] = useState<PinyouProjectInfo[]>([])
  const [root, setRoot] = useState('')
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [slot, setSlot] = useState(0)
  const [busy, setBusy] = useState(false)
  // 导入方式：items=每个视频一条规则（一个视频一条规则，各绑不同礼物）；
  //          time=时间类项目并进时间挂件的盲盒奖池；folder=整个文件夹一条「随机抽一条」的规则
  const [mode, setMode] = useState<'items' | 'time' | 'folder'>('items')

  const load = useCallback(async () => {
    const r = await window.api.pinyouProjects()
    setProjects(r.projects || [])
    setRoot(r.root || '')
    setErr(r.error || '')
    // 默认全勾上：主播的素材库就是拿来用的，逐个点太累
    setPicked(Object.fromEntries((r.projects || []).map((p) => [p.dir, true])))
  }, [])
  useEffect(() => { if (open) void load() }, [open, load])

  const chosen = projects.filter((p) => picked[p.dir])
  const totalVideos = chosen.reduce((n, p) => n + p.videos, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入项目"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-4)]">
            选中 {chosen.length} 个项目、{totalVideos} 个视频
          </span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>取消</Btn>
            <Btn
              disabled={!chosen.length || busy}
              onClick={async () => {
                setBusy(true)
                const dirs = chosen.map((p) => p.dir)
                let msg = ''
                if (mode === 'items') {
                  const r = await window.api.pinyouItemsImport(dirs, slot || undefined)
                  msg = r.added
                    ? `已导入 ${r.added} 条规则（来自 ${r.projects.length} 个项目）。规则名先用视频名、默认停用——把礼物名改成真实礼物名后再启用`
                    : `没有导入成功${r.skipped.length ? '：' + r.skipped[0] : ''}`
                } else if (mode === 'time') {
                  const r = await window.api.pinyouTimeImport(dirs)
                  const add = r.report.reduce((n, x) => n + x.added, 0)
                  const skip = r.report.reduce((n, x) => n + x.skipped, 0)
                  if (!add) {
                    const why = r.report.flatMap((x) => x.why)[0]
                    msg = `这些项目里没有时间加减动作${why ? `（${why}）` : ''}，换「每个视频一条规则」试试`
                  } else {
                    // ★倒计时配置的权威是这一份 localStorage：页面从它读，改完再推给主进程。
                    //   所以导入必须写它 —— 只在主进程改内存的话，页面里事件库还是 0。
                    const total = mergeTimeBlindBoxEvents(r.events)
                    msg = `已加入时间盲盒 ${add} 个事件（事件库共 ${total} 个${skip ? `，${skip} 条不是时间动作已跳过` : ''}）。到「倒计时」页把事件绑到礼物上`
                  }
                } else {
                  const r = await window.api.pinyouProjectsImport(dirs, slot || undefined)
                  msg = r.added.length
                    ? `已导入 ${r.added.length} 个项目（每个项目一条「随机抽一条」的规则）。默认停用，改好礼物名再启用`
                    : `没有导入成功${r.skipped.length ? '：' + r.skipped[0] : ''}`
                }
                setBusy(false)
                onClose()
                onDone(msg)
              }}
            >
              {busy ? '导入中…' : mode === 'items' ? `导入 ${totalVideos} 条规则` : mode === 'time' ? `加入时间盲盒` : `导入 ${chosen.length} 个项目`}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
          <span>素材目录：{root || '未设置'}</span>
          <Btn variant="secondary" size="sm" onClick={onImportFolder} title="选一个文件夹导入（别人发来的项目文件夹，或任意装着视频的文件夹）">
            选文件夹导入
          </Btn>
          <Btn
            variant="secondary"
            size="sm"
            onClick={async () => {
              const r = await window.api.pinyouAssetRootPick()
              if (r.ok) {
                setProjects(r.projects || [])
                setRoot(r.root || '')
                setErr('')
                setPicked(Object.fromEntries((r.projects || []).map((p) => [p.dir, true])))
              }
            }}
          >
            换目录
          </Btn>
        </div>
        <Field
          label="导入方式"
          hint={
            mode === 'items'
              ? '项目里每个视频各建一条规则，规则名就是视频名（「-10分」这种），礼物名留给你填'
              : mode === 'time'
                ? '时间加减类的项目（虚拟主播时间 / 翻牌子时间 / 加减播…）并进「倒计时」页的盲盒奖池：每个视频一个事件，带自己的加减值'
                : '整个项目只建一条规则，触发时从文件夹里随机抽一条播——盲盒玩法'
          }
        >
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'items' | 'time' | 'folder')}
            options={[
              { value: 'items', label: '每个视频一条规则' },
              { value: 'time', label: '并进时间盲盒' },
              { value: 'folder', label: '整个文件夹随机' }
            ]}
          />
        </Field>
        <Field label="指定播放窗口" hint="不选就播到设置里的默认播放窗口">
          <Select value={String(slot)} onChange={(e) => setSlot(Number(e.target.value))} className="min-w-[160px]">
            <option value="0">默认窗口（跟随设置）</option>
            <option value="1">绿幕 1</option>
            <option value="2">绿幕 2</option>
            <option value="3">绿幕 3</option>
            <option value="4">绿幕 4</option>
          </Select>
        </Field>
        {err ? (
          <p className="text-sm text-[var(--warn)]">{err}</p>
        ) : !projects.length ? (
          <p className="text-sm text-[var(--text-3)]">这个目录里没有含视频的文件夹。</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={() => setPicked(Object.fromEntries(projects.map((p) => [p.dir, true])))}>全选</Btn>
              <Btn variant="secondary" size="sm" onClick={() => setPicked({})}>全不选</Btn>
              <Btn
                variant="secondary"
                size="sm"
                onClick={() => setPicked(Object.fromEntries(projects.filter((p) => p.paired > 0).map((p) => [p.dir, true])))}
                title="只要那些视频旁边带 .脚本 的项目（触发时会执行加班加减这类动作）"
              >
                只选带动作的
              </Btn>
            </div>
            <div className="max-h-[46vh] space-y-1 overflow-y-auto">
              {projects.map((p) => (
                <label
                  key={p.dir}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-2)]"
                >
                  <input
                    type="checkbox"
                    checked={!!picked[p.dir]}
                    onChange={(e) => setPicked((prev) => ({ ...prev, [p.dir]: e.target.checked }))}
                  />
                  <span className="flex-1 truncate text-[var(--text)]">{p.name}</span>
                  <span className="tnum text-xs text-[var(--text-3)]">{p.videos} 个视频</span>
                  {p.paired ? (
                    <Pill tone="ok">{p.paired} 个带动作</Pill>
                  ) : (
                    <Pill tone="muted">纯视频</Pill>
                  )}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// 把导入的盲盒事件并进倒计时页的配置。
// ★倒计时配置存在渲染进程的 localStorage('ent_time_cfg')：页面从那里读、改完再
//   window.api.timeWidgetUpdate 推给主进程。所以这里两步都做，和倒计时页自己保存时同一条路。
//   （2026-09-07：一开始只在主进程改内存，页面读不到，用户看到「盲盒事件库 0」。）
function mergeTimeBlindBoxEvents(incoming: TimeBlindBoxEvent[]): number {
  const KEY = 'ent_time_cfg'
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
  } catch {
    cfg = {}
  }
  const old = Array.isArray(cfg.blindBoxEvents) ? (cfg.blindBoxEvents as TimeBlindBoxEvent[]) : []
  const merged = mergeImportedBlindBoxEvents(old, incoming)
  cfg.blindBoxEvents = merged
  // 事件库有内容时顺手把倒计时打开，否则盲盒不会触发（timeWidgetOpenBox 要求 enable）
  if (merged.length && cfg.enable !== true) cfg.enable = true
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  } catch {
    /* localStorage 满了也别让导入整个失败 */
  }
  void window.api.timeWidgetUpdate(cfg as never).catch(() => {})
  return merged.length
}

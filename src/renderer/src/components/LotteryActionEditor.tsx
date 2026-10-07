import type { LotteryAction, LotteryExtraAction, LotteryItem } from '@shared/types'
import { COMMAND_LABELS } from '@shared/entertainmentLabels'
import { Btn, Field, Input, Select, Toggle } from './ui'
import { prankGroups, usePrankCatalog } from '../lib/pranks'
import { useVisiblePrankGames } from './GamePrankSelect'
import SpecialActionFields from './SpecialActionFields'
import SpecialBoxPool, { defaultSpecialBoxParam } from './special/SpecialBoxPool'
import { specialDefaultParam } from '@shared/specialGames'

// 奖项动作的选项。'command' 是万能出口：把礼物规则那 30 多个动作命令整套接过来
// （加班加减 / 计数 / 锁键盘 / 触发项目（文件夹）/ 随机视频…），
// 转盘、九宫格、时间盲盒共用这一份，不必各自补一遍。
const ACTION_OPTIONS: { value: LotteryAction; label: string }[] = [
  { value: 'none', label: '仅显示结果' },
  { value: 'prank', label: '游戏整蛊' },
  { value: 'effect', label: '礼物动画' },
  { value: 'stage-video', label: '在转盘窗口里播视频（推荐：不用另外采集）' },
  { value: 'green-video', label: '播放绿幕视频（单独的绿幕窗口）' },
  { value: 'video', label: '播放视频（单独的视频窗口）' },
  { value: 'countdown-adjust', label: '倒计时加减' },
  { value: 'countdown-clear', label: '倒计时清零' },
  { value: 'wheel-spin', label: '触发转盘' },
  { value: 'nine-spin', label: '触发九宫格' },
  { value: 'command', label: '动作命令（特色整蛊/加班/计数/锁键盘/触发项目…）' }
]

// 动作命令里对奖项没意义的几个（要么是给规则编辑器用的，要么会自己套自己）
// game-prank：奖项自己有「游戏整蛊」选项，不在命令里重复
const COMMAND_SKIP = new Set(['script-sequence', 'wheel-spin', 'nine-spin', 'game-prank'])

// 参数是「文件夹」的动作命令：给一个能直接粘路径的输入框 + 选文件夹 + 打开文件夹，
// 免得主播只能凭记忆手打路径（0.3.42 用户反馈：指定项目后没法确认路径对不对）。
const FOLDER_COMMANDS = new Set(['project-random', 'video-random', 'sound-random', 'random-script'])

// 会播视频的动作命令：这些动作后面挂一个「绿幕抠图」开关
const VIDEO_COMMANDS = new Set(['project-random', 'video-play', 'video-play-wait', 'video-random', 'video-gif'])

/** 一个动作的字段编辑（主动作和附加动作共用） */
function ActionFields({
  action,
  actionParam,
  actionSeconds,
  chroma,
  name,
  onChange
}: {
  action: LotteryAction
  actionParam?: string
  actionSeconds?: number
  chroma?: boolean
  name: string
  onChange: (patch: { actionParam?: string; actionSeconds?: number; chroma?: boolean }) => void
}): React.JSX.Element | null {
  usePrankCatalog() // 整蛊下拉来自定义包，刷新时重渲染
  // 游戏整蛊下拉只列能用的游戏（mod 下架且没装的不列），已经选着的那款照常列出
  const prankGames = useVisiblePrankGames(action === 'prank' ? String(actionParam || '').split('|')[0] : '')
  const video = action === 'video' || action === 'green-video' || action === 'stage-video'
  // 'command' 的参数是「<命令>|<参数>」，只按第一个 | 切
  const cut = String(actionParam || '').indexOf('|')
  const cmd = cut < 0 ? String(actionParam || '') : String(actionParam || '').slice(0, cut)
  const cmdParam = cut < 0 ? '' : String(actionParam || '').slice(cut + 1)
  const canChroma = video || (action === 'command' && VIDEO_COMMANDS.has(cmd))
  const chromaToggle = canChroma ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-2 py-1.5">
      <span className="min-w-0 text-xs leading-5 text-[var(--text-3)]">绿幕抠图（视频自带绿背景时扣成透明，参数在设置页）</span>
      <Toggle label={`${name} 绿幕抠图`} value={chroma === true} onChange={(on) => onChange({ chroma: on })} />
    </div>
  ) : null

  if (action === 'effect') {
    return (
      <Select aria-label={`${name} 礼物动画`} value={actionParam || ''} onChange={(e) => onChange({ actionParam: e.target.value })}>
        <option value="">选择动画</option>
        <option value="parabola">抛物线</option>
        <option value="bomb">炸弹</option>
        <option value="car">跑车</option>
        <option value="firework">烟花</option>
        <option value="rain">礼物雨</option>
      </Select>
    )
  }
  if (action === 'prank') {
    return (
      <Select aria-label={`${name} 游戏整蛊`} value={actionParam || ''} onChange={(e) => onChange({ actionParam: e.target.value })}>
        <option value="">选择事件</option>
        {prankGames.map(([game, label]) => (
          <optgroup key={game} label={label}>
            {prankGroups(game)
              .flatMap((g) => g.items)
              .filter((p) => !p.danger)
              .map((p) => (
                <option key={p.id} value={`${game}|${p.id}`}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    )
  }
  if (video) {
    return (
      <>
        <div className="flex gap-2">
          <Input
            aria-label={`${name} 视频路径`}
            value={actionParam || ''}
            placeholder="选择视频"
            onChange={(e) => onChange({ actionParam: e.target.value })}
          />
          <Btn
            size="sm"
            variant="secondary"
            onClick={async () => {
              const r = await window.api.selectFile({
                title: '选择中奖视频',
                filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] }],
                properties: ['openFile']
              })
              if (r.ok && r.path) onChange({ actionParam: r.path })
            }}
          >
            选择
          </Btn>
        </div>
        <Field label="播放秒数" hint="0 表示播完关闭">
          <Input
            type="number"
            min={0}
            step={0.1}
            value={actionSeconds || 0}
            onChange={(e) => onChange({ actionSeconds: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
        {chromaToggle}
      </>
    )
  }
  if (action === 'countdown-adjust') {
    return (
      <Input
        aria-label={`${name} 倒计时秒数`}
        inputMode="numeric"
        step={1}
        placeholder="整秒或整数范围，例如 -30、10~60"
        value={actionParam || ''}
        onChange={(e) => onChange({ actionParam: e.target.value })}
      />
    )
  }
  if (action === 'command') {
    const folder = FOLDER_COMMANDS.has(cmd)
    const pickFolder = async (): Promise<void> => {
      const r = await window.api.selectFile({ title: '选择项目文件夹', properties: ['openDirectory'] })
      if (r.ok && r.path) onChange({ actionParam: `${cmd}|${r.path}` })
    }
    return (
      <div className="space-y-2">
        <Select
          aria-label={`${name} 动作命令`}
          value={cmd}
          onChange={(e) => {
            const next = e.target.value
            // 特色整蛊的参数自成一套（玩法|操作|数量|选项），和别的命令互换时不沿用旧参数
            if (next === 'special-play') onChange({ actionParam: `special-play|${specialDefaultParam('chain_challenge')}` })
            else if (next === 'special-box') void window.api.specialBoxEvents().then((list) => onChange({ actionParam: `special-box|${defaultSpecialBoxParam(list)}` }))
            else if (cmd === 'special-play' || cmd === 'special-box') onChange({ actionParam: next })
            else onChange({ actionParam: cmdParam ? `${next}|${cmdParam}` : next })
          }}
        >
          <option value="">选择命令…</option>
          {Object.entries(COMMAND_LABELS)
            .filter(([k]) => !COMMAND_SKIP.has(k))
            .map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
        </Select>
        {cmd === 'special-play' ? (
          <SpecialActionFields value={cmdParam} onChange={(v) => onChange({ actionParam: `special-play|${v}` })} idp={`lottery-${name}`} />
        ) : cmd === 'special-box' ? (
          <SpecialBoxPool value={cmdParam} onChange={(v) => onChange({ actionParam: `special-box|${v}` })} compact idp={`lottery-${name}-box`} />
        ) : folder ? (
          <>
            <div className="flex gap-2">
              <Input
                aria-label={`${name} 命令参数`}
                value={cmdParam}
                placeholder="项目文件夹路径（可以直接粘贴）"
                className="min-w-0 flex-1"
                onChange={(e) => onChange({ actionParam: e.target.value ? `${cmd}|${e.target.value}` : cmd })}
              />
              <Btn size="sm" variant="secondary" onClick={() => void pickFolder()}>选择文件夹</Btn>
              <Btn
                size="sm"
                variant="secondary"
                disabled={!cmdParam}
                title={cmdParam ? '在资源管理器里打开' : '先选或粘贴一个文件夹'}
                onClick={() => { void window.api.openPath(cmdParam) }}
              >
                打开文件夹
              </Btn>
            </div>
            <p className="text-xs leading-5 text-[var(--text-4)]">
              选文件夹时里面要有视频（项目方式会随机挑一条播）；路径可以直接从资源管理器地址栏复制粘贴。
            </p>
            {chromaToggle}
          </>
        ) : (
          <Input
            aria-label={`${name} 命令参数`}
            value={cmdParam}
            placeholder="参数：加减填秒数/数值，锁键盘填 W,A,S,D|5000；不需要参数就留空"
            onChange={(e) => onChange({ actionParam: e.target.value ? `${cmd}|${e.target.value}` : cmd })}
          />
        )}
      </div>
    )
  }
  return null
}

export default function LotteryActionEditor({
  item,
  onChange
}: {
  item: LotteryItem
  onChange: (patch: Partial<LotteryItem>) => void
}): React.JSX.Element {
  const action = item.action || 'none'
  const extras = item.actions || []
  const pickVoice = async (): Promise<void> => {
    const r = await window.api.selectFile({
      title: '选择中奖语音',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }],
      properties: ['openFile']
    })
    if (r.ok && r.path) onChange({ voice: r.path })
  }
  const patchExtra = (i: number, patch: Partial<LotteryExtraAction>): void => {
    const next = extras.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    onChange({ actions: next })
  }

  return (
    <div className="space-y-2">
      <Field label="中奖语音（可选）" hint="抽中先播这段（「恭喜抽中…」），在转盘窗口里出声">
        <div className="flex gap-2">
          <Input aria-label="中奖语音" value={item.voice || ''} placeholder="没选就不播语音"
            onChange={(e) => onChange({ voice: e.target.value })} />
          <Btn size="sm" variant="secondary" onClick={() => void pickVoice()}>选择</Btn>
          {item.voice ? <Btn size="sm" variant="ghost" onClick={() => onChange({ voice: '' })}>×</Btn> : null}
        </div>
      </Field>
      {item.voice ? (
        <label className="flex items-center gap-2 text-xs text-[var(--text-3)]">
          <input type="checkbox" checked={item.voiceWait !== false}
            onChange={(e) => onChange({ voiceWait: e.target.checked })} />
          语音播完再执行下面的动作
        </label>
      ) : null}
      <Select
        aria-label="中奖动作"
        value={action}
        onChange={(e) => onChange({ action: e.target.value as LotteryAction, actionParam: '' })}
      >
        {ACTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <ActionFields
        action={action}
        actionParam={item.actionParam}
        actionSeconds={item.actionSeconds}
        chroma={item.chroma}
        name="动作 1"
        onChange={(patch) => onChange(patch)}
      />

      {/* 附加动作：一个奖项可以「播视频 + 加班 +30 秒 + 锁键盘」，按顺序执行 */}
      {extras.map((extra, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-[var(--line)] p-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-[var(--text-3)]">动作 {i + 2}</span>
            <Select
              aria-label={`动作 ${i + 2}`}
              value={extra.action}
              onChange={(e) => patchExtra(i, { action: e.target.value as LotteryAction, actionParam: '' })}
              className="flex-1"
            >
              {ACTION_OPTIONS.filter((o) => o.value !== 'none').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Btn
              size="sm"
              variant="secondary"
              aria-label={`删除动作 ${i + 2}`}
              onClick={() => onChange({ actions: extras.filter((_, idx) => idx !== i) })}
            >
              删除
            </Btn>
          </div>
          <Field label="先等几秒" hint="0 = 紧跟上一个动作">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={(extra.delayMs || 0) / 1000}
              onChange={(e) => patchExtra(i, { delayMs: Math.max(0, Math.round((Number(e.target.value) || 0) * 1000)) })}
            />
          </Field>
          <ActionFields
            action={extra.action}
            actionParam={extra.actionParam}
            actionSeconds={extra.actionSeconds}
            chroma={extra.chroma}
            name={`动作 ${i + 2}`}
            onChange={(patch) => patchExtra(i, patch)}
          />
        </div>
      ))}

      <Btn
        size="sm"
        variant="secondary"
        onClick={() => onChange({ actions: [...extras, { action: 'command', actionParam: '', delayMs: 0 }] })}
      >
        + 添加动作
      </Btn>
    </div>
  )
}

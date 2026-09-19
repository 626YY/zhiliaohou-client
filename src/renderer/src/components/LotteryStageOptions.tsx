import AdvancedSection from './AdvancedSection'
// 抽奖挂件的「上播表现」：外圈跑马灯、声音、空闲时露不露面。转盘和九宫格共用一套。
import { Volume2 } from 'lucide-react'
import type { LotteryBulbMode, LotterySound } from '@shared/types'
import { Btn, Field, Input, Select, Toggle } from './ui'

export type StageOptions = {
  bulbs: LotteryBulbMode
  sound: LotterySound
  idleHide: boolean
  holdSeconds: number
  // 抽中的视频铺在抽奖窗口里放（默认开）：直播伴侣只要采这一个来源，视频也不会挡住转盘
  stageVideo?: boolean
}

export const DEFAULT_STAGE_OPTIONS: StageOptions = {
  bulbs: 'chase',
  sound: { mode: 'preset', spin: '', win: '', volume: 70 },
  idleHide: true,
  holdSeconds: 6,
  stageVideo: true
}

/** 存档里缺项的按默认值补齐，老配置升上来不会变成空白。 */
export function normalizeStageOptions(value: Partial<StageOptions> | undefined): StageOptions {
  const sound = value?.sound
  const volume = Number(sound?.volume)
  return {
    bulbs: value?.bulbs === 'blink' || value?.bulbs === 'off' ? value.bulbs : 'chase',
    sound: {
      mode: sound?.mode === 'off' || sound?.mode === 'custom' || sound?.mode === 'chime' ? sound.mode : 'preset',
      spin: String(sound?.spin ?? ''),
      win: String(sound?.win ?? ''),
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 70
    },
    idleHide: value?.idleHide !== false,
    holdSeconds: Number.isFinite(Number(value?.holdSeconds)) ? Math.max(0, Math.min(120, Number(value?.holdSeconds))) : 6,
    stageVideo: value?.stageVideo !== false
  }
}

export default function LotteryStageOptions({ value, onChange, showBulbs = true }: {
  value: StageOptions
  onChange: (patch: Partial<StageOptions>) => void
  showBulbs?: boolean
}) {
  const pickAudio = async (apply: (path: string) => void) => {
    const res = await window.api.selectFile({
      title: '选择音效',
      filters: [{ name: '音效', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }],
      properties: ['openFile']
    })
    if (res.ok && res.path) apply(res.path)
  }
  const setSound = (patch: Partial<LotterySound>) => onChange({ sound: { ...value.sound, ...patch } })
  const audioRow = (label: string, path: string, apply: (next: string) => void) => (
    <Field label={label}>
      <div className="flex gap-2">
        <Input value={path} readOnly placeholder="没选就用内置的" className="flex-1" />
        <Btn variant="secondary" onClick={() => void pickAudio(apply)} title={`选择${label}`}><Volume2 size={14} /></Btn>
        {path ? <Btn variant="ghost" onClick={() => apply('')} title={`清除${label}`}>×</Btn> : null}
      </div>
    </Field>
  )

  return (
    <AdvancedSection title="声音与上屏表现">
    <div className="space-y-3">
      {showBulbs ? (
        <Field label="外圈跑马灯">
          <Select value={value.bulbs} onChange={(e) => onChange({ bulbs: e.target.value as LotteryBulbMode })}>
            <option value="chase">转起来时灯跟着盘跑，抽中齐闪（推荐）</option>
            <option value="blink">一直慢闪</option>
            <option value="off">不闪</option>
          </Select>
        </Field>
      ) : null}

      <Field label="声音" hint="声音出在挂件窗口里，直播伴侣采到的就有声">
        <Select value={value.sound.mode} onChange={(e) => setSound({ mode: e.target.value as LotterySound['mode'] })}>
          <option value="preset">转盘实录：转一格「哒」一声 + 中奖声（推荐）</option>
          <option value="off">不要转动音（只用奖项自己配的语音）</option>
          <option value="chime">电子音：合成的哒哒声 + 上扬音</option>
          <option value="custom">用我自己的音效文件</option>
        </Select>
      </Field>
      {value.sound.mode === 'custom' ? (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          {audioRow('转动音效', value.sound.spin ?? '', (spin) => setSound({ spin }))}
          {audioRow('抽中音效', value.sound.win ?? '', (win) => setSound({ win }))}
          <p className="text-xs leading-5 text-[var(--text-4)]">转动音效循环播到停；没选的用内置音。</p>
        </div>
      ) : null}
      {value.sound.mode !== 'off' ? (
        <Field label="音量">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={value.sound.volume} className="flex-1"
              onChange={(e) => setSound({ volume: Number(e.target.value) })} aria-label="音量" />
            <span className="tnum w-12 text-right text-sm text-[var(--text-2)]">{value.sound.volume}%</span>
          </div>
        </Field>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">抽中的视频铺在抽奖窗口里播</div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">奖品视频在转盘/九宫格窗口里放，放完自动收回；直播伴侣只采这一个来源。</p>
        </div>
        <Toggle label="抽中的视频铺在抽奖窗口里播" value={value.stageVideo !== false} onChange={(on) => onChange({ stageVideo: on })} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">平时不出现在直播画面里</div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">平时画面是空的，礼物触发才亮出来，抽完停一会儿再收走。</p>
        </div>
        <Toggle label="平时不出现在直播画面里" value={value.idleHide} onChange={(on) => onChange({ idleHide: on })} />
      </div>
      {value.idleHide ? (
        <Field label="抽中后停留（秒）" hint="给观众看清中了什么，到点自动收走">
          <Input type="number" min={0} max={120} value={String(value.holdSeconds)}
            onChange={(e) => onChange({ holdSeconds: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} />
        </Field>
      ) : null}
    </div>
    </AdvancedSection>
  )
}

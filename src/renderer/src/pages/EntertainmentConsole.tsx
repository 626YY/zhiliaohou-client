import { useEffect, useRef, useState } from 'react'
import {
  Pause,
  Play,
  Hash,
  Plus,
  Minus,
  RotateCcw,
  Send,
  Clipboard,
  MousePointer2,
  MousePointerClick,
  Clock,
  Briefcase
} from 'lucide-react'
import { Btn, Card, Field, Input, Toggle, Segmented } from '../components/ui'
import { useToast } from '../stores/ui'

const LS_COUNTER = 'ent_console_counter'
const LS_WORK = 'ent_console_work'

export default function EntertainmentConsole() {
  const toast = useToast((s) => s.toast)

  // 暂停/恢复整蛊（护体联动）
  const [paused, setPaused] = useState(false)
  const [bridgeOk, setBridgeOk] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)

  // 计数器
  const [counter, setCounter] = useState(() => Number(localStorage.getItem(LS_COUNTER) || 0))

  // 发送/粘贴文本
  const [text, setText] = useState('')
  const [textMode, setTextMode] = useState<'send' | 'paste'>('send')
  const [enterAfter, setEnterAfter] = useState(true)

  // 鼠标模拟
  const [mx, setMx] = useState('')
  const [my, setMy] = useState('')

  // 加班器
  const [workOn, setWorkOn] = useState(() => localStorage.getItem(LS_WORK) !== '0')
  const [workMinutes, setWorkMinutes] = useState(60)

  useEffect(() => {
    let alive = true
    window.api.liveState().then((st) => {
      if (!alive) return
      setBridgeOk(st.bridgeOk)
      setGameRunning(st.running)
    })
    // 读当前 config 里的加班器状态
    window.api.readConfig().then((r) => {
      if (!alive || !r.ok) return
      if (typeof r.values.WorkClockOn === 'number') setWorkOn(r.values.WorkClockOn === 1)
      if (typeof r.values.WorkClockMinutes === 'number') setWorkMinutes(r.values.WorkClockMinutes)
    })
    return () => {
      alive = false
    }
  }, [])

  const saveCounter = (v: number) => {
    setCounter(v)
    localStorage.setItem(LS_COUNTER, String(v))
  }

  const togglePause = async () => {
    const next = !paused
    const r = await window.api.liveCmd(next ? 'protect on' : 'protect off')
    if (!r.ok) {
      toast(r.error || '暂停/恢复失败', 'error')
      return
    }
    setPaused(next)
    toast(next ? '已暂停整蛊（开启护体）' : '已恢复整蛊', 'success')
  }

  const sendTextNow = async () => {
    if (!text.trim()) {
      toast('请输入要发送的文本', 'info')
      return
    }
    const r = await window.api.entertainmentSendText(text, textMode, enterAfter)
    if (!r.ok) toast(r.error || '发送失败', 'error')
    else toast('已发送', 'success')
  }

  const mouse = async (action: 'move' | 'click-left' | 'click-right' | 'dblclick-left' | 'down-left' | 'up-left' | 'down-right' | 'up-right') => {
    let x: number | undefined
    let y: number | undefined
    if (mx.trim() !== '' && my.trim() !== '') {
      x = Number(mx)
      y = Number(my)
      if (Number.isNaN(x) || Number.isNaN(y)) {
        toast('坐标必须是数字', 'info')
        return
      }
    }
    const r = await window.api.entertainmentMouse(action, x, y)
    if (!r.ok) toast(r.error || '鼠标操作失败', 'error')
  }

  const applyWork = async (on: boolean, minutes: number) => {
    await window.api.liveSet('WorkClockOn', on ? 1 : 0)
    if (minutes > 0) await window.api.liveSet('WorkClockMinutes', minutes)
    setWorkOn(on)
    setWorkMinutes(minutes)
    localStorage.setItem(LS_WORK, on ? '1' : '0')
    toast(on ? '加班器已开启' : '加班器已关闭', 'success')
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 暂停/恢复整蛊 */}
      <Card title="暂停 / 恢复整蛊">
        <div className="flex items-center gap-3">
          <Btn
            variant={paused ? 'danger' : 'primary'}
            onClick={togglePause}
            className="flex-1"
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
            {paused ? '恢复整蛊' : '暂停整蛊'}
          </Btn>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[var(--text-4)]">
          暂停 = 向游戏内下发「护体」命令，期间的整蛊动作会被跳过；恢复即解除护体。
          {gameRunning ? (bridgeOk ? '游戏与桥接正常，命令可实时下发。' : '未找到 bridge.txt，请先安装当前游戏的整蛊 Mod。') : '游戏未在运行，命令会暂存到下次进游戏前。'}
        </p>
      </Card>

      {/* 计数器 */}
      <Card title="计数器">
        <div className="tnum text-center text-6xl font-bold text-[var(--accent-2)]">{counter}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Btn variant="secondary" onClick={() => saveCounter(counter - 1)}>
            <Minus size={14} /> -1
          </Btn>
          <Btn onClick={() => saveCounter(counter + 1)}>
            <Plus size={14} /> +1
          </Btn>
          <Btn variant="ghost" onClick={() => saveCounter(0)}>
            <RotateCcw size={14} /> 清零
          </Btn>
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-4)]">计数加减/清零，自动保存，可记录直播局数、死亡数等。</p>
      </Card>

      {/* 发送 / 粘贴文本 */}
      <Card title="发送 / 粘贴文本">
        <div className="space-y-3">
          <Field label="文本内容">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="要发送到直播间输入框的内容（支持中文/emoji）"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={textMode}
              onChange={setTextMode}
              options={[
                { value: 'send', label: '发送' },
                { value: 'paste', label: '粘贴' }
              ]}
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
              <Toggle value={enterAfter} onChange={setEnterAfter} />
              发送后回车
            </label>
          </div>
          <Btn onClick={sendTextNow} className="w-full">
            {textMode === 'send' ? <Send size={14} /> : <Clipboard size={14} />}
            {textMode === 'send' ? '发送文本' : '粘贴文本'}
          </Btn>
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            发送：纯英文/数字直接模拟键盘敲出，含中文时自动走剪贴板粘贴；粘贴：一律复制到剪贴板后 Ctrl+V。
          </p>
        </div>
      </Card>

      {/* 鼠标模拟 */}
      <Card title="鼠标模拟">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field advanced label="X 坐标(可选)">
              <Input type="number" value={mx} onChange={(e) => setMx(e.target.value)} placeholder="屏幕横坐标" />
            </Field>
            <Field advanced label="Y 坐标(可选)">
              <Input type="number" value={my} onChange={(e) => setMy(e.target.value)} placeholder="屏幕纵坐标" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" onClick={() => mouse('move')}>
              <MousePointer2 size={13} /> 移动到
            </Btn>
            <Btn size="sm" onClick={() => mouse('click-left')}>
              <MousePointerClick size={13} /> 左键单击
            </Btn>
            <Btn size="sm" onClick={() => mouse('dblclick-left')}>
              左键双击
            </Btn>
            <Btn size="sm" variant="secondary" onClick={() => mouse('click-right')}>
              右键单击
            </Btn>
            <Btn size="sm" variant="secondary" onClick={() => mouse('down-left')}>
              左键按住
            </Btn>
            <Btn size="sm" variant="secondary" onClick={() => mouse('up-left')}>
              左键弹起
            </Btn>
            <Btn size="sm" variant="secondary" onClick={() => mouse('down-right')}>
              右键按住
            </Btn>
            <Btn size="sm" variant="secondary" onClick={() => mouse('up-right')}>
              右键弹起
            </Btn>
          </div>
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            不填坐标 = 在当前光标位置执行。点击/双击动作会先把光标移到坐标再点（若填了坐标）。
          </p>
        </div>
      </Card>

      {/* 加班器面板 */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <Briefcase size={15} className="text-[var(--warn)]" /> 加班器面板
          </span>
        }
        className="lg:col-span-2"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              <Toggle value={workOn} onChange={(v) => applyWork(v, workMinutes)} />
              加班器总开关
            </label>
            <div className="w-40">
              <Field label="班表时长(分钟)">
                <Input
                  type="number"
                  value={workMinutes}
                  onChange={(e) => setWorkMinutes(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
            </div>
            <Btn variant="secondary" size="sm" onClick={() => applyWork(workOn, workMinutes)}>
              应用时长
            </Btn>
            <div className="flex gap-2">
              <Btn size="sm" variant="secondary" onClick={() => window.api.livePrank('work_time')}>
                <Clock size={13} /> 上班时间±
              </Btn>
              <Btn size="sm" variant="secondary" onClick={() => window.api.livePrank('work_zero')}>
                一键下班(清零)
              </Btn>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-[var(--text-4)]">
            加班器由游戏内 Mod 实现（WorkClock）。此处可开关总闸、设班表时长，并一键触发「上班时间± / 下班清零」。加时/减时/乘除倍率在「参数调节」的加班器分组里调。
          </p>
        </div>
      </Card>
    </div>
  )
}

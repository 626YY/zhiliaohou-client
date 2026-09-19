import AdvancedSection from '../components/AdvancedSection'
﻿import { useEffect, useState } from 'react'
import { ThumbsUp, Send, Plus, RotateCcw, Wifi, WifiOff, Gift, FlaskConical } from 'lucide-react'
import type { DanmakuForwardEvent, DanmakuForwardState } from '@shared/types'
import { Btn, Card, Field, Input, Select, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'
import { DOUYIN_GIFT_NAMES } from '../data/douyinGifts'

export default function EntertainmentTools() {
  const toast = useToast((s) => s.toast)
  // 功德点赞
  const [merit, setMerit] = useState(0)
  const [autoMerit, setAutoMerit] = useState(true)

  // 原版转发由客户端在本机监听 WebSocket，第三方软件主动接入。
  const [forward, setForward] = useState<DanmakuForwardState>({ running: false, port: 9001, clients: 0 })
  const [forwardPort, setForwardPort] = useState('9001')
  const [testComment, setTestComment] = useState('666')
  const [testGift, setTestGift] = useState('小心心')
  const [testGiftCount, setTestGiftCount] = useState(1)

  useEffect(() => {
    let alive = true
    let initial = true
    const refresh = async () => {
      const state = await window.api.danmakuForwardState()
      if (!alive) return
      setForward(state)
      if (initial) {
        setForwardPort(String(state.port))
        initial = false
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // 功德按真实数量累计：一次点赞事件带的是连点次数，礼物按个数；老实现一行只加 1。
  // 转发在主进程直接接同一条事件流，页面关闭不中断。
  useEffect(() => {
    return window.api.onConnectorEvent((event) => {
      if (!autoMerit) return
      if (event.type !== 'like' && event.type !== 'gift') return
      setMerit((s) => s + Math.max(1, Math.trunc(Number(event.count) || 1)))
    })
  }, [autoMerit])

  const toggleForward = async () => {
    if (forward.running) {
      await window.api.danmakuForwardStop()
      setForward((state) => ({ ...state, running: false, clients: 0, error: undefined }))
      toast('弹幕转发已停止', 'info')
      return
    }
    const port = Number(forwardPort)
    const result = await window.api.danmakuForwardStart(port)
    const state = await window.api.danmakuForwardState()
    setForward(state)
    if (result.ok) {
      setForwardPort(String(state.port))
      toast(`弹幕转发已启动：ws://127.0.0.1:${state.port}`, 'success')
    } else {
      toast(result.error ?? '启动弹幕转发失败', 'error')
    }
  }

  const publishForwardTest = async (event: DanmakuForwardEvent, label: string) => {
    const result = await window.api.danmakuForwardPublish(event)
    if (result.ok) toast(`已发送${label}测试数据`, 'success')
    else toast(result.error ?? '发送测试数据失败', 'error')
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <ThumbsUp size={16} className="text-[var(--ok)]" /> 功德点赞
        </div>
        <div className="space-y-3">
          <div className="tnum text-center text-5xl font-bold text-[var(--accent-2)]">{merit}</div>
          <div className="text-center text-xs text-[var(--text-3)]">互动人气值</div>
          <div className="flex gap-2">
            <Btn onClick={() => setMerit((s) => s + 1)} className="flex-1">
              <Plus size={14} /> +1
            </Btn>
            <Btn variant="secondary" onClick={() => setMerit(0)}>
              <RotateCcw size={14} />
            </Btn>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            <Toggle value={autoMerit} onChange={setAutoMerit} />
            收到点赞 / 礼物自动累计
          </label>
          <p className="text-[11px] text-[var(--text-4)]">通过点赞或礼物增加直播间互动人气值（对应原版「功德点赞」）。</p>
        </div>
      </Card>

      <SimulateCard />

      <AdvancedSection title="弹幕转发与第三方接入"><Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Send size={16} className="text-[var(--info)]" /> 弹幕转发
        </div>
        <div className="space-y-3">
          <Field label="监听端口" hint="第三方软件连接 ws://127.0.0.1:端口">
            <Input type="number" min={1} max={65535} value={forwardPort} onChange={(e) => setForwardPort(e.target.value)} disabled={forward.running} />
          </Field>
          <div className="flex items-center gap-3">
            <Btn onClick={toggleForward} variant={forward.running ? 'secondary' : 'primary'}>
              {forward.running ? <WifiOff size={14} /> : <Wifi size={14} />}
              {forward.running ? '停止' : '启动'}
            </Btn>
            <span className={`text-xs ${forward.running ? 'text-[var(--ok)]' : 'text-[var(--text-4)]'}`}>
              {forward.running ? `运行中 · ${forward.clients} 个客户端` : '未启动'}
            </span>
          </div>
          {forward.error && <p className="text-[11px] text-[var(--danger)]">{forward.error}</p>}
          <div className="grid grid-cols-1 gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-2">
            <Field label="发言内容">
              <div className="flex gap-2">
                <Input value={testComment} onChange={(e) => setTestComment(e.target.value)} />
                <Btn size="sm" variant="secondary" onClick={() => publishForwardTest({ type: 'comment', uid: '', name: '测试用户', url: '', msg: testComment, gift: '', num: 0 }, '发言')}><Send size={13} /> 测试</Btn>
              </div>
            </Field>
            <Field label="模拟礼物">
              <div className="flex gap-2">
                <Input value={testGift} onChange={(e) => setTestGift(e.target.value)} className="min-w-0 flex-1" />
                <Select value={testGiftCount} onChange={(e) => setTestGiftCount(Number(e.target.value))} className="w-16">
                  {[1, 10, 20, 30, 66, 99].map((count) => <option key={count} value={count}>{count}</option>)}
                </Select>
                <Btn size="sm" variant="secondary" onClick={() => publishForwardTest({ type: 'gift', uid: '', name: '测试用户', url: '', msg: '', gift: testGift, num: testGiftCount }, '礼物')}><Gift size={13} /> 测试</Btn>
              </div>
            </Field>
          </div>
        </div>
      </Card></AdvancedSection>

    </div>
  )
}

// 模拟事件：不开播也能把礼物/进场/关注/点赞/弹幕喂给全部挂件和礼物规则，主播开播前自己过一遍
function SimulateCard() {
  const toast = useToast((s) => s.toast)
  const [gift, setGift] = useState('小心心')
  const [count, setCount] = useState(1)
  const [sender, setSender] = useState('测试观众')
  const [chat, setChat] = useState('666')
  const [custom, setCustom] = useState('')

  const send = async (line: string, label: string) => {
    const r = await window.api.connectorSimulate(line)
    if (r.ok) toast(`已模拟${label}`, 'success')
    else toast(r.error || '模拟失败', 'error')
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
        <FlaskConical size={16} className="text-[var(--accent-2)]" /> 模拟事件
      </div>
      <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
        像真直播一样发一条事件给所有挂件和礼物规则（走连接器同一条管线），开播前就能把倒计时、动画、排队、进场横幅全试一遍。
      </p>
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="送礼人" className="w-28">
            <Input value={sender} onChange={(e) => setSender(e.target.value)} />
          </Field>
          <Field label="礼物" className="min-w-[120px] flex-1">
            <Input value={gift} onChange={(e) => setGift(e.target.value)} list="ent-sim-gifts" />
            <datalist id="ent-sim-gifts">
              {DOUYIN_GIFT_NAMES.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Field>
          <Field label="个数" className="w-20">
            <Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Btn size="sm" onClick={() => send(`礼物: ${gift.trim() || '小心心'} ×${count}  by ${sender.trim() || '测试观众'}`, '礼物')}><Gift size={13} /> 送礼物</Btn>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={() => send(`进场: ${sender.trim() || '测试观众'}`, '进场')}>进场</Btn>
          <Btn size="sm" variant="secondary" onClick={() => send(`关注 by ${sender.trim() || '测试观众'}`, '关注')}>关注</Btn>
          <Btn size="sm" variant="secondary" onClick={() => send(`点赞: ${Math.max(1, count)} by ${sender.trim() || '测试观众'}`, '点赞')}>点赞 ×{count}</Btn>
          <Btn size="sm" variant="secondary" onClick={() => send(`灯牌 by ${sender.trim() || '测试观众'}`, '灯牌')}>灯牌</Btn>
          <div className="flex flex-1 items-center gap-2">
            <Input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="弹幕内容" className="min-w-[120px] flex-1" />
            <Btn size="sm" variant="secondary" onClick={() => send(`弹幕: ${sender.trim() || '测试观众'} ${chat.trim() || '666'}`, '弹幕')}>弹幕</Btn>
          </div>
        </div>
        <Field advanced label="自定义一行（按连接器日志格式）" hint="例如 gift 小心心 x3 by 阿彪（游戏 mod 连接器格式）">
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="礼物: 火箭 ×1  by 阿彪" className="flex-1" onKeyDown={(e) => e.key === 'Enter' && custom.trim() && send(custom.trim(), '自定义事件')} />
            <Btn size="sm" variant="secondary" onClick={() => custom.trim() && send(custom.trim(), '自定义事件')}>发送</Btn>
          </div>
        </Field>
      </div>
    </Card>
  )
}

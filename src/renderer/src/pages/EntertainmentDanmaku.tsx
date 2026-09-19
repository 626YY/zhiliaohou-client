import { useEffect, useState } from 'react'
import EmojiText from '../components/EmojiText'
import { Radio, Wifi, WifiOff } from 'lucide-react'
import type { ConnectorState } from '@shared/types'
import { Btn, Card, Field, Input, Pill } from '../components/ui'
import { useToast } from '../stores/ui'

interface Platform {
  id: string
  name: string
  status: 'done' | 'todo'
}

const PLATFORMS: Platform[] = [
  { id: 'douyin', name: '抖音', status: 'done' },
  { id: 'douyu', name: '斗鱼', status: 'todo' },
  { id: 'bilibili', name: '哔哩哔哩', status: 'todo' },
  { id: 'xiaohongshu', name: '小红书', status: 'todo' },
  { id: 'bigo', name: 'BigoLive', status: 'todo' }
]

export default function EntertainmentDanmaku() {
  const toast = useToast((s) => s.toast)
  const [state, setState] = useState<ConnectorState | null>(null)
  const [room, setRoom] = useState('')

  useEffect(() => {
    const tick = async () => {
      setState(await window.api.connectorState())
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [])

  const connect = async () => {
    if (!room.trim()) return toast('请输入直播间号', 'error')
    const r = await window.api.connectorStart(room.trim(), false)
    if (!r.ok) toast(r.error ?? '连接失败', 'error')
    else toast('已发起连接', 'success')
  }

  const disconnect = async () => {
    await window.api.connectorStop()
    toast('已断开', 'info')
  }

  const running = !!state?.running

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Radio size={16} className="text-[var(--info)]" /> 弹幕平台
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <span
              key={p.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                p.status === 'done'
                  ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
                  : 'bg-[var(--bg-elev)] text-[var(--text-4)]'
              }`}
            >
              <EmojiText text={p.name} />
              {p.status === 'done' ? (
                <span className="text-[10px]">已支持</span>
              ) : (
                <span className="text-[10px]">待接入</span>
              )}
            </span>
          ))}
        </div>
        <div className="space-y-3">
          <Field label="抖音直播间号 / 房间地址">
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="填抖音直播间号（当前支持抖音）"
            />
          </Field>
          <div className="flex items-center gap-3">
            {running ? (
              <>
                <Pill tone="ok" dot>
                  已连接{state?.sim ? '（模拟）' : ''}
                </Pill>
                <Btn variant="danger" onClick={disconnect}>
                  <WifiOff size={14} /> 断开
                </Btn>
              </>
            ) : (
              <Btn onClick={connect}>
                <Wifi size={14} /> 连接
              </Btn>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

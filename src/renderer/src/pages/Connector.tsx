import { useEffect, useRef, useState } from 'react'
import EmojiText from '../components/EmojiText'
import { useNavigate } from 'react-router-dom'
import { Play, Square, Radio, FlaskConical, Download, Link2 } from 'lucide-react'
import type { ConnectorLogLine } from '@shared/types'
import { Btn, PageHeader, Pill, Select, Input, Segmented } from '../components/ui'
import { Modal } from '../components/Modal'
import RoomManager from '../components/RoomManager'
import { useCardAccess } from '../lib/useCardAccess'
import { useToast } from '../stores/ui'
import { useAuth } from '../stores/auth'

const levelStyle: Record<string, string> = {
  info: 'text-[var(--text-2)]',
  warn: 'text-[var(--warn)]',
  error: 'text-[var(--danger)]',
  gift: 'text-[var(--accent-2)] font-medium',
  follow: 'text-[var(--info)]',
  like: 'text-[var(--info)]'
}

const levelTag: Record<string, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  gift: '礼物',
  follow: '关注',
  like: '点赞'
}

export default function Connector() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.toast)
  const user = useAuth((s) => s.user)
  const rooms = user?.boundRooms ?? []
  // 卡密模式：绑定 / 扫码入口就在这页（弹窗里是 RoomManager），不用去设置页；legacy 模式照旧去设置页绑定
  const { enabled: cardMode } = useCardAccess()
  const [manage, setManage] = useState(false)
  const [running, setRunning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncingGifts, setSyncingGifts] = useState(false)
  const [sim, setSim] = useState(false)
  const [roomId, setRoomId] = useState('')
  // 直播平台：抖音(默认，走扫码登录链路) / B站(公开直播间免登录)。更多平台陆续接入。
  const [platform, setPlatform] = useState<'douyin' | 'bilibili'>('douyin')
  const [biliRoom, setBiliRoom] = useState('')
  const [logs, setLogs] = useState<ConnectorLogLine[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const startRef = useRef(false)

  useEffect(() => {
    let alive = true
    let first = true
    const refreshState = () => window.api.connectorState().then((s) => {
      if (!alive) return
      setRunning(s.running)
      setConnecting(!!s.connecting)
      if (first) {
        setSim(!!s.sim)
        if (s.roomId) setRoomId(s.roomId)
        first = false
      }
    }).catch(() => {})
    void refreshState()
    const timer = setInterval(refreshState, 1000)
    window.api.connectorLog().then(setLogs)
    // 连接器：装了游戏整蛊 mod 用 mod 里的，没装用客户端自带的，不用先配游戏路径
    // 直播间号默认取自 mod 配置（仅当它是本账号已授权的号）
    window.api.readConfig().then((cfg) => {
      const cfgRoom = cfg.ok ? String(cfg.values.LiveRoomId ?? '') : ''
      if (cfgRoom && rooms.includes(cfgRoom)) setRoomId(cfgRoom)
    }).catch(() => {})
    return () => { alive = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    const off = window.api.onConnectorLog((line) => {
      setLogs((prev) => (prev.length >= 800 ? [...prev.slice(-799), line] : [...prev, line]))   // 与主进程同样只留 800 行，长时间开播不越攒越卡
      if (stickRef.current) {
        requestAnimationFrame(() => {
          boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
        })
      }
    })
    return off
  }, [])

  // B站房号：允许直接填号，或粘 live.bilibili.com/<号> 链接
  const parseBiliRoom = (s: string): string => {
    const t = s.trim()
    const m = t.match(/bilibili\.com\/(?:h5\/)?(\d+)/)
    if (m) return m[1]
    const digits = t.replace(/[^\d]/g, '')
    return digits || t
  }

  const start = async () => {
    if (connecting || startRef.current) return
    // B站：公开直播间免登录，直接用房号连（不校验绑定、不走卡密）
    if (platform === 'bilibili') {
      const room = parseBiliRoom(biliRoom)
      if (!sim && !room) {
        toast('请先填写 B 站直播间号', 'error')
        return
      }
      startRef.current = true
      setConnecting(true)
      try {
        const res = await window.api.connectorStart(room, sim, 'bilibili')
        toast(res.ok ? (sim ? '连接器已启动（模拟模式）' : 'B 站连接器已启动') : res.error ?? '启动失败', res.ok ? 'success' : 'error')
      } catch {
        toast('连接失败，请重试', 'error')
      } finally {
        startRef.current = false
        setConnecting(false)
        window.api.connectorState().then((s) => { setRunning(s.running); setSim(!!s.sim) })
      }
      return
    }
    const room = roomId.trim()
    if (!sim && !room) {
      toast('请先选择直播间号', 'error')
      return
    }
    // 只能启动已授权的直播间号；要新号先去设置页绑定
    if (room && !rooms.includes(room)) {
      toast(cardMode ? '请选择已绑定的直播间；新直播间点「绑定 / 管理直播间」' : '请选择下方已授权的直播间号，新号请到设置页绑定', 'error')
      return
    }
    startRef.current = true
    setConnecting(true)
    try {
      const res = await window.api.connectorStart(room, sim, 'douyin')
      toast(res.ok ? (sim ? '连接器已启动（模拟模式）' : '登录状态已保存，连接器已启动') : res.error ?? '启动失败', res.ok ? 'success' : 'error')
    } catch {
      toast('连接失败，请重试', 'error')
    } finally {
      startRef.current = false
      setConnecting(false)
      window.api.connectorState().then((s) => {
        setRunning(s.running)
        setSim(!!s.sim)
      })
    }
  }

  // 手动同步抖音礼物图：连接直播间时会自动做一次，这里给没开播、想先把新礼物的图拉下来的主播
  const syncGifts = async () => {
    setSyncingGifts(true)
    try {
      const r = await window.api.giftImagesSync(roomId.trim())
      if (!r.ok) toast(r.error ?? '同步礼物图失败', 'error')
      else if (r.downloaded > 0) toast(`礼物图已同步：新增 ${r.downloaded} 张，本地已有 ${r.existing} 张${r.failed ? `，${r.failed} 张下载失败` : ''}`, 'success')
      else toast(`礼物图已是最新：抖音礼物表 ${r.total} 个礼物本地都有图`, 'success')
    } catch {
      toast('同步礼物图失败，请重试', 'error')
    } finally {
      setSyncingGifts(false)
    }
  }

  const stop = async () => {
    await window.api.connectorStop()
    toast(connecting ? '已取消连接' : '已停止连接器', 'info')
    window.api.connectorState().then((s) => {
      setRunning(s.running)
      setSim(!!s.sim)
    })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4">
        <PageHeader
          icon={<Radio size={20} className="text-[var(--accent-2)]" />}
          title="直播连接器"
          desc="选择直播间并连接，让礼物、关注和点赞触发已配置的互动。"
          actions={
            <Pill tone={running ? 'ok' : connecting ? 'warn' : 'muted'} dot pulse={running || connecting}>
              {running ? (sim ? '运行中 · 模拟' : '运行中') : connecting ? '连接中' : '已停止'}
            </Pill>
          }
        />
      </div>

      {/* 平台选择：抖音走扫码登录链路；B站公开直播间免登录；更多平台陆续接入 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={platform}
          onChange={(v) => setPlatform(v)}
          options={[
            { value: 'douyin', label: '抖音' },
            { value: 'bilibili', label: '哔哩哔哩' }
          ]}
        />
        <span className="text-xs text-[var(--text-4)]">
          快手 · 视频号 · 小红书 · TikTok 等平台陆续接入中
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {platform === 'bilibili' ? (
          <Input
            value={biliRoom}
            onChange={(e) => setBiliRoom(e.target.value)}
            placeholder="B 站直播间号，或粘 live.bilibili.com/ 链接"
            style={{ width: '22rem' }}
            aria-label="B 站直播间号"
            disabled={connecting || running}
          />
        ) : rooms.length > 0 ? (
          <Select
            value={rooms.includes(roomId) ? roomId : ''}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ width: '18rem' }}
            aria-label="直播间号"
            disabled={connecting || running}
          >
            <option value="">选择直播间号…</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        ) : cardMode ? (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--text-3)]" data-testid="connector-room-guide">
            还没有绑定直播间。输入直播间号或链接，用抖音扫一次码就好。
            <Btn size="sm" onClick={() => setManage(true)} data-testid="connector-bind-btn">
              <Link2 size={13} /> 绑定直播间
            </Btn>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--text-3)]">
            还没有已授权的直播间号。
            <Btn variant="secondary" size="sm" onClick={() => navigate('/settings')}>
              去设置绑定
            </Btn>
          </span>
        )}
        {platform === 'douyin' && cardMode && rooms.length > 0 ? (
          <Btn variant="secondary" size="sm" onClick={() => setManage(true)} disabled={connecting || running} data-testid="connector-manage-btn">
            <Link2 size={13} /> 绑定 / 管理直播间
          </Btn>
        ) : null}

        <button
          onClick={() => setSim((v) => !v)}
          aria-pressed={sim}
          disabled={connecting || running}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            sim
              ? 'border-[var(--accent-soft-2)] bg-[var(--accent-soft)] text-[var(--accent-2)]'
              : 'border-[var(--line-strong)] text-[var(--text-3)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]'
          }`}
        >
          <FlaskConical size={14} /> 模拟模式
        </button>
        {platform === 'douyin' && (
          <Btn
            variant="secondary"
            disabled={syncingGifts}
            onClick={syncGifts}
            title="从抖音拉当前礼物表，把本地还没有的礼物图下到连接器目录；连接直播间时也会自动做"
          >
            <Download size={14} /> {syncingGifts ? '同步中…' : '同步礼物图'}
          </Btn>
        )}
        {connecting ? (
          <Btn variant="secondary" onClick={stop}>取消连接</Btn>
        ) : running ? (
          <Btn variant="danger" onClick={stop}>
            <Square size={14} /> 停止
          </Btn>
        ) : (
          <Btn onClick={start}>
            <Play size={14} /> 启动连接器
          </Btn>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--text-4)]">
        {platform === 'bilibili' ? (
          <span>
            B 站公开直播间免登录即可连接：填直播间号就能收弹幕、礼物、进场、点赞、上舰。礼物图会在连接后自动缓存。
          </span>
        ) : (
          <span>
            {cardMode
              ? '只能连接已绑定的直播间；要加新直播间或更换，点「绑定 / 管理直播间」。'
              : '直播间号只能从本账号已授权的号中选择，需要新号请到设置页绑定。'}
            {connecting ? ' 正在登录并连接，请在打开的抖音网页完成扫码。' : cardMode ? ' 连接用的是绑定时扫码保存的登录状态；过期了会再打开抖音网页让你扫一次。' : ' 首次连接会打开抖音网页，扫码后自动保存并继续连接。'}
          </span>
        )}
      </div>

      {cardMode ? (
        <Modal open={manage} onClose={() => setManage(false)} title="直播间" width={640} footer={<Btn variant="secondary" onClick={() => setManage(false)}>关闭</Btn>}>
          <RoomManager
            compact
            onBound={(room) => {
              // 刚绑好的直播间直接选上，主播回来点「启动连接器」就行
              setRoomId(room)
            }}
          />
        </Modal>
      ) : null}

      <div
        ref={boxRef}
        className="zl-scroll select-text flex-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 font-mono text-[12px] leading-6"
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {logs.length === 0 && (
          <div className="text-[var(--text-4)]">
            暂无日志。启动连接器后，这里会显示实时输出。
          </div>
        )}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-[var(--text-4)]">
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            <span className="shrink-0 rounded bg-[var(--bg-elev)] px-1 text-[10px] text-[var(--text-3)]">
              {levelTag[l.level] ?? 'INFO'}
            </span>
            <span
              className={`break-all whitespace-pre-wrap ${levelStyle[l.level]}`}
            >
              <EmojiText text={l.text} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

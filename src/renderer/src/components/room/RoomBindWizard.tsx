import { useEffect, useRef, useState } from 'react'
import { Link2, QrCode, ScanLine, CheckCircle2, KeyRound, RefreshCw } from 'lucide-react'
import { Modal } from '../Modal'
import { Btn, Input, Pill } from '../ui'
import { CardRedeemForm } from '../CardAccess'
import { extractRoomId, preflight, quotaSummary, type RoomApi, type RoomQuotaState } from './roomApi'

// 直播间绑定向导（卡密模式 · 基础）：一步一问，不出现「申请 / 审批 / 令牌 / 槽位」这些内部词。
//   入口两条：先输入直播间号或链接 → 扫码 → 确认；或先扫码 → 粘贴链接补房号 → 确认。
//   扫码时页面一直有反馈（已等待多久 / 还没扫好 / 重新扫码 / 取消），不让主播对着空白等 6 分钟。
//   名额 / 次数不够时直接停在卡密步；兑换成功刷新名额后回到原来那一步，不重复扫码。
//   取消只丢本地草稿，不做任何服务端写入；令牌只在主进程，这里只拿一个不显示的 proof。

export type WizardMode = { action: 'bind' } | { action: 'replace'; previous: string }
export type CardKind = 'room_slot' | 'room_change'
type Step = 'card' | 'entry' | 'input' | 'scan' | 'askRoom' | 'confirm' | 'done'

interface Props {
  open: boolean
  mode: WizardMode
  api: RoomApi
  quota: RoomQuotaState | null
  /** 名额 / 次数不足：一打开就停在卡密步 */
  initialCard?: CardKind | null
  /** 快捷入口带过来的直播间号 / 链接 */
  initialInput?: string
  /** 一打开就先扫码 */
  scanFirst?: boolean
  /** 本次运行里刚解绑过的直播间：空出来的名额再绑别的直播间会算 1 次改绑，确认页要提前说 */
  recentUnbound?: string[]
  onClose: () => void
  onRefreshQuota: () => Promise<RoomQuotaState | null>
  onApply: (quota?: RoomQuotaState | null, boundRooms?: string[]) => void
  onBound?: (room: string) => void
}

const SLOW_HINT_MS = 90_000

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 卡密步：说清为什么要卡、这张卡给什么，兑换用现成表单 */
export function RoomCardPanel({ kind, quota, onDone, note }: { kind: CardKind; quota: RoomQuotaState | null; onDone: () => void; note?: string }) {
  const q = quotaSummary(quota)
  return (
    <div className="space-y-3" data-testid="room-card-panel" data-kind={kind}>
      <div className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-sm leading-6 text-[var(--warn)]">
        {kind === 'room_slot'
          ? `${q.available===0?'直播间名额已用完':'可以增加直播间名额'}（已绑 ${q.bound} / ${q.capacity} 个）。每张名额卡长期增加 1 个名额，已有绑定保持。`
          : `${q.changesLeft===0?'改绑次数已用完':'当前还有改绑机会'}（剩 ${q.changesLeft} 次）。每张改绑卡增加 3 次改绑机会，可以累加。`}
      </div>
      {note ? <p className="text-xs leading-5 text-[var(--text-3)]">{note}</p> : null}
      <CardRedeemForm autoFocus label="激活" onDone={onDone} />
      <p className="text-xs leading-5 text-[var(--text-4)]">激活后自动刷新名额并回到刚才那一步，已经扫过的码不用再扫。</p>
    </div>
  )
}

export function RoomBindWizard({ open, mode, api, quota, initialCard, initialInput = '', scanFirst = false, recentUnbound = [], onClose, onRefreshQuota, onApply, onBound }: Props) {
  const isReplace = mode.action === 'replace'
  const previous = isReplace ? mode.previous : ''
  const [step, setStep] = useState<Step>(() => (initialCard ? 'card' : scanFirst ? 'scan' : initialInput ? 'input' : 'entry'))
  const [cardKind, setCardKind] = useState<CardKind | null>(initialCard ?? null)
  // 卡密步兑换成功后回到哪：先扫码入口回扫码、快捷输入入口回输入、否则回入口选择
  const [cardReturn, setCardReturn] = useState<Step>(() => (scanFirst ? 'scan' : initialInput ? 'input' : 'entry'))
  const [cardNote, setCardNote] = useState('')
  const [text, setText] = useState(initialInput)
  const [room, setRoom] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('')
  const [offline, setOffline] = useState(false)
  const [proof, setProof] = useState('')
  const [scanError, setScanError] = useState('')
  /** 扫码成功但房号核实失败（proof 还在）：可以直接改房号，不用重扫 */
  const [lookupFailed, setLookupFailed] = useState(false)
  const [scanStarted, setScanStarted] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [showNotYet, setShowNotYet] = useState(false)
  const [commitError, setCommitError] = useState('')
  const [busy, setBusy] = useState(false)
  const scanTicket = useRef(0)
  const started = useRef(false)

  useEffect(()=>()=>{scanTicket.current++;void window.api.cancelRoomApply().catch(()=>{})},[])

  const parsed = extractRoomId(text)
  const summary = quotaSummary(quota)
  const boundList = quota?.rooms ?? []

  // 扫码等待期间每秒走一下「已等待」
  useEffect(() => {
    if (step !== 'scan' || scanError) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step, scanError])

  const startScan = async (r?: string, p?: string) => {
    const ticket = ++scanTicket.current
    setStep('scan')
    setScanError('')
    setLookupFailed(false)
    setShowNotYet(false)
    setScanStarted(Date.now())
    setNow(Date.now())
    try {
      if (!p) { await window.api.cancelRoomApply(); if (ticket !== scanTicket.current) return }
      const res = await api.cardRoomVerify(r || undefined, p || undefined)
      if (ticket !== scanTicket.current) return // 已点了重新扫码 / 取消，旧结果作废
      if (!res.ok) {
        // 登录没问题只是房号核不上：主进程会把 proof 留着，让主播改个房号，不用重扫
        if (res.proof) {
          setProof(res.proof)
          setLookupFailed(true)
        }
        setScanError(res.error || '扫码没有完成')
        return
      }
      if (res.proof) setProof(res.proof)
      if (res.needRoom || !(res.room || r)) {
        setStep('askRoom')
        return
      }
      setRoom(res.room || r || '')
      setNickname(res.nickname || '')
      setAvatar(typeof res.avatar === 'string' && /^(https?:|data:image\/)/i.test(res.avatar) ? res.avatar : '')
      setOffline(!!res.offline)
      setCommitError('')
      setStep('confirm')
    } catch (e) {
      if (ticket !== scanTicket.current) return
      setScanError(e instanceof Error ? e.message : '扫码没有完成')
    }
  }

  // scanFirst：一打开就扫
  useEffect(() => {
    if (!open || started.current) return
    started.current = true
    if (scanFirst && !initialCard) void startScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const cancel = () => {
    scanTicket.current++ // 之后回来的扫码结果一律丢掉；不 commit，服务端不会有任何写入
    void window.api.cancelRoomApply().catch(()=>{})
    onClose()
  }

  const goInputNext = () => {
    if (!parsed.room) return
    setRoom(parsed.room)
    if (proof) void startScan(parsed.room, proof)
    else void startScan(parsed.room)
  }

  const commit = async () => {
    if (!room || !proof || busy) return
    setBusy(true)
    setCommitError('')
    try {
      const res = await api.cardRoomCommit({ action: mode.action, room, previous: isReplace ? previous : undefined, proof })
      if (res.ok) {
        onApply(res.quota, res.boundRooms)
        setStep('done')
        onBound?.(room)
        return
      }
      if (res.needCard) {
        setCardKind(res.needCard)
        setCardReturn('confirm')
        setCardNote('刚才的扫码结果已保留，激活后直接回到确认页。')
        setStep('card')
        return
      }
      setCommitError(res.error || '绑定没有成功，请重试')
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : '绑定没有成功，请重试')
    } finally {
      setBusy(false)
    }
  }

  // 卡密激活成功 → 刷新名额 → 够了就回原步骤，不够就留在卡密步并说明
  const afterCard = async () => {
    const q = await onRefreshQuota()
    const need = preflight(q ?? quota, mode.action)
    if (need === 'ok' || need === 'unknown') {
      setCardKind(null)
      setCardNote('')
      if (cardReturn === 'scan' && !proof) void startScan(room || undefined)
      else setStep(cardReturn)
    } else {
      setCardNote('卡密已激活，但这张卡不是本步需要的类型，名额或次数还没变。请换一张对应的卡。')
    }
  }

  // ---- 确认页要说清：这次动的是哪个直播间、消耗什么 ----
  const sameAsBound = boundList.includes(room)
  const consequence = (() => {
    if (summary.free) return { text: isReplace && room === previous ? '和原来的直播间相同。' : '当前不限直播间数量和改绑次数，确认后直接生效。', tone: 'info' as const }
    if (isReplace) {
      if (room === previous) return { text: '和原来的直播间相同，不消耗改绑次数。', tone: 'muted' as const }
      return { text: `更换直播间会消耗 1 次改绑：剩余 ${summary.changesLeft} 次 → ${Math.max(0, summary.changesLeft - 1)} 次。`, tone: 'warn' as const }
    }
    if (sameAsBound) return { text: '这个直播间已经绑定在本账号，确认后不消耗名额。', tone: 'muted' as const }
    const slotText = `使用 1 个直播间名额：已绑 ${summary.bound} / ${summary.capacity} 个 → ${Math.min(summary.capacity, summary.bound + 1)} / ${summary.capacity} 个。`
    // 按平台持久记录判断，重启后仍可提前说清费用；名额卡新增的未用名额优先免费。
    // 旧平台缺 empty_slots 时仅用本次已知解绑记录兜底，不能把缺字段当作没有历史。
    const emptySlots = quota?.empty_slots ?? recentUnbound.map((last_room, i) => ({ slot: i + 1, last_room }))
    if (emptySlots.some((s) => s.last_room === room)) return { text: slotText + ' 绑回原来解绑的直播间，不算改绑。', tone: 'info' as const }
    const neverUsed = summary.capacity > summary.bound + emptySlots.length
    if (neverUsed) return { text: slotText + ' 使用还没绑过直播间的新名额，不消耗改绑次数。', tone: 'info' as const }
    const reused = [...emptySlots].sort((a, b) => a.slot - b.slot)[0]
    if (reused?.last_room) {
      return { text: slotText + ` 这个名额之前绑过 ${reused.last_room}，换成别的直播间会算 1 次改绑：剩余 ${summary.changesLeft} 次 → ${Math.max(0, summary.changesLeft - 1)} 次。`, tone: 'warn' as const }
    }
    return { text: slotText, tone: 'info' as const }
  })()

  const title = (() => {
    if (step === 'card') return cardKind === 'room_change' ? '需要改绑卡' : '需要名额卡'
    if (step === 'done') return isReplace ? '已改绑' : '已绑定'
    return isReplace ? `更换直播间 ${previous}` : boundList.length ? '添加另一个直播间' : '绑定直播间'
  })()

  const roomInput = (label: string, onEnter: () => void) => (
    <div className="space-y-2">
      <Input
        aria-label={label}
        placeholder="直播间号，或粘贴直播链接（live.douyin.com/…）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed.room) onEnter()
        }}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      {text.trim() ? (
        parsed.room ? (
          <p className="text-xs text-[var(--ok)]" data-testid="room-parsed" data-room={parsed.room}>
            识别到直播间号 <span className="select-text font-mono">{parsed.room}</span>
            {parsed.source === 'link' ? '（来自链接）' : ''}
          </p>
        ) : (
          <p role="alert" className="text-xs leading-5 text-[var(--danger)]">
            {parsed.error}
          </p>
        )
      ) : (
        <p className="text-xs leading-5 text-[var(--text-4)]">打开抖音直播间，复制地址栏里的完整链接粘贴到这里也可以。</p>
      )}
    </div>
  )

  const footer = (() => {
    switch (step) {
      case 'card':
        return <Btn variant="secondary" onClick={cancel}>取消</Btn>
      case 'entry':
        return <Btn variant="secondary" onClick={cancel}>取消</Btn>
      case 'input':
        return (
          <>
            <Btn variant="secondary" onClick={cancel}>取消</Btn>
            <Btn onClick={goInputNext} disabled={!parsed.room}>
              <ScanLine size={14} />
              {summary.free ? '下一步：确认绑定' : '下一步：扫码确认'}
            </Btn>
          </>
        )
      case 'scan':
        return (
          <>
            <Btn variant="secondary" onClick={cancel}>取消</Btn>
            {!scanError ? (
              <Btn variant="ghost" onClick={() => setShowNotYet((v) => !v)}>
                还没扫好
              </Btn>
            ) : null}
            <Btn variant={scanError ? 'primary' : 'secondary'} onClick={() => { setProof(''); void startScan(room || undefined) }}>
              <RefreshCw size={14} />
              重新扫码
            </Btn>
          </>
        )
      case 'askRoom':
        return (
          <>
            <Btn variant="secondary" onClick={cancel}>取消</Btn>
            <Btn
              onClick={() => {
                if (!parsed.room) return
                setRoom(parsed.room)
                void startScan(parsed.room, proof)
              }}
              disabled={!parsed.room}
            >
              下一步
            </Btn>
          </>
        )
      case 'confirm':
        return (
          <>
            <Btn variant="secondary" onClick={cancel} disabled={busy}>取消</Btn>
            <Btn onClick={() => void commit()} disabled={busy} data-testid="room-commit">
              {busy ? '正在提交…' : isReplace ? '确认改绑' : '确认绑定'}
            </Btn>
          </>
        )
      case 'done':
        return <Btn onClick={onClose}>完成</Btn>
    }
  })()

  return (
    <Modal open={open} onClose={cancel} title={title} width={520} footer={footer} closeOnBackdrop={false} closeDisabled={busy}>
      <div data-testid="room-wizard" data-step={step} data-action={mode.action}>
        {step === 'card' && cardKind ? <RoomCardPanel kind={cardKind} quota={quota} onDone={() => void afterCard()} note={cardNote} /> : null}

        {step === 'entry' ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[var(--text-2)]">
              {isReplace
                ? summary.free
                  ? `把直播间 ${previous} 换成另一个，不限次数。`
                  : `把直播间 ${previous} 换成另一个。换成不同的直播间会消耗 1 次改绑（剩 ${summary.changesLeft} 次）；换回同一个不消耗。`
                : summary.free
                  ? '输入直播间号或粘贴直播链接就能绑定，不限数量和次数，不会改动你的视频和规则。'
                  : '两种方式都要用抖音扫一次码，扫码只是确认这个直播间是你本人的，不会改动你的视频和规则。'}
            </p>
            <button
              type="button"
              onClick={() => setStep('input')}
              className="flex w-full items-center gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elev)] px-4 py-3 text-left transition hover:border-[var(--accent)]"
              data-testid="room-entry-input"
            >
              <Link2 size={18} className="shrink-0 text-[var(--accent-2)]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--text)]">先输入直播间号或链接</span>
                <span className="block text-xs text-[var(--text-3)]">知道直播间号，或者能复制直播链接</span>
              </span>
            </button>
            {summary.free ? null : (
            <button
              type="button"
              onClick={() => void startScan()}
              className="flex w-full items-center gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elev)] px-4 py-3 text-left transition hover:border-[var(--accent)]"
              data-testid="room-entry-scan"
            >
              <QrCode size={18} className="shrink-0 text-[var(--accent-2)]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--text)]">先用抖音扫码</span>
                <span className="block text-xs text-[var(--text-3)]">不知道直播间号也没关系，扫完再补一次链接</span>
              </span>
            </button>
            )}
          </div>
        ) : null}

        {step === 'input' ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[var(--text-2)]">{summary.free ? '告诉我要绑定哪个直播间，下一步确认就绑上。' : '第 1 步：告诉我要绑定哪个直播间。下一步会打开浏览器用抖音扫码确认。'}</p>
            {roomInput('抖音直播间号或直播链接', goInputNext)}
          </div>
        ) : null}

        {step === 'scan' ? (
          <div className="space-y-3" data-testid="room-scan" data-error={scanError ? '1' : '0'}>
            {room ? (
              <p className="text-sm text-[var(--text-2)]">
                直播间 <span className="select-text font-mono text-[var(--text)]">{room}</span>
              </p>
            ) : null}
            {scanError ? (
              <div className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Pill tone="danger" dot>扫码没完成</Pill>
                </div>
                <p role="alert" className="mt-2 text-sm leading-6 text-[var(--danger)]">{scanError}</p>
                {lookupFailed ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs leading-5 text-[var(--text-3)]">扫码本身已经成功，只是这个房号核不上。可以改一个房号，不用重扫。</span>
                    <Btn size="sm" variant="secondary" onClick={() => setStep('askRoom')} data-testid="room-fix-room">
                      改房号（不用重扫）
                    </Btn>
                  </div>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">刚才填的内容都还在。点「重新扫码」再来一次，或取消。</p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Pill tone="warn" dot pulse>等待扫码</Pill>
                  <span className="tnum text-xs text-[var(--text-4)]" data-testid="room-scan-elapsed">已等待 {fmtElapsed(now - scanStarted)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--text)]">浏览器已经打开，用抖音扫一扫；完成会自动回来。</p>
                <p className="text-xs leading-5 text-[var(--text-3)]">不用关这个窗口。手机上确认登录后，这里会自动进入下一步。</p>
                {now - scanStarted > SLOW_HINT_MS ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--warn)]">等得有点久了。浏览器没打开或者二维码过期的话，点「重新扫码」。</p>
                ) : null}
                {showNotYet ? (
                  <p className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs leading-5 text-[var(--text-2)]" data-testid="room-scan-help">
                    没关系，慢慢扫。找不到浏览器窗口就看任务栏；二维码过期了就点「重新扫码」；不想绑了点「取消」，不会有任何改动。
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {step === 'askRoom' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Pill tone="ok" dot>已扫码</Pill>
              <span className="text-xs text-[var(--text-3)]">不用再扫了</span>
            </div>
            <p className="text-sm leading-6 text-[var(--text-2)]">扫码成功，还差直播间号：把你的直播链接粘贴到这里。</p>
            {roomInput('抖音直播间号或直播链接', () => {
              if (!parsed.room) return
              setRoom(parsed.room)
              void startScan(parsed.room, proof)
            })}
          </div>
        ) : null}

        {step === 'confirm' ? (
          <div className="space-y-3" data-testid="room-confirm" data-room={room}>
            <div className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
              {avatar ? (
                <img src={avatar} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-2)] to-[var(--accent)] text-lg font-bold text-white">
                  {(nickname || room || '?')[0]}
                </div>
              )}
              <div className="min-w-0">
                {nickname ? <div className="truncate text-sm font-semibold text-[var(--text)]" data-testid="room-nickname">{nickname}</div> : null}
                <div className="select-text font-mono text-sm text-[var(--text-2)]">直播间 {room}</div>
              </div>
              <Pill tone="ok" dot className="ml-auto">已扫码</Pill>
            </div>
            {offline ? (
              <p className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-xs leading-5 text-[var(--warn)]" data-testid="room-offline">
                这个直播间现在没开播，上面显示的是刚扫码登录的抖音账号本人。请核对直播间号是不是你自己的。
              </p>
            ) : null}
            {isReplace ? (
              <p className="text-sm text-[var(--text-2)]">
                原直播间 <span className="select-text font-mono text-[var(--text-3)]">{previous}</span> → 新直播间 <span className="select-text font-mono text-[var(--text)]">{room}</span>
              </p>
            ) : null}
            <p
              className={`rounded-lg px-3 py-2 text-sm leading-6 ${
                consequence.tone === 'warn'
                  ? 'border border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn)]'
                  : consequence.tone === 'info'
                    ? 'border border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]'
                    : 'bg-[var(--bg-elev)] text-[var(--text-3)]'
              }`}
              data-testid="room-consequence"
            >
              {consequence.text}
            </p>
            {commitError ? (
              <div className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2">
                <p role="alert" className="text-sm leading-6 text-[var(--danger)]">{commitError}</p>
                <div className="mt-1">
                  <Btn size="sm" variant="ghost" onClick={() => void startScan(room, undefined)}>
                    <RefreshCw size={13} />
                    重新扫码
                  </Btn>
                </div>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-[var(--text-4)]">视频、规则等配置不会因为绑定或更换直播间而改变。</p>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className="space-y-3" data-testid="room-done" data-room={room}>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--ok-line)] bg-[var(--ok-soft)] px-4 py-3">
              <CheckCircle2 size={20} className="shrink-0 text-[var(--ok)]" />
              <div className="min-w-0 text-sm text-[var(--ok)]">
                {isReplace ? '已改绑到' : '已绑定'}直播间 <span className="select-text font-mono">{room}</span>
                {nickname ? `（${nickname}）` : ''}
              </div>
            </div>
            <p className="text-xs leading-5 text-[var(--text-3)]">{summary.free ? '到「直播连接器」选择它就能连接直播；第一次连接时扫码登录抖音，之后登录状态保存在本机。' : '到「直播连接器」选择它就能连接直播；扫码时的登录状态已保存在本机。'}</p>
            {quota ? (
              <p className="text-xs text-[var(--text-4)]" data-testid="room-done-quota">
                {summary.free ? `现在：已绑定 ${summary.bound} 个 · 数量和改绑次数不限` : `现在：已绑定 ${summary.bound} / ${summary.capacity} 个 · 可添加 ${summary.available} 个 · 剩余改绑 ${summary.changesLeft} 次`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {step === 'card' ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--text-4)]">
          <KeyRound size={12} />
          {cardKind === 'room_change' ? '输入改绑卡密，增加 3 次改绑机会。' : '输入直播间名额卡密，增加 1 个名额。'}
        </p>
      ) : null}
    </Modal>
  )
}

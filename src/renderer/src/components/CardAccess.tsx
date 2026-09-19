import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, RefreshCw, Mail } from 'lucide-react'
import type { CardRight } from '@shared/types'
import { Modal } from './Modal'
import { Btn, Input, Pill } from './ui'
import { useToast } from '../stores/ui'
import { useAuth } from '../stores/auth'
import {
  CARD_PLATFORM_PRODUCT,
  cardGameProduct,
  cardProductName,
  cardRefreshHint,
  cardRightValid,
  cardTerm,
  useCardAccess,
  useCardStore
} from '../lib/useCardAccess'

// 卡密授权界面（正式版）。只在主进程报告 enabled=true 时出现；否则这些组件全部渲染为空，
// 原来的邮箱授权 / 直播间申请界面原样保留。
// 主播端只有「输入卡密激活 / 刷新授权」：不提供任何后台或平台管理入口，正常连接时不显示服务器状态。

// 2026-09-13：授权快照 4 秒刷一次 → 60 秒（每次都要问平台 /me），周期由主进程给（回归用 ZL_CARD_POLL_MS 缩短）；切回窗口时立刻刷一次照旧
const DEFAULT_POLL_MS = 60_000

/** 常驻根组件：轮询快照、接主进程「需要激活」事件、渲染唯一的激活弹窗 */
export function CardAccessHost() {
  const accountId=useAuth(s=>s.user?.id)
  const refresh = useCardStore((s) => s.refresh)
  const openPrompt = useCardStore((s) => s.openPrompt)
  const enabled = useCardStore((s) => !!s.snapshot?.enabled)
  const loaded = useCardStore((s) => s.loaded)
  const prompt = useCardStore((s) => s.prompt)
  const closePrompt = useCardStore((s) => s.closePrompt)
  const pollMs = Math.max(1000, Number((window as unknown as { api?: { cardPollMs?: number } }).api?.cardPollMs) || DEFAULT_POLL_MS)

  useEffect(() => {
    void refresh()
  }, [refresh,accountId])

  useEffect(() => {
    if (!loaded || !enabled) return
    const id = setInterval(() => void refresh(), pollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loaded, enabled, refresh, pollMs])

  useEffect(() => {
    if (typeof window.api?.onCardLicenseRequired !== 'function') return
    return window.api.onCardLicenseRequired((product) => {
      if (typeof product === 'string' && product) openPrompt(product)
    })
  }, [openPrompt])

  if (!enabled || !prompt) return null
  return <CardRedeemPrompt key={prompt} product={prompt} onClose={closePrompt} />
}

/** 只在最近一次读取授权失败时出现的一句短提示；正常连接时什么都不渲染，也不显示服务地址或底层原文 */
export function CardRefreshFailed({ className = '' }: { className?: string }) {
  const { snapshot, loaded, connected } = useCardAccess()
  if (!snapshot?.enabled || !loaded || connected) return null
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-[var(--warn)] ${className}`} data-testid="card-refresh-failed">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
      {cardRefreshHint(snapshot.error)}
    </span>
  )
}

/** 离线授权中（平台暂时联系不上，正按本机保存的平台签名凭证继续用）：只在这种状态下渲染 */
export function CardOfflineNotice({ className = '' }: { className?: string }) {
  const { snapshot } = useCardAccess()
  if (!snapshot?.enabled || !snapshot.offline) return null
  const until = snapshot.offlineUntil ? new Date(snapshot.offlineUntil * 1000).toLocaleString('zh-CN', { hour12: false }) : ''
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-[var(--warn)] ${className}`} data-testid="card-offline-notice" title="平台恢复后会自动切回在线授权，不用重新登录">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
      平台暂时联系不上，正按本机保存的授权继续使用{until ? `（有效到 ${until}）` : ''}
    </span>
  )
}

/** 权益清单：名称 + 期限 + 已激活/未激活 */
export function CardRightsList({ rights, compact = false }: { rights: CardRight[]; compact?: boolean }) {
  if (!rights.length) {
    // 读取失败时主进程不带权益，这里拿到的是空数组：不能说成「没有任何授权」，只给中性提示
    return (
      <p className="text-xs text-[var(--text-3)]" data-testid="card-rights-empty">
        暂时没有可显示的授权信息，请刷新后重试
      </p>
    )
  }
  return (
    <div className={compact ? 'space-y-2' : 'divide-y divide-[var(--line)]'} data-testid="card-rights">
      {rights.map((r) => {
        const valid = cardRightValid(r)
        return (
          <div key={r.id} className={`flex items-center gap-4 ${compact ? 'text-xs' : 'py-3'}`} data-card-right={r.id}>
            <div className="min-w-0 flex-1">
              <div className={compact ? 'text-[var(--text-2)]' : 'text-sm text-[var(--text)]'}>{r.name || cardProductName(r.id)}</div>
              <div className={`${compact ? 'mt-0.5' : 'mt-1'} text-xs text-[var(--text-3)]`}>{cardTerm(r)}</div>
            </div>
            <Pill tone={valid ? 'ok' : 'muted'} dot>
              {valid ? '已激活' : '未激活'}
            </Pill>
          </div>
        )
      })}
    </div>
  )
}

/** 激活卡密表单：失败原因 + 怎么重试就写在输入框下面 */
export function CardRedeemForm({ autoFocus = false, onDone, label = '激活卡密' }: { autoFocus?: boolean; onDone?: () => void; label?: string }) {
  const toast = useToast((s) => s.toast)
  const redeem = useCardStore((s) => s.redeem)
  const busy = useCardStore((s) => s.busy)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    const result = await redeem(code)
    if (result.ok) {
      setCode('')
      toast('卡密已激活，授权已更新', 'success')
      onDone?.()
    } else {
      setError(result.error || '激活失败，请检查卡密后重试')
    }
  }

  return (
    <form className="space-y-2" onSubmit={submit} data-testid="card-redeem-form">
      <div className="flex gap-2">
        <Input
          aria-label="卡密"
          placeholder="在这里输入卡密"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            if (error) setError('')
          }}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={busy}
        />
        <Btn type="submit" disabled={busy || !code.trim()} className="shrink-0">
          <KeyRound size={14} />
          {busy ? '激活中…' : label}
        </Btn>
      </div>
      {error ? (
        <p role="alert" className="text-xs leading-5 text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** 顶栏「卡密授权」入口 + 弹窗 */
export function CardAccessButton() {
  const { enabled, free, rights, user, loaded } = useCardAccess()
  const refresh = useCardStore((s) => s.refresh)
  const toast = useToast((s) => s.toast)
  const authUser = useAuth((s) => s.user)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  if (!enabled || free) return null
  const email = user?.email || authUser?.email || authUser?.username || ''
  const doRefresh = async () => {
    setRefreshing(true)
    try {
      const r = await refresh()
      if (r && r.ok && r.offline) toast('平台暂时联系不上，正按本机保存的授权继续使用；平台恢复后会自动切回在线', 'info')
      else if (r && r.ok) toast('授权已刷新', 'success')
      else toast(cardRefreshHint(r?.error), 'error')
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="card-access-button">
        <KeyRound size={14} />
        卡密授权
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="卡密授权" width={640} footer={<Btn variant="secondary" onClick={() => setOpen(false)}>关闭</Btn>}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm text-[var(--text-2)]">
            <Mail size={14} className="text-[var(--text-3)]" />
            <span className="select-text">{email || '未登录'}</span>
          </span>
          <CardRefreshFailed />
          <CardOfflineNotice />
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--text-3)]">授权跟随当前账号。娱乐助手与各游戏 Mod 分别激活，时间按北京时间显示。</p>
        <div className="mb-5">{loaded ? <CardRightsList rights={rights} /> : <p className="text-xs text-[var(--text-3)]">正在读取授权…</p>}</div>
        <CardRedeemForm />
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="ghost" size="sm" disabled={refreshing} onClick={doRefresh}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新授权
          </Btn>
        </div>
      </Modal>
    </>
  )
}

/** 主进程拒绝某次使用后弹出：显示该产品与娱乐助手的期限；激活成功后提示再点原按钮。取消不改任何业务。 */
export function CardRedeemPrompt({ product, onClose }: { product: string; onClose: () => void }) {
  const { right, platform, rights, free } = useCardAccess()
  const busy = useCardStore((s) => s.busy)
  const target = right(product)
  const isPlatform = product === CARD_PLATFORM_PRODUCT
  const allowed = cardRightValid(target) && (isPlatform || cardRightValid(platform))
  if (free) return null
  return (
    <Modal
      open
      onClose={onClose}
      title={allowed ? '授权已生效' : '需要激活卡密'}
      width={470}
      closeDisabled={busy}
      footer={
        <Btn variant="secondary" onClick={onClose} disabled={busy}>
          {allowed ? '返回使用' : '稍后激活'}
        </Btn>
      }
    >
      <div data-testid="card-redeem-prompt" data-product={product}>
        <p className="text-sm text-[var(--text-2)]">
          {cardProductName(product, rights)} · {cardTerm(target)}
        </p>
        {/* 最近一次读取授权失败（断网等）时给一句网络提示；正常连接时不渲染 */}
        <CardRefreshFailed className="mt-2" />
        <CardOfflineNotice className="mt-2" />
        {!isPlatform ? (
          <p className="mt-2 text-xs leading-5 text-[var(--text-3)]">娱乐助手 · {cardTerm(platform)}。使用游戏 Mod 需要娱乐助手和该 Mod 都在有效期内。</p>
        ) : null}
        {allowed ? (
          <p className="mt-4 text-sm text-[var(--ok)]" role="status">
            授权已生效，请再次点击原功能按钮。
          </p>
        ) : (
          <div className="mt-5">
            <CardRedeemForm autoFocus label="激活" />
            <p className="mt-3 text-xs leading-5 text-[var(--text-4)]">配置和预览不需要授权；只有开启、播放、执行等实际使用时才要激活。输入对应产品的卡密即可。</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 设置页「账号与卡密授权」区（直播间绑定部分仍由 Settings 自己渲染） */
export function CardAccountAccess() {
  const { rights, loaded, user, free } = useCardAccess()
  const authUser = useAuth((s) => s.user)
  const email = user?.email || authUser?.email || ''
  // 免检：只显示账号邮箱，没有授权列表 / 激活表单
  if (free) {
    return email ? (
      <div className="flex items-center gap-2 text-sm" data-testid="account-free">
        <Mail size={14} className="text-[var(--text-3)]" />
        <span className="select-text text-[var(--text-2)]">{email}</span>
      </div>
    ) : null
  }
  return (
    <div className="space-y-3" data-testid="account-card-access">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {email ? (
          <span className="inline-flex items-center gap-2 text-sm">
            <Mail size={14} className="text-[var(--text-3)]" />
            <span className="select-text text-[var(--text-2)]">{email}</span>
          </span>
        ) : (
          <span className="text-sm text-[var(--text-3)]">当前是本地账号，卡密授权需要邮箱账号登录</span>
        )}
        <CardRefreshFailed />
        <CardOfflineNotice />
      </div>
      {loaded ? <CardRightsList rights={rights} compact /> : <p className="text-xs text-[var(--text-3)]">正在读取授权…</p>}
      <CardRedeemForm />
      <p className="text-xs leading-5 text-[var(--text-4)]">授权跟随当前账号，激活后立即生效，到期会自动更新。</p>
    </div>
  )
}

/** Mod 详情右栏：授权状态、期限、激活入口。安装 / 更新 / 卸载按钮仍由 ModDetail 自己渲染。 */
export function ModCardAccess({ gameId }: { gameId: string }) {
  const { enabled, free, right, platform, loaded } = useCardAccess()
  const openPrompt = useCardStore((s) => s.openPrompt)
  if (!enabled || free || !gameId) return null
  const product = cardGameProduct(gameId)
  const target = right(product)
  const allowed = cardRightValid(target) && cardRightValid(platform)
  return (
    <div className="mb-3 space-y-2" data-testid="mod-card-access">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-3)]">授权状态</span>
        <Pill tone={allowed ? 'ok' : 'muted'} dot>
          {loaded ? (allowed ? '已激活' : '未激活') : '读取中…'}
        </Pill>
      </div>
      <div className="space-y-1 text-xs text-[var(--text-3)]" data-testid="mod-card-expiry">
        <p>Mod · {cardTerm(target)}</p>
        <p>娱乐助手 · {cardTerm(platform)}</p>
      </div>
      {!allowed ? (
        <Btn className="w-full" variant="secondary" onClick={() => openPrompt(product)}>
          <KeyRound size={14} />
          激活卡密
        </Btn>
      ) : null}
    </div>
  )
}

/** 娱乐助手顶部状态条：未激活也能浏览和配置，真正使用时由主进程门禁拦截并弹激活 */
export function EntertainmentCardBar() {
  const { enabled, free, platform, loaded } = useCardAccess()
  const openPrompt = useCardStore((s) => s.openPrompt)
  if (!enabled || free) return null
  const valid = cardRightValid(platform)
  return (
    <div
      data-testid="entertainment-card-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--line)] bg-[var(--bg-side)] px-6 py-2 text-xs"
    >
      <span className="inline-flex items-center gap-2 text-[var(--text-2)]">
        <KeyRound size={13} className="text-[var(--text-3)]" />
        娱乐助手 · {loaded ? cardTerm(platform) : '正在读取授权…'}
      </span>
      {loaded && !valid ? (
        <>
          <span className="text-[var(--text-3)]">可以先配置和预览，开启或播放前需要激活。</span>
          <Btn size="sm" variant="ghost" onClick={() => openPrompt(CARD_PLATFORM_PRODUCT)} className="ml-auto">
            <KeyRound size={13} />
            激活卡密
          </Btn>
        </>
      ) : null}
    </div>
  )
}

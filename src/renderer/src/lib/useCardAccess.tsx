import { useEffect } from 'react'
import { create } from 'zustand'
import type { CardRight, CardSnapshot } from '@shared/types'
import { clearAuthCache } from './gameAuthCache'

// 卡密平台授权（正式版）：主进程在本机配置了卡密平台时 enabled=true，页面才切到卡密界面；
// 没配置一律保持原来的邮箱授权 / 直播间申请界面，已发布用户看不到任何变化。
// 快照全局只轮询一份（CardAccessHost 挂在 App），各页面共用，不各自起定时器。

export const CARD_PLATFORM_PRODUCT = 'platform:assistant'
export const cardGameProduct = (gameId: string) => 'game:' + gameId

const PRODUCT_NAMES: Record<string, string> = {
  [CARD_PLATFORM_PRODUCT]: '娱乐助手',
  'game:librarian': '图书管理员 Mod',
  'game:dontscream': "DON'T SCREAM Mod",
  'game:4wheel-challenge': '轮椅模拟器 Mod'
}

export function cardProductName(product: string, rights?: CardRight[]): string {
  return rights?.find((r) => r.id === product)?.name || PRODUCT_NAMES[product] || product
}

/** 剩余时长：≥1 天「N 天 N 小时」，不足 1 天「N 小时 N 分」，不足 1 小时「N 分钟」 */
export function cardRemaining(expiresAt: number, now = Date.now() / 1000): string {
  const left = Math.max(0, Math.floor(expiresAt - now))
  const days = Math.floor(left / 86400)
  const hours = Math.floor((left % 86400) / 3600)
  const minutes = Math.floor((left % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${Math.max(1, minutes)} 分钟`
}

export function cardExpiryText(expiresAt: number): string {
  return new Date(expiresAt * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

/** 权益是否当前可用：服务判定 allowed，且永久或未到期 */
export function cardRightValid(right?: CardRight | null): boolean {
  if (!right || !right.allowed) return false
  return right.permanent || (right.expires_at || 0) > Date.now() / 1000
}

/** 权益一句话：未激活 / 已收回 / 永久 / 到期时间 + 剩余 / 已到期。以服务返回的状态为准。 */
export function cardTerm(right?: CardRight | null): string {
  if (!right || right.status === 'missing') return '未激活'
  if (right.status === 'revoked') return '已收回'
  if (right.status === 'disabled' || right.status === 'banned') return '已停用'
  if (right.permanent) return right.allowed ? '永久' : '未激活'
  if (!right.expires_at) return right.allowed ? '已激活' : '未激活'
  if (right.status === 'expired' || right.expires_at <= Date.now() / 1000) return '已到期：' + cardExpiryText(right.expires_at) + '（北京时间）'
  return '到期时间：' + cardExpiryText(right.expires_at) + '（北京时间）· 剩余 ' + cardRemaining(right.expires_at)
}

/** 底层 / 技术性错误文本（英文堆栈、地址、错误码）：不能原样给主播看 */
const TECHNICAL_RE = /https?:\/\/|\d+\.\d+\.\d+\.\d+|localhost:\d+|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|TypeError|Error:|\bat \w+ \(/i
const CJK_RE = /[一-鿿]/

/** 读取 / 刷新授权失败时给主播的一句话：只说能做什么，不带服务地址、不带底层原文 */
export function cardRefreshHint(error?: string): string {
  const text = (error || '').trim()
  if (/登录|login|会话|session|401/i.test(text) && !TECHNICAL_RE.test(text)) return '登录状态已失效，请重新登录后再试'
  return '暂时无法刷新授权，请检查网络后重试'
}

/** 卡密输入被拒时给主播的原因 + 怎么重试；真实业务原因（无效 / 已使用 / 作废 / 到期）保留，底层错误只给可执行的短提示 */
export function cardRedeemHint(error: string): string {
  const text = (error || '').trim()
  if (!text) return '激活失败，请检查卡密后重试'
  if (/连接|网络|超时|timeout/i.test(text) || TECHNICAL_RE.test(text)) return '暂时无法激活，请检查网络后重试'
  if (/已(被)?使用|已兑换|used|redeemed/i.test(text)) return text + '。每张卡密只能激活一次，请换一张卡密'
  if (/不存在|无效|invalid|not found|格式/i.test(text)) return text + '。请核对卡密是否完整，不要带空格，重新复制后再试'
  if (/作废|已封|停用|revoked|disabled/i.test(text)) return text + '。这张卡密不能再使用，请换一张卡密'
  if (/过期|到期|expired/i.test(text)) return text + '。请换一张未过期的卡密'
  if (/登录|login|会话|session/i.test(text)) return text + '。请重新登录后再激活'
  // 既不是已知业务原因、又不是中文：多半是底层原文，不原样展示
  if (!CJK_RE.test(text)) return '激活失败，请稍后重试'
  return text + '。请检查后重试'
}

interface CardStore {
  snapshot: CardSnapshot | null
  /** 第一次 cardState 已返回（不论成功与否） */
  loaded: boolean
  /** 主进程门禁要求激活的产品；Settings/Mod 详情主动打开时也走这里，全局只弹一个 */
  prompt: string
  busy: boolean
  refresh: () => Promise<CardSnapshot | null>
  redeem: (code: string) => Promise<{ ok: boolean; error?: string }>
  openPrompt: (product: string) => void
  closePrompt: () => void
}

let reading: Promise<CardSnapshot | null> | null = null
let lastRights = ''
// 激活期间不让轮询的旧结果覆盖新结果
let sequence = 0

function commit(set: (patch: Partial<CardStore>) => void, result: CardSnapshot) {
  const next = JSON.stringify(result.rights ?? null)
  if (next !== lastRights) {
    lastRights = next
    // 旧的游戏授权缓存（参数页 / 遥控页门禁）跟着权益变化重新读
    clearAuthCache()
  }
  set({ snapshot: result, loaded: true })
}

export const useCardStore = create<CardStore>((set, get) => ({
  snapshot: null,
  loaded: false,
  prompt: '',
  busy: false,
  refresh: async () => {
    if (reading) return reading
    const ticket = ++sequence
    reading = (async () => {
      try {
        if (typeof window.api?.cardState !== 'function') {
          set({ snapshot: { ok: true, enabled: false }, loaded: true })
          return null
        }
        const result = await window.api.cardState()
        if (ticket !== sequence) return result
        commit(set, result)
        return result
      } catch (error) {
        if (ticket !== sequence) return null
        const prev = get().snapshot
        set({
          snapshot: { ok: false, enabled: prev?.enabled ?? false, user: prev?.user, rights: prev?.rights, error: error instanceof Error ? error.message : '暂时无法读取授权' },
          loaded: true
        })
        return null
      } finally {
        reading = null
      }
    })()
    return reading
  },
  redeem: async (code) => {
    const trimmed = code.trim()
    if (!trimmed) return { ok: false, error: '请输入卡密' }
    if (get().busy) return { ok: false, error: '正在激活，请稍候' }
    set({ busy: true })
    const ticket = ++sequence
    try {
      const result = await window.api.cardRedeem(trimmed)
      if (ticket === sequence) {
        if (result.ok) commit(set, result)
        else if (result.rights || result.user) commit(set, { ...result, ok: true })
      }
      return result.ok ? { ok: true } : { ok: false, error: cardRedeemHint(result.error || '') }
    } catch (error) {
      return { ok: false, error: cardRedeemHint(error instanceof Error ? error.message : '') }
    } finally {
      set({ busy: false })
    }
  },
  openPrompt: (product) => set({ prompt: product }),
  closePrompt: () => set({ prompt: '' })
}))

/** 读取共享快照；enabled=false 时各页面走原界面 */
export function useCardAccess() {
  const snapshot = useCardStore((s) => s.snapshot)
  const loaded = useCardStore((s) => s.loaded)
  const enabled = !!snapshot?.enabled
  const rights = snapshot?.rights ?? []
  const right = (product: string) => rights.find((r) => r.id === product)
  const platform = right(CARD_PLATFORM_PRODUCT)
  return {
    snapshot,
    loaded,
    enabled,
    /** 免检（license-policy enforce=false）：卡密系统整体停用，所有卡密界面（顶栏入口 / 激活表单 / 授权状态 / 提示）一律不渲染 */
    free: enabled && snapshot?.free === true,
    /** 最近一次读取授权是否成功；失败时页面只给「暂时无法刷新授权」一类短提示，不展示服务地址或底层原文 */
    connected: enabled && snapshot?.ok !== false,
    rights,
    right,
    platform,
    platformValid: cardRightValid(platform),
    /** 游戏 Mod 需要娱乐助手 + 该游戏两项都有效 */
    gameValid: (gameId: string) => cardRightValid(platform) && cardRightValid(right(cardGameProduct(gameId))),
    user: snapshot?.user
  }
}

/**
 * 只在登录前的页面用：读一次卡密模式开关与平台元信息。登录页不显示任何连接状态 / 服务地址，
 * 这里也不把 origin / error 交给页面。
 *   - requiresCode：注册 / 找回密码要不要邮箱验证码。平台没说清楚（元信息读不到）时按「需要」——正式平台复用原邮箱身份，
 *     不能因为一次读取失败就把「本机模式不发验证码」那套表单放到线上；
 *   - legacyHold：安装包带了默认平台配置，但本机只有旧版本地账号，暂时仍走旧账号系统，登录页给一个明确的切换入口。
 */
export function useCardModeProbe() {
  const refresh = useCardStore((s) => s.refresh)
  const snapshot = useCardStore((s) => s.snapshot)
  const loaded = useCardStore((s) => s.loaded)
  useEffect(() => {
    void refresh()
  }, [refresh])
  const enabled = !!snapshot?.enabled
  return {
    loaded,
    enabled,
    identityMode: snapshot?.identityMode,
    requiresCode: enabled ? snapshot?.registrationRequiresCode !== false : true,
    legacyHold: !enabled && snapshot?.legacyHold === 'local-accounts' && snapshot?.defaultAvailable === true,
    refresh
  }
}

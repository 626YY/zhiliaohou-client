// 卡密模式下的「辅助能力」出口：通知中心 / 云配置备份恢复 / 在线心跳 / 观众记录上报。
//   这些能力本身还在原邮箱服务上；卡密模式不再直连旧服务器，而是让卡密平台用「登录时旧身份服务已验证过、
//   只加密存在平台服务端」的旧会话代为调用（POST /api/v1/compat/<operation>，见 license-connection.ts compat()）。
//   本模块只做三件事：
//     1. 核对调用方给的邮箱就是当前卡密账号（邮箱不符直接拒绝，不发请求；服务端也只按登录账号取邮箱）；
//     2. 把平台的拒绝翻译成旧接口风格的 {ok:0,error,code}，让 email-api 里原有的结果归一化代码原样可用；
//     3. 旧会话失效（identity_relogin）/ 平台未接入（identity_not_linked）时按「授权纪元」记一次，
//        同一次登录内不再反复请求（退出重登、换号后纪元变化自动恢复）。绝不拿记住的密码去重登、不动卡密授权、不关输出。
//   card-auth.ts 用动态 import：email-api → 本模块 → card-auth → connector → … → email-api 会成环。
import { cardModeEnabled } from './card-provider'
import { cardEpoch } from './card-epoch'
import { PlatformError, type CompatOperation } from './license-connection'
import { logLine } from './crash-log'

export const COMPAT_RELOGIN_MESSAGE = '原邮箱账号登录状态已失效：通知、云配置和观众记录上传已暂停，退出后重新登录即可恢复（卡密授权不受影响）'
export const COMPAT_NOT_LINKED_MESSAGE = '当前卡密平台未接入原邮箱服务，通知 / 云配置 / 观众记录不可用'
const PAUSE_CODES = new Set(['identity_relogin', 'identity_not_linked'])

let paused: { epoch: number; code: string; error: string } | null = null

/** 当前登录内辅助能力是否已暂停（旧会话失效 / 未接入）；给界面或日志判断用。 */
export function compatPaused(): { code: string; error: string } | null {
  if (paused && paused.epoch === cardEpoch()) return { code: paused.code, error: paused.error }
  return null
}

/**
 * 以旧接口风格返回：成功 → 旧接口原样应答（ok:1 …）；失败 → {ok:0,error,code}。
 * 永远不返回 null（null 在 email-api 里意味着「无法连接服务器」这一种文案）。
 */
export async function compatLegacy(operation: CompatOperation, payload: Record<string, unknown>, expectEmail: string): Promise<Record<string, unknown>> {
  if (!cardModeEnabled()) return { ok: 0, error: '本机未启用卡密平台', code: 'card_disabled' }
  const wanted = String(expectEmail ?? '').trim().toLowerCase()
  let cardAuth: typeof import('./card-auth')
  try {
    cardAuth = await import('./card-auth')
  } catch {
    return { ok: 0, error: '卡密账号模块未加载', code: 'card_unavailable' }
  }
  const session = cardAuth.cardSession()
  if (!session) return { ok: 0, error: '未登录', code: 'not_logged_in' }
  if (!wanted || session.email?.toLowerCase() !== wanted) return { ok: 0, error: '请使用当前登录账号', code: 'email_mismatch' }
  const pause = compatPaused()
  if (pause) return { ok: 0, error: pause.error, code: pause.code }
  const epoch = cardEpoch()
  try {
    const result = await cardAuth.cardConnection().compat(operation, payload)
    if (cardEpoch() !== epoch || cardAuth.cardSession()?.email?.toLowerCase() !== wanted) return { ok: 0, error: '登录状态已变化', code: 'session_changed' }
    return result
  } catch (error) {
    const code = error instanceof PlatformError ? error.code : ''
    let message = error instanceof Error && error.message ? error.message : '辅助服务请求失败'
    if (code === 'identity_relogin') message = COMPAT_RELOGIN_MESSAGE
    else if (code === 'identity_not_linked') message = COMPAT_NOT_LINKED_MESSAGE
    else if (code === 'identity_unavailable') message = '原邮箱服务暂时连不上，稍后自动重试'
    if (PAUSE_CODES.has(code) && cardEpoch() === epoch) {
      paused = { epoch, code, error: message }
      logLine('card', `辅助转发已暂停（${operation}）：${code}`)
    }
    return { ok: 0, error: message, code: code || 'compat_failed' }
  }
}

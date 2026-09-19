// 「当前登录的是谁」——两套账号系统的统一入口：
//   卡密模式（license-provider.json 存在）看卡密账号层 card-auth.cardSession()，否则看旧账号系统 auth.session()。
// 通知轮询 / 在线心跳 / 观众记录上传只关心邮箱是谁、有没有登录，不该各自分路判断。
import { cardModeEnabled } from './card-provider'
import { session as legacySession } from './auth'
import { cardSession } from './card-auth'
import type { SessionUser } from '@shared/types'

export function currentAccount(): SessionUser | null {
  return cardModeEnabled() ? cardSession() : legacySession()
}

/** 当前登录账号的邮箱（小写）；没登录 / 不是邮箱账号 → ''。 */
export function currentAccountEmail(): string {
  return currentAccount()?.email?.trim().toLowerCase() ?? ''
}

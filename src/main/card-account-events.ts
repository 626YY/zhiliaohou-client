// 卡密账号变化的广播（登录 / 找回密码成功 / 退出 / 授权被拒）：通知轮询、在线心跳、观众记录上传据此立刻跑一次，
// 不用等下一个定时周期。单独一个无依赖的小模块：card-auth.ts 发、notifications / heartbeat / live-report 收，
// 反过来 card-auth 不能 import 它们（会成环）。
type Listener = () => void
const listeners = new Set<Listener>()

export function onCardAccountChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emitCardAccountChange(): void {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch {
      /* 某个监听者出错不影响其它 */
    }
  }
}

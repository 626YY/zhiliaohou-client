import { AsyncLocalStorage } from 'node:async_hooks'

// 通用动作命令与直接抽奖联动共用调用链；异步任务完成后不把旧上下文留给定时器。
type Scope = { tools: readonly string[]; active: boolean }
const chain = new AsyncLocalStorage<Scope>()

export function currentToolChain(): string[] { const scope = chain.getStore(); return scope?.active ? [...scope.tools] : [] }
export function runWithToolChain<T>(tools: readonly string[], action: () => Promise<T>): Promise<T> {
  const scope: Scope = { tools, active: true }
  return chain.run(scope, async () => { try { return await action() } finally { scope.active = false } })
}

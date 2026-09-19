// 验证实际中奖 adapter -> livePrank -> send；仅游戏状态/桥路径替身，写入独立临时桥文件。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'output', 'lottery-bridge-review')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'session-'))
const dirs = Object.fromEntries(['librarian', '4wheel-challenge'].map(game => {
  const dir = path.join(profile, game)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'bridge.txt'), '')
  fs.writeFileSync(path.join(dir, 'hb.json'), JSON.stringify({ ts: Date.now() / 1000, in: 1, ready: 1 }))
  return [game, dir]
}))
const fixture = { gameId: 'librarian', query: async () => ({ running: true }), dir: () => dirs[fixture.gameId] }
const ipc = fs.readFileSync(path.join(root, 'src/main/ipc.ts'), 'utf8')
// ipc.ts 2026-09 起抽奖适配器是 const executePrizeAction = async (item, …)，随后 setLotteryActionHandler(executePrizeAction)
const start = ipc.indexOf('  const executePrizeAction = async (item')
const end = ipc.indexOf('  setTimeBlindBoxActionHandler(', start)   // 紧跟 setLotteryActionHandler(executePrizeAction) 之后
assert.ok(start >= 0 && end > start, 'actual lottery adapter must be found')
const entry = `const {liveState,livePrank}=globalThis.live;
const currentGameId=()=>globalThis.fixture.gameId;
const setLotteryActionHandler=fn=>{globalThis.action=fn};
${ipc.slice(start, end)}`
const nativeRequire = createRequire(import.meta.url)
const liveModule = { exports: {} }
const context = vm.createContext({ fixture, console, exports: liveModule.exports, module: liveModule, require: name => {
  if (name === './game-launcher') return { queryGameState: () => fixture.query() }
  if (name === './bridge') return { wheelLiveDir: () => fixture.dir(), bridgePath: () => path.join(fixture.dir(), 'bridge.txt') }
  // live-api.ts 2026-09 起多了卡密模式判断：桩里关掉卡密模式，走原始桥路径
  if (name === './card-provider') return { cardModeEnabled: () => false }
  if (name === './card-epoch') return { cardEpoch: () => 0 }
  if (name === './games') return { currentGameId: () => fixture.gameId }
  return nativeRequire(name)
} })
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
} }).outputText
vm.runInContext(compile(fs.readFileSync(path.join(root, 'src/main/live-api.ts'), 'utf8')), context)
context.live = liveModule.exports
vm.runInContext(compile(entry), context)
const readBridge = game => fs.readFileSync(path.join(dirs[game], 'bridge.txt'), 'utf8')
const reset = () => {
  fixture.gameId = 'librarian'
  fixture.query = async () => ({ running: true })
  for (const dir of Object.values(dirs)) fs.writeFileSync(path.join(dir, 'bridge.txt'), '')
}
const item = { name: '测试整蛊', action: 'prank', actionParam: 'librarian|test_only' }
const checks = []
const pass = name => { checks.push(name); console.log('PASS ' + name) }

for (const mode of ['close', 'switch']) {
  reset()
  let active = true, resolveSend, enteredSend, calls = 0
  const entered = new Promise(resolve => { enteredSend = resolve })
  const deferred = new Promise(resolve => { resolveSend = resolve })
  fixture.query = () => {
    calls++
    if (calls === 1) return Promise.resolve({ running: true }) // adapter 的 liveState
    enteredSend()
    return deferred // 实际 send 内部的第二次查询
  }
  const pending = context.action(item, () => active)
  await entered
  if (mode === 'close') active = false
  else fixture.gameId = '4wheel-challenge'
  resolveSend({ running: true })
  const reply = await pending
  assert.equal(reply.ok, false)
  assert.equal(calls, 2)
  assert.equal(readBridge('librarian'), '')
  assert.equal(readBridge('4wheel-challenge'), '')
  pass(mode === 'close' ? '最终 send 等待期间取消开奖，两份桥均无旧命令' : '最终 send 等待期间切换游戏，两份桥均无旧命令')
}

reset()
assert.equal((await context.action(item, () => true)).ok, true)
assert.equal(readBridge('librarian'), 'prank test_only\n')
assert.equal(readBridge('4wheel-challenge'), '')
pass('有效开奖通过实际 adapter/send 只向绑定临时桥写入一次')

reset()
let queried = 0
fixture.query = async () => { queried++; return { running: true } }
assert.equal((await context.live.livePrank('already_cancelled', () => false)).ok, false)
assert.equal(queried, 0)
assert.equal(readBridge('librarian'), '')
pass('已取消的 send 不查询游戏、不写桥')

reset()
assert.equal((await context.live.livePrank('legacy_call')).ok, true)
assert.equal((await context.live.liveCmd('legacy command')).ok, true)
assert.equal((await context.live.liveSet('LegacyField', 7)).ok, true)
assert.equal(readBridge('librarian'), 'prank legacy_call\nlegacy command\ncfgset LegacyField 7\n')
pass('未传取消守卫的既有 livePrank/liveCmd/liveSet 行为保留')

console.log(`Lottery bridge cancellation: ${checks.length}/${checks.length} PASS`)
console.log('Only temporary fixture bridges were written: ' + profile)
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, profile, gameStateMocked: true, realGameTouched: false }, null, 2))

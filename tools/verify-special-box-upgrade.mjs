// 特色整蛊盲盒升级回归：老配置升级到新的默认事件库（照时间盲盒那排数、带配音）。
//   A. 0.3.64 的老配置（事件库 = 每个玩法一个随机数量的默认事件）：
//      1. 事件库补上新默认事件（老的留着、顺序不动），只补一次（重启不重复）
//      2. 礼物奖池还是当初默认全选的 → 新事件也勾上；自己挑过的奖池不动；「事件库全部」(*) 本来就跟着走
//   B. 装过第一包测试版的（事件库第 2 版、标记 boxEventsV2）、还自己删过一个默认事件：
//      只补第 3 版新出的（加减照时间盲盒配满）；删掉的不加回来；默认全选的奖池补勾新的
// 隐藏的独立客户端实例、独立 userData，不碰正式配置，不抢前台，静音。
// 用法：npx electron-vite build && node tools/verify-special-box-upgrade.mjs [--out=out]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg ? outArg.slice(6) : 'out'
const output = path.join(root, 'output', 'playwright', 'special-box-upgrade')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const bundle = path.join(output, 'shared.cjs')
await build({ stdin: { contents: `export {defaultSpecialBoxEvents, SPECIAL_BOX_DEFAULTS_LEVEL} from './src/shared/specialGames';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
const { defaultSpecialBoxEvents, SPECIAL_BOX_DEFAULTS_LEVEL } = createRequire(import.meta.url)(bundle)

// 0.3.64 的默认事件（每个玩法一个，默认操作 + 随机数量）
const GAMES = [
  ['chain_challenge', 'add', '1~5'], ['catch_duck', 'add', '5~15'], ['throw_poop', 'add', '5~15'], ['throw_trash', 'add', '5~15'],
  ['catch_bullet', 'add', '5~20'], ['caterpillar', 'add', '3~8'], ['xiaoxin_hey', 'add', '2~5'], ['fan_call', 'show', '1'],
  ['fan_video_call', 'show', '1'], ['talisman_seal', 'add', '2~6'], ['mosquito', 'add', '8~25'], ['big_mosquito', 'add', '2~5'],
  ['gesture_fly', 'add', '2~6'], ['fruit_slice', 'add', '4~10'], ['coin_bump', 'add', '5~15'], ['leaf_pickup', 'add', '5~20'], ['music_ball', 'start', '']
]
const legacyEvents = GAMES.map(([id, op, n]) => ({ id: `sbe-default-${id}`, name: '', param: n ? `${id}|${op}|${n}` : `${id}|${op}`, enabled: true, weight: 1, prank: '' }))
const legacyIds = legacyEvents.map((e) => e.id)
const all = defaultSpecialBoxEvents()
const v3New = defaultSpecialBoxEvents(2)
const v3NewIds = new Set(v3New.map((e) => e.id))
const v2Events = all.filter((e) => !v3NewIds.has(e.id))
const rule = (id, gift, param) => ({ id, name: `盲盒·${gift}`, group: '', giftName: gift, triggerType: 'gift', actionType: 'command', commandCmd: 'special-box', commandParam: param, times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }

async function profile(store, rules) {
  const dir = await fs.mkdtemp(path.join(output, 'userdata-'))
  await fs.mkdir(path.join(dir, 'data'), { recursive: true })
  await fs.writeFile(path.join(dir, 'data', 'special-gameplay.json'), JSON.stringify(store))
  await fs.writeFile(path.join(dir, 'data', 'entertainment_rules.json'), JSON.stringify(rules))
  return {
    dir,
    store: async () => JSON.parse(await fs.readFile(path.join(dir, 'data', 'special-gameplay.json'), 'utf8')),
    rules: async () => JSON.parse(await fs.readFile(path.join(dir, 'data', 'entertainment_rules.json'), 'utf8'))
  }
}

// first = 第一次启动这个测试目录（游戏路径隔离只准备一次，启动器不许重复准备）
async function boot(p, first = true) {
  const entry = await writeHiddenElectronBootstrap(root, p.dir, { outDir, isolateGames: first })
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [entry, `--user-data-dir=${p.dir}`, '--no-sandbox', '--mute-audio'],
    cwd: root,
    env,
    timeout: 40_000
  })
  await app.firstWindow()
  // 启动整理是异步的：等到版本标记落盘
  for (let i = 0; i < 100; i++) {
    const s = await p.store().catch(() => null)
    if (s?.boxDefaults >= SPECIAL_BOX_DEFAULTS_LEVEL) break
    await sleep(200)
  }
  await sleep(500)
  return app
}

let app
try {
  // ===== A. 0.3.64 老配置 =====
  const a = await profile(
    { games: {}, window: { autoOpen: true, background: 'green', width: 1280, height: 720 }, boxEvents: legacyEvents, legacyMigrated: true, chainSkinV2: true },
    [
      rule('r-all-default', '亲吻', `${legacyIds.join(',')}|特色盲盒`),
      rule('r-custom', '玫瑰', 'sbe-default-catch_duck,sbe-default-chain_challenge|我的盲盒'),
      rule('r-star', '小心心', '*|全部随机')
    ]
  )
  app = await boot(a)
  const s1 = await a.store()
  assert.equal(s1.boxDefaults, SPECIAL_BOX_DEFAULTS_LEVEL, '升级标记没落盘')
  const ids1 = s1.boxEvents.map((e) => e.id)
  assert.deepEqual(ids1.slice(0, 17), legacyIds, '老事件应原样留在前面')
  const fresh = ids1.slice(17)
  assert.deepEqual(new Set(fresh), new Set(all.map((e) => e.id)), `新默认事件没补全：${fresh.length}/${all.length}`)
  assert.equal(new Set(ids1).size, ids1.length, '事件 id 重复了')
  ok(`A 事件库：老的 17 个留着，补上 ${fresh.length} 个新默认事件（共 ${ids1.length} 个）`)
  const r1 = await a.rules()
  const pool = (rules, id) => rules.find((r) => r.id === id).commandParam
  const [allHead, allName] = pool(r1, 'r-all-default').split('|')
  assert.equal(allName, '特色盲盒')
  const allIds = allHead.split(',')
  assert.deepEqual(allIds.slice(0, 17), legacyIds, '老勾选应保留原顺序')
  assert.deepEqual(allIds.slice(17), fresh, '默认全选的奖池应把新事件都勾上')
  assert.equal(pool(r1, 'r-custom'), 'sbe-default-catch_duck,sbe-default-chain_challenge|我的盲盒', '自己挑过的奖池不该动')
  assert.equal(pool(r1, 'r-star'), '*|全部随机', '「事件库全部」不该被改写')
  ok(`A 奖池：默认全选的「亲吻」补勾到 ${allIds.length} 个；自己挑过的「玫瑰」、全部随机的「小心心」不动`)
  await app.close()
  app = await boot(a, false)
  assert.equal((await a.store()).boxEvents.length, ids1.length, '重启后事件库不该再补')
  assert.equal(pool(await a.rules(), 'r-all-default'), pool(r1, 'r-all-default'), '重启后奖池不该再改')
  ok('A 重启一次：事件库、奖池都不再变（只补一次）')
  await app.close()
  app = undefined

  // ===== B. 第一包测试版（第 2 版事件库），自己删过「锁链 +1」 =====
  const deleted = 'sbe-v-chain_challenge-add-1'
  const libB = [...legacyEvents, ...v2Events.filter((e) => e.id !== deleted)]
  const idsB = libB.map((e) => e.id)
  const b = await profile(
    { games: {}, window: { autoOpen: true, background: 'green', width: 1280, height: 720 }, boxEvents: libB, legacyMigrated: true, chainSkinV2: true, boxEventsV2: true },
    [
      rule('r-full', '亲吻', `${idsB.join(',')}|特色盲盒`),
      rule('r-pick', '玫瑰', 'sbe-v-catch_duck-add-5,sbe-v-chain_challenge-add-5|我的盲盒')
    ]
  )
  app = await boot(b)
  const sB = await b.store()
  const libAfter = sB.boxEvents.map((e) => e.id)
  assert.deepEqual(libAfter.slice(0, idsB.length), idsB, '原有事件应原样留在前面')
  const added = libAfter.slice(idsB.length)
  assert.deepEqual(new Set(added), new Set([...v3NewIds].filter((id) => id !== deleted)), `应只补第 3 版新出的：补了 ${added.length} 个`)
  assert.ok(!libAfter.includes(deleted), '自己删掉的默认事件不该加回来')
  ok(`B 事件库：第 2 版的 ${idsB.length} 个留着，只补第 3 版新出的 ${added.length} 个；自己删掉的「锁链 +1」没加回来`)
  const rB = await b.rules()
  const fullIds = pool(rB, 'r-full').split('|')[0].split(',')
  assert.deepEqual(fullIds, [...idsB, ...added], '默认全选的奖池应补勾第 3 版新事件')
  assert.equal(pool(rB, 'r-pick'), 'sbe-v-catch_duck-add-5,sbe-v-chain_challenge-add-5|我的盲盒', '自己挑过的奖池不该动')
  ok(`B 奖池：全选的「亲吻」补勾到 ${fullIds.length} 个；自己挑过的「玫瑰」不动`)
  console.log(`\nSPECIAL BOX UPGRADE: ${passed} PASS`)
} catch (e) {
  console.error('FAIL', e.message)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
}

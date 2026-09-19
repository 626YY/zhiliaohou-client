#!/usr/bin/env node
/**
 * tools/obs-smoke.mjs —— OBS 模块冒烟测试（纯 Node，不需要 Electron，不碰用户真实 OBS 配置）
 *
 * 用法：node tools/obs-smoke.mjs [--keep] [--real]
 *   1. 用项目自带的 tsc 把 src/main/obs-ws-core.ts + obs-local.ts 编成 CommonJS 到临时目录（--keep 保留产物）
 *   2. 起 tools/obs-mock-server.mjs（随机端口），对客户端做断言：
 *      握手 / 正确密码 Identified / 错密码「OBS 密码错误」/ 免鉴权 / GetVersion / 场景列表 / 滤镜汇总（坏源跳过）/
 *      toggle 返回值 / 事件派发 / 请求超时 / 未知请求 / 126、127 长度大帧收发 / 分片拼包 / ping-pong /
 *      被动断线 / 主动断开 close 1000 / 连接被拒绝 / Accept 校验失败 / HTTP 400 / 握手无响应超时
 *   3. Windows 上顺带跑 obs-local：注册表、进程、真实配置与场景集合只读；enableObsWebSocket 只写临时目录
 *   4. 真实 OBS：只有本机 obs-websocket 已启用且 OBS 正在运行才连一次；--real 时 OBS 没开也会 launchObs、测完 taskkill
 * 环境变量 OBS_SMOKE_OUT 可指定编译输出目录。退出码：全部 PASS 为 0，否则 1。
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockObs } from './obs-mock-server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const real = process.argv.includes('--real')
const outDir = process.env.OBS_SMOKE_OUT || path.join(os.tmpdir(), `zhiliao-obs-smoke-${process.pid}`)
const HOST = '127.0.0.1'

// ---------- 极简断言 ----------
const results = []
function check(name, cond, detail = '') {
  const ok = !!cond
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
  return ok
}
function section(title) {
  console.log(`\n=== ${title} ===`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, timeoutMs = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true
    await sleep(10)
  }
  return pred()
}
async function rejection(promise) {
  try {
    await promise
    return null
  } catch (e) {
    return e
  }
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
/** 找一个此刻没人监听的端口 */
function closedPort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, HOST, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}
function tcpOpen(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port })
    const done = (v) => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(timeoutMs, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== 结果：${results.length - failed.length}/${results.length} PASS${failed.length ? `，${failed.length} FAIL` : ''} ====`)
  for (const f of failed) console.log(`  FAIL: ${f.name}  ${f.detail}`)
  if (!keep) {
    try {
      fs.rmSync(outDir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  } else {
    console.log(`编译产物保留在 ${outDir}`)
  }
  process.exit(failed.length ? 1 : 0)
}

// ---------- 1. 编译 ----------
section('编译 src/main/obs-ws-core.ts + obs-local.ts → CommonJS')
// 每次从空目录开始：上一轮 --keep 留下的假配置/备份会干扰"首份备份名"之类的断言
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const tscJs = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const tscFlags = [
  '--module', 'commonjs',
  '--target', 'es2020',
  '--moduleResolution', 'node',
  '--esModuleInterop',
  '--strict',
  '--skipLibCheck',
  '--types', 'node',
  '--outDir', outDir,
  path.join(root, 'src', 'main', 'obs-ws-core.ts'),
  path.join(root, 'src', 'main', 'obs-local.ts')
]
const build = fs.existsSync(tscJs)
  ? spawnSync(process.execPath, [tscJs, ...tscFlags], { cwd: root, encoding: 'utf8' })
  : spawnSync('npx', ['tsc', ...tscFlags], { cwd: root, encoding: 'utf8', shell: true })
if (build.status !== 0) {
  console.error(build.stdout || '', build.stderr || '')
  check('tsc 编译', false, `exit ${build.status}`)
  finish()
}
check('tsc 编译', true, outDir)
const require = createRequire(import.meta.url)
const core = require(path.join(outDir, 'obs-ws-core.js'))
const local = require(path.join(outDir, 'obs-local.js'))

// ---------- 2. 假 OBS ----------
section('假 OBS：鉴权与握手')
const PASSWORD = 'zhiliao-测试密码-123'
const mock = await startMockObs({ password: PASSWORD })
console.log(`  假 OBS 在 ws://${HOST}:${mock.port}`)
const events = []
const states = []
const offEvent = core.onObsEvent((type, data) => events.push({ type, data }))
const offState = core.onObsStateChange((s) => states.push(s))

let r = await core.obsConnect({ host: HOST, port: mock.port, password: '错误密码' })
check('错密码 → ok:false', r.ok === false)
check('错密码 → 错误文案「OBS 密码错误」', r.error === 'OBS 密码错误', r.error)
check('错密码 → 假 OBS 记到 1 次鉴权失败（close 4009）', mock.stats.authFailures === 1 && mock.stats.closesSentByServer.includes(4009))
let st = core.obsState()
check('错密码 → state.connected=false 且 error=密码错误', !st.connected && st.error === 'OBS 密码错误', JSON.stringify(st))

r = await core.obsConnect({ host: HOST, port: mock.port, password: '' })
check('空密码但 OBS 要鉴权 → 提示填写密码', !r.ok && /密码/.test(r.error ?? ''), r.error)

r = await core.obsConnect({ host: HOST, port: mock.port, password: PASSWORD })
check('正确密码 → Identified ok:true', r.ok === true, JSON.stringify(r))
check('版本号来自 GetVersion', r.version === '31.0.0-mock', r.version)
st = core.obsState()
check(
  'state: connected/host/port/version/wsVersion/无 error',
  st.connected && st.host === HOST && st.port === mock.port && st.version === '31.0.0-mock' && st.wsVersion === '5.5.0-mock' && st.error === undefined,
  JSON.stringify(st)
)
check('Identify 订阅位 = 默认 173（General|Scenes|Inputs|Filters|SceneItems）', mock.stats.lastEventSubscriptions === 173 && core.DEFAULT_EVENT_SUBSCRIPTIONS === 173, String(mock.stats.lastEventSubscriptions))
check('状态订阅者收到 connected=true', states.some((s) => s.connected === true))
await waitFor(() => mock.stats.pongs.length > 0)
check('服务端 ping → 客户端自动回 pong（同 payload）', mock.stats.pongs[0] === 'mock-ping', JSON.stringify(mock.stats.pongs))

section('请求 / 响应 / 事件')
const v = await core.obsRequest('GetVersion')
check('obsRequest GetVersion', v.obsVersion === '31.0.0-mock' && v.rpcVersion === 1, JSON.stringify(v).slice(0, 80))
let scenes = await core.obsListScenes()
check('obsListScenes 当前场景', scenes.current === '游戏场景', scenes.current)
check('obsListScenes 顺序=界面顺序（响应被拆成 3 个分片帧）', JSON.stringify(scenes.scenes) === JSON.stringify(['游戏场景', '休息场景', '整蛊场景']), JSON.stringify(scenes.scenes))

const filters = await core.obsListFilters()
const expectFilters = [
  { source: '游戏采集', filter: '色度键', kind: 'chroma_key_filter_v2', enabled: true },
  { source: '游戏采集', filter: '颜色校正', kind: 'color_filter_v2', enabled: false },
  { source: '麦克风', filter: '噪声抑制', kind: 'noise_suppress_filter_v2', enabled: true },
  { source: '整蛊场景', filter: '翻转整蛊', kind: 'gpu_delay', enabled: false }
]
check('obsListFilters 汇总 4 条（输入源+场景，坏源报 702 被跳过）', JSON.stringify(filters) === JSON.stringify(expectFilters), JSON.stringify(filters))
check('7 个源（3 输入+3 场景+1 分组）都查过 GetSourceFilterList', mock.stats.requests.filter((t) => t === 'GetSourceFilterList').length === 7, String(mock.stats.requests.filter((t) => t === 'GetSourceFilterList').length))

let t = await core.obsToggleFilter('游戏采集', '色度键')
check('obsToggleFilter 返回翻转后的状态 false', t === false)
check('假 OBS 内部状态已改为 false', mock.world.filters['游戏采集'][0].enabled === false)
t = await core.obsToggleFilter('游戏采集', '色度键')
check('再翻回 true', t === true && mock.world.filters['游戏采集'][0].enabled === true)
await core.obsSetFilterEnabled('麦克风', '噪声抑制', false)
check('obsSetFilterEnabled 生效', mock.world.filters['麦克风'][0].enabled === false)
await waitFor(() => events.filter((e) => e.type === 'SourceFilterEnableStateChanged').length >= 3)
const fe = events.filter((e) => e.type === 'SourceFilterEnableStateChanged')
check('滤镜事件派发 3 次且 eventData 正确', fe.length === 3 && fe[2].data.sourceName === '麦克风' && fe[2].data.filterEnabled === false, JSON.stringify(fe.map((e) => e.data)))
check('lastEventAt 已更新', typeof core.obsState().lastEventAt === 'number' && Date.now() - core.obsState().lastEventAt < 5000)

await core.obsSetScene('整蛊场景')
scenes = await core.obsListScenes()
check('obsSetScene 生效', mock.world.currentScene === '整蛊场景' && scenes.current === '整蛊场景')
await waitFor(() => events.some((e) => e.type === 'CurrentProgramSceneChanged'))
check('场景切换事件', events.some((e) => e.type === 'CurrentProgramSceneChanged' && e.data.sceneName === '整蛊场景'))
let err = await rejection(core.obsSetScene('不存在的场景'))
check('切到不存在的场景 → reject 带 comment 和 code 600', err && /SetCurrentProgramScene/.test(err.message) && /No source was found/.test(err.message) && err.code === 600, err?.message)
err = await rejection(core.obsRequest('NoSuchRequest'))
check('未知请求 → reject（204 + comment）', err && err.code === 204 && /not valid/.test(err.message), err?.message)
err = await rejection(core.obsToggleFilter('游戏采集', '没有这个滤镜'))
check('toggle 不存在的滤镜 → reject 600', err && err.code === 600, err?.message)

section('超时 / 大帧 / 掩码')
const t0 = Date.now()
err = await rejection(core.obsRequest('MockNeverRespond', {}, 300))
const dt = Date.now() - t0
check('请求超时 reject（300ms）', err && /超时/.test(err.message) && dt >= 290 && dt < 2000, `${err?.message}  用时 ${dt}ms`)
const blob1k = 'x'.repeat(1000)
const blob70k = 'y'.repeat(70000)
let echo = await core.obsRequest('MockEcho', { blob: blob1k })
check('发送 126 扩展长度帧（1000B）', echo.length === 1000, JSON.stringify(echo))
echo = await core.obsRequest('MockEcho', { blob: blob70k })
check('发送 127 扩展长度帧（70000B）且服务端解掩码后内容一致', echo.length === 70000 && echo.sha256 === sha256(blob70k), JSON.stringify(echo))
await core.obsRequest('MockBigEvent', { size: 1000 })
await core.obsRequest('MockBigEvent', { size: 70000 })
await waitFor(() => events.filter((e) => e.type === 'MockBig').length >= 2)
const big = events.filter((e) => e.type === 'MockBig')
check('接收 126/127 扩展长度帧', big.length === 2 && big[0].data.blob.length === 1000 && big[1].data.blob.length === 70000, JSON.stringify(big.map((e) => e.data.blob.length)))
check('客户端发出的帧全部带掩码', mock.stats.unmaskedFrames === 0 && mock.stats.framesFromClient > 10, `frames=${mock.stats.framesFromClient} unmasked=${mock.stats.unmaskedFrames}`)

section('断线')
states.length = 0
err = await rejection(core.obsRequest('MockDropConnection', {}, 3000))
check('被动断线：挂起的请求被 reject（文案含「断开」）', err && /断开/.test(err.message), err?.message)
st = core.obsState()
check('被动断线：connected=false 且 error 有文案', !st.connected && /断开/.test(st.error ?? ''), st.error)
check('被动断线：状态订阅者收到 connected=false', states.some((s) => s.connected === false))
err = await rejection(core.obsRequest('GetVersion'))
check('未连接时请求 → 「尚未连接到 OBS」', err && /尚未连接/.test(err.message), err?.message)

r = await core.obsConnect({ host: HOST, port: mock.port, password: PASSWORD })
check('重连成功', r.ok, r.error)
states.length = 0
// 注意：错密码那轮客户端按 RFC 回显了服务端的 close 4009，假 OBS 已经记了一条，这里要等"新增"的那条
const closeCountBefore = mock.stats.closeCodesFromClient.length
core.obsDisconnect()
st = core.obsState()
check('主动断开：同步 connected=false 且无 error', !st.connected && st.error === undefined, JSON.stringify(st))
check('主动断开：状态订阅者收到通知', states.length === 1 && states[0].connected === false)
await waitFor(() => mock.stats.closeCodesFromClient.length > closeCountBefore)
check('主动断开：假 OBS 收到 close 1000', mock.stats.closeCodesFromClient.length > closeCountBefore && mock.stats.closeCodesFromClient[mock.stats.closeCodesFromClient.length - 1] === 1000, JSON.stringify(mock.stats.closeCodesFromClient))
check('错密码时客户端回显了 close 4009（RFC 6455 关闭握手）', mock.stats.closeCodesFromClient[0] === 4009)

section('连接失败的中文翻译')
const dead = await closedPort()
r = await core.obsConnect({ host: HOST, port: dead, password: 'x', timeoutMs: 3000 })
check('端口没人监听 → 「连接被拒绝」文案', !r.ok && /连接被拒绝/.test(r.error ?? ''), r.error)
const badAccept = await startMockObs({ upgradeMode: 'badAccept' })
r = await core.obsConnect({ host: HOST, port: badAccept.port, password: 'x', timeoutMs: 3000 })
check('Sec-WebSocket-Accept 错 → 握手失败', !r.ok && /Accept/.test(r.error ?? ''), r.error)
await badAccept.close()
const rejecting = await startMockObs({ upgradeMode: 'reject' })
r = await core.obsConnect({ host: HOST, port: rejecting.port, password: 'x', timeoutMs: 3000 })
check('HTTP 400 → 握手失败文案', !r.ok && /HTTP 400/.test(r.error ?? ''), r.error)
await rejecting.close()
const noAuth = await startMockObs({ password: '' })
r = await core.obsConnect({ host: HOST, port: noAuth.port, password: '随便填' })
check('免鉴权的 OBS：Hello 无 authentication 也能 Identified', r.ok && noAuth.stats.identified === 1, r.error)
core.obsDisconnect()
await noAuth.close()
const silent = net.createServer(() => {})
await new Promise((res) => silent.listen(0, HOST, res))
r = await core.obsConnect({ host: HOST, port: silent.address().port, password: 'x', timeoutMs: 500 })
check('对方收下 TCP 但不回握手 → 连接超时文案', !r.ok && /超时/.test(r.error ?? ''), r.error)
silent.close()

offEvent()
offState()
await mock.close()

// ---------- 3. obs-local ----------
section('obs-local（Windows 本机；真实配置只读，写入只落临时目录）')
let realCfg = null
if (process.platform !== 'win32') {
  console.log('SKIP  非 Windows')
} else {
  const dir = local.obsInstallDir()
  check('obsInstallDir 找到安装目录', typeof dir === 'string' && fs.existsSync(dir), String(dir))
  const exe = dir ? local.obsExePath(dir) : null
  check('obsExePath 找到 obs64.exe', !!exe && fs.existsSync(exe), String(exe))
  check('obsExePath 对不存在的目录返回 null', local.obsExePath('C:\\definitely-not-here') === null)
  check('launchObs 对无效目录返回 ok:false', local.launchObs('C:\\definitely-not-here').ok === false, local.launchObs('C:\\definitely-not-here').error)
  const running = await local.isObsRunning()
  check('isObsRunning 返回布尔', typeof running === 'boolean', `obs64.exe 运行中=${running}`)
  const liveDir = await local.liveCompanionInstallDir(true)
  const liveRunning = await local.isLiveCompanionRunning()
  const liveRoot = local.liveCompanionConfigRoot()
  check('liveCompanionInstallDir 识别抖音直播伴侣安装目录', !!liveDir && fs.existsSync(liveDir), String(liveDir))
  check('isLiveCompanionRunning 返回布尔', typeof liveRunning === 'boolean', `直播伴侣进程运行中=${liveRunning}`)
  check('直播伴侣已启动时能识别进程', liveRunning === true, `直播伴侣进程运行中=${liveRunning}`)
  check('liveCompanionConfigRoot 返回已存在配置根目录', !!liveRoot && fs.existsSync(liveRoot), String(liveRoot))
  const liveStatus = await local.liveCompanionStatus()
  check('liveCompanionStatus 字段完整', liveStatus.installed && liveStatus.running && liveStatus.installDir === liveDir && liveStatus.configRoot === liveRoot, JSON.stringify(liveStatus))
  check('decodeConsoleOutput 能解 GBK', local.decodeConsoleOutput(Buffer.from('d0c5cfa23a20c3bbd3d0', 'hex')) === '信息: 没有')

  realCfg = local.readObsWebSocketConfig()
  console.log(`  真实 obs-websocket 配置：found=${realCfg.found} enabled=${realCfg.enabled} port=${realCfg.port} authRequired=${realCfg.authRequired} hasPassword=${realCfg.password.length > 0}`)
  console.log(`  路径：${realCfg.path}`)
  check('readObsWebSocketConfig 返回结构完整', typeof realCfg.enabled === 'boolean' && Number.isInteger(realCfg.port) && typeof realCfg.password === 'string' && typeof realCfg.authRequired === 'boolean')

  const sc = local.readSceneCollection()
  console.log(`  场景集合：found=${sc.found} name=${sc.name} current=${sc.currentScene} scenes=${JSON.stringify(sc.scenes)} filters=${sc.filters.length} ${sc.error ?? ''}`)
  console.log(`  文件：${sc.path}`)
  check('readSceneCollection 结构', Array.isArray(sc.scenes) && Array.isArray(sc.filters))
  check('readSceneCollectionFilters 与 readSceneCollection 一致', JSON.stringify(local.readSceneCollectionFilters()) === JSON.stringify(sc.filters))

  // enableObsWebSocket：只写临时目录
  const tmpRoot = path.join(outDir, 'fake-obs-config')
  fs.mkdirSync(path.join(tmpRoot, 'plugin_config', 'obs-websocket'), { recursive: true })
  const tmpCfg = path.join(tmpRoot, 'plugin_config', 'obs-websocket', 'config.json')
  check('临时配置路径 != 真实配置路径', path.resolve(tmpCfg).toLowerCase() !== path.resolve(realCfg.path).toLowerCase())
  fs.writeFileSync(
    tmpCfg,
    '{\r\n  "alerts_enabled": true,\r\n  "auth_required": false,\r\n  "first_load": false,\r\n  "server_enabled": false,\r\n  "server_password": "old",\r\n  "server_port": 4466\r\n}\r\n'
  )
  check('enableObsWebSocket 空密码被拒', (await local.enableObsWebSocket('', tmpCfg)).ok === false)
  const en = await local.enableObsWebSocket('new-密码', tmpCfg)
  check('enableObsWebSocket 写临时配置 ok', en.ok === true, JSON.stringify(en))
  check(
    '备份 config.json.bak-yyyyMMdd 存在且内容=原文',
    en.backup && /config\.json\.bak-\d{8}$/.test(en.backup) && fs.readFileSync(en.backup, 'utf8').includes('"server_password": "old"'),
    en.backup
  )
  const after = local.readObsWebSocketConfig(tmpCfg)
  check('写后：enabled/authRequired/password 已改，port 保留 4466', after.enabled && after.authRequired && after.password === 'new-密码' && after.port === 4466, JSON.stringify(after))
  const rawAfter = fs.readFileSync(tmpCfg, 'utf8')
  check(
    '写后：其它键保留 + CRLF + 2 空格缩进 + 键名字母序',
    rawAfter.includes('"alerts_enabled": true') && rawAfter.includes('\r\n') && rawAfter.indexOf('"alerts_enabled"') < rawAfter.indexOf('"auth_required"') && /^\{\r\n {2}"/.test(rawAfter),
    JSON.stringify(rawAfter.slice(0, 50))
  )
  const en2 = await local.enableObsWebSocket('again', tmpCfg)
  check('同日第二次修改：备份不覆盖第一份', en2.ok && en2.backup !== en.backup && fs.existsSync(en.backup), en2.backup)
  const fresh = path.join(tmpRoot, 'fresh', 'config.json')
  const en3 = await local.enableObsWebSocket('pw', fresh)
  const freshCfg = local.readObsWebSocketConfig(fresh)
  check('无原文件：自动建目录 + 默认键（端口 4455）', en3.ok && !en3.backup && freshCfg.enabled && freshCfg.port === 4455 && freshCfg.password === 'pw', JSON.stringify(freshCfg))
  check('真实配置未被触碰', JSON.stringify(local.readObsWebSocketConfig()) === JSON.stringify(realCfg))

  // 离线场景解析：用假的 configRoot 验证 user.ini 选集合 + filters 提取
  const fakeRoot = path.join(outDir, 'fake-obs-root')
  fs.mkdirSync(path.join(fakeRoot, 'basic', 'scenes'), { recursive: true })
  fs.writeFileSync(path.join(fakeRoot, 'user.ini'), '\ufeff[General]\r\nFirstRun=false\r\n\r\n[Basic]\r\nSceneCollection=测试集合\r\nSceneCollectionFile=测试集合.json\r\n')
  fs.writeFileSync(path.join(fakeRoot, 'basic', 'scenes', '旧集合.json'), JSON.stringify({ name: '旧集合', sources: [] }))
  fs.writeFileSync(
    path.join(fakeRoot, 'basic', 'scenes', '测试集合.json'),
    JSON.stringify({
      name: '测试集合',
      current_program_scene: '直播',
      scene_order: [{ name: '直播' }, { name: '休息' }],
      sources: [
        { name: '直播', id: 'scene', versioned_id: 'scene', filters: [{ name: '场景滤镜', id: 'color_filter', versioned_id: 'color_filter_v2', enabled: true }] },
        { name: '休息', id: 'scene' },
        {
          name: '摄像头',
          id: 'dshow_input',
          filters: [
            { name: '色度键', id: 'chroma_key_filter', versioned_id: 'chroma_key_filter_v2', enabled: false },
            { name: '锐化', id: 'sharpness_filter', enabled: true }
          ]
        }
      ],
      groups: [{ name: '分组A', id: 'group', filters: [{ name: '分组滤镜', id: 'crop_filter', enabled: true }] }]
    })
  )
  const oldTime = new Date(Date.now() - 3600e3)
  fs.utimesSync(path.join(fakeRoot, 'basic', 'scenes', '测试集合.json'), oldTime, oldTime) // 旧集合更"新"，验证按 ini 选而不是按修改时间
  const fake = local.readSceneCollection(fakeRoot)
  check('离线解析：按 user.ini 选中集合（不是最近修改的那个）', fake.found && fake.name === '测试集合' && fake.path.endsWith('测试集合.json'), fake.path)
  check('离线解析：当前场景 / 场景顺序', fake.currentScene === '直播' && JSON.stringify(fake.scenes) === JSON.stringify(['直播', '休息']), JSON.stringify(fake))
  check(
    '离线解析：4 条滤镜（场景+输入源+分组，kind 取 id，enabled 缺省为 true）',
    fake.filters.length === 4 && fake.filters[0].source === '直播' && fake.filters[1].filter === '色度键' && fake.filters[1].enabled === false && fake.filters[3].source === '分组A' && fake.filters[2].kind === 'sharpness_filter',
    JSON.stringify(fake.filters)
  )
  fs.rmSync(path.join(fakeRoot, 'user.ini'))
  const byMtime = local.readSceneCollection(fakeRoot)
  check('离线解析：没有 ini 时退回最近修改的 json', byMtime.found && byMtime.name === '旧集合', byMtime.name)
}

// ---------- 4. 真实 OBS ----------
section('真实 OBS')
if (process.platform !== 'win32' || !realCfg) {
  console.log('SKIP  非 Windows')
} else if (!realCfg.enabled) {
  console.log('SKIP  本机 obs-websocket 未启用（server_enabled=false）——按约定不改用户真实配置，跳过真机连接')
} else {
  const wasRunning = await local.isObsRunning()
  let launched = false
  if (!wasRunning) {
    if (!real) {
      console.log('SKIP  OBS 未运行；加 --real 才会自动启动 OBS 测试（测完 taskkill）')
    } else {
      const dir = local.obsInstallDir()
      const l = dir ? local.launchObs(dir, ['--disable-shutdown-check']) : { ok: false, error: '找不到 OBS' }
      check('launchObs', l.ok, JSON.stringify(l))
      launched = l.ok
      if (launched) {
        let up = false
        for (let i = 0; i < 60 && !up; i++) {
          await sleep(1000)
          up = await tcpOpen(realCfg.port)
        }
        check('OBS 启动后 WebSocket 端口可达', up, `port ${realCfg.port}`)
      }
    }
  }
  if (wasRunning || launched) {
    const rr = await core.obsConnect({ host: HOST, port: realCfg.port, password: realCfg.password, timeoutMs: 10000 })
    check('真实 OBS 连接', rr.ok, rr.ok ? `OBS ${rr.version} / obs-websocket ${core.obsState().wsVersion}` : rr.error)
    if (rr.ok) {
      const sc = await core.obsListScenes()
      console.log('  场景：', JSON.stringify(sc))
      const fl = await core.obsListFilters()
      console.log('  滤镜：', JSON.stringify(fl))
      check('真实 OBS 场景列表非空', sc.scenes.length > 0)
    }
    core.obsDisconnect()
    if (launched) {
      await sleep(1000)
      spawnSync('taskkill', ['/IM', 'obs64.exe', '/F'], { windowsHide: true })
      console.log('  已 taskkill obs64.exe')
    }
  }
}

finish()

// OBS 真机联调：真启动本机 OBS，走客户端自己的链路（CDP 驱动 dev 实例的 window.api）验证
//   远程接口启用 → 启动 OBS → 连接 → 列场景/滤镜 → 开关滤镜 → 礼物规则 OBS 动作真的翻转滤镜 → 清理。
// 前置：dev 实例已带 --remote-debugging-port=9222 起着；本机 OBS 未运行。
// 对用户 OBS 的改动：远程接口 server_enabled 置 true（沿用配置里原有密码，原文件备份为 .bak-日期）；
//   测试用的临时滤镜「知了猴联调滤镜」测完即删，场景集合不留痕。
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, 'output', 'obs-real')
const results = []
const check = (name, ok, detail = '') => {
  results.push([name, !!ok])
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function compile(entry) {
  await fs.mkdir(tmp, { recursive: true })
  const out = path.join(tmp, path.basename(entry).replace(/\.ts$/, '.mjs'))
  await build({ entryPoints: [path.join(root, 'src', 'main', entry)], bundle: true, platform: 'node', format: 'esm', outfile: out, external: ['electron'], logLevel: 'silent' })
  return import(pathToFileURL(out).href)
}

function ps(command) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 60_000 })
  return (r.stdout || '').trim()
}

async function main() {
  const local = await compile('obs-local.ts')
  const core = await compile('obs-ws-core.ts')

  // ---- 1. 本机状态 ----
  const dir = local.obsInstallDir()
  check('找到 OBS 安装目录', !!dir, dir)
  const alreadyRunning = await local.isObsRunning()
  const cfg = local.readObsWebSocketConfig()
  check('读到 obs-websocket 配置', cfg.found, `enabled=${cfg.enabled} port=${cfg.port} auth=${cfg.authRequired}`)
  const password = cfg.password || ''
  check('配置里已有密码可沿用', password.length > 0)
  if (!cfg.enabled) {
    if (alreadyRunning) throw new Error('远程接口未启用且 OBS 正在运行：先关 OBS 再跑')
    const en = await local.enableObsWebSocket(password)
    check('启用远程接口（沿用原密码，已备份原配置）', en.ok, en.error || en.backup)
  } else {
    check('远程接口本来就已启用', true)
  }

  // ---- 2. 启动 OBS（已在跑就沿用），等 websocket 端口起来 ----
  if (alreadyRunning) {
    check('OBS 已在运行，沿用当前实例', true)
  } else {
    const launched = local.launchObs(dir, ['--disable-shutdown-check'])
    check('启动 OBS', launched.ok, launched.error || `pid=${launched.pid}`)
  }
  let connected = false
  for (let i = 0; i < 40 && !connected; i++) {
    await sleep(1500)
    const r = await core.obsConnect({ host: '127.0.0.1', port: cfg.port || 4455, password, timeoutMs: 4000 })
    connected = r.ok
  }
  check('测试脚本直连 OBS websocket', connected, JSON.stringify(core.obsState()))
  if (!connected) throw new Error('连不上 OBS websocket，后面没法测')

  // ---- 3. 造一个临时滤镜给客户端开关 ----
  const inputs = await core.obsRequest('GetInputList')
  const source = inputs?.inputs?.find((i) => /采集|capture/i.test(i.inputName))?.inputName || inputs?.inputs?.[0]?.inputName
  check('有可挂滤镜的输入源', !!source, source)
  const FILTER = '知了猴联调滤镜'
  await core.obsRequest('RemoveSourceFilter', { sourceName: source, filterName: FILTER }).catch(() => {})
  await core.obsRequest('CreateSourceFilter', { sourceName: source, filterName: FILTER, filterKind: 'color_filter_v2', filterSettings: { brightness: 0.05 } })
  const created = await core.obsRequest('GetSourceFilter', { sourceName: source, filterName: FILTER })
  check('临时滤镜已创建且默认开启', created?.filterEnabled === true)
  const filterEnabled = async () => (await core.obsRequest('GetSourceFilter', { sourceName: source, filterName: FILTER })).filterEnabled

  // ---- 4. 客户端链路（CDP 驱动 dev 实例）----
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost'))
  if (!page) throw new Error('找不到客户端主窗口')
  const api = (fn, arg) => page.evaluate(fn, arg)
  const body = await page.innerText('body')
  if (!body.includes('游戏库')) {
    await api(() => window.api.login('gapfill_test', 'Fixture123!'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(2500)
  }
  await api(() => window.api.obsDisconnect())
  const conn = await api(() => window.api.obsConnect())
  check('客户端连接 OBS', conn.ok, conn.error || `OBS ${conn.version}`)
  await api(() => window.api.obsRefresh())
  let st = await api(() => window.api.obsState())
  check('客户端拿到实时场景列表', st.source === 'live' && st.scenes.scenes.length > 0, JSON.stringify(st.scenes))
  check('客户端滤镜列表包含临时滤镜', st.filters.some((f) => f.source === source && f.filter === FILTER), `${st.filters.length} 个滤镜`)

  const off = await api(({ s, f }) => window.api.obsSetFilter(s, f, false), { s: source, f: FILTER })
  check('客户端关闭滤镜', off.ok && (await filterEnabled()) === false, off.error)
  const on = await api(({ s, f }) => window.api.obsSetFilter(s, f, true), { s: source, f: FILTER })
  check('客户端打开滤镜', on.ok && (await filterEnabled()) === true, on.error)

  // 礼物规则：跑车 → OBS 切换滤镜（走主进程执行队列 runObsAction）
  const rules = await api(() => window.api.entertainmentRulesList())
  for (const r of rules) if (r.giftName === '跑车' && r.actionType === 'obs') await api((id) => window.api.entertainmentRuleRemove(id), r.id)
  const add = await api(({ s, f }) => window.api.entertainmentRuleAdd({ id: '', giftName: '跑车', actionType: 'obs', obsAction: 'filter-toggle', obsSource: s, obsFilter: f, enabled: true, queueMode: 'instant' }), { s: source, f: FILTER })
  check('添加 OBS 切换滤镜规则', add.ok)
  await api(() => window.api.connectorSimulate('礼物: 跑车 ×1  by 阿彪'))
  let flipped = false
  for (let i = 0; i < 20 && !flipped; i++) {
    await sleep(250)
    flipped = (await filterEnabled()) === false
  }
  check('模拟礼物「跑车」→ 规则真的把滤镜切成关', flipped)
  await api(() => window.api.connectorSimulate('礼物: 跑车 ×1  by 阿彪'))
  let back = false
  for (let i = 0; i < 20 && !back; i++) {
    await sleep(250)
    back = (await filterEnabled()) === true
  }
  check('再送一次 → 切回开', back)

  // 亮几秒规则
  const rules2 = await api(() => window.api.entertainmentRulesList())
  for (const r of rules2) if (r.giftName === '跑车' && r.actionType === 'obs') await api((id) => window.api.entertainmentRuleRemove(id), r.id)
  await api(({ s, f }) => window.api.entertainmentRuleAdd({ id: '', giftName: '跑车', actionType: 'obs', obsAction: 'filter-flash', obsSeconds: 2, obsSource: s, obsFilter: f, enabled: true, queueMode: 'instant' }), { s: source, f: FILTER })
  await core.obsRequest('SetSourceFilterEnabled', { sourceName: source, filterName: FILTER, filterEnabled: false })
  await api(() => window.api.connectorSimulate('礼物: 跑车 ×1  by 阿彪'))
  let lit = false
  for (let i = 0; i < 12 && !lit; i++) {
    await sleep(200)
    lit = (await filterEnabled()) === true
  }
  check('滤镜亮几秒：触发后先亮', lit)
  await sleep(2600)
  check('滤镜亮几秒：2 秒后自动关', (await filterEnabled()) === false)

  // 切场景（只有一个场景时切到自己也应成功）
  const scene = st.scenes.current || st.scenes.scenes[0]
  const sw = await api((s) => window.api.obsSetScene(s), scene)
  check('客户端切场景', sw.ok, sw.error || scene)

  // ---- 5. 清理：删规则、删临时滤镜、断开、优雅关 OBS ----
  const rules3 = await api(() => window.api.entertainmentRulesList())
  for (const r of rules3) if (r.giftName === '跑车' && r.actionType === 'obs') await api((id) => window.api.entertainmentRuleRemove(id), r.id)
  await core.obsRequest('RemoveSourceFilter', { sourceName: source, filterName: FILTER })
  const gone = await core.obsRequest('GetSourceFilter', { sourceName: source, filterName: FILTER }).then(() => false, () => true)
  check('临时滤镜已删除，场景集合不留痕', gone)
  await api(() => window.api.obsDisconnect())
  core.obsDisconnect()
  await browser.close()
  ps("Get-Process -Name obs64 -ErrorAction SilentlyContinue | ForEach-Object { $null = $_.CloseMainWindow() }")
  let closed = false
  for (let i = 0; i < 20 && !closed; i++) {
    await sleep(1000)
    closed = !(await local.isObsRunning())
  }
  if (!closed) ps('Stop-Process -Name obs64 -Force -ErrorAction SilentlyContinue')
  check('OBS 已关闭', !(await local.isObsRunning()))
}

main().catch((e) => {
  console.error('ERROR', e?.stack || e)
  results.push(['未捕获异常', false])
}).finally(() => {
  const failed = results.filter((r) => !r[1])
  console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`)
  process.exitCode = failed.length ? 1 : 0
})

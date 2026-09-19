// 启动生命周期回归：真实 Electron 单实例锁与主窗口，独立临时 profile。
// 只在自有进程中屏蔽 show/focus 并记录请求；不代表 Windows 原生前台切换验收。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/single-instance')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
const bundle = path.join(profile, 'lifecycle.cjs')
const statsFile = path.join(profile, 'data/sticker-stats.json')
await fs.mkdir(path.dirname(statsFile))
await fs.writeFile(statsFile, JSON.stringify({ rows: [{ name: '鲜花', count: 5, last: 1 }], lastGift: '鲜花', lastAt: 1 }))

// 仅隔离启动副作用（游戏探测、连接器、网络服务和渲染页面），不替换被验的
// index.ts、sticker-stats.ts、db.ts，也不伪造 requestSingleInstanceLock 的返回值。
const startupStubs = {
  './crash-log': 'export function initCrashLog() {}',
  './ipc': `import * as stickers from ${JSON.stringify(path.join(root, 'src/main/sticker-stats.ts'))}; global.qa.stickers = stickers; export function registerIpc() { global.qa.calls.push({ method: 'registerIpc' }); }`,
  './connector': 'export function stopConnector() {}',
  './game-launcher': 'export function detectAllGames() { return { found: {} }; }',
  './settings': 'export function getSettings() { return { alwaysOnTop: false }; }',
  './updater': 'export function initUpdater() {}',
  './notifications': 'export function startNotifyWatch() {}',
  './heartbeat': 'export function startHeartbeatWatch() {}',
  './connector-runtime': 'export function registerConnectorRuntime() {}',
  './obs-service': 'export function initObsService() {}'
}
await build({
  entryPoints: [path.join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
  external: ['electron'], tsconfig: path.join(root, 'tsconfig.node.json'), logLevel: 'silent',
  plugins: [{ name: 'isolate-startup-services', setup(builder) {
    builder.onResolve({ filter: /^\.\// }, args => {
      if (args.importer.replaceAll('\\', '/').endsWith('/src/main/index.ts') && startupStubs[args.path]) return { path: args.path, namespace: 'startup-stub' }
      if (args.importer.replaceAll('\\', '/').endsWith('/src/main/sticker-stats.ts') && args.path === './entertainment') return { path: 'gift-image', namespace: 'startup-stub' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'startup-stub' }, args => ({ contents: args.path === 'gift-image' ? 'export function findGiftImage() { return undefined; }' : startupStubs[args.path], loader: 'ts', resolveDir: root }))
  } }]
})

await fs.writeFile(entry, `
const fs = require('node:fs'), path = require('node:path'), electron = require('electron');
const { app, BrowserWindow: NativeWindow } = electron;
const role = process.env.ZL_SINGLE_INSTANCE_ROLE || 'primary';
const reportFile = path.join(__dirname, role + '-telemetry.json');
app.setName('zhiliao-single-instance-' + path.basename(__dirname));
app.setPath('userData', __dirname);
app.setAppPath(${JSON.stringify(root)});
global.qa = { role, calls: [], nativeEvents: [], constructors: [], minimized: [], statsWrites: 0, secondInstances: 0, beforeQuit: 0 };
const report = () => fs.writeFileSync(reportFile, JSON.stringify({ ...global.qa, stickers: undefined }));
process.on('exit', code => { global.qa.exitCode = code; report(); });
process.on('uncaughtException', error => { global.qa.error = String(error.stack || error); report(); app.exit(1); });
app.on('before-quit', () => { global.qa.beforeQuit++; report(); });
app.on('second-instance', () => { global.qa.secondInstances++; report(); });
const write = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  if (String(file).includes('sticker-stats.json')) global.qa.statsWrites++;
  return write.call(this, file, ...args);
};
for (const method of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) {
  NativeWindow.prototype[method] = function () {
    global.qa.calls.push({ id: this.id, method });
    if (method === 'restore') global.qa.minimized = global.qa.minimized.filter(id => id !== this.id);
  };
}
const nativeIsMinimized = NativeWindow.prototype.isMinimized;
NativeWindow.prototype.isMinimized = function () { return global.qa.minimized.includes(this.id) || nativeIsMinimized.call(this); };
app.focus = () => { global.qa.calls.push({ method: 'app.focus' }); };
electron.dialog.showErrorBox = (title, content) => { global.qa.error = title + ': ' + content; report(); };
const originalLoadFile = NativeWindow.prototype.loadFile;
NativeWindow.prototype.loadFile = function (file, ...args) {
  if (this.getTitle() === '知了猴整蛊台') return this.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>知了猴整蛊台</title><main>isolated lifecycle fixture</main>'));
  return originalLoadFile.call(this, file, ...args);
};
const HiddenWindow = new Proxy(NativeWindow, { construct(Target, args) {
  const requested = args[0] || {};
  const win = Reflect.construct(Target, [{ ...requested, show: false, focusable: false, webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }], Target);
  global.qa.constructors.push({ id: win.id, title: requested.title, requestedShow: requested.show });
  for (const event of ['show', 'focus']) win.on(event, () => global.qa.nativeEvents.push({ id: win.id, event }));
  return win;
} });
global.qa.createRetainedWidget = () => new HiddenWindow({ title: 'single-instance-retained-widget', show: false });
const requestLock = app.requestSingleInstanceLock.bind(app);
app.requestSingleInstanceLock = function (...args) {
  // 第二实例已经读取旧统计，但尚未请求锁。由测试驱动让主实例先收到新礼物，
  // 然后放行，精确复现二次启动退出时用旧快照覆盖新统计的竞态。
  if (role !== 'primary') {
    fs.writeFileSync(path.join(__dirname, role + '-loaded'), 'loaded');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(path.join(__dirname, role + '-release'))) {
      if (Date.now() >= deadline) throw new Error('secondary barrier timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  const locked = requestLock(...args);
  global.qa.locked = locked;
  report();
  return locked;
};
const Module = require('node:module'), load = Module._load;
const facade = { ...electron, BrowserWindow: HiddenWindow };
Module._load = function (name) { return name === 'electron' ? facade : load.apply(this, arguments); };
require('./lifecycle.cjs');
`)

const executablePath = path.join(root, 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const checks = [], children = [], evidence = {
  profile, checks,
  limitations: [
    'Native windows remain hidden and unfocusable; show/focus/restore requests are recorded without execution. This does not verify Windows foreground activation.',
    'Only startup services and renderer content are isolated. Real source index, sticker statistics, persistence and Electron singleton are used.',
    'Both processes use the same Electron executable and a unique shared test profile; installed executable handoff is not tested.'
  ]
}
const pass = name => { checks.push(name); console.log('PASS ' + name) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, description, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(40) }
  throw new Error('Timed out: ' + description)
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const app = await electron.launch({ executablePath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: profile, env, timeout: 30000 })
const snapshot = () => app.evaluate(({ app, BrowserWindow }) => ({
  profile: app.getPath('userData'), locked: app.hasSingleInstanceLock(),
  calls: global.qa.calls, constructors: global.qa.constructors, nativeEvents: global.qa.nativeEvents,
  secondInstances: global.qa.secondInstances, statsWrites: global.qa.statsWrites,
  windows: BrowserWindow.getAllWindows().map(w => ({ id: w.id, title: w.getTitle(), visible: w.isVisible(), focused: w.isFocused() }))
}))
async function secondary(role, beforeRelease) {
  const child = spawn(executablePath, [entry, `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: profile, env: { ...env, ZL_SINGLE_INSTANCE_ROLE: role }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const record = { role, pid: child.pid, stdout: '', stderr: '' }
  children.push(child)
  child.stdout.on('data', chunk => { record.stdout += chunk.toString() })
  child.stderr.on('data', chunk => { record.stderr += chunk.toString() })
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { record.code = code; record.signal = signal; resolve(record) }) })
  await until(() => fs.access(path.join(profile, role + '-loaded')).then(() => true, () => false), role + ' loaded source')
  if (beforeRelease) await beforeRelease()
  await fs.writeFile(path.join(profile, role + '-release'), 'continue')
  let timeout
  try {
    await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(role + ' failed to exit')), 12000) })])
  } finally { clearTimeout(timeout) }
  record.telemetry = JSON.parse(await fs.readFile(path.join(profile, role + '-telemetry.json'), 'utf8'))
  evidence[role] = record
  assert.equal(record.code, 0, role + ' exit status')
  assert.equal(record.telemetry.locked, false, role + ' lost singleton lock')
  assert.equal(record.telemetry.constructors.length, 0, role + ' must not create a window')
  return record
}
try {
  await app.firstWindow()
  await until(async () => (await snapshot()).calls.some(call => call.method === 'show'), 'initial ready-to-show')
  const first = await snapshot()
  assert.equal(first.profile, profile)
  assert.equal(first.locked, true)
  assert.equal(first.constructors.length, 1)
  const firstId = first.windows.find(w => w.title === '知了猴整蛊台').id
  pass('独立 profile 的主实例成功持锁并创建一个隐藏主窗口')

  await app.evaluate((_, id) => { global.qa.calls.length = 0; global.qa.minimized.push(id) }, firstId)
  let expectedStatsHash
  const second = await secondary('secondary-existing', async () => {
    await app.evaluate(() => global.qa.stickers.handleStickerGift({ type: 'gift', giftName: '鲜花', count: 2 }))
    expectedStatsHash = sha(await fs.readFile(statsFile))
  })
  await until(async () => (await snapshot()).secondInstances === 1, 'real second-instance event')
  assert.equal(second.telemetry.beforeQuit, 0)
  assert.equal(second.telemetry.statsWrites, 0)
  assert.equal(sha(await fs.readFile(statsFile)), expectedStatsHash)
  assert.equal(JSON.parse(await fs.readFile(statsFile, 'utf8')).rows[0].count, 7)
  pass('第二实例干净退出，不触发业务退出保存，不覆盖主实例新增礼物统计')
  const restored = await snapshot()
  assert.equal(restored.constructors.length, 1)
  for (const method of ['restore', 'show', 'focus']) assert.ok(restored.calls.some(call => call.id === firstId && call.method === method), method)
  pass('真实二次启动通知复用已有主窗口，请求恢复、显示和聚焦')

  const widgetId = await app.evaluate(async ({ BrowserWindow }, id) => {
    const widget = global.qa.createRetainedWidget()
    const main = BrowserWindow.fromId(id)
    const closed = new Promise(resolve => main.once('closed', resolve))
    main.close()
    await closed
    global.qa.calls.length = 0
    return widget.id
  }, firstId)
  const onlyWidget = await snapshot()
  assert.equal(onlyWidget.windows.length, 1)
  assert.equal(onlyWidget.windows[0].id, widgetId)
  assert.equal(onlyWidget.locked, true)
  pass('主窗口关闭后，独立挂件保留且进程仍持单实例锁')

  await secondary('secondary-reopen')
  const reopened = await until(async () => {
    const s = await snapshot()
    const main = s.windows.find(w => w.title === '知了猴整蛊台')
    return main && s.calls.some(c => c.id === main.id && c.method === 'show') && s.calls.some(c => c.id === main.id && c.method === 'focus') ? s : null
  }, 'main recreated by real second instance')
  const reopenedId = reopened.windows.find(w => w.title === '知了猴整蛊台').id
  assert.notEqual(reopenedId, firstId)
  assert.equal(reopened.windows.filter(w => w.title === '知了猴整蛊台').length, 1)
  assert.ok(reopened.windows.some(w => w.id === widgetId))
  pass('再次启动重建主窗口并请求显示聚焦，原挂件不关闭')

  await secondary('secondary-repeat')
  await until(async () => (await snapshot()).secondInstances === 3, 'third handoff')
  const repeated = await snapshot()
  assert.equal(repeated.windows.find(w => w.title === '知了猴整蛊台').id, reopenedId)
  assert.equal(repeated.constructors.filter(w => w.title === '知了猴整蛊台').length, 2)
  pass('重复启动继续使用重建后的同一窗口，不重复创建主窗口')

  await app.evaluate(() => global.qa.stickers.stickerImport({ 爱心: 3 }))
  assert.equal(JSON.parse(await fs.readFile(statsFile, 'utf8')).rows.find(row => row.name === '爱心').count, 3)
  await app.evaluate(() => global.qa.stickers.stickerReset())
  assert.deepEqual(JSON.parse(await fs.readFile(statsFile, 'utf8')).rows, [])
  pass('主实例礼物累计、导入和清零仍立即持久化')

  evidence.final = await snapshot()
  assert.deepEqual(evidence.final.nativeEvents, [])
  assert.ok(evidence.final.windows.every(w => !w.visible && !w.focused))
  pass('所有自建窗口始终隐藏、不聚焦，无真实桌面输入')
  const savedHash = sha(await fs.readFile(statsFile))
  const writesBeforeQuit = evidence.final.statsWrites
  await app.close()
  const primaryExit = JSON.parse(await fs.readFile(path.join(profile, 'primary-telemetry.json'), 'utf8'))
  evidence.primaryExit = primaryExit
  assert.equal(primaryExit.beforeQuit, 1)
  assert.equal(primaryExit.statsWrites, writesBeforeQuit)
  assert.equal(sha(await fs.readFile(statsFile)), savedHash)
  pass('主实例正常退出保留统计，不重复写入退出前快照')
} catch (error) {
  evidence.error = String(error.stack || error)
  throw error
} finally {
  // 只关闭本脚本明确拥有的隔离 Electron；不会按进程名查杀用户程序。
  await app.close().catch(() => {})
  for (const child of children) if (child.exitCode == null && child.signalCode == null) child.kill()
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify(evidence, null, 2))
  console.log('EVIDENCE ' + path.join(profile, 'results.json'))
}
console.log('single-instance regression passed: ' + checks.length + ' checks')

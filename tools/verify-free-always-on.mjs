// 免费模式「服务器挂了也照常用、绝不掉授权」回归（2026-10-07 用户：「就是免费软件来着，即使我们服务器挂了，软件也要可以正常使用的」
// 「千万不要干扰直播」「也不要有任何的掉授权行为」）。
//   隐藏离屏 Electron + 本测试私有的卡密平台夹具（tools/formal-card-fixture.py → ../卡密系统 create_app，开免费模式），不连线上、不出声、不抢前台。
//   1 在线：注册登录 → 开倒计时窗口；平台记下这台机器、下发四个产品的离线凭证
//   2 平台登录失效（线上 1 天到期 / 会话被清，夹具删会话）：后台请求 401 → 静默重登 → 绑定照样报到平台；窗口一直开着、账号没退
//   3 平台不认自动登录（夹具改了密码）：窗口照样开着、账号没退，本机绑定照常生效
//   4 平台挂了（夹具进程退出）：窗口照样开着；关掉客户端重开 → 同一个号直接登录进去（提示服务器连不上）；
//     密码输错照样拦下；这台电脑没登过的新邮箱也能进；注册页收不到验证码也能直接注册进入；服务器挂着时绑定在本机直接生效
//   5 平台恢复：本机登录中的客户端自动连回平台，服务器挂着时绑的直播间补报上去
// 用法：npx electron-vite build --outDir output/free-always-on-build && node tools/verify-free-always-on.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.env.ZL_FREE_ON_OUT_DIR || 'output/free-always-on-build'
const out = path.join(root, 'output/playwright/free-always-on')
const platformRoot = path.resolve(root, '../卡密系统')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))

const secrets = new Set()
const mask = (t) => { let s = String(t ?? ''); for (const x of secrets) if (x) s = s.split(x).join('***'); return s }
const results = []
const check = (name, value) => {
  results.push({ name, ok: !!value })
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, ms = 15000, step = 250) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch { /* 再等 */ }
    await sleep(step)
  }
  return null
}

// ================= 私有卡密平台（夹具进程，免费模式）=================
const serviceDir = path.join(out, 'service-' + Date.now())
await fs.mkdir(serviceDir, { recursive: true })
let service = null
let serviceAlive = false
let serviceErr = ''
const lines = []
const waiters = []
function startService(port = 0) {
  serviceErr = ''
  service = spawn(process.env.ZL_TEST_PYTHON || 'python', [path.join(root, 'tools/formal-card-fixture.py'), platformRoot, path.join(serviceDir, 'data'), String(port)], { cwd: serviceDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  serviceAlive = true
  const proc = service
  proc.stderr.on('data', (d) => { serviceErr += d.toString() })
  proc.on('exit', () => { if (service === proc) serviceAlive = false })
  let buf = ''
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      if (waiters.length) waiters.shift()(line)
      else lines.push(line)
    }
  })
}
const nextLine = (ms = 60000) => new Promise((resolve, reject) => {
  if (lines.length) return resolve(lines.shift())
  const t = setTimeout(() => reject(new Error('夹具无响应：' + mask(serviceErr).slice(-800))), ms)
  waiters.push((line) => { clearTimeout(t); resolve(line) })
})
async function fixture(cmd) {
  assert.ok(serviceAlive, '夹具已退出')
  service.stdin.write(JSON.stringify(cmd) + '\n')
  const reply = JSON.parse(await nextLine())
  assert.ok(reply.ok, `夹具命令失败 ${cmd.op}: ${mask(reply.error)}`)
  return reply
}
async function stopService() {
  if (!serviceAlive) return
  try { service.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n') } catch { /* 已退出 */ }
  await waitFor(() => !serviceAlive, 8000)
  if (serviceAlive) service.kill()
  lines.length = 0   // 关机应答别留到下次启动当成启动信息
}

startService()
const platform = JSON.parse(await nextLine())
const port = Number(new URL(platform.origin).port)
await fixture({ op: 'free', on: true })

// ================= 隐藏离屏 Electron =================
const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
const env = {
  ...process.env,
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  ZL_CARD_RELOGIN_MS: '5000',                                  // 本机登录中每 5 秒可试一次连回平台（线上 60 秒）
  ZL_LEASE_MIRROR_URL: 'http://127.0.0.1:1/',                   // 镜像源不可用：只测本机记录
  ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json'   // 全程不出网
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ZL_LICENSE_ENFORCE   // 走随包默认：build/license-policy.json enforce=false（免费）

async function launch(tag, reuse = '') {
  const profile = reuse || await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir, isolateGames: !reuse })
  if (!reuse) await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: platform.origin, publicKey: platform.publicKey }), 'utf8')
  const app = await electron.launch({ executablePath: electronExe, args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(tag + ': ' + mask(e.message)))
  await page.waitForFunction(() => !!window.api?.cardState)
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须用本次隔离 profile')
  await page.evaluate(async () => {
    await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'basic')
  })
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  const log = () => fs.readFile(path.join(profile, 'logs', 'main.log'), 'utf8').catch(() => '')
  return { app, page, profile, api, log, errors }
}
const mainUi = (page, ms = 30000) => page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: ms }).then(() => true, () => false)
async function loginViaUi(page, acct) {
  await page.getByPlaceholder('邮箱 / 用户名').fill(acct.email)
  await page.getByPlaceholder('密码').fill(acct.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
}
async function logoutViaUi(page) {
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('button', { name: '切换账号', exact: true }).click()
  await page.getByPlaceholder('邮箱 / 用户名').waitFor()
}
const toastShown = (page, text, ms = 6000) => page.getByText(text, { exact: false }).first().waitFor({ timeout: ms }).then(() => true, () => false)
async function bind(api, room) {
  const v = await api('cardRoomVerify', room)
  if (!v?.ok || !v.proof) return v
  return api('cardRoomCommit', { action: 'bind', room, proof: v.proof })
}
const TIME = { enable: true, initial: 60, gifts: [], addGift: '', subGift: '' }
const platformRooms = async (email) => (await fixture({ op: 'rooms', email })).rooms

const stamp = Date.now()
const A = { email: `free-a-${stamp}@example.test`, password: 'Free-' + randomUUID().slice(0, 12) }
const C = { email: `free-c-${stamp}@example.test`, password: 'Free-' + randomUUID().slice(0, 12) }
const D = { email: `free-d-${stamp}@example.test`, password: 'Free-' + randomUUID().slice(0, 12) }
for (const x of [A, C, D]) secrets.add(x.password)
const R1 = '100000000101', R2 = '100000000102', R3 = '100000000103', R4 = '100000000104'

let s = null
try {
  // ===== 1 在线 =====
  s = await launch('online')
  const reg = await s.api('emailRegister', A.email, '', A.password, '主播A')
  check('1 在线注册成功', reg?.ok === true)
  await s.page.reload()
  check('1 进入主界面', await mainUi(s.page))
  const opened = await s.api('timeWidgetOpen', TIME)
  check('1 倒计时窗口打开', opened?.ok === true && (await s.api('timeWidgetState')).open === true)
  check('1 平台记下了这台机器（离线凭证要用）', (await fixture({ op: 'machines', email: A.email })).count === 1)
  const leases = JSON.parse(await fs.readFile(path.join(s.profile, 'data', 'card-offline-leases.json'), 'utf8'))
  check('1 本机拿到四个产品的离线凭证', ['platform:assistant', 'game:4wheel-challenge', 'game:dontscream', 'game:librarian'].every((p) => typeof leases?.leases?.[p] === 'string'))

  // ===== 2 平台登录失效 =====
  await fixture({ op: 'kill_sessions', email: A.email })
  const b1 = await bind(s.api, R1)
  check('2 登录失效时绑定照常生效', b1?.ok === true)
  check('2 静默重登后绑定照样报到平台', !!(await waitFor(async () => (await platformRooms(A.email)).includes(R1))))
  check('2 倒计时窗口一直开着', (await s.api('timeWidgetState')).open === true)
  check('2 账号没退', (await s.api('session'))?.email === A.email)

  // ===== 3 平台不认自动登录 =====
  await fixture({ op: 'set_password', email: A.email, password: A.password + 'x' })
  await fixture({ op: 'kill_sessions', email: A.email })
  const b2 = await bind(s.api, R2)
  await sleep(2500)
  check('3 平台不认自动登录：本机绑定照常生效', b2?.ok === true && (await s.api('session'))?.boundRooms?.includes(R2))
  check('3 平台没收到这次绑定（它拒了）', !(await platformRooms(A.email)).includes(R2))
  check('3 倒计时窗口一直开着、账号没退', (await s.api('timeWidgetState')).open === true && (await s.api('session'))?.email === A.email)
  check('3 日志：平台没认自动登录、本机继续用', /平台没认这次自动登录/.test(await s.log()))
  await fixture({ op: 'set_password', email: A.email, password: A.password })

  // ===== 4 平台挂了 =====
  await stopService()
  check('4 夹具平台已停', !serviceAlive)
  await sleep(3000)
  check('4 平台挂了：倒计时窗口照样开着、账号没退', (await s.api('timeWidgetState')).open === true && (await s.api('session'))?.email === A.email)
  const profile = s.profile
  await s.app.close()
  s = await launch('down', profile)
  await loginViaUi(s.page, { email: A.email, password: A.password + 'wrong' })
  check('4 服务器挂着时密码输错照样拦下', (await toastShown(s.page, '账号或密码不正确')) && !(await mainUi(s.page, 2500)))
  await loginViaUi(s.page, A)
  check('4 服务器挂着也能登录进主界面', await mainUi(s.page))
  check('4 提示：服务器暂时连不上，功能照常用', await toastShown(s.page, '服务器暂时连不上'))
  check('4 日志：本机登录（有离线凭证走凭证，没有走免费模式本机登录）', /免费模式直接用本机登录|用本机签名凭证离线登录/.test(await s.log()))
  check('4 服务器挂着照样开窗口', (await s.api('timeWidgetOpen', TIME))?.ok === true && (await s.api('timeWidgetState')).open === true)
  await s.api('timeWidgetClose')
  await logoutViaUi(s.page)
  check('4 退出后回到登录页', (await s.api('session')) === null)
  await loginViaUi(s.page, { email: A.email, password: A.password + 'wrong' })
  check('4 退出后再输错密码照样拦下（这台电脑的登录记录还在）', (await toastShown(s.page, '账号或密码不正确')) && !(await mainUi(s.page, 2500)))
  await loginViaUi(s.page, C)
  check('4 这台电脑没登过的新邮箱也能直接进', (await mainUi(s.page)) && (await s.api('session'))?.email === C.email)
  await logoutViaUi(s.page)
  await s.page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
  await s.page.getByPlaceholder('邮箱号').fill(D.email)
  await s.page.getByPlaceholder('昵称（留空用邮箱名）').fill('主播D')
  await s.page.getByPlaceholder('密码（至少 6 位）').fill(D.password)
  await s.page.getByPlaceholder('确认密码').fill(D.password)
  const codeBox = await s.page.getByPlaceholder('邮箱验证码').count()
  if (codeBox) {
    await s.page.getByRole('button', { name: '发送验证码', exact: true }).click()
    check('4 注册页：发不了验证码时说明可以直接注册', await toastShown(s.page, '收不到验证码'))
  }
  await s.page.getByRole('button', { name: '注册', exact: true }).click()
  check('4 服务器挂着、收不到验证码也能注册进入', (await mainUi(s.page)) && (await s.api('session'))?.email === D.email)
  check('4 注册填的昵称照样用上', (await s.api('session'))?.nickname === '主播D')
  await logoutViaUi(s.page)
  await loginViaUi(s.page, A)
  check('4 再用原账号登录进入', await mainUi(s.page))
  const b3 = await bind(s.api, R3)
  check('4 服务器挂着时绑定在本机直接生效', b3?.ok === true && (await s.api('session'))?.boundRooms?.includes(R3))
  const localRooms = (await s.api('session'))?.boundRooms || []
  check('4 本机还记得之前绑的直播间', [R1, R2, R3].every((r) => localRooms.includes(r)))
  const reopen = await s.api('timeWidgetOpen', TIME)
  check('4 服务器挂着再开窗口', reopen?.ok === true)

  // ===== 5 平台恢复 =====
  startService(port)
  JSON.parse(await nextLine())
  await fixture({ op: 'free', on: true })
  await sleep(5500)
  const b4 = await bind(s.api, R4)
  check('5 平台恢复后绑定照常', b4?.ok === true)
  const synced = await waitFor(async () => { const r = await platformRooms(A.email); return [R1, R2, R3, R4].every((x) => r.includes(x)) ? r : null }, 25000)
  check('5 自动连回平台：服务器挂着时绑的直播间也补报上去', !!synced)
  check('5 日志：重新联系上平台', /重新联系上平台/.test(await s.log()))
  check('5 全程窗口没被关、账号没掉', (await s.api('timeWidgetState')).open === true && (await s.api('session'))?.email === A.email)
  check('全程页面无报错', s.errors.length === 0)
  check('全程日志没有「已关闭输出」', !/已关闭输出/.test(await s.log()))
} catch (e) {
  check('意外中断：' + mask(e?.stack || e).slice(0, 600), false)
} finally {
  try { await s?.app.close() } catch { /* 已关 */ }
  await stopService()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
process.exit(failed.length ? 1 : 0)

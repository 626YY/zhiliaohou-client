// 正式客户端 × 本机卡密平台：独立完整端到端验收（真实链路，不桩 card:* / auth:* / email:* 任何主进程 IPC）。
//   平台：tools/formal-card-fixture.py 起一个隔离的 ../卡密系统 create_app（TESTING、IDENTITY_MODE=local、不连旧后台），
//         本测试 pin 它的 Ed25519 公钥到独立 userData/license-provider.json；收回 / 直授 / 到期只经夹具控制面（stdin）。
//   客户端：一次完整 electron-vite 构建（默认 output/fable-formal-e2e-build，不覆盖 out/），隐藏 + 离屏，
//         游戏路径全部是 test-bootstrap 造的临时 0 字节占位 exe；不连真实直播、不启动游戏、不碰真实账号 / 素材。
//   覆盖：无 provider 旧登录（简）→ 有 provider 注册 / 登录 / 错密码 / 凭据隔离 → 未激活四项 → 三个激活入口真实兑换同步
//         → 权益中文期限与平台一致 → 娱乐助手向导可配、开窗口弹激活、激活后真实倒计时 + 模拟礼物改时间
//         → 收回 / 到期 / 平台掉线 输出被关且再次使用被拒、UI 同步 → 换账号旧配置保留但权益不串
//         → 直播间绑定按新平台权限（只验 bind IPC，不开抖音）→ 参数 / 遥控 / 启动页权限门来自新平台映射 → 关窗口不要授权。
//   产物：output/playwright/formal-card-e2e/（截图 + result.json）。截图前输入框已清空；卡密 / 密码只在本进程内存，日志一律打码。
// 用法：node tools/test-formal-card-e2e.mjs [--out-dir output/fable-formal-e2e-build] [--skip-legacy]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const outDir = argValue('--out-dir', process.env.ZL_FORMAL_E2E_OUT_DIR || 'output/fable-formal-e2e-build')
const skipLegacy = argv.includes('--skip-legacy')
const out = path.join(root, 'output/playwright/formal-card-e2e')
const platformRoot = path.resolve(root, '../卡密系统')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))
await fs.access(path.join(platformRoot, 'app.py'))

// ---- 打码：卡密 / 密码永远不进控制台与 result.json ----
const CARD_RE = /ZL-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}/g
const secrets = new Set()
const mask = (text) => {
  let s = String(text ?? '').replace(CARD_RE, 'ZL-****')
  for (const x of secrets) if (x) s = s.split(x).join('***')
  return s
}

const checks = []
const errorsAll = []
/** kind：实际 = 真实链路（UI → IPC → 平台）；夹具 = 靠夹具控制面 / 占位路径才能发生的前提 */
const check = (name, value, kind = '实际') => {
  assert.ok(value, name)
  checks.push({ name, kind })
  console.log(`PASS [${kind}] ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, label, ms = 10000, step = 200) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await sleep(step)
  }
  throw new Error(label)
}

// ================= 私有卡密平台（夹具进程）=================
const serviceDir = path.join(out, 'service-' + Date.now())
await fs.mkdir(serviceDir, { recursive: true })
let service = null
let serviceErr = ''
let serviceAlive = false
const lineQueue = []
const lineWaiters = []
/** 起夹具平台；port 给了就固定监听（「平台挂了又起来」要同一个地址，客户端 pin 的就是它） */
function startService(port = 0) {
  serviceErr = ''
  service = spawn(process.env.ZL_TEST_PYTHON || 'python', [path.join(root, 'tools/formal-card-fixture.py'), platformRoot, path.join(serviceDir, 'data'), String(port)], {
    cwd: serviceDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  })
  serviceAlive = true
  const proc = service
  proc.stderr.on('data', (d) => { serviceErr += d.toString() })
  proc.on('exit', () => { if (service === proc) serviceAlive = false })
  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      if (lineWaiters.length) lineWaiters.shift()(line)
      else lineQueue.push(line)
    }
  })
}
startService()
const nextLine = (ms = 30000) => new Promise((resolve, reject) => {
  if (lineQueue.length) return resolve(lineQueue.shift())
  const t = setTimeout(() => reject(new Error('夹具服务无响应：' + mask(serviceErr))), ms)
  lineWaiters.push((line) => { clearTimeout(t); resolve(line) })
})
const platform = JSON.parse(await nextLine(60000))
for (const list of Object.values(platform.cards)) for (const code of list) secrets.add(code)
assert.ok(platform.origin.startsWith('http://127.0.0.1:') && platform.cards.platform.length === 3 && platform.cards.librarian.length === 3, '夹具平台启动异常')
/** 夹具控制面（不经 HTTP 管理口）：grant / rights / now */
async function fixture(cmd) {
  assert.ok(serviceAlive, '夹具服务已退出')
  service.stdin.write(JSON.stringify(cmd) + '\n')
  const reply = JSON.parse(await nextLine())
  assert.ok(reply.ok, `夹具命令失败 ${cmd.op}: ${mask(reply.error)}`)
  return reply
}
const stopService = () => {
  if (!serviceAlive) return
  try { service.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n') } catch { /* 已退出 */ }
  setTimeout(() => { if (serviceAlive) service.kill() }, 3000).unref()
}

// ================= 离线凭证镜像（本地 HTTP，模拟更新源 updates/leases/<key>.json）=================
let mirrorBundle = null
let mirrorKey = ''
const mirror = http.createServer((req, res) => {
  if (mirrorBundle && req.url.split('?')[0] === '/' + mirrorKey) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(mirrorBundle))
  else res.writeHead(404).end('no')
})
await new Promise((r) => mirror.listen(0, '127.0.0.1', r))
/** 本机机器码（和客户端读的是同一个注册表项）：夹具按它算镜像包对象名 */
const machineId = /MachineGuid\s+REG_SZ\s+([A-Za-z0-9-]{8,64})/.exec(execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8' }))[1]

// ================= 隐藏 Electron =================
const electronExe = path.join(root, 'node_modules/electron/dist/electron.exe')
const env = {
  ...process.env,
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  ZL_CARD_POLL_MS: '3000',
  ZL_CARD_RECHECK_MS: '2000',
  // 离线登录中每 3 秒试一次重新联系平台（线上 60 秒）；镜像包从本地 HTTP 取
  ZL_CARD_RELOGIN_MS: '3000',
  ZL_LEASE_MIRROR_URL: `http://127.0.0.1:${mirror.address().port}/`,
  // 远端 mod 清单指向一个没服务的本机端口：本测试全程不出网，mod 列表用内置清单（可复现）
  ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json'
}
delete env.ELECTRON_RUN_AS_NODE
async function launch(tag, { provider = false, profile: reuse = '' } = {}) {
  // reuse：用上一次的 profile 重启客户端（模拟主播关掉再打开）——设置 / 凭据 / 离线凭证文件都还在
  const profile = reuse || await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir, isolateGames: !reuse })
  if (!reuse) {
    // 有效授权后参数页需要实际可读的临时 Mod 配置；不模拟授权或读配置 IPC。
    const isolatedSettings=JSON.parse(await fs.readFile(path.join(profile,'data/settings.json'),'utf8'))
    const libraryConfig=path.join(path.dirname(isolatedSettings.gamePaths.librarian),'ue4ss/Mods/DarkMage/config.json')
    await fs.mkdir(path.dirname(libraryConfig),{recursive:true});await fs.writeFile(libraryConfig,'{}')
  }
  if (provider && !reuse) {
    await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: platform.origin, publicKey: platform.publicKey }), 'utf8')
    // 预埋一份「旧服务器记住的密码」（明文兜底格式）：卡密模式的登录页绝不能把它预填出来
    await fs.mkdir(path.join(profile, 'data'), { recursive: true })
    await fs.writeFile(path.join(profile, 'data/creds.json'), JSON.stringify({ last: 'legacy-user@example.test', map: { 'legacy-user@example.test': 'p:' + Buffer.from('legacy-secret-not-for-platform').toString('base64') } }), 'utf8')
  }
  const app = await electron.launch({ executablePath: electronExe, args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(tag + ': ' + mask(e.message)))
  errorsAll.push(errors)
  await page.waitForFunction(() => !!window.api?.cardState)
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
  const api = (method, ...args) => page.evaluate(({ method, args }) => window.api[method](...args), { method, args })
  const goto = async (route) => {
    await page.evaluate((r) => { location.hash = r }, route)
    await sleep(700)
  }
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  return { app, page, profile, api, goto, shot, errors }
}
const isDenied = (r, product) => !!r && r.ok === false && r.code === 'license_required' && (!product || r.product === product)
const exists = (p) => fs.access(p).then(() => true, () => false)
const markGuidesSeen = (page) => page.evaluate(async () => {
  await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
  localStorage.setItem('zl-guide-seen', '1')
  localStorage.setItem('zl_configuration_level', 'basic')
})

// ================= 阶段 A：无 provider → 旧登录原样（简）=================
async function legacyPhase() {
  const { app, page, api, errors, profile } = await launch('legacy')
  try {
    check('legacy：cardState enabled=false（本机没有 license-provider.json）', (await api('cardState')).enabled === false)
    await page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
    check('legacy：注册页仍是邮箱验证码流程', (await page.getByPlaceholder('邮箱验证码').count()) === 1 && (await page.getByTestId('card-login-mode').count()) === 0)
    await page.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await markGuidesSeen(page)
    const pwd = 'Legacy-' + randomUUID().slice(0, 10)
    secrets.add(pwd)
    check('legacy：本地账号注册 / 登录走旧实现', (await api('register', 'legacy_e2e', pwd, '旧账号')).ok && (await api('login', 'legacy_e2e', pwd)).ok)
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    check('legacy：顶栏没有卡密授权入口', (await page.getByTestId('card-access-button').count()) === 0)
    const opened = await api('timeWidgetOpen', { enable: true, initial: 60, gifts: [], addGift: '', subGift: '' })
    check('legacy：开输出窗口不需要卡密', opened.ok === true && (await api('timeWidgetState')).open === true)
    await api('timeWidgetClose')
    check('legacy：只有旧账号文件、没有卡密账号文件', (await exists(path.join(profile, 'data/users.json'))) && !(await exists(path.join(profile, 'data/card_users.json'))))
    assert.deepEqual(errors, [], 'legacy 阶段页面报错')
  } finally {
    await app.close()
  }
}

// ================= 阶段 B：有 provider → 真实平台 =================
const stamp = Date.now()
const A = { email: `card-a-${stamp}@example.test`, password: 'E2e-' + randomUUID().slice(0, 16) }
const B = { email: `card-b-${stamp}@example.test`, password: 'E2e-' + randomUUID().slice(0, 16) }
secrets.add(A.password)
secrets.add(B.password)
const PLATFORM = 'platform:assistant'
const bjTime = (page, ts) => page.evaluate((t) => new Date(t * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), ts)

async function registerViaUi(page, acct) {
  await page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
  await page.getByPlaceholder('邮箱号').fill(acct.email)
  await page.getByPlaceholder('昵称（留空用邮箱名）').fill('')
  await page.getByPlaceholder('密码（至少 6 位）').fill(acct.password)
  await page.getByPlaceholder('确认密码').fill(acct.password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 30000 })
}
async function loginViaUi(page, acct) {
  await page.getByPlaceholder('邮箱 / 用户名').fill(acct.email)
  await page.getByPlaceholder('密码').fill(acct.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor({ timeout: 30000 })
}
async function logoutViaUi(page) {
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('button', { name: '切换账号', exact: true }).click()
  await page.getByPlaceholder('邮箱 / 用户名').waitFor()
}
/** 基础向导：5 分钟 + 小心心每个加 30 秒 → 保存 → 停在「开启倒计时窗口」 */
async function configureTimeGuide(page, goto) {
  await goto('/ent?tool=time')
  await page.getByTestId('time-setup-question').waitFor()
  await page.getByRole('button', { name: '5 分钟', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '设置礼物', exact: true }).click()
  await page.getByRole('button', { name: '小心心', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '保存，去开启窗口', exact: true }).click()
  await page.getByRole('button', { name: '开启倒计时窗口', exact: true }).waitFor()
}

async function cardPhase() {
  let { app, page, profile, api, goto, shot, errors } = await launch('card', { provider: true })
  let prompt = page.getByTestId('card-redeem-prompt')
  const bar = page.getByTestId('entertainment-card-bar')
  let laterBtn = () => page.getByRole('button', { name: '稍后激活', exact: true }).click()
  const errorsBefore = []
  try {
    await page.evaluate(() => { window.__lic = []; window.api.onCardLicenseRequired((p) => window.__lic.push(p)) })
    // ---- 登录页：卡密模式、旧凭据不预填 ----
    await page.locator('[data-testid="login-panel"][data-card-mode="1"]').waitFor()
    check('登录页保持原表单，不显示平台连接状态', (await page.getByTestId('card-login-mode').count()) === 0 && !(await page.getByTestId('login-panel').textContent()).includes('已连接'))
    check('旧服务器记住的凭据不预填给新平台（账号 / 密码框为空、无已保存账号）', (await page.getByPlaceholder('邮箱 / 用户名').inputValue()) === '' && (await page.getByPlaceholder('密码').inputValue()) === '' && (await page.getByRole('button', { name: '选择已保存的账号' }).count()) === 0 && (await api('credLoad')).last === null)
    await shot('01-login-card-mode')
    await markGuidesSeen(page)
    // ---- 注册（不要验证码）----
    await page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
    check('注册页不再要邮箱验证码', (await page.getByPlaceholder('邮箱验证码').count()) === 0)
    await page.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await registerViaUi(page, A)
    const st1 = await api('cardState')
    check('UI 注册 A 成功：平台会话建立、rights 四项全未激活', st1.ok && st1.user?.email === A.email && st1.rights?.length === 4 && st1.rights.every((r) => !r.allowed) && (await api('session'))?.email === A.email)
    // ---- 退出 → 错误密码不能复活旧会话 → 正确密码登录 ----
    await logoutViaUi(page)
    check('切换账号后会话已清空', (await api('session')) === null && !(await api('cardState')).user)
    await page.getByPlaceholder('邮箱 / 用户名').fill(A.email)
    await page.getByPlaceholder('密码').fill('wrong-' + A.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('status').filter({ hasText: /账号或密码/ }).waitFor()
    check('错误密码：提示账号或密码不正确、仍在登录页、旧 session 未复活', (await page.getByPlaceholder('密码').count()) === 1 && (await api('session')) === null && !(await api('cardState')).user)
    await page.getByPlaceholder('密码').fill('')
    await loginViaUi(page, A)
    check('正确密码登录 A', (await api('session'))?.email === A.email)

    // ---- 未激活四项 + 无购买 ----
    await page.getByTestId('card-access-button').click()
    let dialog = page.getByRole('dialog')
    await dialog.getByTestId('card-rights').waitFor()
    const rows = dialog.locator('[data-card-right]')
    const rowTexts = await rows.allTextContents()
    check('顶栏卡密弹窗：四项全部「未激活」', rowTexts.length === 4 && rowTexts.every((t) => t.includes('未激活')) && (await dialog.textContent()).includes(A.email))
    check('未激活时没有购买 / 申请 / 封锁 / 平台入口类文案', (await dialog.getByText(/购买|申请授权|已封锁|测试账号|打开卡密平台|平台管理员/).count()) === 0 && (await dialog.getByRole('button', { name: /平台|后台/ }).count()) === 0 && (await dialog.getByTestId('card-refresh-failed').count()) === 0)
    await shot('02-topbar-unactivated')
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    await page.getByRole('button', { name: '账号菜单', exact: true }).click()
    check('侧栏账号菜单没有「购买授权」（平台不给购买联系方式）', (await page.getByRole('button', { name: '购买授权' }).count()) === 0)
    await page.locator('.fixed.inset-0.z-10').click({position:{x:5,y:5}})
    await page.getByRole('button', { name: '切换账号', exact: true }).waitFor({ state: 'hidden' })

    // ---- 参数 / 遥控 / 启动页：权限来自新平台映射（未激活 → 门禁）----
    await goto('/config')
    await page.getByText(/尚未授权|尚未激活/).waitFor()
    check('参数调整：无任何游戏卡 → 门禁面板（权限来自平台映射）', true)
    await goto('/remote')
    await page.getByText(/尚未授权|尚未激活/).waitFor()
    check('整蛊遥控：无任何游戏卡 → 门禁面板', true)
    await goto('/launch')
    // 游戏库网格里「轮椅模拟器」卡片上的「启动」：切当前游戏 → launchGame（占位 exe 已定位，所以有启动按钮）
    const wheelCard = page.locator('div.group', { hasText: '轮椅模拟器' })
    await wheelCard.getByRole('button', { name: '启动', exact: true }).waitFor()
    await wheelCard.getByRole('button', { name: '启动', exact: true }).click()
    await prompt.waitFor()
    check('启动游戏（临时占位 exe）：主进程门禁拦下并弹激活窗，进程未启动', (await prompt.getAttribute('data-product')) === 'game:4wheel-challenge' && (await api('gameState')).running === false, '夹具')
    await laterBtn()

    // ---- 娱乐助手：未激活可配向导，开窗口弹激活 ----
    await configureTimeGuide(page, goto)
    check('娱乐助手状态条：未激活 + 可以先配置', (await bar.textContent()).includes('未激活') && (await bar.textContent()).includes('可以先配置'))
    check('未激活也能走完倒计时向导并保存配置', (await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg') || '{}'))).initial === 300)
    await page.getByRole('button', { name: '开启倒计时窗口', exact: true }).click()
    await prompt.waitFor()
    check('开启倒计时窗口被主进程拦下：弹激活窗（platform:assistant）、向导显示原因、窗口没开', (await prompt.getAttribute('data-product')) === PLATFORM && (await page.getByRole('alert').filter({ hasText: /授权|激活/ }).count()) >= 1 && (await api('timeWidgetState')).open === false && (await page.evaluate(() => window.__lic)).includes(PLATFORM))
    await shot('03-ent-gate-prompt')
    // 门禁弹窗内真实兑换娱乐助手卡（入口 1）
    await prompt.getByRole('textbox', { name: '卡密', exact: true }).fill('ZL-0000-0000-0000-0000-0000-0000-0000-0000')
    await prompt.getByRole('button', { name: '激活', exact: true }).click()
    await prompt.getByRole('alert').waitFor()
    check('错误卡密：平台原因 + 怎么重试', /卡密无效|作废/.test(await prompt.getByRole('alert').textContent()) && (await api('cardState')).rights.every((r) => !r.allowed))
    await prompt.getByRole('textbox', { name: '卡密', exact: true }).fill(platform.cards.platform[0])
    await prompt.getByRole('button', { name: '激活', exact: true }).click()
    await prompt.getByRole('status').filter({ hasText: '再次点击原功能按钮' }).waitFor()
    const afterPlatform = await api('cardState')
    check('门禁弹窗内兑换娱乐助手周卡：平台权益 allowed（入口 1）', afterPlatform.rights.find((r) => r.id === PLATFORM)?.allowed === true && (await prompt.getByRole('textbox', { name: '卡密' }).count()) === 0)
    await page.getByRole('button', { name: '返回使用', exact: true }).click()
    await page.getByRole('button', { name: '开启倒计时窗口', exact: true }).click()
    await page.getByRole('button', {name:'关闭倒计时窗口',exact:true}).waitFor()
    await waitFor(async()=>(await api('timeWidgetState')).open===true,'倒计时未实际开启')
    const stOpen = await api('timeWidgetState')
    check('激活后开启真实倒计时窗口：open、running、剩余≈300 秒', stOpen.open === true && stOpen.running === true && stOpen.remaining > 290 && stOpen.remaining <= 300)
    check('状态条只显示到期时间，不再催激活', (await bar.textContent()).includes('到期时间') && (await bar.getByRole('button', { name: '激活卡密' }).count()) === 0)
    await shot('04-ent-activated')
    // 模拟礼物（互动工具页真实按钮 → connectorSimulate → 时间挂件）
    await goto('/ent?tool=tools')
    const before = (await api('timeWidgetState')).remaining
    await page.getByRole('button', { name: '送礼物', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已模拟礼物' }).waitFor()
    const after = await waitFor(async () => { const s = await api('timeWidgetState'); return s.remaining >= before + 25 ? s : null }, '模拟礼物后倒计时没有 +30', 8000)
    check('模拟礼物「小心心」真实改变倒计时（+30 秒，扣除走秒）', after.remaining >= before + 25 && after.remaining <= before + 31)

    // ---- 设置页（入口 2）：权益中文期限与平台一致；错误卡密走真实平台 ----
    await goto('/settings')
    const acct = page.getByTestId('account-card-access')
    await acct.locator(`[data-card-right="${PLATFORM}"]`).filter({ hasText: '已激活' }).waitFor()
    const rightsA = await fixture({ op: 'rights', email: A.email })
    const expPlatform = rightsA.rights.find((r) => r.id === PLATFORM).expires_at
    const platformRowText = await acct.locator(`[data-card-right="${PLATFORM}"]`).textContent()
    check('设置页到期时间 = 平台 expires_at（北京时间）+ 剩余天数', platformRowText.includes('到期时间：' + (await bjTime(page, expPlatform))) && platformRowText.includes('（北京时间）') && /剩余 [67] 天/.test(platformRowText))
    check('设置页三款游戏仍未激活、标题改为账号与卡密授权', (await acct.locator('[data-card-right^="game:"]').allTextContents()).every((t) => t.includes('未激活')) && (await page.getByRole('heading', { name: '账号与卡密授权' }).count()) === 1)
    await acct.getByRole('textbox', { name: '卡密', exact: true }).fill('ZL-1111-2222-3333-4444-5555-6666-7777-8888')
    await acct.getByRole('button', { name: '激活卡密', exact: true }).click()
    await acct.getByRole('alert').waitFor()
    check('设置页激活表单走真实平台：不存在的卡密回「卡密无效」+ 怎么重试', /卡密无效|作废/.test(await acct.getByRole('alert').textContent()) && /核对|重新复制|重试/.test(await acct.getByRole('alert').textContent()))
    await acct.getByRole('textbox', { name: '卡密', exact: true }).fill('')
    await shot('05-settings-activated')

    // ---- Mod 详情（入口 3）：真实兑换图书管理员卡，三处同步 ----
    const mods = await api('listMods')
    const target = mods.mods.find((m) => m.gameId === 'librarian')
    assert.ok(target, '内置清单里要有图书管理员 Mod（gameId=librarian）')
    await goto('/mod/' + target.id)
    const modCard = page.getByTestId('mod-card-access')
    await modCard.waitFor()
    check('Mod 详情：Mod 未激活、娱乐助手显示到期时间', (await modCard.getByTestId('mod-card-expiry').textContent()).includes('Mod · 未激活') && (await modCard.textContent()).includes('娱乐助手 · 到期时间'))
    await modCard.getByRole('button', { name: '激活卡密', exact: true }).click()
    await prompt.waitFor()
    check('Mod 详情激活入口直达 game:librarian', (await prompt.getAttribute('data-product')) === 'game:librarian')
    await prompt.getByRole('textbox', { name: '卡密', exact: true }).fill(platform.cards.librarian[0])
    await prompt.getByRole('button', { name: '激活', exact: true }).click()
    await prompt.getByRole('status').filter({ hasText: '授权已生效' }).waitFor()
    await page.getByRole('button', { name: '返回使用', exact: true }).click()
    await modCard.getByText('已激活', { exact: true }).waitFor()
    const rightsA2 = await fixture({ op: 'rights', email: A.email })
    const expLib = rightsA2.rights.find((r) => r.id === 'game:librarian').expires_at
    check('Mod 详情兑换月卡后：已激活 + 到期时间与平台一致（入口 3）', (await modCard.getByTestId('mod-card-expiry').textContent()).includes('Mod · 到期时间：' + (await bjTime(page, expLib))) && rightsA2.rights.find((r) => r.id === 'game:librarian').allowed === true)
    check('未激活 / 已激活都保留安装管理按钮（门禁在主进程）', (await page.getByRole('button', { name: /安装|待发售/ }).count()) >= 1)
    await shot('06-mod-activated')
    await page.getByTestId('card-access-button').click()
    await dialog.getByTestId('card-rights').waitFor()
    const synced = await dialog.locator('[data-card-right]').allTextContents()
    check('三个入口同步：顶栏弹窗里娱乐助手 + 图书管理员已激活、另两款未激活', synced.filter((t) => t.includes('已激活')).length === 2 && synced.filter((t) => t.includes('未激活')).length === 2)
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    await goto('/settings')
    await acct.locator('[data-card-right="game:librarian"]').filter({ hasText: '已激活' }).waitFor()
    check('设置页也同步显示图书管理员已激活', true)

    // ---- 参数 / 遥控 / 命令：权限映射到已激活的游戏 ----
    const settled = async () => {
      await page.locator('[aria-haspopup="listbox"]').first().waitFor()
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 15000 }).catch(() => {})
      await sleep(500)
    }
    await goto('/config')
    await settled()
    await page.locator('[aria-haspopup="listbox"]').first().click()
    const options = page.getByRole('option')
    await options.first().waitFor()
    const optionState = await options.evaluateAll((els) => els.map((el) => ({ text: el.textContent || '', disabled: el.disabled })))
    await page.keyboard.press('Escape')
    check('参数调整：游戏选择器按平台权益放行——图书管理员可选、轮椅 / DON\'T SCREAM 禁用，且无门禁面板', (await page.getByText(/尚未授权|尚未激活/).count()) === 0 && optionState.some((o) => o.text.includes('图书管理员') && !o.disabled) && optionState.filter((o) => o.disabled).length === 2)
    await goto('/remote')
    await settled()
    check('整蛊遥控：有图书管理员卡 → 不再显示门禁面板', (await page.getByText(/尚未授权|尚未激活/).count()) === 0)
    await api('setGameCurrent', 'librarian')
    const cmd = await api('liveCmd', 'noop')
    check('已授权游戏的整蛊命令过门禁、落到原实现（占位游戏未运行）', !isDenied(cmd) && cmd.ok === false && /未在运行|bridge/.test(cmd.error || ''), '夹具')
    await api('setGameCurrent', '4wheel-challenge')
    check('未授权游戏的整蛊命令仍被拦', isDenied(await api('liveCmd', 'noop'), 'game:4wheel-challenge'))
    await api('setGameCurrent', 'librarian')

    // 本测试只验绑定状态展示/解绑；完整扫码与提交另由 test-card-room-main/ui 覆盖。
    await fixture({ op: 'bind', email: A.email, room: '123456' })
    const bound = await api('cardRooms')
    check('读取服务端已有绑定并同步当前账号', bound.ok === true && bound.quota.rooms.includes('123456'))
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    await goto('/settings')
    await page.getByText('123456', { exact: true }).waitFor()
    await page.getByRole('button', { name: '解绑', exact: true }).click()
    await page.getByRole('button', { name: '确认解绑', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已解绑' }).waitFor()
    // toast 在 unbindRoom 返回后立刻出现，列表 / session 的更新紧随其后：按「变了什么」等，不在瞬时状态上断言
    await page.getByText('123456', { exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
    await waitFor(async () => (await api('session')).boundRooms.length === 0, '解绑后 5 秒内 session.boundRooms 未清空', 5000)
    check('设置页显示绑定的直播间并可解绑（走主进程真实通道）', true)

    // ---- 后台收回：输出被关、再次使用被拒、UI 同步 ----
    await goto('/ent?tool=time')
    check('收回前：倒计时窗口仍开着', (await api('timeWidgetState')).open === true)
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'revoke' })
    await waitFor(async () => (await api('timeWidgetState')).open === false, '后台收回后 8 秒内输出窗口没有关闭', 8000)
    await bar.getByRole('button', { name: '激活卡密', exact: true }).waitFor({ timeout: 9000 })
    check('后台收回娱乐助手：复核关掉倒计时窗口、状态条变「已收回」', (await bar.textContent()).includes('已收回'), '夹具')
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await prompt.waitFor()
    check('收回后再次开启被拒：弹激活窗、窗口没开', (await prompt.getAttribute('data-product')) === PLATFORM && (await api('timeWidgetState')).open === false)
    await shot('07-ent-revoked')
    await laterBtn()
    await goto('/mod/' + target.id)
    await modCard.getByText('未激活', { exact: true }).waitFor({ timeout: 9000 })
    check('收回娱乐助手后 Mod 详情也变未激活（游戏权益要娱乐助手同时有效）', (await modCard.getByTestId('mod-card-expiry').textContent()).includes('娱乐助手 · 已收回'))
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'permanent' })
    await goto('/ent?tool=time')
    await bar.filter({ hasText: '永久' }).waitFor({ timeout: 9000 })
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await page.getByRole('button', {name:'关闭倒计时窗口',exact:true}).waitFor()
    await waitFor(async()=>(await api('timeWidgetState')).open===true,'倒计时未实际开启')
    check('后台直授永久：状态条「永久」、立刻能再开', (await api('timeWidgetState')).open === true, '夹具')

    // ---- 到期：指定 12 秒后到期 → 输出被关、UI 显示已到期 ----
    const now = (await fixture({ op: 'now' })).now
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'set_expiry', expires_at: now + 12 })
    await sleep(2500)
    check('到期前 2.5 秒：短期授权仍有效、窗口仍开着', (await api('timeWidgetState')).open === true, '夹具')
    await waitFor(async () => (await api('timeWidgetState')).open === false, '授权到期后 20 秒内输出窗口没有关闭', 20000)
    await bar.filter({ hasText: '已到期' }).waitFor({ timeout: 9000 })
    check('授权到期：复核关掉窗口、状态条「已到期：<北京时间>」', /已到期：.+（北京时间）/.test(await bar.textContent()))
    await page.getByTestId('card-access-button').click()
    await dialog.getByTestId('card-rights').waitFor()
    check('顶栏弹窗同步已到期、未激活', (await dialog.locator(`[data-card-right="${PLATFORM}"]`).textContent()).includes('已到期') && (await dialog.locator(`[data-card-right="${PLATFORM}"]`).textContent()).includes('未激活'))
    await shot('08-topbar-expired')
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    check('到期后再开被拒', isDenied(await api('timeWidgetOpen', { enable: true, initial: 300, gifts: [], addGift: '', subGift: '' }), PLATFORM))
    await prompt.waitFor();await laterBtn()
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'permanent' })
    await goto('/ent?tool=time')
    await bar.filter({ hasText: '永久' }).waitFor({ timeout: 9000 })
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await page.getByRole('button', {name:'关闭倒计时窗口',exact:true}).waitFor()
    await waitFor(async()=>(await api('timeWidgetState')).open===true,'倒计时未实际开启')

    // ---- 换账号：旧配置不丢，旧权益不能继续用 ----
    const rulesBefore = (await api('entertainmentRulesList')).length
    await logoutViaUi(page)
    check('切换账号：登出即关输出、会话清空', (await api('timeWidgetState')).open === false && (await api('session')) === null)
    check('登录页有已保存的卡密账号 A、密码不预填', (await page.getByRole('button', { name: '选择已保存的账号' }).count()) === 1 && (await page.getByPlaceholder('密码').inputValue()) === '')
    await registerViaUi(page, B)
    check('注册并登录 B：四项全未激活', (await api('cardState')).rights.every((r) => !r.allowed) && (await api('session'))?.email === B.email)
    await goto('/ent?tool=time')
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).waitFor()
    check('换账号后旧倒计时配置仍在（initial=300、规则数不变）', (await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg') || '{}'))).initial === 300 && (await api('entertainmentRulesList')).length === rulesBefore)
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await prompt.waitFor()
    check('B 没有权益：用 A 留下的配置开窗口被拒（旧权益不跟配置走）', (await prompt.getAttribute('data-product')) === PLATFORM && (await api('timeWidgetState')).open === false)
    await laterBtn()
    await goto('/settings')
    await acct.getByRole('textbox', { name: '卡密', exact: true }).fill(platform.cards.platform[0])
    await acct.getByRole('button', { name: '激活卡密', exact: true }).click()
    await acct.getByRole('alert').waitFor()
    check('B 输入 A 用过的卡：平台回「卡密已被使用」、不授权', /已被使用|已使用|已兑换/.test(await acct.getByRole('alert').textContent()) && (await api('cardState')).rights.every((r) => !r.allowed))
    await acct.getByRole('textbox', { name: '卡密', exact: true }).fill(platform.cards.platform[1])
    await acct.getByRole('button', { name: '激活卡密', exact: true }).click()
    await acct.locator(`[data-card-right="${PLATFORM}"]`).filter({ hasText: '已激活' }).waitFor()
    check('B 在设置页真实兑换娱乐助手卡：已激活（入口 2 真实兑换）', (await acct.getByRole('textbox', { name: '卡密', exact: true }).inputValue()) === '' && (await api('cardState')).rights.find((r) => r.id === PLATFORM).allowed === true)
    await goto('/ent?tool=time')
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await page.getByRole('button', {name:'关闭倒计时窗口',exact:true}).waitFor()
    await waitFor(async()=>(await api('timeWidgetState')).open===true,'倒计时未实际开启')
    check('B 激活后能用同一份配置开倒计时', (await api('timeWidgetState')).open === true)
    check('账号列表只有两个卡密账号', (await api('listAccounts')).map((a) => a.email).sort().join() === [A.email, B.email].sort().join())
    await logoutViaUi(page)
    await loginViaUi(page, A)
    const stA = await api('cardState')
    check('切回 A：权益仍是 A 的（娱乐助手永久 + 图书管理员）、B 的输出已关', stA.user.email === A.email && stA.rights.find((r) => r.id === PLATFORM).permanent === true && stA.rights.find((r) => r.id === 'game:librarian').allowed === true && (await api('timeWidgetState')).open === false)

    // ---- 平台掉线（2026-09-13 起）：A 的娱乐助手是永久卡 → 输出照常、再开也放行；UI 只提示网络；只有平台明确拒绝才关 ----
    await goto('/ent?tool=time')
    await page.getByRole('button', { name: '开启现有倒计时', exact: true }).click()
    await page.getByRole('button', {name:'关闭倒计时窗口',exact:true}).waitFor()
    await waitFor(async()=>(await api('timeWidgetState')).open===true,'倒计时未实际开启')
    const mirrored = await fixture({ op: 'mirror', email: A.email, machine: machineId })
    check('夹具能按 邮箱 + 本机机器码 出离线凭证镜像包（娱乐助手 + 图书管理员）', mirrored.bundle && mirrored.bundle.leases[PLATFORM] && mirrored.bundle.leases['game:librarian'] && /^updates\/leases\/[0-9a-f]{64}\.json$/.test(mirrored.key), '夹具')
    const platformPort = Number(new URL(platform.origin).port)
    service.kill()
    await waitFor(() => !serviceAlive, '夹具平台未退出', 5000)
    await sleep(8500)   // 超过复核周期（回归里 ZL_CARD_RECHECK_MS=2000）+ 快照刷新周期（ZL_CARD_POLL_MS=3000）好几轮
    check('平台掉线：永久卡账号的倒计时窗口不关（网络问题绝不掉线）', (await api('timeWidgetState')).open === true)
    const stOffline = await api('cardState')
    check('掉线时 cardState 是离线快照：ok、offline、权益 allowed 来自验过签的凭证、带有效期', stOffline.ok === true && stOffline.offline === true && stOffline.user?.email === A.email && stOffline.rights.find((r) => r.id === PLATFORM).allowed === true && stOffline.rights.find((r) => r.id === PLATFORM).permanent === true && stOffline.rights.find((r) => r.id === 'game:librarian').allowed === true && stOffline.rights.find((r) => r.id === 'game:dontscream').allowed === false && stOffline.offlineUntil > Date.now() / 1000)
    await page.getByTestId('card-access-button').click()
    await dialog.getByTestId('card-offline-notice').waitFor({ timeout: 9000 })
    const offlineText = await dialog.textContent()
    check('顶栏弹窗提示「平台暂时联系不上，正按本机保存的授权继续使用（有效到 …）」，不带服务地址 / 底层原文', /平台暂时联系不上/.test(offlineText) && /有效到/.test(offlineText) && !/127\.0\.0\.1|fetch|ECONN/.test(offlineText))
    check('离线时权益照常显示且来自签名凭证：四项都在、娱乐助手永久已激活、图书管理员已激活、邮箱与卡密输入框仍在', offlineText.includes(A.email) && (await dialog.locator('[data-card-right]').count()) === 4 && (await dialog.locator(`[data-card-right="${PLATFORM}"]`).textContent()).includes('永久') && (await dialog.locator('[data-card-right="game:librarian"]').textContent()).includes('已激活') && (await dialog.getByTestId('card-refresh-failed').count()) === 0 && (await dialog.getByRole('textbox', { name: '卡密', exact: true }).count()) === 1)
    await dialog.getByRole('button', { name: '刷新授权', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '平台暂时联系不上' }).waitFor()
    check('掉线时点刷新授权：说明正按本机授权继续，不说「授权已刷新」', (await page.getByRole('status').filter({ hasText: '授权已刷新' }).count()) === 0)
    await shot('09-platform-offline')
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    await api('timeWidgetClose')
    const offline = await api('timeWidgetOpen', { enable: true, initial: 300, gifts: [], addGift: '', subGift: '' })
    check('掉线后再开也放行（按上次平台给的永久授权）', offline.ok === true && (await api('timeWidgetState')).open === true)
    check('掉线时没有弹门禁（不是拒绝，是离线放行）', (await prompt.count()) === 0)
    const offlineLog = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
    check('主进程日志记录了「平台暂时联系不上，按上次授权继续」', /按上次授权继续/.test(offlineLog), offlineLog.split('\n').filter((l) => l.includes('[card]')).slice(-3).join(' | '))
    await shot('09b-offline-grace')

    // ---- 平台还没恢复时重启客户端：离线登录（本机签名凭证 + 本机核对密码）→ 照样能开输出 ----
    const leaseFile = path.join(profile, 'data/card-offline-leases.json')
    const leaseSaved = JSON.parse(await fs.readFile(leaseFile, 'utf8'))
    check('离线凭证文件已落盘：账号、scrypt 核对值、验过签的两张凭证；不含密码本身', leaseSaved.user && leaseSaved.verifier?.salt && leaseSaved.verifier?.hash && typeof leaseSaved.leases?.[PLATFORM] === 'string' && typeof leaseSaved.leases?.['game:librarian'] === 'string' && !leaseSaved.leases['game:dontscream'] && !JSON.stringify(leaseSaved).includes(A.password))
    errorsBefore.push(...errors)
    await app.close()
    ;({ app, page, api, goto, shot, errors } = await launch('card-restart', { profile }))
    prompt = page.getByTestId('card-redeem-prompt')
    dialog = page.getByRole('dialog')
    laterBtn = () => page.getByRole('button', { name: '稍后激活', exact: true }).click()
    await page.locator('[data-testid="login-panel"][data-card-mode="1"]').waitFor()
    await page.getByPlaceholder('邮箱 / 用户名').fill(A.email)
    await page.getByPlaceholder('密码').fill('wrong-' + A.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('status').filter({ hasText: /账号或密码/ }).waitFor()
    check('平台不在时用错密码：本机核对不过、不放行、仍在登录页', (await api('session')) === null && (await page.getByPlaceholder('密码').count()) === 1)
    await page.getByPlaceholder('密码').fill('')
    await loginViaUi(page, A)
    const stRestart = await api('cardState')
    check('平台不在时用正确密码：离线登录成功（会话是 A、快照 offline、娱乐助手永久 + 图书管理员 allowed）', (await api('session'))?.email === A.email && stRestart.ok === true && stRestart.offline === true && stRestart.rights.find((r) => r.id === PLATFORM).allowed === true && stRestart.rights.find((r) => r.id === 'game:librarian').allowed === true)
    const openedOffline = await api('timeWidgetOpen', { enable: true, initial: 300, gifts: [], addGift: '', subGift: '' })
    check('离线登录后能开输出窗口、不弹门禁', openedOffline.ok === true && (await api('timeWidgetState')).open === true && (await prompt.count()) === 0)
    check('主进程日志：用本机签名凭证离线登录', /签名凭证离线登录/.test(await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8')))
    await shot('09c-offline-login')
    await logoutViaUi(page)
    check('离线登录后退出：输出关、会话清空、本机凭证文件作废', (await api('timeWidgetState')).open === false && (await api('session')) === null && JSON.parse(await fs.readFile(leaseFile, 'utf8').catch(() => 'null')) === null)

    // ---- 凭证文件被改过：验签不过 → 不放行；镜像也没有 → 就是普通的连不上 ----
    const tampered = JSON.parse(JSON.stringify(leaseSaved))
    const [h, body, sig] = tampered.leases[PLATFORM].split('.')
    tampered.leases[PLATFORM] = h + '.' + body.slice(0, -2) + (body.slice(-2) === 'AA' ? 'BB' : 'AA') + '.' + sig
    await fs.writeFile(leaseFile, JSON.stringify(tampered), 'utf8')
    await page.getByPlaceholder('邮箱 / 用户名').fill(A.email)
    await page.getByPlaceholder('密码').fill(A.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('status').waitFor()
    check('改过的凭证（验签不过）：不能离线登录，仍在登录页、会话为空', (await api('session')) === null && (await page.getByPlaceholder('密码').count()) === 1 && !(await page.getByRole('status').textContent()).includes('账号或密码'))

    // ---- 更新源上的镜像包：本机没有可用凭证时从更新源拿（验签 + 绑机器）→ 离线登录（本机没有密码核对记录）----
    mirrorBundle = mirrored.bundle
    mirrorKey = mirrored.key
    await page.getByPlaceholder('密码').fill('')
    await loginViaUi(page, A)
    const stMirror = await api('cardState')
    check('镜像包离线登录成功：快照 offline、权益来自镜像里验过签的凭证', (await api('session'))?.email === A.email && stMirror.ok === true && stMirror.offline === true && stMirror.rights.find((r) => r.id === PLATFORM).allowed === true)
    check('主进程日志：镜像登录标明本机没有密码核对记录', /本机没有密码核对记录/.test(await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8')))
    const openedMirror = await api('timeWidgetOpen', { enable: true, initial: 300, gifts: [], addGift: '', subGift: '' })
    check('镜像包离线登录后能开输出窗口', openedMirror.ok === true && (await api('timeWidgetState')).open === true)

    // ---- 平台恢复：客户端自动切回在线（不用重新登录、输出不断）；恢复后后台收回照样立刻关 ----
    startService(platformPort)
    const platform2 = JSON.parse(await nextLine(60000))
    check('夹具平台在原地址重启（同一把签名密钥）', platform2.origin === platform.origin && platform2.publicKey === platform.publicKey, '夹具')
    await waitFor(async () => { const s = await api('cardState'); return s.ok && !s.offline && s.user?.email === A.email }, '平台恢复后 20 秒内没切回在线', 20000, 500)
    check('平台恢复后自动切回在线授权，期间输出窗口一直开着', (await api('timeWidgetState')).open === true && /切回在线授权/.test(await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8')))
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'revoke' })
    await waitFor(async () => (await api('timeWidgetState')).open === false, '平台恢复后后台收回没有关输出', 12000)
    check('平台恢复后后台收回：输出立刻关（封禁 / 收回信号照常有效）', (await api('cardState')).rights.find((r) => r.id === PLATFORM).allowed === false)
    const stAfterRevoke = await api('cardState')
    check('收回后本机凭证里娱乐助手那张已作废（离线也不能再用）', !stAfterRevoke.offline && JSON.parse(await fs.readFile(leaseFile, 'utf8')).leases[PLATFORM] === undefined)
    await fixture({ op: 'grant', email: A.email, product: PLATFORM, mode: 'permanent' })
    await shot('09d-platform-back')
    service.kill()
    await waitFor(() => !serviceAlive, '夹具平台未退出', 5000)

    // ---- 文件与日志 ----
    check('卡密模式从未写旧账号文件；卡密账号文件与专用凭据文件已建', !(await exists(path.join(profile, 'data/users.json'))) && (await exists(path.join(profile, 'data/card_users.json'))) && (await fs.readdir(path.join(profile, 'data'))).some((f) => /^creds-card-/.test(f)))
    const log = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
    check('主进程日志不含卡密 / 密码', !CARD_RE.test(log) && !log.includes(A.password) && !log.includes(B.password))
    CARD_RE.lastIndex = 0
    check('card 阶段页面无报错（含重启后）', errorsBefore.length === 0 && errors.length === 0 && JSON.stringify([...errorsBefore, ...errors]))

    // ---- 关闭主窗口：不要求授权、正常退出 ----
    const exited = new Promise((resolve) => app.process().once('exit', (code) => resolve(code ?? 0)))
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('index.html')) w.close()
    })
    const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')])
    check('平台不可达时关闭主窗口：不弹授权、15 秒内正常退出', code === 0)
  } finally {
    try { await app.close() } catch { /* 已退出 */ }
  }
}

let completed = false
let error = ''
try {
  if (!skipLegacy) await legacyPhase()
  await cardPhase()
  completed = true
  console.log(`FORMAL-CARD-E2E ${checks.length}/${checks.length} PASS; outDir=${outDir}; screenshots=${out}`)
} catch (e) {
  error = mask(e.stack || e.message)
  console.error('FAIL ' + mask(e.message))
} finally {
  stopService()
  mirror.close()
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({
    completed, error, outDir, platformOrigin: platform.origin, checks, errors: errorsAll.flat(),
    real: checks.filter((c) => c.kind === '实际').length, fixture: checks.filter((c) => c.kind === '夹具').length,
    finishedAt: new Date().toISOString()
  }, null, 2))
}
if (!completed) process.exit(1)

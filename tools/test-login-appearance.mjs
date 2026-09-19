// 登录页外观回归（renderer）：登录 / 注册 / 找回密码三页要和原版登录页（1b69cd3）一样，
// 不出现「已连接 / 未连接授权服务」「卡密平台」这类实现细节；验证码流程与原布局按钮仍在；
// 登录失败时原 toast 仍显示主进程给的具体原因。
// 三个隐藏、隔离的 Electron 实例（假游戏路径、临时 profile），不连任何服务、不发验证码、不登录真实账号：
//   legacy       ：profile 没有 license-provider.json → 原账号系统
//   card-online  ：provider 文件 + 主进程内临时桩，卡密平台「已连接」（identityMode=existing，需验证码）
//   card-offline ：同上但桩报 ok=false（平台连不上）
// 用法：node tools/test-login-appearance.mjs [--out-dir output/fable-login-appearance-build]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const outDir = argValue('--out-dir', 'output/fable-login-appearance-build')
const out = path.join(root, 'output/playwright/login-appearance')
await fs.mkdir(out, { recursive: true })

// 通道名从 shared/types.ts 读，和主进程 / preload 同一份真相
const typesText = await fs.readFile(path.join(root, 'src/shared/types.ts'), 'utf8')
const channel = (key) => {
  const m = typesText.match(new RegExp(`\\b${key}:\\s*'([^']+)'`))
  assert.ok(m, `shared/types.ts 缺少 Ipc.${key}`)
  return m[1]
}
const CH = {
  state: channel('CardState'),
  session: channel('AuthSession'),
  emailLogin: channel('EmailLogin'),
  sendCode: channel('EmailSendCode')
}

// 登录面板里不该出现的实现细节文案（原版登录页没有这些）
const FORBIDDEN = /授权服务|卡密平台|已连接|未连接|连不上|平台账号|用邮箱账号登录/
const FIXTURE_EMAIL = 'login-appearance@example.test'
const LOGIN_FAIL_ONLINE = '账号或密码不正确'
const LOGIN_FAIL_OFFLINE = '无法连接授权服务：connect ECONNREFUSED 127.0.0.1:1'

const checks = []
const screenshots = []
const check = (name, value) => {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}
const shot = async (page, name) => {
  const file = path.join(out, name + '.png')
  await page.screenshot({ path: file })
  screenshots.push(file)
  console.log('SHOT ' + file)
}

async function launch(tag, { provider = false } = {}) {
  const profile = await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
  if (provider) {
    // 只让主进程报告 enabled=true；地址指向没有服务的端口，公钥是格式合法的占位值（32 字节全 0）
    await fs.writeFile(
      path.join(profile, 'license-provider.json'),
      JSON.stringify({ provider: 'card', origin: 'http://127.0.0.1:1/card', publicKey: Buffer.alloc(32).toString('base64url') })
    )
  }
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry], cwd: root, env })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(tag + ': ' + e.message))
  return { app, page, profile, errors }
}

// 主进程内临时桩：卡密快照 / 会话 / 邮箱登录 / 发验证码 都不出进程
async function installStub(app, { online }) {
  await app.evaluate(
    ({ ipcMain }, { CH, online, FIXTURE_EMAIL, LOGIN_FAIL_ONLINE, LOGIN_FAIL_OFFLINE }) => {
      const stub = { logins: [], codes: [] }
      global.__loginStub = stub
      for (const c of [CH.state, CH.session, CH.emailLogin, CH.sendCode]) ipcMain.removeHandler(c)
      ipcMain.handle(CH.state, async () =>
        online
          ? { ok: true, enabled: true, origin: 'http://127.0.0.1:1/card', identityMode: 'existing', registrationRequiresCode: true, rights: [] }
          : { ok: false, enabled: true, origin: 'http://127.0.0.1:1/card', identityMode: 'existing', registrationRequiresCode: true, error: 'connect ECONNREFUSED 127.0.0.1:1' }
      )
      ipcMain.handle(CH.session, async () => null)
      ipcMain.handle(CH.emailLogin, async (_e, email, password) => {
        stub.logins.push({ email, passwordType: typeof password })
        return { ok: false, error: online ? LOGIN_FAIL_ONLINE : LOGIN_FAIL_OFFLINE }
      })
      ipcMain.handle(CH.sendCode, async (_e, email) => {
        stub.codes.push(email)
        return email === FIXTURE_EMAIL ? { ok: true } : { ok: false, error: '邮箱不存在' }
      })
    },
    { CH, online, FIXTURE_EMAIL, LOGIN_FAIL_ONLINE, LOGIN_FAIL_OFFLINE }
  )
}
const stubInfo = (app) => app.evaluate(() => global.__loginStub)

const panel = (page) => page.getByTestId('login-panel')
const panelText = (page) => panel(page).evaluate((el) => el.textContent || '')
const toastWith = (page, text) => page.locator('[role="status"] button').filter({ hasText: text })
const waitPanel = async (page) => {
  await page.waitForFunction(() => !!window.api?.login)
  await page.waitForSelector('[data-testid="login-panel"][data-card-loaded="1"]')
}

// 原版布局：登录页各控件都在，且面板第一个子元素就是表单（前面没有任何状态条）
async function assertLoginLayout(page, tag) {
  const p = panel(page)
  const firstChild = await p.evaluate((el) => el.firstElementChild?.tagName)
  check(`${tag}: 登录面板第一个元素就是表单，前面没有状态条`, firstChild === 'FORM')
  check(`${tag}: 首个标签是「用账户名称登录」`, (await p.getByText('用账户名称登录', { exact: true }).count()) === 1)
  check(`${tag}: 账号 / 密码输入框在`, (await p.getByPlaceholder('邮箱 / 用户名').count()) === 1 && (await p.getByPlaceholder('密码', { exact: true }).count()) === 1)
  const remember = p.getByRole('checkbox', { name: '记住密码' })
  const auto = p.getByRole('checkbox', { name: '自动登录' })
  check(`${tag}: 记住密码 / 自动登录 两个勾选框在`, (await remember.count()) === 1 && (await auto.count()) === 1)
  check(`${tag}: 登录按钮在`, (await p.getByRole('button', { name: '登录', exact: true }).count()) === 1)
  check(`${tag}: 忘记密码 / 创建账号 两个入口在`, (await p.getByRole('button', { name: '忘记密码，无法登录？', exact: true }).count()) === 1 && (await p.getByRole('button', { name: '没有账号？创建账号', exact: true }).count()) === 1)
  check(`${tag}: 登录面板没有授权服务 / 平台连接类文案`, !FORBIDDEN.test(await panelText(page)))
  check(`${tag}: 页面上没有 card-login-mode 状态条`, (await page.getByTestId('card-login-mode').count()) === 0)
  // 原版行为：取消记住密码 → 自动登录不可勾选；勾回来恢复
  await remember.uncheck()
  check(`${tag}: 取消记住密码后自动登录禁用`, await auto.isDisabled())
  await remember.check()
  check(`${tag}: 勾回记住密码后自动登录可用`, !(await auto.isDisabled()))
}

async function assertRegisterLayout(page, tag) {
  const p = panel(page)
  await p.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
  await p.getByText('注册邮箱账号', { exact: true }).waitFor()
  check(`${tag}: 注册页有返回登录`, (await p.getByRole('button', { name: '← 返回登录', exact: true }).count()) === 1)
  for (const ph of ['邮箱号', '邮箱验证码', '昵称（留空用邮箱名）', '密码（至少 6 位）', '确认密码']) {
    check(`${tag}: 注册页输入框「${ph}」在`, (await p.getByPlaceholder(ph, { exact: true }).count()) === 1)
  }
  check(`${tag}: 注册页有发送验证码 / 注册按钮`, (await p.getByRole('button', { name: '发送验证码', exact: true }).count()) === 1 && (await p.getByRole('button', { name: '注册', exact: true }).count()) === 1)
  check(`${tag}: 注册页没有授权服务 / 平台连接类文案`, !FORBIDDEN.test(await panelText(page)))
  await shot(page, tag + '-register')
}

async function assertResetLayout(page, tag) {
  const p = panel(page)
  await p.getByRole('button', { name: '忘记密码，无法登录？', exact: true }).click()
  await p.getByText('重置密码', { exact: true }).first().waitFor()
  check(`${tag}: 找回页有返回登录`, (await p.getByRole('button', { name: '← 返回登录', exact: true }).count()) === 1)
  for (const ph of ['邮箱号', '邮箱验证码', '新密码（至少 6 位）', '确认新密码']) {
    check(`${tag}: 找回页输入框「${ph}」在`, (await p.getByPlaceholder(ph, { exact: true }).count()) === 1)
  }
  // 验证码倒计时是页面共享状态：注册页刚发过码，找回页的按钮会显示「Ns 后可重发」（原版同样如此）
  check(`${tag}: 找回页有发送验证码 / 重置密码按钮`, (await p.getByRole('button', { name: /^(发送验证码|\d+s 后可重发)$/ }).count()) === 1 && (await p.getByRole('button', { name: '重置密码', exact: true }).count()) === 1)
  check(`${tag}: 找回页是验证码表单，不是「联系管理员」提示`, (await page.getByTestId('card-reset-help').count()) === 0)
  check(`${tag}: 找回页没有授权服务 / 平台连接类文案`, !FORBIDDEN.test(await panelText(page)))
  await shot(page, tag + '-reset')
}

// 空邮箱点发送验证码：本地校验先拦，不调任何接口（legacy 阶段没有桩，绝不能发真验证码）
async function assertSendCodeLocalGuard(page, tag) {
  const p = panel(page)
  await p.getByPlaceholder('邮箱号', { exact: true }).fill('')
  await p.getByRole('button', { name: '发送验证码', exact: true }).click()
  await toastWith(page, '邮箱格式不正确').waitFor()
  check(`${tag}: 发送验证码先做邮箱格式校验（toast 给原因）`, true)
}

// ============ legacy：没有 provider ============
async function legacyPhase() {
  const tag = 'legacy'
  const { app, page, errors } = await launch(tag)
  try {
    await waitPanel(page)
    check(`${tag}: 主进程报告未启用卡密模式`, (await panel(page).getAttribute('data-card-mode')) === '0')
    await assertLoginLayout(page, tag)
    await shot(page, tag + '-login')
    // 三主题不换皮：只切主题重载，面板文案一致
    for (const theme of ['dark', 'light', 'cream']) {
      await page.evaluate((t) => {
        localStorage.setItem('zl-theme', t)
        localStorage.setItem('zl-theme-motion', 'off')
      }, theme)
      await page.reload()
      await waitPanel(page)
      check(`${tag}: ${theme} 主题登录页应用到 html[data-theme]`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme)
      check(`${tag}: ${theme} 主题登录页没有授权服务 / 平台连接类文案`, !FORBIDDEN.test(await panelText(page)) && (await panel(page).getByText('用账户名称登录', { exact: true }).count()) === 1)
      await shot(page, `${tag}-login-${theme}`)
    }
    await assertRegisterLayout(page, tag)
    await assertSendCodeLocalGuard(page, tag)
    await panel(page).getByRole('button', { name: '← 返回登录', exact: true }).click()
    await assertResetLayout(page, tag)
    await panel(page).getByRole('button', { name: '← 返回登录', exact: true }).click()
    await panel(page).getByPlaceholder('邮箱 / 用户名').waitFor()
    assert.deepEqual(errors, [], `${tag} 阶段页面报错`)
    check(`${tag}: 0 pageerror`, true)
  } finally {
    await app.close()
  }
}

// ============ card-online / card-offline：provider + 主进程桩 ============
async function cardPhase(online) {
  const tag = online ? 'card-online' : 'card-offline'
  const { app, page, errors } = await launch(tag, { provider: true })
  try {
    await installStub(app, { online })
    await page.reload()
    await waitPanel(page)
    const p = panel(page)
    check(`${tag}: 主进程报告卡密模式已启用（桩，正式身份、需验证码）`, (await p.getAttribute('data-card-mode')) === '1' && (await p.getAttribute('data-identity')) === 'existing' && (await p.getAttribute('data-requires-code')) === '1')
    await assertLoginLayout(page, tag)
    await shot(page, tag + '-login')

    // 实际提交登录：失败时回到表单，toast 显示主进程给的具体原因，面板仍没有状态条
    await p.getByPlaceholder('邮箱 / 用户名').fill(FIXTURE_EMAIL)
    await p.getByPlaceholder('密码', { exact: true }).fill('Fixture123!')
    await p.getByRole('button', { name: '登录', exact: true }).click()
    const expected = online ? LOGIN_FAIL_ONLINE : LOGIN_FAIL_OFFLINE
    await toastWith(page, expected).waitFor()
    await shot(page, tag + '-login-failed-toast')
    await p.getByRole('button', { name: '登录', exact: true }).waitFor()
    const info = await stubInfo(app)
    check(`${tag}: 登录用邮箱 + 密码走 emailLogin（桩）`, info.logins.length === 1 && info.logins[0].email === FIXTURE_EMAIL && info.logins[0].passwordType === 'string')
    check(`${tag}: 登录失败 toast 显示具体原因「${expected}」`, (await toastWith(page, expected).count()) === 1)
    check(`${tag}: 登录失败后回到原表单、仍无状态条`, (await p.getByPlaceholder('邮箱 / 用户名').inputValue()) === FIXTURE_EMAIL && !FORBIDDEN.test(await panelText(page)) && (await page.getByTestId('card-login-mode').count()) === 0)
    await page.locator('[role="status"] button').first().waitFor({ state: 'detached', timeout: 10000 }) // 等 toast 自己消失，别影响后面的截图与断言

    await assertRegisterLayout(page, tag)
    // 验证码流程仍在：夹具邮箱点发送 → 走 email:send-code（桩）→ 成功 toast + 60 秒倒计时
    await p.getByPlaceholder('邮箱号', { exact: true }).fill(FIXTURE_EMAIL)
    await p.getByRole('button', { name: '发送验证码', exact: true }).click()
    await toastWith(page, '验证码已发送').waitFor()
    const after = await stubInfo(app)
    check(`${tag}: 注册页发送验证码走 email:send-code（桩收到夹具邮箱）`, after.codes.length === 1 && after.codes[0] === FIXTURE_EMAIL)
    check(`${tag}: 发送后按钮进入倒计时`, /\d+s 后可重发/.test(await p.getByRole('button', { name: /后可重发/ }).textContent()))
    await p.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await assertResetLayout(page, tag)
    await p.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await p.getByPlaceholder('邮箱 / 用户名').waitFor()
    assert.deepEqual(errors, [], `${tag} 阶段页面报错`)
    check(`${tag}: 0 pageerror`, true)
  } finally {
    await app.close()
  }
}

try {
  await legacyPhase()
  await cardPhase(true)
  await cardPhase(false)
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ outDir, checks, screenshots }, null, 2))
  console.log(`LOGIN APPEARANCE ${checks.length}/${checks.length} PASS`)
} catch (error) {
  console.error('FAIL ' + (error.stack || error))
  process.exit(1)
}

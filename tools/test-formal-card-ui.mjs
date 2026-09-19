// 正式客户端卡密授权界面（renderer）验收：隐藏、隔离的 Electron 实例，不连真实平台、不启动游戏、不连直播。
//   阶段 A（legacy）：profile 里没有 license-provider.json → 顶栏 / 设置 / 登录 / Mod 详情 / 娱乐助手全部保持原界面。
//   阶段 B（card）  ：profile 里写入 provider 文件，并在主进程内用临时桩替换 card:* 通道（固定的假账号与假卡密，
//                    不是真实卡密），逐项核对新界面：顶栏入口、激活表单错误提示、权益期限、娱乐助手状态条、
//                    功能门禁弹窗、设置页账号 / 直播间区、Mod 详情激活入口与安装管理按钮共存、登录页注册 / 忘记密码。
// 用法：node tools/test-formal-card-ui.mjs [--out-dir output/fable-formal-card-ui-build] [--legacy-only] [--card-only]
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
const outDir = argValue('--out-dir', 'output/fable-formal-card-ui-build')
const legacyOnly = argv.includes('--legacy-only')
const cardOnly = argv.includes('--card-only')
const out = path.join(root, 'output/playwright/formal-card-ui')
await fs.mkdir(out, { recursive: true })

// 通道名从 shared/types.ts 读，和主进程 / preload 保持同一份真相
const typesText = await fs.readFile(path.join(root, 'src/shared/types.ts'), 'utf8')
const channel = (key) => {
  const m = typesText.match(new RegExp(`\\b${key}:\\s*'([^']+)'`))
  assert.ok(m, `shared/types.ts 缺少 Ipc.${key}`)
  return m[1]
}
const CH = {
  state: channel('CardState'),
  redeem: channel('CardRedeem'),
  open: channel('CardOpenPlatform'),
  required: channel('CardLicenseRequired'),
  // 卡密模式下登录 / 会话走平台；测试桩替掉这两条，不连任何服务
  session: channel('AuthSession'),
  emailLogin: channel('EmailLogin')
}

const checks = []
const errorsAll = []
const check = (name, value) => {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}

async function launch(tag, { provider = false } = {}) {
  const profile = await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
  if (provider) {
    // 只用来让主进程报告 enabled=true；地址指向没有服务的端口，公钥是格式合法的占位值（32 字节全 0）
    await fs.writeFile(
      path.join(profile, 'license-provider.json'),
      JSON.stringify({ provider: 'card', origin: 'http://127.0.0.1:1/', publicKey: Buffer.alloc(32).toString('base64url') })
    )
  }
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_CARD_POLL_MS: '3000', ZL_CARD_RECHECK_MS: '2000' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry], cwd: root, env })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(tag + ': ' + e.message))
  errorsAll.push(errors)
  return { app, page, profile, errors }
}

const goto = async (page, route) => {
  await page.evaluate((r) => {
    location.hash = r
  }, route)
  await page.waitForTimeout(600)
}
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') })
async function loginFixture(page, name) {
  await page.waitForFunction(() => !!window.api?.register)
  const r = await page.evaluate(async (name) => {
    await window.api.register(name, 'Fixture123!', '卡密界面验收')
    const res = await window.api.login(name, 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'basic')
    return res
  }, name)
  assert.equal(r.ok, true, '夹具账号登录')
  await page.reload()
  await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
}

// ============ 阶段 A：没有 provider → 原界面 ============
async function legacyPhase() {
  const { app, page, errors } = await launch('legacy')
  try {
    await page.waitForFunction(() => !!window.api?.login)
    await page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
    check('legacy: 注册页仍有邮箱验证码', (await page.getByPlaceholder('邮箱验证码').count()) === 1)
    check('legacy: 登录页没有卡密平台状态行', (await page.getByTestId('card-login-mode').count()) === 0)
    await page.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await page.getByRole('button', { name: '忘记密码，无法登录？', exact: true }).click()
    check('legacy: 忘记密码仍是验证码重置表单', (await page.getByPlaceholder('邮箱验证码').count()) === 1 && (await page.getByTestId('card-reset-help').count()) === 0)
    await page.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await loginFixture(page, 'card_legacy_fixture')
    check('legacy: 顶栏没有卡密授权入口', (await page.getByTestId('card-access-button').count()) === 0)
    await goto(page, '/ent')
    check('legacy: 娱乐助手没有卡密状态条', (await page.getByTestId('entertainment-card-bar').count()) === 0)
    check('legacy: 娱乐助手 20 个模块照旧', (await page.locator('[data-feature]').count()) === 20)
    await goto(page, '/settings')
    await page.getByRole('heading', { name: '账号与直播间绑定' }).waitFor()
    check('legacy: 设置页账号区标题不变', true)
    check('legacy: 设置页没有卡密账号区', (await page.getByTestId('account-card-access').count()) === 0)
    const mods = await page.evaluate(() => window.api.listMods())
    const target = mods.mods.find((m) => m.gameId) || mods.mods[0]
    await goto(page, '/mod/' + target.id)
    await page.getByRole('button', { name: '返回游戏库', exact: true }).waitFor()
    check('legacy: Mod 详情没有卡密授权卡', (await page.getByTestId('mod-card-access').count()) === 0)
    await shot(page, 'legacy-mod-detail')
    assert.deepEqual(errors, [], 'legacy 阶段页面报错')
  } finally {
    await app.close()
  }
}

// ============ 阶段 B：provider + 主进程内临时桩 ============
const FIXTURE_EMAIL = 'card-fixture@example.test'
const FIXTURE_CODE = 'ZL-FIXTURE-0000-0000' // 仅本测试桩认得的占位值，不是真实卡密
async function installStub(app) {
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { CH, FIXTURE_EMAIL, FIXTURE_CODE }) => {
      const now = () => Math.floor(Date.now() / 1000)
      const right = (id, name, kind, patch) => ({ id, name, kind, status: 'missing', permanent: false, expires_at: null, allowed: false, reasons: ['未激活'], ...patch })
      const stub = {
        ok: true,
        enabled: true,
        origin: 'http://127.0.0.1:1',
        user: { id: 'u-fixture', email: FIXTURE_EMAIL },
        rights: [right('platform:assistant', '娱乐助手', 'platform'), right('game:librarian', '图书管理员 Mod', 'game'), right('game:dontscream', "DON'T SCREAM Mod", 'game'), right('game:4wheel-challenge', '轮椅模拟器 Mod', 'game')],
        opened: 0,
        redeemed: [],
        logins: [],
        loggedIn: false
      }
      global.__cardStub = stub
      const sessionUser = () => ({ id: stub.user.id, username: stub.user.email, nickname: '卡密界面验收', avatar: '', createdAt: 0, boundRooms: [], email: stub.user.email })
      // 桩模拟的是本机测试平台（identityMode=local、注册不要验证码）；登录页自 7262969 起按平台元信息保守判断，桩必须把这两项说清楚
      // 与主进程 snapshotError 一致：读取失败时只有 ok=false + error，不带账号与权益（页面不缓存上一次权益）
      const snapshot = () =>
        stub.ok
          ? { ok: true, enabled: true, origin: stub.origin, identityMode: 'local', registrationRequiresCode: false, user: stub.loggedIn ? stub.user : undefined, rights: stub.rights.map((r) => ({ ...r })) }
          : { ok: false, enabled: true, origin: stub.origin, error: stub.error }
      for (const c of [CH.state, CH.redeem, CH.open, CH.session, CH.emailLogin]) ipcMain.removeHandler(c)
      ipcMain.handle(CH.session, async () => (stub.loggedIn ? sessionUser() : null))
      ipcMain.handle(CH.emailLogin, async (_e, email, password) => {
        stub.logins.push({ email, passwordType: typeof password })
        if (email !== stub.user.email) return { ok: false, error: '账号或密码不正确' }
        stub.loggedIn = true
        return { ok: true, user: sessionUser() }
      })
      ipcMain.handle(CH.state, async () => snapshot())
      ipcMain.handle(CH.redeem, async (_e, code) => {
        stub.redeemed.push(typeof code)
        if (code !== FIXTURE_CODE) return { ok: false, enabled: true, error: '卡密不存在或已使用' }
        const p = stub.rights.find((r) => r.id === 'platform:assistant')
        Object.assign(p, { status: 'active', allowed: true, expires_at: now() + 7 * 86400, reasons: [] })
        return snapshot()
      })
      ipcMain.handle(CH.open, async () => {
        stub.opened++
        return { ok: true }
      })
      global.__cardRequire = (product) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.required, product)
      }
    },
    { CH, FIXTURE_EMAIL, FIXTURE_CODE }
  )
}
const setStub = (app, patch) =>
  app.evaluate((_, patch) => {
    const stub = global.__cardStub
    for (const [id, p] of Object.entries(patch.rights || {})) Object.assign(stub.rights.find((r) => r.id === id), p)
    if ('ok' in patch) stub.ok = patch.ok
    if ('error' in patch) stub.error = patch.error
  }, patch)
const stubInfo = (app) => app.evaluate(() => ({ opened: global.__cardStub.opened, redeemed: global.__cardStub.redeemed, rights: global.__cardStub.rights, logins: global.__cardStub.logins }))

async function cardPhase() {
  const { app, page, errors } = await launch('card', { provider: true })
  try {
    await installStub(app)
    await page.reload()
    await page.waitForFunction(() => typeof window.api?.cardState === 'function')
    const probe = await page.evaluate(() => window.api.cardState())
    check('card: 主进程报告 enabled=true（桩）', probe.enabled === true && probe.ok === true)
    // 登录页
    await page.locator('[data-testid="login-panel"][data-card-mode="1"]').waitFor()
    check('card: 登录页不显示平台连接状态', (await page.getByTestId('card-login-mode').count()) === 0 && (await page.getByText(/测试账号|测试卡密|体验|已连接授权服务/).count()) === 0)
    await page.getByRole('button', { name: '没有账号？创建账号', exact: true }).click()
    check('card: 注册页不再要邮箱验证码', (await page.getByPlaceholder('邮箱验证码').count()) === 0 && (await page.getByPlaceholder('邮箱号').count()) === 1)
    await shot(page, 'card-register')
    await page.getByRole('button', { name: '← 返回登录', exact: true }).click()
    await page.getByRole('button', { name: '忘记密码，无法登录？', exact: true }).click()
    await page.getByTestId('card-reset-help').waitFor()
    check('card: 忘记密码改为联系平台管理员，不调旧重置接口', (await page.getByTestId('card-reset-help').textContent()).includes('联系平台管理员') && (await page.getByPlaceholder('邮箱验证码').count()) === 0)
    await page.getByRole('button', { name: '返回登录', exact: true }).last().click()
    await page.getByPlaceholder('邮箱 / 用户名').waitFor()
    // 真走登录表单：邮箱 + 密码 → emailLogin（桩），不带验证码；先把首次向导标记掉
    await page.evaluate(async () => {
      await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
      localStorage.setItem('zl-guide-seen', '1')
      localStorage.setItem('zl_configuration_level', 'basic')
    })
    await page.getByPlaceholder('邮箱 / 用户名').fill(FIXTURE_EMAIL)
    await page.getByPlaceholder('密码').fill('Fixture123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    const logins = (await stubInfo(app)).logins
    check('card: 登录表单用邮箱 + 密码走 emailLogin', logins.length === 1 && logins[0].email === FIXTURE_EMAIL && logins[0].passwordType === 'string')

    // 顶栏入口 + 激活弹窗
    await page.getByTestId('card-access-button').waitFor()
    await page.getByTestId('card-access-button').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('card-rights').waitFor()
    check('card: 顶栏弹窗列出账号邮箱、正常连接时不显示服务器状态', (await dialog.textContent()).includes(FIXTURE_EMAIL) && (await dialog.getByTestId('card-refresh-failed').count()) === 0 && !/已连接|未连接|平台/.test(await dialog.textContent()))
    check('card: 未开通显示未激活', (await dialog.locator('[data-card-right="platform:assistant"]').textContent()).includes('未激活'))
    check('card: 不出现测试 / 购买 / 封锁 / 平台管理类文案', (await dialog.getByText(/测试账号|测试卡密|测试后台|购买卡密|已封锁|打开卡密平台|平台管理员|本机/).count()) === 0)
    check('card: 弹窗没有打开平台 / 后台的按钮', (await dialog.getByRole('button', { name: /平台|后台/ }).count()) === 0)
    const codeInput = dialog.getByRole('textbox', { name: '卡密', exact: true })
    check('card: 空卡密时激活按钮禁用', await dialog.getByRole('button', { name: '激活卡密', exact: true }).isDisabled())
    await codeInput.fill('ZL-WRONG-CODE')
    await dialog.getByRole('button', { name: '激活卡密', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    const alertText = await dialog.getByRole('alert').textContent()
    check('card: 无效卡密给原因 + 怎么重试', alertText.includes('卡密不存在或已使用') && /重试|换一张|重新复制/.test(alertText))
    await codeInput.fill(FIXTURE_CODE)
    await dialog.getByRole('button', { name: '激活卡密', exact: true }).click()
    await dialog.locator('[data-card-right="platform:assistant"]').filter({ hasText: '已激活' }).waitFor()
    const platformRow = await dialog.locator('[data-card-right="platform:assistant"]').textContent()
    check('card: 激活后按服务权益显示到期时间与剩余', platformRow.includes('到期时间') && platformRow.includes('剩余'))
    check('card: 激活成功后输入框清空、错误消失', (await codeInput.inputValue()) === '' && (await dialog.getByRole('alert').count()) === 0)
    check('card: 卡密只以字符串发到主进程', (await stubInfo(app)).redeemed.every((t) => t === 'string'))
    await shot(page, 'card-topbar-dialog')
    await dialog.getByRole('button', { name: '刷新授权', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '授权已刷新' }).waitFor()
    check('card: 刷新授权成功提示', true)
    check('card: 主播端从未调用打开平台接口', (await stubInfo(app)).opened === 0)
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    check('card: 弹窗关闭', (await page.getByRole('dialog').count()) === 0)

    // 娱乐助手状态条（未激活可浏览 / 配置；引导不被遮挡）
    await goto(page, '/ent')
    const bar = page.getByTestId('entertainment-card-bar')
    await bar.waitFor()
    check('card: 已激活时状态条只显示期限，不催激活', (await bar.textContent()).includes('到期时间') && (await bar.getByRole('button', { name: '激活卡密' }).count()) === 0)
    await setStub(app, { rights: { 'platform:assistant': { status: 'revoked', allowed: false, reasons: ['已收回'] } } })
    await bar.getByRole('button', { name: '激活卡密', exact: true }).waitFor({ timeout: 9000 })
    check('card: 后台收回后状态条 ≤ 一次轮询内更新为已收回', (await bar.textContent()).includes('已收回') && (await bar.textContent()).includes('可以先配置'))
    check('card: 未激活仍能浏览全部 20 个模块', (await page.locator('[data-feature]').count()) === 20)
    await goto(page, '/ent?tool=gift')
    const guide = page.getByTestId('basic-feature-guide')
    await guide.waitFor()
    const [barBox, guideBox] = await Promise.all([bar.boundingBox(), guide.boundingBox()])
    check('card: 状态条不遮挡基础引导', !!barBox && !!guideBox && barBox.y + barBox.height <= guideBox.y + 1)
    await page.getByRole('button', { name: '新增规则', exact: true }).first().click()
    check('card: 未激活也能打开规则配置', (await page.getByRole('dialog').count()) === 1)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await shot(page, 'card-ent-revoked')

    // 主进程门禁事件 → 激活弹窗；取消不改业务
    await app.evaluate(() => global.__cardRequire('game:librarian'))
    const prompt = page.getByTestId('card-redeem-prompt')
    await prompt.waitFor()
    const promptText = await prompt.textContent()
    check('card: 门禁弹窗说明产品与娱乐助手各自状态', (await prompt.getAttribute('data-product')) === 'game:librarian' && promptText.includes('图书管理员 Mod · 未激活') && promptText.includes('娱乐助手 · 已收回'))
    check('card: 门禁弹窗不提管理员直授 / 平台入口', !/平台管理员|打开卡密平台|后台/.test(promptText))
    await page.getByRole('button', { name: '稍后激活', exact: true }).click()
    check('card: 取消门禁弹窗不改权益', (await page.getByTestId('card-redeem-prompt').count()) === 0 && (await stubInfo(app)).rights.find((r) => r.id === 'game:librarian').allowed === false)
    await app.evaluate(() => global.__cardRequire('platform:assistant'))
    await prompt.waitFor()
    await prompt.getByRole('textbox', { name: '卡密', exact: true }).fill(FIXTURE_CODE)
    await prompt.getByRole('button', { name: '激活', exact: true }).click()
    await prompt.getByRole('status').filter({ hasText: '再次点击原功能按钮' }).waitFor()
    check('card: 门禁弹窗内激活成功后提示再点原按钮', true)
    await page.getByRole('button', { name: '返回使用', exact: true }).click()

    // 设置页：账号与卡密授权 + 直播间绑定仍在
    await goto(page, '/settings')
    await page.getByRole('heading', { name: '账号与卡密授权' }).waitFor()
    check('card: 设置页账号区改为账号与卡密授权', (await page.getByTestId('account-card-access').count()) === 1)
    const acctText = await page.getByTestId('account-card-access').textContent()
    check('card: 设置页授权卡没有平台 / 后台入口与服务器状态', (await page.getByTestId('account-card-access').getByRole('button', { name: /平台|后台/ }).count()) === 0 && !/已连接|未连接|本机|平台管理员/.test(acctText))
    check('card: 设置页不再显示旧的邮箱授权状态', (await page.getByText(/^(已授权|未授权|授权查询失败)$/).count()) === 0)
    check('card: 设置页仍可绑定 / 管理直播间', (await page.getByRole('textbox', { name: '抖音直播间号' }).count()) === 1 && (await page.getByRole('button', { name: '绑定', exact: true }).count()) === 1 && (await page.getByText('直播间绑定', { exact: true }).count()) === 1)
    await shot(page, 'card-settings')

    // Mod 详情：激活入口 + 安装管理共存
    const mods = await page.evaluate(() => window.api.listMods())
    const target = mods.mods.find((m) => m.gameId === 'librarian') || mods.mods.find((m) => m.gameId)
    assert.ok(target, '清单里要有带 gameId 的 Mod')
    await goto(page, '/mod/' + target.id)
    const modCard = page.getByTestId('mod-card-access')
    await modCard.waitFor()
    check('card: Mod 详情显示 Mod 与娱乐助手各自期限', (await modCard.getByTestId('mod-card-expiry').textContent()).includes('Mod · 未激活') && (await modCard.textContent()).includes('娱乐助手 · 到期时间'))
    check('card: 未激活时保留安装 / 更新按钮（门禁在主进程）', (await page.getByRole('button', { name: /^安装 Mod$/ }).count()) === 1 || (await page.getByRole('button', { name: /待发售|安装|更新/ }).count()) >= 1)   // 线上清单版本高于夹具已装版本时按钮是「更新」
    check('card: Mod 详情不显示申请授权 / 封禁旧文案', (await page.getByRole('button', { name: '申请授权' }).count()) === 0 && (await page.getByText('账号已封禁').count()) === 0)
    await modCard.getByRole('button', { name: '激活卡密', exact: true }).click()
    await prompt.waitFor()
    check('card: Mod 详情激活入口直达对应产品', (await prompt.getAttribute('data-product')) === 'game:' + target.gameId)
    await page.getByRole('button', { name: '稍后激活', exact: true }).click()
    await setStub(app, { rights: { ['game:' + target.gameId]: { status: 'active', allowed: true, permanent: true, reasons: [] } } })
    await modCard.getByText('已激活', { exact: true }).waitFor({ timeout: 9000 })
    check('card: 平台侧授权后 Mod 状态变已激活、永久', (await modCard.textContent()).includes('Mod · 永久') && (await modCard.getByRole('button', { name: '激活卡密' }).count()) === 0)
    // 已安装状态：只改本实例的 mods:list 返回，不写游戏目录
    await app.evaluate(
      ({ ipcMain }, { channel, data, id }) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async () => ({ ...data, installed: { ...data.installed, [id]: { id, version: '0.0.1', installPath: 'C:\\isolated-fixture\\mod' } } }))
      },
      { channel: channel('ModsList'), data: mods, id: target.id }
    )
    await goto(page, '/')
    await goto(page, '/mod/' + target.id)
    await page.getByText('已安装', { exact: false }).first().waitFor()
    check('card: 已安装管理按钮（更新 / 卸载）与卡密卡共存', (await page.getByRole('button', { name: /更新到 v|重新安装|重装为/ }).count()) === 1 && (await page.getByRole('button', { name: '卸载', exact: true }).count()) === 1 && (await modCard.count()) === 1)
    await shot(page, 'card-mod-installed')

    // 平台断开：只给可执行的短提示，不显示服务地址 / 底层原文，界面不崩
    await setStub(app, { ok: false, error: 'TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:1)' })
    await page.getByTestId('card-access-button').click()
    const offlineDialog = page.getByRole('dialog')
    await offlineDialog.getByTestId('card-refresh-failed').waitFor({ timeout: 9000 })
    const offlineHint = await offlineDialog.getByTestId('card-refresh-failed').textContent()
    check('card: 平台断开时只提示「暂时无法刷新授权，请检查网络后重试」', offlineHint.includes('暂时无法刷新授权') && offlineHint.includes('检查网络'))
    check('card: 断开提示不含服务地址 / 英文堆栈 / 本机平台字样', !/127\.0\.0\.1|fetch|ECONN|TypeError|本机|平台/.test(await offlineDialog.textContent()))
    await offlineDialog.getByRole('button', { name: '刷新授权', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '暂时无法刷新授权' }).waitFor()
    check('card: 断开时点刷新授权给同一句短提示，不说成功', (await page.getByRole('status').filter({ hasText: '授权已刷新' }).count()) === 0)
    // 页面不缓存上一次权益：断开时权益区只给中性提示（不说「还没有任何授权」、不显示旧的「已激活」），输入框仍在
    const offlineText = await offlineDialog.textContent()
    check('card: 断开时不显示上一次权益、权益区只给中性提示', (await offlineDialog.locator('[data-card-right]').count()) === 0 && (await offlineDialog.getByTestId('card-rights-empty').textContent()).includes('暂时没有可显示的授权信息') && !offlineText.includes('还没有任何授权') && !offlineText.includes('已激活'), offlineText)
    check('card: 断开时卡密输入框仍在', (await offlineDialog.getByRole('textbox', { name: '卡密', exact: true }).count()) === 1)
    await shot(page, 'card-topbar-offline')
    await offlineDialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    assert.deepEqual(errors, [], 'card 阶段页面报错')
  } finally {
    await app.close()
  }
}

let completed = false
try {
  if (!cardOnly) await legacyPhase()
  if (!legacyOnly) await cardPhase()
  completed = true
  console.log(`FORMAL-CARD-UI ${checks.length}/${checks.length} PASS; 0 page errors; outDir=${outDir}`)
} finally {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ completed, outDir, checks, errors: errorsAll.flat() }, null, 2))
}

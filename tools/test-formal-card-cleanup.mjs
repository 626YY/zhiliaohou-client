// 正式主播端「卡密授权」界面清理验收（独立脚本，隐藏 + 隔离的 Electron，不连真实平台、不碰真实账号 / 配置）。
//   目的：主播端只有「输入卡密激活 / 刷新授权」——没有「打开卡密平台」等后台 / 平台管理入口，没有测试 / 体验字样；
//         正常连接时不显示服务器状态；连接失败只给「暂时无法刷新授权，请检查网络后重试」一类可执行短提示，
//         不打印服务地址 / 英文堆栈；激活失败仍保留真实业务原因（无效 / 已使用 / 作废），不把失败说成成功。
//   覆盖：源码静态扫描 → 顶栏弹窗 → 设置页授权卡 → Mod 详情激活 → 娱乐助手未激活提示 / 门禁弹窗 → 断网刷新 / 断网激活 → 恢复。
//   主进程 card:* 通道用临时桩替换（固定假账号、假卡密，不是真实卡密）；桩会统计「打开平台」接口调用次数，主播端必须为 0。
// 用法：npx electron-vite build --outDir output/fable-card-cleanup-build && node tools/test-formal-card-cleanup.mjs [--out-dir output/fable-card-cleanup-build]
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
const outDir = argValue('--out-dir', process.env.ZL_TEST_OUT_DIR || 'output/fable-card-cleanup-build')
const out = path.join(root, 'output/playwright/formal-card-cleanup')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js')).catch(() => {
  throw new Error(`构建产物不存在：${outDir}，先 npx electron-vite build --outDir ${outDir}`)
})

const checks = []
const check = (name, value, detail) => {
  assert.ok(value, name + (detail ? '\n  ' + String(detail).slice(0, 400) : ''))
  checks.push(name)
  console.log('PASS ' + name)
}

// 主播端页面上不该出现的字样（后台 / 平台管理入口、测试 / 体验、服务地址、底层英文）
const FORBIDDEN_TEXT = /打开卡密平台|本机卡密平台|卡密平台已打开|测试后台|测试账号|测试卡密|体验账号|体验版|平台管理员|管理后台|管理员直接|已连接|未连接/
const TECHNICAL_TEXT = /127\.0\.0\.1|localhost|https?:\/\/|ECONN|fetch failed|TypeError|Error:/

// ---------- 1. 源码静态扫描 ----------
const rendererDir = path.join(root, 'src/renderer/src')
async function listFiles(dir) {
  const acc = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) acc.push(...(await listFiles(p)))
    else if (/\.(tsx?|css)$/.test(entry.name)) acc.push(p)
  }
  return acc
}
{
  const cardAccess = await fs.readFile(path.join(rendererDir, 'components/CardAccess.tsx'), 'utf8')
  const hook = await fs.readFile(path.join(rendererDir, 'lib/useCardAccess.tsx'), 'utf8')
  check('源码: CardAccess.tsx 没有 OpenPlatformButton / cardOpenPlatform / ExternalLink', !/OpenPlatformButton|cardOpenPlatform|ExternalLink|打开卡密平台/.test(cardAccess))
  check('源码: CardAccess.tsx / useCardAccess.tsx 不含本机卡密平台 / 平台管理员 / 测试字样', !/本机卡密平台|平台管理员|测试账号|测试后台|体验/.test(cardAccess + hook))
  check('源码: useCardAccess.tsx 不再暴露平台地址判定（cardOriginIsLocal）', !/cardOriginIsLocal/.test(hook))
  check('源码: 连接失败提示只有一句可执行文案', /暂时无法刷新授权，请检查网络后重试/.test(hook))
  // 全 renderer：这些字样只允许出现在注释里（// 或 /* */ 或 JSX {/* */}）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')
  const hits = []
  for (const file of await listFiles(rendererDir)) {
    const code = stripComments(await fs.readFile(file, 'utf8'))
    for (const m of code.matchAll(/打开卡密平台|本机卡密平台|测试后台|测试账号|体验账号|体验版|打开平台|本机平台|cardOpenPlatform/g)) hits.push(path.relative(root, file) + ': ' + m[0])
  }
  check('源码: 整个 renderer 非注释代码里没有打开平台 / 本机平台 / 测试后台 / 测试账号 / 体验账号字样', hits.length === 0, hits.join('; '))
  // 0.3.49 最终整改：页面不缓存上一次权益（断网时不能把旧权益显示成「已生效」）；空清单只给中性提示
  const commitBody = (hook.match(/function commit\([\s\S]*?\n\}/) || [''])[0]
  check('源码: useCardAccess.tsx 的 commit(set, result) 不再合并上一次的账号 / 权益', /^function commit\(set: [^,]+, result: CardSnapshot\)/.test(commitBody) && !/prev|incoming/.test(commitBody), commitBody.slice(0, 120))
  check('源码: CardRightsList 空态是中性提示，不说「还没有任何授权」', /暂时没有可显示的授权信息，请刷新后重试/.test(cardAccess) && !/还没有任何授权/.test(cardAccess))
  // 用户截图指出的事件库说明：只说事件设置，不提「今晚」/「项目开关」
  const timeEditor = stripComments(await fs.readFile(path.join(rendererDir, 'components/TimeBlindBoxEditor.tsx'), 'utf8'))
  check('源码: 事件库说明只写「为每个事件设置时间、视频、音效和整蛊动作。」，非注释代码不含今晚 / 项目开关一关', /为每个事件设置时间、视频、音效和整蛊动作。/.test(timeEditor) && !/今晚|项目开关一关/.test(timeEditor))
  const roomWizard = stripComments(await fs.readFile(path.join(rendererDir, 'components/room/RoomBindWizard.tsx'), 'utf8'))
  check('源码: 直播间绑定向导不含购买卡密 / 卡密平台 / 管理员发放字样，卡密步骤只说明名额卡 / 改绑卡用途', !/购买|卡密平台|平台管理|管理员发放/.test(roomWizard) && /输入改绑卡密/.test(roomWizard) && /输入直播间名额卡密/.test(roomWizard))
}

// ---------- 2. 隔离 Electron + 主进程桩 ----------
const typesText = await fs.readFile(path.join(root, 'src/shared/types.ts'), 'utf8')
const channel = (key) => {
  const m = typesText.match(new RegExp(`\\b${key}:\\s*'([^']+)'`))
  assert.ok(m, `shared/types.ts 缺少 Ipc.${key}`)
  return m[1]
}
const CH = { state: channel('CardState'), redeem: channel('CardRedeem'), open: channel('CardOpenPlatform'), required: channel('CardLicenseRequired'), session: channel('AuthSession'), emailLogin: channel('EmailLogin') }
const FIXTURE_EMAIL = 'card-cleanup@example.test'
// 仅本测试桩认得的占位卡密，不是真实卡密
const CODES = { platform: 'ZL-CLEANUP-PLATFORM-0000', librarian: 'ZL-CLEANUP-LIBRARIAN-0000' }

const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: 'http://127.0.0.1:1/', publicKey: Buffer.alloc(32).toString('base64url') }))
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json', ZL_CARD_POLL_MS: '3000', ZL_CARD_RECHECK_MS: '2000' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry], cwd: root, env, timeout: 60000 })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')

await app.evaluate(
  ({ ipcMain, BrowserWindow }, { CH, FIXTURE_EMAIL, CODES }) => {
    const now = () => Math.floor(Date.now() / 1000)
    const right = (id, name, kind) => ({ id, name, kind, status: 'missing', permanent: false, expires_at: null, allowed: false, reasons: ['未激活'] })
    const stub = {
      ok: true,
      error: undefined,
      user: { id: 'u-cleanup', email: FIXTURE_EMAIL },
      rights: [right('platform:assistant', '娱乐助手', 'platform'), right('game:librarian', '图书管理员 Mod', 'game'), right('game:dontscream', "DON'T SCREAM Mod", 'game'), right('game:4wheel-challenge', '轮椅模拟器 Mod', 'game')],
      opened: 0,
      redeemed: 0,
      loggedIn: false
    }
    global.__cardStub = stub
    const sessionUser = () => ({ id: stub.user.id, username: stub.user.email, nickname: '清理验收', avatar: '', createdAt: 0, boundRooms: [], email: stub.user.email })
    // 与主进程 snapshotError 一致：读取失败时只有 ok=false + error，不带账号与权益（页面不保留上一次的权益，只给中性提示）
    const snapshot = () =>
      stub.ok
        ? { ok: true, enabled: true, origin: 'http://127.0.0.1:1', identityMode: 'local', registrationRequiresCode: false, user: stub.loggedIn ? stub.user : undefined, rights: stub.rights.map((r) => ({ ...r })) }
        : { ok: false, enabled: true, origin: 'http://127.0.0.1:1', error: stub.error }
    for (const c of [CH.state, CH.redeem, CH.open, CH.session, CH.emailLogin]) ipcMain.removeHandler(c)
    ipcMain.handle(CH.session, async () => (stub.loggedIn ? sessionUser() : null))
    ipcMain.handle(CH.emailLogin, async (_e, email) => {
      if (email !== stub.user.email) return { ok: false, error: '账号或密码不正确' }
      stub.loggedIn = true
      return { ok: true, user: sessionUser() }
    })
    ipcMain.handle(CH.state, async () => snapshot())
    ipcMain.handle(CH.redeem, async (_e, code) => {
      stub.redeemed++
      // 断网：主进程会把 fetch 的英文原文放进 error，页面不能原样展示
      if (!stub.ok) return { ok: false, enabled: true, error: 'TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:1)' }
      if (code === 'ZL-USED-0000') return { ok: false, enabled: true, error: '卡密已被使用' }
      if (code === 'ZL-VOID-0000') return { ok: false, enabled: true, error: '卡密已作废' }
      const product = code === CODES.platform ? 'platform:assistant' : code === CODES.librarian ? 'game:librarian' : ''
      if (!product) return { ok: false, enabled: true, error: '卡密无效' }
      Object.assign(stub.rights.find((r) => r.id === product), { status: 'active', allowed: true, expires_at: now() + 7 * 86400, reasons: [] })
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
  { CH, FIXTURE_EMAIL, CODES }
)
const setStub = (patch) =>
  app.evaluate((_, patch) => {
    const stub = global.__cardStub
    for (const [id, p] of Object.entries(patch.rights || {})) Object.assign(stub.rights.find((r) => r.id === id), p)
    if ('ok' in patch) stub.ok = patch.ok
    if ('error' in patch) stub.error = patch.error
  }, patch)
const stubInfo = () => app.evaluate(() => ({ opened: global.__cardStub.opened, redeemed: global.__cardStub.redeemed, rights: global.__cardStub.rights }))
const goto = async (route) => {
  await page.evaluate((r) => {
    location.hash = r
  }, route)
  await page.waitForTimeout(700)
}
const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
const bodyText = () => page.evaluate(() => document.body.innerText)
// 整页扫描只看后台 / 平台管理入口与测试 / 体验字样（OBS、连接器等业务区本来就有「已连接 / 未连接」）
const FORBIDDEN_PAGE = /打开卡密平台|本机卡密平台|测试后台|测试账号|体验账号|体验版|平台管理员|管理后台/
const noForbidden = async (label, scope = page) => {
  if (scope === page) {
    const text = await bodyText()
    check(`${label}: 没有后台 / 平台管理入口、测试 / 体验字样`, !FORBIDDEN_PAGE.test(text), (text.match(FORBIDDEN_PAGE) || [])[0])
    check(`${label}: 没有打开平台 / 后台类按钮`, (await page.getByRole('button', { name: /卡密平台|后台/ }).count()) === 0)
    return
  }
  const text = await scope.textContent()
  check(`${label}: 没有后台 / 平台管理入口、测试 / 体验、连接状态字样`, !FORBIDDEN_TEXT.test(text), (text.match(FORBIDDEN_TEXT) || [])[0])
  check(`${label}: 没有服务地址 / 英文堆栈`, !TECHNICAL_TEXT.test(text), (text.match(TECHNICAL_TEXT) || [])[0])
  check(`${label}: 没有平台 / 后台类按钮`, (await scope.getByRole('button', { name: /平台|后台|管理/ }).count()) === 0)
}

let completed = false
try {
  await page.reload()
  await page.waitForFunction(() => typeof window.api?.cardState === 'function')
  await page.locator('[data-testid="login-panel"][data-card-mode="1"]').waitFor()
  check('登录页: 卡密模式已探测、没有平台状态 / 测试字样', !FORBIDDEN_TEXT.test(await bodyText()) && (await page.getByTestId('card-login-mode').count()) === 0)
  await page.evaluate(async () => {
    await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'basic')
  })
  await page.getByPlaceholder('邮箱 / 用户名').fill(FIXTURE_EMAIL)
  await page.getByPlaceholder('密码').fill('Fixture123!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()

  // ---------- 3. 顶栏「卡密授权」弹窗 ----------
  await page.getByTestId('card-access-button').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByTestId('card-rights').waitFor()
  check('顶栏: 弹窗显示账号邮箱与四项授权（全部未激活）', (await dialog.textContent()).includes(FIXTURE_EMAIL) && (await dialog.locator('[data-card-right]').count()) === 4 && (await dialog.locator('[data-card-right]').allTextContents()).every((t) => t.includes('未激活')))
  check('顶栏: 正常连接时不显示服务器连接提示', (await dialog.getByTestId('card-refresh-failed').count()) === 0)
  check('顶栏: 只有「激活卡密」「刷新授权」「关闭」三个动作', (await dialog.getByRole('button').allTextContents()).map((t) => t.trim()).filter(Boolean).sort().join() === ['关闭', '刷新授权', '激活卡密'].sort().join())
  await noForbidden('顶栏弹窗', dialog)
  await shot('01-topbar-unactivated')
  const codeInput = dialog.getByRole('textbox', { name: '卡密', exact: true })
  const activate = dialog.getByRole('button', { name: '激活卡密', exact: true })
  await codeInput.fill('ZL-USED-0000')
  await activate.click()
  await dialog.getByRole('alert').waitFor()
  check('顶栏: 已使用的卡密 → 保留真实原因「卡密已被使用」+ 换一张', /卡密已被使用/.test(await dialog.getByRole('alert').textContent()) && /换一张/.test(await dialog.getByRole('alert').textContent()))
  await codeInput.fill('ZL-VOID-0000')
  await activate.click()
  await dialog.getByRole('alert').filter({ hasText: '已作废' }).waitFor()
  check('顶栏: 作废的卡密 → 保留真实原因，不让主播去找管理员', !/管理员|平台/.test(await dialog.getByRole('alert').textContent()))
  await codeInput.fill('ZL-NOPE-0000')
  await activate.click()
  await dialog.getByRole('alert').filter({ hasText: '卡密无效' }).waitFor()
  check('顶栏: 无效卡密 → 原因 + 核对后重试，权益不变', /核对|重新复制/.test(await dialog.getByRole('alert').textContent()) && (await stubInfo()).rights.every((r) => !r.allowed))
  await codeInput.fill(CODES.platform)
  await activate.click()
  await dialog.locator('[data-card-right="platform:assistant"]').filter({ hasText: '已激活' }).waitFor()
  check('顶栏: 正确卡密 → 娱乐助手已激活、显示到期时间与剩余、输入框清空', /到期时间.*剩余/.test(await dialog.locator('[data-card-right="platform:assistant"]').textContent()) && (await codeInput.inputValue()) === '' && (await dialog.getByRole('alert').count()) === 0)
  await dialog.getByRole('button', { name: '刷新授权', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '授权已刷新' }).waitFor()
  check('顶栏: 刷新授权成功提示「授权已刷新」', true)
  await shot('02-topbar-activated')
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  check('顶栏: 弹窗可关闭', (await page.getByRole('dialog').count()) === 0)

  // ---------- 4. 设置页授权卡 ----------
  await goto('/settings')
  const acct = page.getByTestId('account-card-access')
  await acct.locator('[data-card-right="platform:assistant"]').filter({ hasText: '已激活' }).waitFor()
  check('设置页: 账号与卡密授权区显示邮箱、四项授权、卡密输入框', (await acct.textContent()).includes(FIXTURE_EMAIL) && (await acct.locator('[data-card-right]').count()) === 4 && (await acct.getByRole('textbox', { name: '卡密', exact: true }).count()) === 1)
  check('设置页: 授权卡只有「激活卡密」一个按钮', (await acct.getByRole('button').allTextContents()).map((t) => t.trim()).filter(Boolean).join() === '激活卡密')
  check('设置页: 正常连接时不显示服务器连接提示', (await acct.getByTestId('card-refresh-failed').count()) === 0)
  await noForbidden('设置页授权卡', acct)
  await noForbidden('设置页整页')
  await acct.getByRole('textbox', { name: '卡密', exact: true }).fill(CODES.librarian)
  await acct.getByRole('button', { name: '激活卡密', exact: true }).click()
  await acct.locator('[data-card-right="game:librarian"]').filter({ hasText: '已激活' }).waitFor()
  check('设置页: 在这里激活图书管理员卡 → 已激活', (await stubInfo()).rights.find((r) => r.id === 'game:librarian').allowed === true)
  await shot('03-settings')

  // ---------- 5. Mod 详情 / 游戏激活 ----------
  const mods = await page.evaluate(() => window.api.listMods())
  const target = mods.mods.find((m) => m.gameId === 'dontscream') || mods.mods.find((m) => m.gameId && m.gameId !== 'librarian')
  assert.ok(target, '清单里要有第二款带 gameId 的 Mod')
  await goto('/mod/' + target.id)
  const modCard = page.getByTestId('mod-card-access')
  await modCard.waitFor()
  check('Mod 详情: 未激活 → 显示 Mod 未激活、娱乐助手到期时间、「激活卡密」按钮', (await modCard.getByTestId('mod-card-expiry').textContent()).includes('Mod · 未激活') && (await modCard.textContent()).includes('娱乐助手 · 到期时间') && (await modCard.getByRole('button', { name: '激活卡密', exact: true }).count()) === 1)
  await noForbidden('Mod 详情整页')
  await modCard.getByRole('button', { name: '激活卡密', exact: true }).click()
  const prompt = page.getByTestId('card-redeem-prompt')
  await prompt.waitFor()
  check('Mod 详情: 激活弹窗直达对应产品、只说输入卡密', (await prompt.getAttribute('data-product')) === 'game:' + target.gameId && /输入对应产品的卡密/.test(await prompt.textContent()))
  await noForbidden('游戏激活弹窗', prompt)
  await shot('04-mod-prompt')
  await prompt.getByRole('textbox', { name: '卡密', exact: true }).fill('ZL-NOPE-0000')
  await prompt.getByRole('button', { name: '激活', exact: true }).click()
  await prompt.getByRole('alert').filter({ hasText: '卡密无效' }).waitFor()
  check('Mod 详情: 无效卡密不放行、原因保留', (await stubInfo()).rights.find((r) => r.id === 'game:' + target.gameId).allowed === false)
  await page.getByRole('button', { name: '稍后激活', exact: true }).click()
  check('Mod 详情: 稍后激活关闭弹窗、权益不变', (await page.getByTestId('card-redeem-prompt').count()) === 0)

  // ---------- 6. 娱乐助手未激活提示 + 主进程门禁弹窗 ----------
  await setStub({ rights: { 'platform:assistant': { status: 'revoked', allowed: false, reasons: ['已收回'] } } })
  await goto('/ent')
  const bar = page.getByTestId('entertainment-card-bar')
  await bar.getByRole('button', { name: '激活卡密', exact: true }).waitFor({ timeout: 9000 })
  check('娱乐助手: 未激活提示 = 状态 + 可以先配置 + 「激活卡密」', (await bar.textContent()).includes('已收回') && (await bar.textContent()).includes('可以先配置'))
  await noForbidden('娱乐助手状态条', bar)
  await bar.getByRole('button', { name: '激活卡密', exact: true }).click()
  await prompt.waitFor()
  check('娱乐助手: 状态条激活入口直达娱乐助手', (await prompt.getAttribute('data-product')) === 'platform:assistant')
  await noForbidden('未激活提示弹窗', prompt)
  await shot('05-ent-prompt')
  await page.getByRole('button', { name: '稍后激活', exact: true }).click()
  await app.evaluate(() => global.__cardRequire('game:librarian'))
  await prompt.waitFor()
  check('主进程门禁: 弹窗说明产品与娱乐助手各自状态', (await prompt.textContent()).includes('图书管理员 Mod') && (await prompt.textContent()).includes('娱乐助手 · 已收回'))
  await page.getByRole('button', { name: '稍后激活', exact: true }).click()
  await setStub({ rights: { 'platform:assistant': { status: 'active', allowed: true, reasons: [] } } })
  await bar.filter({ hasText: '到期时间' }).waitFor({ timeout: 9000 })
  check('娱乐助手: 恢复后状态条只显示期限、不再催激活', (await bar.getByRole('button', { name: '激活卡密' }).count()) === 0)

  // ---------- 7. 断网 / 刷新失败 ----------
  await setStub({ ok: false, error: 'TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:1)' })
  await page.getByTestId('card-access-button').click()
  await dialog.getByTestId('card-refresh-failed').waitFor({ timeout: 9000 })
  const hint = await dialog.getByTestId('card-refresh-failed').textContent()
  check('断网: 顶栏弹窗只提示「暂时无法刷新授权，请检查网络后重试」', hint.trim() === '暂时无法刷新授权，请检查网络后重试', hint)
  await noForbidden('断网时顶栏弹窗', dialog)
  const offlineDialogText = await dialog.textContent()
  check('断网: 主进程不带权益 → 不显示上一次的权益 / 「已激活」，权益区只给中性提示、不说「还没有任何授权」', (await dialog.locator('[data-card-right]').count()) === 0 && (await dialog.getByTestId('card-rights-empty').textContent()).trim() === '暂时没有可显示的授权信息，请刷新后重试' && !offlineDialogText.includes('还没有任何授权') && !offlineDialogText.includes('已激活') && !offlineDialogText.includes('授权已生效'), offlineDialogText)
  check('断网: 账号邮箱（登录态）、卡密输入框、刷新按钮仍在', offlineDialogText.includes(FIXTURE_EMAIL) && (await codeInput.count()) === 1 && (await dialog.getByRole('button', { name: '刷新授权', exact: true }).count()) === 1)
  await dialog.getByRole('button', { name: '刷新授权', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '暂时无法刷新授权，请检查网络后重试' }).waitFor()
  check('断网: 点刷新授权 → 同一句短提示、不说「授权已刷新」', (await page.getByRole('status').filter({ hasText: '授权已刷新' }).count()) === 0)
  await codeInput.fill(CODES.platform)
  await activate.click()
  await dialog.getByRole('alert').waitFor()
  const offlineAlert = await dialog.getByRole('alert').textContent()
  check('断网: 激活失败提示「暂时无法激活，请检查网络后重试」，不带英文原文 / 地址', offlineAlert.trim() === '暂时无法激活，请检查网络后重试', offlineAlert)
  await shot('06-topbar-offline')
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  // 断网时主进程门禁弹窗（娱乐助手之前已激活过）：不能凭旧权益说「授权已生效」，要给网络提示 + 输入框
  await app.evaluate(() => global.__cardRequire('platform:assistant'))
  await prompt.waitFor()
  const offlinePromptText = await prompt.textContent()
  check('断网: 门禁弹窗不说「授权已生效」、没有「返回使用」，标题是「需要激活卡密」', !offlinePromptText.includes('授权已生效') && !offlinePromptText.includes('已激活') && (await page.getByRole('button', { name: '返回使用' }).count()) === 0 && (await page.getByRole('dialog').filter({ hasText: '需要激活卡密' }).count()) === 1, offlinePromptText)
  check('断网: 门禁弹窗带「暂时无法刷新授权，请检查网络后重试」提示与卡密输入框', (await prompt.getByTestId('card-refresh-failed').textContent()).trim() === '暂时无法刷新授权，请检查网络后重试' && (await prompt.getByRole('textbox', { name: '卡密', exact: true }).count()) === 1)
  await noForbidden('断网时门禁弹窗', prompt)
  await shot('06b-gate-prompt-offline')
  await page.getByRole('button', { name: '稍后激活', exact: true }).click()
  check('断网: 稍后激活关闭门禁弹窗', (await page.getByTestId('card-redeem-prompt').count()) === 0)
  await goto('/settings')
  await acct.getByTestId('card-refresh-failed').waitFor({ timeout: 9000 })
  check('断网: 设置页授权卡同一句短提示', (await acct.getByTestId('card-refresh-failed').textContent()).includes('暂时无法刷新授权'))
  await noForbidden('断网时设置页授权卡', acct)
  await shot('07-settings-offline')
  await setStub({ ok: true, error: undefined })
  await page.waitForFunction(() => !document.querySelector('[data-testid="card-refresh-failed"]'), null, { timeout: 9000 })
  check('恢复: 连接恢复后提示自动消失', (await acct.getByTestId('card-refresh-failed').count()) === 0)
  await setStub({ ok: false, error: '登录已失效，请重新登录' })
  await acct.getByTestId('card-refresh-failed').waitFor({ timeout: 9000 })
  check('登录失效: 提示「登录状态已失效，请重新登录后再试」', (await acct.getByTestId('card-refresh-failed').textContent()).includes('登录状态已失效'))
  await setStub({ ok: true, error: undefined })

  // ---------- 8. 时间插件事件库说明（用户截图指出的文案；事件库在「已有设置」折叠区里） ----------
  await goto('/ent?tool=time')
  const details = page.locator('details[data-time-settings]')
  await details.waitFor()
  if (!(await details.evaluate((el) => el.open))) await details.locator('> summary').click()
  const library = page.getByRole('region', { name: '时间盲盒事件库', exact: true })
  await library.waitFor({ timeout: 9000 })
  const libraryHint = (await library.locator('h3 + p').first().textContent()).trim()
  check('事件库: 说明只写「为每个事件设置时间、视频、音效和整蛊动作。」', libraryHint === '为每个事件设置时间、视频、音效和整蛊动作。', libraryHint)
  check('事件库: 区域内没有「今晚」/「项目开关」字样', !/今晚|项目开关/.test(await library.textContent()))
  await library.scrollIntoViewIfNeeded()
  await shot('08-time-library')

  // ---------- 9. 收尾 ----------
  const info = await stubInfo()
  check('全程: 主播端从未调用「打开平台」接口', info.opened === 0)
  check('全程: 激活请求都真的发到了主进程', info.redeemed >= 7, info.redeemed)
  check('全程: 页面无报错', errors.length === 0, errors.join('; '))
  completed = true
  console.log(`FORMAL-CARD-CLEANUP ${checks.length}/${checks.length} PASS; outDir=${outDir}; screenshots=${out}`)
} finally {
  await app.close().catch(() => {})
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ completed, outDir, checks, errors, finishedAt: new Date().toISOString() }, null, 2))
}
if (!completed) process.exit(1)

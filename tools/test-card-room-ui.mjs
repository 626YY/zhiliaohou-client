// 直播间绑定「小白向导」（卡密模式 RoomManager / RoomBindWizard）renderer 验收：真实隐藏 Electron + 主进程临时桩。
//   【桩】主进程内用 ipcMain.handle 替换 card:* / card:rooms / card:room-verify / card:room-commit / auth:unbind-room，
//        名额 / 改绑次数 / proof 的规则按 Tmp/live-data/rooms-contract.md 在桩里模拟；不连真实卡密平台、不打开真实抖音、
//        不启动游戏、不连直播；扫码由桩 finishScan 模拟完成，页面只拿到一个不显示的 proof。
//   阶段 A（legacy）：没有 license-provider.json → 连接器 / 设置页保持原来的绑定流程，没有 RoomManager。
//   阶段 B（card）  ：连接器直接可见绑定入口 → 先输入链接 → 扫码等待反馈（还没扫好 / 重新扫码 / 旧结果作废）→ 确认绑定
//                    → 短链接 / 非抖音链接不猜房号 → 名额不足直接弹名额卡 → 先扫码再补链接（proof 复用不重扫）
//                    → 更换（消耗 1 次改绑）→ 提交时次数不足弹改绑卡、兑换后回确认页不重扫 → 扫码失败留草稿
//                    → 取消不写服务端 → 解绑说清后果 → 设置页用 RoomManager 且账号 / 卡密授权卡仍在 → proof 不出现在页面。
//   阶段 C（联调）：真实 ../卡密系统 隔离实例 + 真实主进程 / preload；只有抖音扫码是夹具（假页面 + 写 cookie）。
// 用法：node tools/test-card-room-ui.mjs [--out-dir output/fable-room-ui-build] [--legacy-only] [--card-only] [--integration-only] [--no-integration]
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
const outDir = argValue('--out-dir', 'output/fable-room-ui-build')
const legacyOnly = argv.includes('--legacy-only')
const cardOnly = argv.includes('--card-only')
const out = path.join(root, 'output/playwright/card-room-ui')
await fs.mkdir(out, { recursive: true })
await fs.access(path.join(root, outDir, 'main/index.js'))

// 通道名从 shared/types.ts 读，和主进程 / preload 同一份真相
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
  session: channel('AuthSession'),
  emailLogin: channel('EmailLogin'),
  rooms: channel('CardRooms'),
  verify: channel('CardRoomVerify'),
  commit: channel('CardRoomCommit'),
  unbind: channel('AuthUnbindRoom')
}

const checks = []
const errorsAll = []
const check = (name, value) => {
  assert.ok(value, name)
  checks.push(name)
  console.log('PASS ' + name)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, label, ms = 10000, step = 150) => {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await sleep(step)
  }
  throw new Error('等待超时：' + label)
}

async function launch(tag, { provider = false } = {}) {
  const profile = await fs.mkdtemp(path.join(out, 'session-'))
  const entry = await writeHiddenElectronBootstrap(root, profile, { offscreen: true, outDir })
  if (provider) {
    // 只用来让主进程报告 enabled=true；地址指向没有服务的端口，公钥是格式合法的占位值
    await fs.writeFile(
      path.join(profile, 'license-provider.json'),
      JSON.stringify({ provider: 'card', origin: 'http://127.0.0.1:1/', publicKey: Buffer.alloc(32).toString('base64url') })
    )
  }
  // 本测试验的是名额 / 改绑次数的界面契约：强制打开授权检查（免检界面由 tools/verify-rooms-free.mjs 单独验）
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_LICENSE_ENFORCE: '1' }
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
const markGuidesSeen = (page) =>
  page.evaluate(async () => {
    await window.api.saveSettings({ guideSeen: true, autoLogin: false, assetGuideSeen: true })
    localStorage.setItem('zl-guide-seen', '1')
    localStorage.setItem('zl_configuration_level', 'basic')
  })

// ============ 阶段 A：没有 provider → 原来的绑定流程 ============
async function legacyPhase() {
  const { app, page, errors } = await launch('legacy')
  try {
    await page.waitForFunction(() => !!window.api?.register)
    const r = await page.evaluate(async () => {
      await window.api.register('room_legacy_fixture', 'Fixture123!', '直播间向导验收')
      const res = await window.api.login('room_legacy_fixture', 'Fixture123!')
      return res
    })
    assert.equal(r.ok, true, '夹具账号登录')
    await markGuidesSeen(page)
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    await goto(page, '/connector')
    await page.getByRole('button', { name: '去设置绑定', exact: true }).waitFor()
    check('legacy: 连接器仍是「去设置绑定」，没有卡密向导入口', (await page.getByTestId('connector-bind-btn').count()) === 0 && (await page.getByTestId('room-manager').count()) === 0)
    await goto(page, '/settings')
    await page.getByRole('heading', { name: '账号与直播间绑定' }).waitFor()
    check('legacy: 设置页保留原绑定表单，没有 RoomManager', (await page.getByRole('textbox', { name: '抖音直播间号' }).count()) === 1 && (await page.getByRole('button', { name: '绑定', exact: true }).count()) === 1 && (await page.getByTestId('room-manager').count()) === 0)
    await shot(page, 'legacy-settings')
    assert.deepEqual(errors, [], 'legacy 阶段页面报错')
  } finally {
    await app.close()
  }
}

// ============ 阶段 B：provider + 主进程内临时桩 ============
const FIXTURE_EMAIL = 'room-fixture@example.test'
const PLATFORM_CODE = 'ZL-FIXTURE-0000-0000' // 桩里的娱乐助手卡（占位值，不是真实卡密）
const SLOT_CODE = 'ZL-SLOT-0000-0000' // 桩里的名额卡
const CHANGE_CODE = 'ZL-CHANGE-0000-0000' // 桩里的改绑卡
async function installStub(app) {
  await app.evaluate(
    ({ ipcMain }, { CH, FIXTURE_EMAIL, PLATFORM_CODE, SLOT_CODE, CHANGE_CODE }) => {
      const now = () => Math.floor(Date.now() / 1000)
      const right = (id, name, kind, patch) => ({ id, name, kind, status: 'missing', permanent: false, expires_at: null, allowed: false, reasons: ['未激活'], ...patch })
      const stub = {
        ok: true,
        user: { id: 'u-room-fixture', email: FIXTURE_EMAIL },
        rights: [right('platform:assistant', '娱乐助手', 'platform', { status: 'active', allowed: true, expires_at: now() + 7 * 86400, reasons: [] }), right('game:librarian', '图书管理员 Mod', 'game')],
        loggedIn: false,
        // 名额规则（契约）：默认 1 个名额、3 次改绑；名额卡 +1；改绑卡补满 3（已满拒绝且不消耗）
        quota: { capacity: 1, changes_left: 3, changes_used: 0, available: 1, rooms: [], bindings: [] },
        nextSlot: 1,
        verifyMode: 'ok', // ok | needRoom | fail | pending
        verifyCalls: [],
        pending: [],
        proofs: {},
        proofSeq: 0,
        commitCalls: [],
        unbindCalls: [],
        redeemed: [],
        forceNeedCard: null,
        nickname: '测试主播'
      }
      global.__roomStub = stub
      const quota = () => JSON.parse(JSON.stringify(stub.quota))
      const sessionUser = () => ({ id: stub.user.id, username: stub.user.email, nickname: '直播间向导验收', avatar: '', createdAt: 0, boundRooms: [...stub.quota.rooms], email: stub.user.email })
      const snapshot = () => ({ ok: stub.ok, enabled: true, origin: 'http://127.0.0.1:1', user: stub.loggedIn ? stub.user : undefined, rights: stub.rights.map((r) => ({ ...r })), roomQuota: quota(), error: stub.error })
      const issueProof = (room) => {
        const p = 'proof-' + ++stub.proofSeq + '-' + Math.random().toString(36).slice(2, 10)
        stub.proofs[p] = { room: room || '', used: false }
        return p
      }
      const bindRoom = (room) => {
        stub.quota.rooms.push(room)
        stub.quota.bindings.push({ slot: stub.nextSlot++, room })
        stub.quota.available = stub.quota.capacity - stub.quota.rooms.length
      }
      for (const c of [CH.state, CH.redeem, CH.open, CH.session, CH.emailLogin, CH.rooms, CH.verify, CH.commit, CH.unbind]) ipcMain.removeHandler(c)
      ipcMain.handle(CH.session, async () => (stub.loggedIn ? sessionUser() : null))
      ipcMain.handle(CH.emailLogin, async (_e, email) => {
        if (email !== stub.user.email) return { ok: false, error: '账号或密码不正确' }
        stub.loggedIn = true
        return { ok: true, user: sessionUser() }
      })
      ipcMain.handle(CH.state, async () => snapshot())
      ipcMain.handle(CH.open, async () => ({ ok: true }))
      ipcMain.handle(CH.redeem, async (_e, code) => {
        stub.redeemed.push(typeof code === 'string' ? code : typeof code)
        if (code === PLATFORM_CODE) {
          Object.assign(stub.rights[0], { status: 'active', allowed: true, expires_at: now() + 7 * 86400, reasons: [] })
          return snapshot()
        }
        if (code === SLOT_CODE) {
          stub.quota.capacity++
          stub.quota.available = stub.quota.capacity - stub.quota.rooms.length
          return snapshot()
        }
        if (code === CHANGE_CODE) {
          if (stub.quota.changes_left >= 3) return { ok: false, enabled: true, error: '改绑次数已经是 3 次，这张卡没有消耗' }
          stub.quota.changes_left = 3
          return snapshot()
        }
        return { ok: false, enabled: true, error: '卡密不存在或已使用' }
      })
      ipcMain.handle(CH.rooms, async () => ({ ok: true, quota: quota() }))
      ipcMain.handle(CH.verify, async (_e, room, proof) => {
        const call = { room: room ?? null, proofType: typeof proof, proof: typeof proof === 'string' ? proof : null, mode: stub.verifyMode }
        stub.verifyCalls.push(call)
        const finish = () => {
          if (stub.verifyMode === 'fail') return { ok: false, error: '扫码窗口被关掉了，没有拿到登录信息' }
          if (proof && stub.proofs[proof]) {
            // 复用刚扫的码：不再扫，只核房号
            stub.proofs[proof].room = room || ''
            return { ok: true, proof, room, nickname: stub.nickname }
          }
          if (stub.verifyMode === 'needRoom' && !room) return { ok: true, needRoom: true, proof: issueProof('') }
          return { ok: true, proof: issueProof(room), room: room || '', nickname: stub.nickname }
        }
        // call.issued = 这次发给页面的 proof（页面之后 commit / 复用时必须原样带回）
        const done = (result) => {
          call.issued = result?.proof || null
          return result
        }
        if (stub.verifyMode === 'pending') {
          return new Promise((resolve) => {
            stub.pending.push((override) => resolve(done(override ?? finish())))
          })
        }
        return done(finish())
      })
      ipcMain.handle(CH.commit, async (_e, input) => {
        const rec = { action: input?.action, room: input?.room, previous: input?.previous ?? null, proofType: typeof input?.proof, proof: input?.proof }
        stub.commitCalls.push(rec)
        const p = stub.proofs[input?.proof]
        if (!p || p.used) return { ok: false, error: '扫码凭证已失效，请重新扫码', code: 'proof_invalid' }
        if (p.room && p.room !== input.room) return { ok: false, error: '扫码时核对的直播间和要绑定的不一致', code: 'proof_room_mismatch' }
        if (stub.forceNeedCard) {
          const need = stub.forceNeedCard
          stub.forceNeedCard = null
          return { ok: false, needCard: need, code: need === 'room_slot' ? 'room_slot_card_required' : 'room_change_card_required', error: need === 'room_slot' ? '名额不足' : '改绑次数不足' }
        }
        const q = stub.quota
        if (input.action === 'bind') {
          if (!q.rooms.includes(input.room)) {
            if (q.available <= 0) return { ok: false, needCard: 'room_slot', code: 'room_slot_card_required', error: '名额不足' }
            bindRoom(input.room)
          }
        } else if (input.action === 'replace') {
          if (!q.rooms.includes(input.previous)) return { ok: false, error: '原直播间不在绑定列表里' }
          if (input.room !== input.previous) {
            if (q.changes_left <= 0) return { ok: false, needCard: 'room_change', code: 'room_change_card_required', error: '改绑次数不足' }
            q.changes_left--
            q.changes_used++
            q.rooms = q.rooms.map((r) => (r === input.previous ? input.room : r))
            q.bindings = q.bindings.map((b) => (b.room === input.previous ? { ...b, room: input.room } : b))
          }
        } else return { ok: false, error: '未知动作' }
        p.used = true
        return { ok: true, boundRooms: [...q.rooms], quota: quota() }
      })
      ipcMain.handle(CH.unbind, async (_e, room) => {
        stub.unbindCalls.push(room)
        const q = stub.quota
        q.rooms = q.rooms.filter((r) => r !== room)
        q.bindings = q.bindings.filter((b) => b.room !== room)
        q.available = q.capacity - q.rooms.length
        return { ok: true, boundRooms: [...q.rooms] }
      })
      global.__roomStubControl = {
        finishScan: (index, override) => {
          const fn = stub.pending[index]
          if (!fn) return false
          stub.pending[index] = null
          fn(override)
          return true
        }
      }
    },
    { CH, FIXTURE_EMAIL, PLATFORM_CODE, SLOT_CODE, CHANGE_CODE }
  )
}
const stubInfo = (app) =>
  app.evaluate(() => {
    const s = global.__roomStub
    return { quota: s.quota, verifyCalls: s.verifyCalls, commitCalls: s.commitCalls, unbindCalls: s.unbindCalls, redeemed: s.redeemed, proofs: Object.keys(s.proofs) }
  })
const setStub = (app, patch) =>
  app.evaluate((_, patch) => {
    const s = global.__roomStub
    if (patch.verifyMode) s.verifyMode = patch.verifyMode
    if (patch.quota) Object.assign(s.quota, patch.quota)
    if ('forceNeedCard' in patch) s.forceNeedCard = patch.forceNeedCard
    if ('nickname' in patch) s.nickname = patch.nickname
  }, patch)
const finishScan = (app, index, override) => app.evaluate((_, a) => global.__roomStubControl.finishScan(a.index, a.override), { index, override })

/** 页面任何地方都不能出现 proof 字符串（令牌只在主进程；proof 也只是主进程发的一次性凭证，不给主播看） */
const proofNotShown = async (page, app) => {
  const { proofs } = await stubInfo(app)
  const html = await page.content()
  return proofs.length > 0 && proofs.every((p) => !html.includes(p))
}

async function cardPhase() {
  const { app, page, errors } = await launch('card', { provider: true })
  try {
    await installStub(app)
    await page.reload()
    await page.waitForFunction(() => typeof window.api?.cardRooms === 'function' && typeof window.api?.cardState === 'function')
    check('card: preload 已暴露 cardRooms / cardRoomVerify / cardRoomCommit', await page.evaluate(() => typeof window.api.cardRoomVerify === 'function' && typeof window.api.cardRoomCommit === 'function'))
    await page.locator('[data-testid="login-panel"][data-card-mode="1"]').waitFor()
    await markGuidesSeen(page)
    await page.getByPlaceholder('邮箱 / 用户名').fill(FIXTURE_EMAIL)
    await page.getByPlaceholder('密码').fill('Fixture123!')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()

    // ---- 连接器：没绑定时直接可见引导 + 绑定入口 ----
    await goto(page, '/connector')
    const guide = page.getByTestId('connector-room-guide')
    await guide.waitFor()
    check('card: 连接器没绑定时显示引导和「绑定直播间」，不再要求去设置页', (await guide.textContent()).includes('还没有绑定直播间') && (await page.getByRole('button', { name: '去设置绑定' }).count()) === 0)
    await page.getByTestId('connector-bind-btn').click()
    const dialog = page.getByRole('dialog')
    const manager = dialog.getByTestId('room-manager')
    await manager.waitFor()
    await manager.locator('[data-ready="1"]').waitFor().catch(() => {})
    const quotaText = () => manager.getByTestId('room-quota').textContent()
    await waitFor(async () => (await quotaText()).includes('已绑定 0 / 1 个'), '名额读取')
    check('card: 列表清楚显示已绑 0/1、可添加 1、剩余改绑 3', (await quotaText()).includes('可添加 1 个') && (await quotaText()).includes('剩余改绑 3 次'))
    check('card: 界面不出现申请 / 审批 / 令牌 / 槽位这类内部词', (await manager.textContent()).match(/申请|审批|令牌|token|槽位|slot/i) === null)
    await shot(page, 'card-connector-manager-empty')

    // ---- 流程 A：先粘贴分享文案（含完整链接）→ 扫码（等待反馈）→ 确认绑定 ----
    await setStub(app, { verifyMode: 'pending' })
    await manager.getByTestId('room-add-input').fill('【抖音】测试主播正在直播 https://live.douyin.com/577117602?enter_from_merge=web_share_link&enter_method=web_share_link 快来看')
    await manager.getByTestId('room-add-btn').click()
    const wizard = page.getByTestId('room-wizard')
    await wizard.waitFor()
    check('card: 快捷输入直接进入「输入」步', (await wizard.getAttribute('data-step')) === 'input')
    const parsed = wizard.getByTestId('room-parsed')
    await parsed.waitFor()
    check('card: 分享文案里识别出真实房号 577117602（来自链接）', (await parsed.getAttribute('data-room')) === '577117602' && (await parsed.textContent()).includes('来自链接'))
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="scan"]').waitFor()
    const scan = wizard.getByTestId('room-scan')
    check('card: 扫码页写明「浏览器已经打开，用抖音扫一扫；完成会自动回来」', (await scan.textContent()).includes('浏览器已经打开，用抖音扫一扫；完成会自动回来'))
    check('card: 扫码页有还没扫好 / 重新扫码 / 取消', (await page.getByRole('button', { name: '还没扫好', exact: true }).count()) === 1 && (await page.getByRole('button', { name: '重新扫码', exact: true }).count()) === 1 && (await page.getByRole('button', { name: '取消', exact: true }).count()) === 1)
    await waitFor(async () => (await stubInfo(app)).verifyCalls.length === 1, 'verify 被调用')
    let info = await stubInfo(app)
    check('card: 输入房号入口把识别出的房号交给主进程 verify（不带 proof）', info.verifyCalls[0].room === '577117602' && info.verifyCalls[0].proofType === 'undefined')
    await page.waitForTimeout(1300)
    check('card: 等待期间显示已等待时长（不是无反馈）', !(await wizard.getByTestId('room-scan-elapsed').textContent()).includes('0:00'))
    await page.getByRole('button', { name: '还没扫好', exact: true }).click()
    await wizard.getByTestId('room-scan-help').waitFor()
    check('card: 「还没扫好」给出安抚说明', (await wizard.getByTestId('room-scan-help').textContent()).includes('慢慢扫'))
    await shot(page, 'card-scan-waiting')
    await page.getByRole('button', { name: '重新扫码', exact: true }).click()
    await waitFor(async () => (await stubInfo(app)).verifyCalls.length === 2, '重新扫码再次 verify')
    // 第一次（已作废）的扫码此时才回来 → 页面不能动
    await finishScan(app, 0)
    await page.waitForTimeout(500)
    check('card: 重新扫码后旧的扫码结果作废，页面仍在等待', (await wizard.getAttribute('data-step')) === 'scan')
    await finishScan(app, 1)
    await page.locator('[data-testid="room-wizard"][data-step="confirm"]').waitFor()
    const confirm = wizard.getByTestId('room-confirm')
    check('card: 确认页显示房号 + 昵称', (await confirm.getAttribute('data-room')) === '577117602' && (await confirm.getByTestId('room-nickname').textContent()) === '测试主播')
    check('card: 确认页说明本次使用 1 个名额（0/1 → 1/1）', (await confirm.getByTestId('room-consequence').textContent()).includes('使用 1 个直播间名额') && (await confirm.getByTestId('room-consequence').textContent()).includes('0 / 1 个 → 1 / 1 个'))
    check('card: 确认按钮是「确认绑定」', (await page.getByRole('button', { name: '确认绑定', exact: true }).count()) === 1)
    check('card: proof 不出现在页面上', await proofNotShown(page, app))
    await shot(page, 'card-confirm-bind')
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="done"]').waitFor()
    info = await stubInfo(app)
    check('card: commit 用 bind + 房号 + 主进程 proof，且是第二次扫码的 proof', info.commitCalls.length === 1 && info.commitCalls[0].action === 'bind' && info.commitCalls[0].room === '577117602' && info.commitCalls[0].proof === info.verifyCalls[1].issued && info.commitCalls[0].proof !== info.verifyCalls[0].issued)
    check('card: 完成页写明已绑定直播间 + 昵称', (await wizard.getByTestId('room-done').textContent()).includes('已绑定直播间 577117602（测试主播）'))
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await manager.locator('[data-testid="room-row"][data-room="577117602"]').waitFor()
    check('card: 列表出现已绑房间，名额变 1/1、可添加 0', (await quotaText()).includes('已绑定 1 / 1 个') && (await quotaText()).includes('可添加 0 个'))
    check('card: 添加区改名「添加另一个直播间」并提示名额已用完', (await manager.getByTestId('room-add').textContent()).includes('添加另一个直播间') && (await manager.getByTestId('room-add').textContent()).includes('名额已用完'))
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    await waitFor(async () => (await page.getByRole('combobox', { name: '直播间号' }).inputValue()) === '577117602', '连接器自动选中新绑的直播间')
    check('card: 绑定后连接器自动选中该直播间，且有「绑定 / 管理直播间」入口', (await page.getByTestId('connector-manage-btn').count()) === 1 && (await page.getByTestId('connector-room-guide').count()) === 0)
    await shot(page, 'card-connector-bound')

    // ---- 短链接 / 非抖音链接：不猜房号 ----
    await page.getByTestId('connector-manage-btn').click()
    await manager.waitFor()
    await setStub(app, { verifyMode: 'ok' })
    await manager.getByTestId('room-add-input').fill('https://v.douyin.com/iAbCdEf/')
    await manager.getByTestId('room-add-btn').click()
    await wizard.waitFor()
    // 名额已满：先弹名额卡（不让主播白扫码）
    check('card: 名额用完时快捷绑定直接停在名额卡步', (await wizard.getAttribute('data-step')) === 'card' && (await wizard.getByTestId('room-card-panel').getAttribute('data-kind')) === 'room_slot')
    check('card: 名额卡步说明已绑 1/1、名额卡长期 +1', (await wizard.getByTestId('room-card-panel').textContent()).includes('已绑 1 / 1 个') && (await wizard.getByTestId('room-card-panel').textContent()).includes('长期增加 1 个'))
    await shot(page, 'card-need-slot-card')
    await wizard.getByRole('textbox', { name: '卡密', exact: true }).fill(SLOT_CODE)
    await wizard.getByRole('button', { name: '激活', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="input"]').waitFor()
    check('card: 名额卡兑换成功后回到原来的输入步（不清输入）', (await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).inputValue()).includes('v.douyin.com'))
    await wizard.getByRole('alert').waitFor()
    check('card: 短链接明确说没有房号、让打开后复制完整地址；下一步禁用', (await wizard.getByRole('alert').textContent()).includes('短链接') && (await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).isDisabled()))
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('https://www.bilibili.com/live/12345')
    check('card: 非抖音链接被拒绝', (await wizard.getByRole('alert').textContent()).includes('不是抖音直播链接'))
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('https://www.douyin.com/follow/live/123456')
    check('card: douyin.com/…/live/数字 也能识别', (await wizard.getByTestId('room-parsed').getAttribute('data-room')) === '123456')
    const before = await stubInfo(app)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForTimeout(300)
    info = await stubInfo(app)
    check('card: 取消向导不做任何服务端写入（verify / commit 次数不变）', info.verifyCalls.length === before.verifyCalls.length && info.commitCalls.length === before.commitCalls.length && (await wizard.count()) === 0)
    await waitFor(async () => (await quotaText()).includes('可添加 1 个'), '名额卡后可添加 1')
    check('card: 名额卡后列表显示 1/2、可添加 1', (await quotaText()).includes('已绑定 1 / 2 个'))

    // ---- 流程 B：先扫码 → 官方给不出房号 → 粘贴链接补房号（复用 proof 不重扫）→ 确认 ----
    await setStub(app, { verifyMode: 'needRoom' })
    await manager.getByTestId('room-scan-btn').click()
    await wizard.waitFor()
    await page.locator('[data-testid="room-wizard"][data-step="askRoom"]').waitFor()
    info = await stubInfo(app)
    const firstProof = info.verifyCalls.at(-1).issued
    check('card: 先扫码入口 verify 不带房号', info.verifyCalls.at(-1).room === null && info.verifyCalls.at(-1).proofType === 'undefined')
    check('card: 扫码后不知道房号 → 一句话让粘贴直播链接，并标「已扫码 · 不用再扫」', (await wizard.textContent()).includes('还差直播间号') && (await wizard.textContent()).includes('不用再扫'))
    await shot(page, 'card-ask-room')
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('https://live.douyin.com/123456/')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="confirm"]').waitFor()
    info = await stubInfo(app)
    const secondCall = info.verifyCalls.at(-1)
    check('card: 补房号后 verify(room, proof) 复用刚扫的码，不重复扫码', secondCall.room === '123456' && !!firstProof && secondCall.proof === firstProof && info.verifyCalls.filter((c) => c.proofType === 'undefined').length === 3)
    check('card: 先扫码流程的确认页也显示房号 + 名额说明（1/2 → 2/2）', (await confirm.getAttribute('data-room')) === '123456' && (await confirm.getByTestId('room-consequence').textContent()).includes('1 / 2 个 → 2 / 2 个'))
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="done"]').waitFor()
    info = await stubInfo(app)
    check('card: 第二个直播间绑定成功，proof 与扫码时一致', info.commitCalls.at(-1).room === '123456' && info.commitCalls.at(-1).proof === firstProof && info.quota.rooms.length === 2)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await manager.locator('[data-testid="room-row"][data-room="123456"]').waitFor()
    check('card: 两个直播间都在列表里，既有绑定保留', (await manager.getByTestId('room-row').count()) === 2 && (await manager.locator('[data-room="577117602"]').count()) === 1)
    await shot(page, 'card-two-rooms')

    // ---- 更换这个直播间：消耗 1 次改绑，不偷偷替换 ----
    await setStub(app, { verifyMode: 'ok' })
    await manager.locator('[data-testid="room-row"][data-room="123456"]').getByTestId('room-replace-btn').click()
    await wizard.waitFor()
    check('card: 更换向导标题带原房号、说明会消耗 1 次改绑', (await dialog.last().textContent()).includes('更换直播间 123456') && (await wizard.textContent()).includes('消耗 1 次改绑（剩 3 次）'))
    await wizard.getByTestId('room-entry-input').click()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('999999')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="confirm"]').waitFor()
    check('card: 改绑确认页写明 原 → 新、消耗 1 次改绑（3 → 2）、按钮是「确认改绑」', (await confirm.textContent()).includes('123456') && (await confirm.textContent()).includes('999999') && (await confirm.getByTestId('room-consequence').textContent()).includes('剩余 3 次 → 2 次') && (await page.getByRole('button', { name: '确认改绑', exact: true }).count()) === 1)
    await shot(page, 'card-confirm-replace')
    await page.getByRole('button', { name: '确认改绑', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="done"]').waitFor()
    info = await stubInfo(app)
    check('card: commit 用 replace + previous，列表里旧房被新房替换、其他房不动', info.commitCalls.at(-1).action === 'replace' && info.commitCalls.at(-1).previous === '123456' && info.commitCalls.at(-1).room === '999999' && info.quota.rooms.join(',') === '577117602,999999')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await waitFor(async () => (await quotaText()).includes('剩余改绑 2 次'), '改绑次数刷新')
    check('card: 改绑后剩余改绑 2 次', (await manager.locator('[data-testid="room-row"][data-room="999999"]').count()) === 1)

    // ---- 提交时次数不足 → 直接弹改绑卡 → 兑换后回确认页、不重扫 ----
    await setStub(app, { forceNeedCard: 'room_change', quota: { changes_left: 0 } })
    // 让桩的「剩 0 次」先不被界面预检拦下（预检只看本地快照），这里验证 commit 返回 needCard 的路径
    await manager.locator('[data-testid="room-row"][data-room="999999"]').getByTestId('room-replace-btn').click()
    await wizard.waitFor()
    if ((await wizard.getAttribute('data-step')) === 'card') {
      // 轮询已经把 changes_left=0 同步进来 → 预检直接弹改绑卡；也算符合「次数不足直接改绑卡」
      check('card: 次数不足时更换直接停在改绑卡步', (await wizard.getByTestId('room-card-panel').getAttribute('data-kind')) === 'room_change')
      await wizard.getByRole('textbox', { name: '卡密', exact: true }).fill(CHANGE_CODE)
      await wizard.getByRole('button', { name: '激活', exact: true }).click()
      await page.locator('[data-testid="room-wizard"][data-step="entry"]').waitFor()
      await setStub(app, { forceNeedCard: 'room_change' })
    }
    await wizard.getByTestId('room-entry-input').click()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('888888')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="confirm"]').waitFor()
    const verifyCountBefore = (await stubInfo(app)).verifyCalls.length
    await page.getByRole('button', { name: '确认改绑', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="card"]').waitFor()
    check('card: commit 回 needCard=room_change → 直接弹改绑卡，并说明扫码结果已保留', (await wizard.getByTestId('room-card-panel').getAttribute('data-kind')) === 'room_change' && (await wizard.textContent()).includes('扫码结果已保留'))
    await shot(page, 'card-need-change-card')
    await setStub(app, { quota: { changes_left: 0 } })
    await wizard.getByRole('textbox', { name: '卡密', exact: true }).fill(CHANGE_CODE)
    await wizard.getByRole('button', { name: '激活', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="confirm"]').waitFor()
    check('card: 改绑卡兑换后回到确认页，没有重新扫码', (await stubInfo(app)).verifyCalls.length === verifyCountBefore && (await confirm.getAttribute('data-room')) === '888888')
    await page.getByRole('button', { name: '确认改绑', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="done"]').waitFor()
    info = await stubInfo(app)
    check('card: 兑换后的改绑提交成功，用的还是同一个 proof', info.commitCalls.at(-1).room === '888888' && info.commitCalls.at(-1).proof === info.commitCalls.at(-2).proof && info.quota.rooms.includes('888888'))
    await page.getByRole('button', { name: '完成', exact: true }).click()

    // ---- 扫码失败：留草稿、可重扫、取消不写 ----
    // 桩里模拟后台给这个账号多加 1 个名额（2/3），点刷新后界面同步，才能走「添加」路径
    await setStub(app, { verifyMode: 'fail', quota: { capacity: 3, available: 1 } })
    await manager.getByRole('button', { name: '刷新直播间名额', exact: true }).click()
    await waitFor(async () => (await quotaText()).includes('已绑定 2 / 3 个'), '刷新后名额 2/3')
    check('card: 点刷新后名额按平台最新数据显示（2/3、可添加 1）', (await quotaText()).includes('可添加 1 个'))
    await manager.getByTestId('room-add-input').fill('777777')
    await manager.getByTestId('room-add-btn').click()
    await wizard.waitFor()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await wizard.locator('[data-testid="room-scan"][data-error="1"]').waitFor()
    check('card: 扫码失败显示原因，草稿房号还在，可重新扫码', (await wizard.getByRole('alert').textContent()).includes('扫码窗口被关掉') && (await wizard.textContent()).includes('777777') && (await page.getByRole('button', { name: '重新扫码', exact: true }).count()) === 1)
    await shot(page, 'card-scan-failed')
    const commitsBefore = (await stubInfo(app)).commitCalls.length
    await page.getByRole('button', { name: '取消', exact: true }).click()
    check('card: 失败后取消不提交', (await stubInfo(app)).commitCalls.length === commitsBefore && (await wizard.count()) === 0)

    // ---- 等待扫码中取消：稍后回来的扫码结果不会弹出任何东西 ----
    await setStub(app, { verifyMode: 'pending' })
    await manager.getByTestId('room-add-input').fill('666666')
    await manager.getByTestId('room-add-btn').click()
    await wizard.waitFor()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await page.locator('[data-testid="room-wizard"][data-step="scan"]').waitFor()
    const pendingIndex = (await stubInfo(app)).verifyCalls.length - 1
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await finishScan(app, pendingIndex)
    await page.waitForTimeout(500)
    check('card: 等待扫码时取消，之后回来的结果被丢弃、不提交', (await wizard.count()) === 0 && (await stubInfo(app)).commitCalls.length === commitsBefore)
    await setStub(app, { verifyMode: 'ok', quota: { capacity: 2, available: 0 } })
    await manager.getByRole('button', { name: '刷新直播间名额', exact: true }).click()
    await waitFor(async () => (await quotaText()).includes('已绑定 2 / 2 个'), '名额收回到 2/2')

    // ---- 解绑：说清名额 / 改绑后果，不清配置 ----
    await manager.locator('[data-testid="room-row"][data-room="888888"]').getByTestId('room-unbind-btn').click()
    const unbind = page.getByTestId('room-unbind-dialog')
    await unbind.waitFor()
    const unbindText = await unbind.textContent()
    check('card: 解绑弹窗写明名额空出（0 → 1）、不消耗改绑次数、之后换别的房算 1 次、配置不清', unbindText.includes('可添加 0 个 → 1 个') && unbindText.includes('不消耗改绑次数') && unbindText.includes('会算 1 次改绑') && unbindText.includes('不会被清除'))
    await shot(page, 'card-unbind-confirm')
    await page.getByTestId('room-unbind-confirm').click()
    await waitFor(async () => (await manager.locator('[data-testid="room-row"][data-room="888888"]').count()) === 0, '解绑后行消失')
    info = await stubInfo(app)
    check('card: 解绑走 unbindRoom，列表与名额同步（1/2、可添加 1）', info.unbindCalls.at(-1) === '888888' && (await quotaText()).includes('已绑定 1 / 2 个') && (await quotaText()).includes('可添加 1 个'))
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

    // ---- 设置页：卡密模式用 RoomManager，账号 / 卡密授权卡仍在 ----
    await goto(page, '/settings')
    await page.getByRole('heading', { name: '账号与卡密授权' }).waitFor()
    await page.getByTestId('room-manager').waitFor()
    check('card: 设置页账号与卡密授权卡保留', (await page.getByTestId('account-card-access').count()) === 1 && (await page.getByTestId('card-redeem-form').count()) >= 1)
    check('card: 设置页直播间绑定改为 RoomManager（旧的申请 / 验证弹窗入口不再出现）', (await page.getByText('直播间绑定', { exact: true }).count()) === 1 && (await page.getByRole('textbox', { name: '抖音直播间号' }).count()) === 1 && (await page.getByRole('button', { name: '绑定', exact: true }).count()) === 1 && (await page.getByText('首次绑定会打开抖音网页').count()) === 0)
    check('card: 设置页 RoomManager 列出既有绑定与名额', (await page.getByTestId('room-manager').locator('[data-testid="room-row"][data-room="577117602"]').count()) === 1 && (await page.getByTestId('room-quota').textContent()).includes('剩余改绑 2 次'))
    check('card: 设置页其余分区（游戏 / 外观 / 挂件窗口采集 / 关于）都在', (await page.getByRole('heading', { name: '游戏', exact: true }).count()) === 1 && (await page.getByRole('heading', { name: '外观', exact: true }).count()) === 1 && (await page.getByText('挂件窗口采集', { exact: true }).count()) === 1 && (await page.getByText('关于', { exact: true }).count()) === 1)
    await shot(page, 'card-settings-room-manager')
    // 独立的改绑卡入口：剩 2 次时可用 → 兑换补满 3 → 按钮禁用并说明已满
    check('card: 剩余改绑 2 次时「用改绑卡补次数」可用', !(await page.getByTestId('room-change-card-btn').isDisabled()))
    await page.getByTestId('room-change-card-btn').click()
    await page.getByTestId('room-card-modal').waitFor()
    check('card: 改绑卡入口弹窗说明当前剩余次数与补满规则', (await page.getByTestId('room-card-modal').textContent()).includes('当前剩余改绑 2 次') && (await page.getByTestId('room-card-modal').textContent()).includes('可以累加')) // 文案早已从「补满到 3 次」改成「+3 可累加」，断言跟着源码走
    await page.getByTestId('room-card-modal').getByRole('textbox', { name: '卡密', exact: true }).fill(CHANGE_CODE)
    await page.getByTestId('room-card-modal').getByRole('button', { name: '激活', exact: true }).click()
    await waitFor(async () => (await page.getByTestId('room-card-modal').count()) === 0, '改绑卡弹窗自动关闭')
    await waitFor(async () => (await page.getByTestId('room-quota').textContent()).includes('剩余改绑 3 次'), '改绑次数补满')
    check('card: 改绑次数已满 3 次时「用改绑卡补次数」禁用', await page.getByTestId('room-change-card-btn').isDisabled())
    await page.getByTestId('room-slot-card-btn').click()
    await page.getByTestId('room-card-modal').waitFor()
    check('card: 名额卡入口弹窗说明当前名额与名额卡作用', (await page.getByTestId('room-card-modal').textContent()).includes('当前名额 2 个') && (await page.getByTestId('room-card-modal').textContent()).includes('长期增加 1 个'))
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click()
    check('card: proof 从未出现在页面上（全流程）', await proofNotShown(page, app))
    check('card: 卡密只以字符串发到主进程', (await stubInfo(app)).redeemed.every((t) => typeof t === 'string' && t.startsWith('ZL-')))
    assert.deepEqual(errors, [], 'card 阶段页面报错')
  } finally {
    await app.close()
  }
}

// ============ 阶段 C：真实卡密平台（../卡密系统 隔离实例）+ 真实主进程 + 真实 preload，只有「抖音扫码」是夹具 ============
//   【夹具】扫码窗口所在的私有分区挂假登录页；主进程 fetch 对 live.douyin.com 回假资料；「扫码」= 往该分区写一枚 sessionid。
//   不打开真实抖音、不代任何人登录、不连直播、不启动游戏；平台数据目录是本次临时目录，跑完可整目录删除。
const A_EMAIL = `room-ui-${Date.now()}@example.test`
const A_PASSWORD = 'Fixture-' + Math.random().toString(36).slice(2, 12)
const PLATFORM_FIXTURE_PY = String.raw`# 直播间向导联调专用（由 tools/test-card-room-ui.mjs 生成到临时目录）：隔离的本机卡密平台 + 名额卡 / 改绑卡制卡。
#   做法与 tools/formal-card-fixture.py 一致：TESTING + IDENTITY_MODE=local，不碰旧后台 / 线上；卡密只经 stdout 一行 JSON 交给调用方。
import json, secrets, sys, threading
from pathlib import Path
platform_root = Path(sys.argv[1]).resolve()
data_dir = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(platform_root))
from app import create_admin, create_app  # noqa: E402
from core import PLATFORM  # noqa: E402
from room_rules import RoomRules  # noqa: E402
from werkzeug.serving import WSGIRequestHandler, make_server  # noqa: E402

class Quiet(WSGIRequestHandler):
    def log(self, *args, **kwargs):
        pass

app = create_app({'TESTING': True, 'DATA_DIR': data_dir, 'IDENTITY_MODE': 'local', 'ADMIN_URL': '', 'ADMIN_CA': '', 'TRUST_PROXY': False,
                  'COOKIE_SECURE': False, 'LEGACY_TOKEN_FILE': '', 'LEGACY_URL': '', 'LEGACY_CA': ''})
store = app.extensions['store']
create_admin(app, 'fixture-admin@example.test', secrets.token_urlsafe(24))
with store.transaction(False) as c:
    ACTOR = store.user(c, 'fixture-admin@example.test')['id']
cards = {}
with store.transaction() as c:
    sku = store.create_sku(c, ACTOR, {'product_id': PLATFORM, 'name': '娱乐助手周卡', 'days': 7, 'permanent': False, 'price_cents': 1})
    batches = {'platform': store.mint(c, ACTOR, {'sku_id': sku['id'], 'quantity': 2}),
               'slot': store.mint(c, ACTOR, {'catalog_key': 'room:slot|once', 'quantity': 3}),
               'change': store.mint(c, ACTOR, {'catalog_key': 'room:change|once', 'quantity': 3})}
    for key, batch in batches.items():
        rows = c.execute('SELECT code_cipher FROM cards WHERE batch_id=? ORDER BY id', (batch['batch_id'],)).fetchall()
        c.execute("UPDATE cards SET state='allocated',exported_at=? WHERE batch_id=?", (store.now(), batch['batch_id']))
        cards[key] = [store.cipher.decrypt(r['code_cipher']).decode() for r in rows]
server = make_server('127.0.0.1', 0, app, threaded=True, request_handler=Quiet)
print(json.dumps({'origin': 'http://127.0.0.1:%d' % server.server_port, 'publicKey': app.extensions['signing'].public()['key'], 'cards': cards}), flush=True)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

def handle(cmd):
    op = cmd.get('op')
    if op == 'quota':
        with store.transaction(False) as c:
            user = store.user(c, cmd.get('email'))
            return {'ok': True, 'quota': RoomRules(store).state(c, user['id'])}
    return {'ok': False, 'error': 'unknown op: %s' % op}

try:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        cmd = json.loads(line)
        if cmd.get('op') == 'shutdown':
            print(json.dumps({'ok': True}), flush=True)
            break
        try:
            reply = handle(cmd)
        except Exception as e:
            reply = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
        print(json.dumps(reply), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
`

async function integrationPhase() {
  const { spawn } = await import('node:child_process')
  const { prepareIsolatedGameProfile } = await import('./electron-test-bootstrap.mjs')
  const platformRoot = path.resolve(root, '../卡密系统')
  const hasPlatform = await fs.access(path.join(platformRoot, 'app.py')).then(() => true, () => false)
  if (!hasPlatform) {
    console.log('SKIP integration: 找不到 ../卡密系统/app.py')
    return
  }
  // ---- 真实平台（隔离实例）----
  const serviceDir = path.join(out, 'service-' + Date.now())
  await fs.mkdir(serviceDir, { recursive: true })
  const fixturePy = path.join(serviceDir, 'room-platform-fixture.py')
  await fs.writeFile(fixturePy, PLATFORM_FIXTURE_PY, 'utf8')
  const service = spawn(process.env.ZL_TEST_PYTHON || 'python', [fixturePy, platformRoot, path.join(serviceDir, 'data')], { cwd: serviceDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let serviceErr = ''
  service.stderr.on('data', (d) => { serviceErr += d.toString() })
  const lines = []
  const waiters = []
  let buf = ''
  service.stdout.on('data', (chunk) => {
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
  const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiters.push(r)))
  const bootLine = await Promise.race([nextLine(), sleep(60000).then(() => { throw new Error('平台夹具 60 秒没起来：' + serviceErr.slice(-800)) })])
  const platform = JSON.parse(bootLine)
  const fixture = async (cmd) => {
    service.stdin.write(JSON.stringify(cmd) + '\n')
    const reply = JSON.parse(await nextLine())
    assert.ok(reply.ok, `夹具命令失败 ${cmd.op}: ${reply.error}`)
    return reply
  }
  const platformQuota = async () => (await fixture({ op: 'quota', email: A_EMAIL })).quota
  const cardsUsed = new Set()
  const takeCard = (kind) => {
    const code = platform.cards[kind].find((c) => !cardsUsed.has(c))
    assert.ok(code, '夹具卡不够：' + kind)
    cardsUsed.add(code)
    return code
  }

  // ---- 隔离 profile + 真实主进程；只有抖音扫码是夹具（假页面 / 假回包 / 写 cookie 当扫码）----
  const profile = await fs.mkdtemp(path.join(out, 'session-'))
  await prepareIsolatedGameProfile(root, profile)
  await fs.writeFile(path.join(profile, 'license-provider.json'), JSON.stringify({ provider: 'card', origin: platform.origin, publicKey: platform.publicKey }))
  const loginHtml = '<html><meta charset="utf-8"><h1>扫码登录（自动化测试页面）</h1><button onclick="this.outerHTML=\'<p>扫码登录</p>\'">登录</button></html>'
  const entry = path.join(profile, 'room-ui-bootstrap.cjs')
  await fs.writeFile(entry, `
const electron = require('electron');
const { app, BrowserWindow: NativeWindow, session } = electron;
app.setPath('userData', ${JSON.stringify(profile)}); app.setAppPath(${JSON.stringify(root)});
electron.dialog.showErrorBox = (t, c) => process.stderr.write(t + ': ' + c + '\\n');
electron.dialog.showMessageBox = async () => ({ response: -1, checkboxChecked: false });
electron.dialog.showMessageBoxSync = () => -1;
electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
for (const m of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'moveTop']) NativeWindow.prototype[m] = function () {};
app.focus = () => {};
const qa = global.__zlRoomUi = { scans: [], fetchLog: [], scanWindows: 0 };
const HiddenWindow = new Proxy(NativeWindow, { construct(Target, args) {
  const opts = args[0] || {};
  const isScan = String(opts.title || '').startsWith('抖音扫码');
  if (isScan) qa.scanWindows++;
  // 主窗口离屏渲染才能截图；扫码窗口保持主进程原样（只是不显示）
  return Reflect.construct(Target, [{ ...opts, show: false, focusable: false, webPreferences: { ...(opts.webPreferences || {}), backgroundThrottling: false, paintWhenInitiallyHidden: true, ...(isScan ? {} : { offscreen: true }) } }], Target);
}});
const realFromPartition = session.fromPartition.bind(session);
const sessionFacade = new Proxy(session, { get(target, key) {
  if (key === 'fromPartition') return (name, opts) => {
    const ses = realFromPartition(name, opts);
    if (String(name).startsWith('card-room-scan-') && !qa.scans.some((s) => s.ses === ses)) {
      // 【夹具】扫码窗口里看到的不是真实抖音，是这页静态 HTML
      ses.protocol.handle('https', () => new Response(${JSON.stringify(loginHtml)}, { headers: { 'Content-Type': 'text/html' } }));
      qa.scans.push({ name, ses });
    }
    return ses;
  };
  return Reflect.get(target, key);
}});
const Module = require('node:module'), originalLoad = Module._load;
const facade = { ...electron, BrowserWindow: HiddenWindow, session: sessionFacade };
Module._load = function (request) { return request === 'electron' ? facade : originalLoad.apply(this, arguments); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://live.douyin.com/')) return realFetch(url, init);
  // 【夹具】主进程核实房号 / 读登录账号资料时的假回包（只认本测试写进去的 sessionid）
  const headers = init?.headers || {};
  const cookie = headers.cookie || headers.Cookie || '';
  const sid = (/sessionid=([^;]+)/.exec(cookie) || [])[1] || '';
  const p = u.slice('https://live.douyin.com/'.length);
  qa.fetchLog.push({ path: p, sid });
  if (p.startsWith('webcast/')) return new Response('{}', { status: 404 });
  if (p === '') {
    if (!sid) return new Response('', { headers: { 'set-cookie': 'ttwid=fixture-visitor; Path=/; Secure' } });
    return new Response('defaultHeaderUserInfo: {"isLogin":true,"realName":"扫码账号","avatarUrl":"https://example.invalid/me.png"}');
  }
  const room = p.split('?')[0];
  if (!sid) return new Response('', { status: 401 });
  if (room === '4040') return new Response('<html>没有这个直播间</html>');
  return new Response('<div data-anchor-info="{&quot;nickname&quot;:&quot;主播' + room + '&quot;,&quot;avatar&quot;:&quot;https://example.invalid/a.png&quot;}"></div>');
};
global.__zhiliaoHiddenTest = true;
require(${JSON.stringify(path.resolve(root, outDir, 'main/index.js'))});
`, 'utf8')
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ZL_MODS_CATALOG_URL: 'http://127.0.0.1:1/mods-catalog.json', ZL_CARD_ROOMS_RECHECK_MS: '2500', ZL_LICENSE_ENFORCE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`], cwd: root, env, timeout: 60000 })
  const page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push('integration: ' + e.message))
  errorsAll.push(errors)
  const qa = (fn, arg) => app.evaluate(fn, arg)
  const scanPage = () => waitFor(() => app.windows().find((w) => w.url().startsWith('https://live.douyin.com/')), '扫码窗口没有打开', 20000)
  /** 【夹具】「扫码」= 往最新的扫码分区写一枚 sessionid，主进程会像真扫码一样收到 cookie 变化 */
  const scanWith = async (value) => {
    await scanPage()
    await qa(async (_, value) => {
      const s = global.__zlRoomUi.scans.at(-1)
      await s.ses.cookies.set({ url: 'https://douyin.com/', domain: '.douyin.com', name: 'sessionid', value, secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 86400 })
    }, value)
  }
  const closeScanWindow = () => qa(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('抖音扫码')); if (w) w.close(); return !!w })
  const scanWindows = () => qa(() => global.__zlRoomUi.scanWindows)
  const atStep = (s) => page.locator(`[data-testid="room-wizard"][data-step="${s}"]`)
  try {
    await page.waitForFunction(() => typeof window.api?.cardRoomVerify === 'function')
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile, '必须使用本次隔离 profile')
    const reg = await page.evaluate(({ email, password }) => window.api.emailRegister(email, '', password, ''), { email: A_EMAIL, password: A_PASSWORD })
    assert.equal(reg.ok, true, '真实平台注册：' + JSON.stringify(reg))
    await markGuidesSeen(page)
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    check('联调: 真实平台注册登录，默认 1 个名额 / 3 次改绑', JSON.stringify(await platformQuota()) === JSON.stringify({ capacity: 1, changes_left: 3, changes_used: 0, available: 1, rooms: [], bindings: [], empty_slots: [] }))

    // ---- 连接器 → 输入链接 → 真实主进程扫码窗口 → 写 cookie → 确认绑定 → 平台落账 ----
    await goto(page, '/connector')
    await page.getByTestId('connector-bind-btn').click()
    const dialog = page.getByRole('dialog')
    const manager = dialog.getByTestId('room-manager')
    await manager.waitFor()
    const quotaText = () => manager.getByTestId('room-quota').textContent()
    await waitFor(async () => (await quotaText()).includes('已绑定 0 / 1 个'), '真实名额读取')
    check('联调: 界面名额来自平台（0/1、可添加 1、剩余改绑 3）', (await quotaText()).includes('可添加 1 个') && (await quotaText()).includes('剩余改绑 3 次'))
    const wizard = page.getByTestId('room-wizard')
    await manager.getByTestId('room-add-input').fill('https://live.douyin.com/1001?enter_from=web_share_link')
    await manager.getByTestId('room-add-btn').click()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await atStep('scan').waitFor()
    await scanPage()
    check('联调: 主进程真的打开了扫码窗口，页面在等待并给反馈', (await scanWindows()) === 1 && (await wizard.getByTestId('room-scan').textContent()).includes('浏览器已经打开'))
    await scanWith('sess-A-1001')
    await atStep('confirm').waitFor()
    const confirm = wizard.getByTestId('room-confirm')
    check('联调: 用刚扫到的登录态核实房号，确认页显示主播昵称', (await confirm.getAttribute('data-room')) === '1001' && (await confirm.getByTestId('room-nickname').textContent()) === '主播1001' && (await confirm.locator('img').count()) === 1)
    check('联调: 确认前平台没有任何绑定', (await platformQuota()).rooms.length === 0)
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await atStep('done').waitFor()
    const q1 = await platformQuota()
    check('联调: 确认绑定后平台落账 1001（1/1）', q1.rooms.join() === '1001' && q1.available === 0 && (await wizard.getByTestId('room-done').textContent()).includes('已绑定直播间 1001（主播1001）'))
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await manager.locator('[data-testid="room-row"][data-room="1001"]').waitFor()
    await shot(page, 'integration-bound-1001')

    // ---- 名额用完 → 名额卡（真实卡）→ 回输入步 → 扫码 → 绑第二个 ----
    await manager.getByTestId('room-add-input').fill('1002')
    await manager.getByTestId('room-add-btn').click()
    await atStep('card').waitFor()
    check('联调: 名额用完时直接停在名额卡步', (await wizard.getByTestId('room-card-panel').getAttribute('data-kind')) === 'room_slot')
    await wizard.getByRole('textbox', { name: '卡密', exact: true }).fill(takeCard('slot'))
    await wizard.getByRole('button', { name: '激活', exact: true }).click()
    await atStep('input').waitFor()
    check('联调: 真实名额卡兑换后平台名额 2、界面回到输入步', (await platformQuota()).capacity === 2 && (await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).inputValue()) === '1002')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-1002')
    await atStep('confirm').waitFor()
    check('联调: 第二个直播间确认页说明 1/2 → 2/2', (await confirm.getByTestId('room-consequence').textContent()).includes('1 / 2 个 → 2 / 2 个'))
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await atStep('done').waitFor()
    check('联调: 平台已绑 1001、1002', (await platformQuota()).rooms.join() === '1001,1002')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await manager.locator('[data-testid="room-row"][data-room="1002"]').waitFor()

    // ---- 更换 1002 → 1003：平台计 1 次改绑 ----
    await manager.locator('[data-testid="room-row"][data-room="1002"]').getByTestId('room-replace-btn').click()
    await atStep('entry').waitFor()
    await wizard.getByTestId('room-entry-input').click()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('1003')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-1003')
    await atStep('confirm').waitFor()
    check('联调: 改绑确认页写明 3 → 2 次', (await confirm.getByTestId('room-consequence').textContent()).includes('剩余 3 次 → 2 次'))
    await page.getByRole('button', { name: '确认改绑', exact: true }).click()
    await atStep('done').waitFor()
    const q3 = await platformQuota()
    check('联调: 平台改绑落账（1001,1003；剩 2 次、已用 1 次）', q3.rooms.join() === '1001,1003' && q3.changes_left === 2 && q3.changes_used === 1)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await waitFor(async () => (await quotaText()).includes('剩余改绑 2 次'), '界面改绑次数同步')

    // ---- 房号核不上：扫码成功但房间不存在 → 改房号不重扫 ----
    await manager.locator('[data-testid="room-row"][data-room="1003"]').getByTestId('room-replace-btn').click()
    await atStep('entry').waitFor()
    await wizard.getByTestId('room-entry-input').click()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('4040')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-4040')
    await wizard.locator('[data-testid="room-scan"][data-error="1"]').waitFor()
    // 计数要在扫码窗口真的开出来之后取（点「下一步」后窗口是异步建的，先取会少算 1 个而误报）
    const scansBefore4040 = await scanWindows()
    check('联调: 房号核不上时说明原因，并提供「改房号（不用重扫）」', (await wizard.getByTestId('room-fix-room').count()) === 1)
    await wizard.getByTestId('room-fix-room').click()
    await atStep('askRoom').waitFor()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('1004')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await atStep('confirm').waitFor()
    check('联调: 改房号后复用同一次扫码（没有再开扫码窗口）', (await scanWindows()) === scansBefore4040 && (await confirm.getAttribute('data-room')) === '1004')
    const commitsBeforeCancel = (await platformQuota()).changes_used
    await page.getByRole('button', { name: '取消', exact: true }).click()
    check('联调: 确认页取消：平台不变', (await platformQuota()).changes_used === commitsBeforeCancel && (await platformQuota()).rooms.join() === '1001,1003')

    // ---- 改绑卡（真实卡）补满 3 次 ----
    await manager.getByTestId('room-change-card-btn').click()
    await page.getByTestId('room-card-modal').waitFor()
    await page.getByTestId('room-card-modal').getByRole('textbox', { name: '卡密', exact: true }).fill(takeCard('change'))
    await page.getByTestId('room-card-modal').getByRole('button', { name: '激活', exact: true }).click()
    await waitFor(async () => (await page.getByTestId('room-card-modal').count()) === 0, '改绑卡弹窗关闭')
    // 改绑卡是「+3 可累加」（卡密系统 room_rules.py min(changes_left+3,999)）：2 + 3 = 5
    await waitFor(async () => (await quotaText()).includes('剩余改绑 5 次'), '改绑次数补满')
    check('联调: 真实改绑卡把平台改绑次数加 3（2 → 5）', (await platformQuota()).changes_left === 5)

    // ---- 解绑 1003 → 平台空出名额；再绑别的直播间时提前说明会算 1 次改绑 ----
    await manager.locator('[data-testid="room-row"][data-room="1003"]').getByTestId('room-unbind-btn').click()
    await page.getByTestId('room-unbind-dialog').waitFor()
    await page.getByTestId('room-unbind-confirm').click()
    await waitFor(async () => (await manager.locator('[data-testid="room-row"][data-room="1003"]').count()) === 0, '解绑后行消失')
    const q4 = await platformQuota()
    check('联调: 平台解绑不计次（1001；可添加 1；仍 5 次）', q4.rooms.join() === '1001' && q4.available === 1 && q4.changes_left === 5)
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    await goto(page, '/connector')
    await page.getByTestId('connector-manage-btn').click()
    await waitFor(async () => (await quotaText()).includes('可添加 1 个'), '页面重载后读取持久空位')
    check('联调: 页面重载后主进程仍传回旧空位记录', (await page.evaluate(() => window.api.cardRooms())).quota.empty_slots[0].last_room === '1003')
    await manager.getByTestId('room-add-input').fill('1003')
    await manager.getByTestId('room-add-btn').click()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-1003')
    await atStep('confirm').waitFor()
    check('联调: 页面重载后绑回原房，明确不算改绑', (await confirm.getByTestId('room-consequence').textContent()).includes('绑回原来解绑的直播间，不算改绑'))
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await manager.getByTestId('room-add-input').fill('1005')
    await manager.getByTestId('room-add-btn').click()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-1005')
    await atStep('confirm').waitFor()
    check('联调: 用刚空出的名额绑别的直播间，确认页提前说明会算 1 次改绑（5 → 4）', (await confirm.getByTestId('room-consequence').textContent()).includes('之前绑过 1003') && (await confirm.getByTestId('room-consequence').textContent()).includes('剩余 5 次 → 4 次'))
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await atStep('done').waitFor()
    const q5 = await platformQuota()
    check('联调: 平台按规则计了 1 次改绑，完成页显示最新名额', q5.rooms.join() === '1001,1005' && q5.changes_left === 4 && (await wizard.getByTestId('room-done-quota').textContent()).includes('剩余改绑 4 次'))
    await page.getByRole('button', { name: '完成', exact: true }).click()

    // ---- 等待扫码时取消：向导和主进程扫码窗口都自动关闭，平台不变 ----
    await manager.locator('[data-testid="room-row"][data-room="1005"]').getByTestId('room-replace-btn').click()
    await atStep('entry').waitFor()
    await wizard.getByTestId('room-entry-input').click()
    await wizard.getByRole('textbox', { name: '抖音直播间号或直播链接' }).fill('1006')
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanPage()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    check('联调: 等待扫码时取消，向导关闭', (await wizard.count()) === 0)
    await waitFor(async () => await qa(({ BrowserWindow }) => !BrowserWindow.getAllWindows().some((x) => x.getTitle().startsWith('抖音扫码'))), '取消时扫码窗口应自动关闭')
    check('联调: 向导取消自动关闭扫码窗口，不用主播另行关闭', !(await closeScanWindow()))
    check('联调: 关掉扫码窗口后平台无任何变化', (await platformQuota()).rooms.join() === '1001,1005' && (await platformQuota()).changes_used === 2 && (await wizard.count()) === 0)
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

    // ---- 连接器下拉与设置页都拿到平台真相 ----
    check('联调: 连接器下拉列出平台的两个直播间', (await page.getByRole('combobox', { name: '直播间号' }).locator('option').allTextContents()).filter((t) => /^\d+$/.test(t)).join() === '1001,1005')
    await goto(page, '/settings')
    await page.getByTestId('room-manager').waitFor()
    await waitFor(async () => (await page.getByTestId('room-quota').textContent()).includes('已绑定 2 / 2 个'), '设置页名额')
    check('联调: 设置页 RoomManager 显示平台名额（2/2、剩余改绑 4）', (await page.getByTestId('room-quota').textContent()).includes('剩余改绑 4 次') && (await page.getByTestId('account-card-access').count()) === 1)
    await shot(page, 'integration-settings')
    // 已有旧空位时再激活名额卡：新名额首次绑定免费，不能因为有历史空位误报扣次。
    const settingsManager = page.getByTestId('room-manager')
    await settingsManager.locator('[data-testid="room-row"][data-room="1005"]').getByTestId('room-unbind-btn').click()
    await page.getByTestId('room-unbind-confirm').click()
    await waitFor(async () => (await settingsManager.locator('[data-testid="room-row"][data-room="1005"]').count()) === 0, '设置页解绑完成')
    await settingsManager.getByTestId('room-slot-card-btn').click()
    await page.getByTestId('room-card-modal').getByRole('textbox', { name: '卡密', exact: true }).fill(takeCard('slot'))
    await page.getByTestId('room-card-modal').getByRole('button', { name: '激活', exact: true }).click()
    await waitFor(async () => (await page.getByTestId('room-card-modal').count()) === 0, '新名额激活完成')
    await page.reload()
    await page.getByRole('link', { name: '娱乐助手', exact: true }).waitFor()
    await goto(page, '/settings')
    await waitFor(async () => (await page.getByTestId('room-quota').textContent()).includes('已绑定 1 / 3 个'), '新名额及旧空位重载后仍保留')
    await settingsManager.getByTestId('room-add-input').fill('1006')
    await settingsManager.getByTestId('room-add-btn').click()
    await page.getByRole('button', { name: '下一步：扫码确认', exact: true }).click()
    await scanWith('sess-A-1006')
    await atStep('confirm').waitFor()
    check('联调: 旧空位与新名额并存时，确认页明确新名额首次绑定免费', (await confirm.getByTestId('room-consequence').textContent()).includes('使用还没绑过直播间的新名额，不消耗改绑次数'))
    await page.getByRole('button', { name: '确认绑定', exact: true }).click()
    await atStep('done').waitFor()
    const freeNew = await platformQuota()
    check('联调: 平台确实优先使用新名额，不扣改绑且旧空位仍保留', freeNew.capacity === 3 && freeNew.changes_left === 4 && freeNew.rooms.join() === '1001,1006' && freeNew.empty_slots[0].last_room === '1005')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    const log = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
    const html = await page.content()
    check('联调: 页面与主进程日志都不含扫码得到的登录态', !/sess-A-/.test(html) && !/sess-A-/.test(log))
    assert.deepEqual(errors, [], 'integration 阶段页面报错')
  } finally {
    await app.close().catch(() => {})
    service.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n')
    await Promise.race([new Promise((r) => service.on('exit', r)), sleep(5000)])
    if (service.exitCode === null) service.kill()
  }
}

let completed = false
try {
  const integrationOnly = argv.includes('--integration-only')
  if (!cardOnly && !integrationOnly) await legacyPhase()
  if (!legacyOnly && !integrationOnly) await cardPhase()
  if (!legacyOnly && !cardOnly && !argv.includes('--no-integration')) await integrationPhase()
  completed = true
  console.log(`CARD-ROOM-UI ${checks.length}/${checks.length} PASS; 0 page errors; outDir=${outDir}`)
} finally {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ completed, outDir, checks, errors: errorsAll.flat() }, null, 2))
}

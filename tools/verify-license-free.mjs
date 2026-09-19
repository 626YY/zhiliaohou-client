// 授权总开关（license-policy）验证：隔离 userData、隐藏窗口、不碰真游戏、不连平台。
//   A 卡密模式 + 免检（随包默认 enforce=false）：日志「授权检查：已暂停」、门禁通道不再回 license_required、
//     授权快照全部已激活（free=true）、旧邮箱授权接口回「全部游戏已授权」、轮椅 mod 目录写入免检标记且 DLL 换成 1.0.0.12 组件
//   B 卡密模式 + 强制启用（ZL_LICENSE_ENFORCE=1）：同样的通道未登录时回 license_required，标记不是免检 —— 开关两头都活
//   C 旧账号系统 + 免检：绑第二个直播间不再要授权 / 申请，直接绑上
//   D 旧账号系统 + 强制启用：绑第二个直播间被拦（needApply / 暂无法确认授权）
// 用法：node tools/verify-license-free.mjs   （先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'license-free')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const results = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function check(name, fn) { try { const d = await fn(); results.push(true); console.log(`PASS ${name}${typeof d === 'string' && d ? '  ' + d : ''}`) } catch (e) { results.push(false); console.log(`FAIL ${name}  ${e?.message || e}`) } }
const sha256 = async f => createHash('sha256').update(await fs.readFile(f)).digest('hex')

async function waitFor(fn, label, timeout = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) { try { if (await fn()) return } catch { /* 再等 */ } await sleep(250) }
  throw new Error('等超时：' + label)
}

async function makeProfile({ card }) {
  await fs.mkdir(outputDir, { recursive: true })
  const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const entry = await writeHiddenElectronBootstrap(root, profile)
  const settings = JSON.parse(await fs.readFile(path.join(profile, 'data', 'settings.json'), 'utf8'))
  const exe = settings.gamePaths['4wheel-challenge']
  const modDir = path.join(path.dirname(exe), 'Mods', 'WheelLive')
  await fs.mkdir(modDir, { recursive: true })
  await fs.writeFile(path.join(modDir, 'config.json'), JSON.stringify({ LiveRoomId: '123456789' }))
  await fs.writeFile(path.join(path.dirname(modDir), 'WheelLive.dll'), 'old dll fixture')
  if (card) await fs.copyFile(path.join(root, 'build', 'license-provider.json'), path.join(profile, 'license-provider.json'))
  return { profile, entry, modDir, log: path.join(profile, 'logs', 'main.log') }
}

async function launch(entry, profile, enforce) {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  if (enforce !== undefined) env.ZL_LICENSE_ENFORCE = enforce ? '1' : '0'
  else delete env.ZL_LICENSE_ENFORCE
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.cardState), null, { timeout: 15_000 })
  return { app, page }
}
async function quit(app) { try { await app.evaluate(({ app }) => app.quit()) } catch { /* 已退出 */ } await sleep(1500) }

const manifest = JSON.parse(await fs.readFile(path.join(root, 'output', 'local-card-mod', 'manifest.json'), 'utf8'))

// ---------- A：卡密模式 + 免检（随包默认） ----------
{
  const { profile, entry, modDir, log } = await makeProfile({ card: true })
  const { app, page } = await launch(entry, profile)
  await check('A 日志：授权检查已暂停（来源 resources）', async () => { await waitFor(async () => /\[license\] 授权检查：已暂停/.test(await fs.readFile(log, 'utf8').catch(() => '')), 'license 行'); return (await fs.readFile(log, 'utf8')).match(/\[license\] [^\n]*/)[0].slice(0, 80) })
  await check('A 快照：enabled 且 free，全部产品 allowed/permanent', async () => {
    const s = await page.evaluate(() => window.api.cardState())
    assert.equal(s.enabled, true); assert.equal(s.free, true); assert.equal(s.ok, true)
    assert.ok(s.rights.length >= 4 && s.rights.every(r => r.allowed && r.permanent), JSON.stringify(s.rights))
    return s.rights.map(r => r.id).join(',')
  })
  await check('A 门禁：未登录调用受门禁的通道，不再回 license_required', async () => {
    const r = await page.evaluate(() => window.api.connectorSimulate('礼物: 玫瑰 ×1  by 免检测试'))
    assert.notEqual(r?.code, 'license_required', JSON.stringify(r))
    return JSON.stringify(r).slice(0, 60)
  })
  await check('A 旧邮箱授权接口：全部游戏已授权，不问服务器', async () => {
    const r = await page.evaluate(() => window.api.emailGetLicense('nobody@example.com'))
    assert.equal(r.ok, true); assert.equal(r.licensed, 1); assert.ok(r.games['4wheel-challenge'] === 1 && r.games['dontscream'] === 1, JSON.stringify(r))
  })
  await check('A 轮椅 mod：免检标记已写入 local-card-license.json', async () => {
    const file = path.join(modDir, 'local-card-license.json')
    await waitFor(async () => JSON.parse(await fs.readFile(file, 'utf8')).free === true, '免检标记')
    const j = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(j.provider, 'card'); assert.equal(j.free, true)
  })
  await check('A 轮椅 mod：Mods/WheelLive.dll 已换成 1.0.0.12 组件（sha 与 manifest 一致）', async () => {
    const dll = path.join(path.dirname(modDir), 'WheelLive.dll')
    await waitFor(async () => (await sha256(dll)) === manifest.sha256, 'DLL 换新')
    assert.equal(await fs.readFile(path.join(path.dirname(modDir), '.zl-version-wheellive'), 'utf8'), manifest.version)
    return manifest.version
  })
  await check('A 复核循环 60 秒内没有向平台发过请求（日志无「授权复核」字样）', async () => {
    const text = await fs.readFile(log, 'utf8'); assert.ok(!/授权复核/.test(text))
  })
  await quit(app)
}

// ---------- B：卡密模式 + 强制启用检查 ----------
{
  const { profile, entry, modDir, log } = await makeProfile({ card: true })
  const { app, page } = await launch(entry, profile, true)
  await check('B 日志：授权检查已启用（来源 env）', async () => { await waitFor(async () => /\[license\] 授权检查：已启用/.test(await fs.readFile(log, 'utf8').catch(() => '')), 'license 行') })
  await check('B 门禁：未登录调用受门禁的通道 → license_required（开关另一头也活着）', async () => {
    const r = await page.evaluate(() => window.api.connectorSimulate('礼物: 玫瑰 ×1  by 免检测试'))
    assert.equal(r?.code, 'license_required', JSON.stringify(r))
  })
  await check('B 快照：不是免检快照', async () => { const s = await page.evaluate(() => window.api.cardState()); assert.notEqual(s.free, true) })
  await check('B 轮椅 mod：标记不是免检（lease 空 / 无 free）', async () => {
    await sleep(1500)
    const file = path.join(modDir, 'local-card-license.json')
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    assert.ok(!text || JSON.parse(text).free !== true, text)
  })
  await quit(app)
}

// ---------- C / D：旧账号系统 ----------
for (const enforce of [false, true]) {
  const tag = enforce ? 'D' : 'C'
  const { profile, entry } = await makeProfile({ card: false })
  const { app, page } = await launch(entry, profile, enforce)
  await check(`${tag} 旧账号：本地注册登录`, async () => {
    const r = await page.evaluate(async () => { await window.api.register('free_user', 'Fixture123!', '免检'); return window.api.login('free_user', 'Fixture123!') })
    assert.equal(r.ok, true, r.error)
  })
  await check(`${tag} 旧账号：快照 enabled=false（不是卡密模式）`, async () => { const s = await page.evaluate(() => window.api.cardState()); assert.equal(s.enabled, false) })
  await check(`${tag} 旧账号：首次绑定直播间 111111 直接绑上`, async () => { const r = await page.evaluate(() => window.api.bindRoomWithLicense('111111')); assert.equal(r.ok, true, r.error) })
  if (!enforce) {
    await check('C 旧账号 + 免检：再绑 222222 不要授权、不要申请，直接绑上', async () => { const r = await page.evaluate(() => window.api.bindRoomWithLicense('222222')); assert.equal(r.ok, true, JSON.stringify(r)) })
  } else {
    await check('D 旧账号 + 强制启用：再绑 222222 被授权门拦下', async () => { const r = await page.evaluate(() => window.api.bindRoomWithLicense('222222')); assert.equal(r.ok, false, JSON.stringify(r)); return r.error })
  }
  await quit(app)
}

const bad = results.filter(x => !x).length
console.log(`\n${results.length - bad}/${results.length} PASS`)
process.exit(bad ? 1 : 0)

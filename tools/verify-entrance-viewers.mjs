// 端到端：隔离隐藏客户端走真实 IPC 验「大哥进场 → 选观众」（已出现的观众名单 + 头像 + 进场效果真用上）
//   2026-09-13 用户：「大哥进场功能，要读取粉丝的名字和头像，做成下拉列表样式」。
//   名单只来自本机记录（连接器事件里的昵称 + 连接器缓存的头像），不是抖音粉丝列表。
//   ① 进场 / 礼物 / 弹幕 / 关注事件里的昵称进名单，最近出现的在前；噪声行不记
//   ② 「头像: 昵称 -> 路径」行给同名观众配上头像；没头像的空着（界面用默认头像）
//   ③ 客户端重开内存表没了，也能按连接器命名规则从 <Mod 目录>/avatars/ 找回头像
//   ④ 重名：带观众 id 的 JSON 事件分成两条，不按昵称串头像
//   ⑤ 规则存了 avatar / uid，老规则（没这两项）原样保留、落盘形状不变
//   ⑥ 真进场：事件没带头像时横幅用规则里选的那张；事件带了以事件为准；「试一试」带头像
//   ⑦ 重启：名单和规则里的头像都还在
// 用法：node tools/verify-entrance-viewers.mjs   （需要先 npm run build；不需要网络）
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { prepareIsolatedGameProfile, writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/entrance-viewers')
await fs.mkdir(output, { recursive: true })
const profile = await fs.mkdtemp(path.join(output, 'session-'))
const settings = await prepareIsolatedGameProfile(root, profile)
const modDir = path.join(path.dirname(settings.gamePaths['4wheel-challenge']), 'Mods', 'WheelLive')
await fs.mkdir(path.join(modDir, 'avatars'), { recursive: true })
await fs.writeFile(path.join(modDir, 'connector.py'), 'import sys, time\nprint("stub", flush=True)\nwhile True: time.sleep(1)\n', 'utf8')
await fs.writeFile(path.join(modDir, 'bridge.txt'), '', 'utf8')
const fixtures = path.join(root, 'tools/fixtures')
const redAvatar = path.join(profile, 'avatar-red.png')
const blueAvatar = path.join(profile, 'avatar-blue.png')
await fs.copyFile(path.join(fixtures, 'viewer-avatar-red.png'), redAvatar)
await fs.copyFile(path.join(fixtures, 'viewer-avatar-blue.png'), blueAvatar)
// 连接器 AvatarCache 的命名：md5(昵称)[:16] + 扩展名，放在 <Mod 目录>/avatars/
const cachedName = '小王'
const cachedAvatar = path.join(modDir, 'avatars', crypto.createHash('md5').update(cachedName, 'utf8').digest('hex').slice(0, 16) + '.jpg')
await fs.copyFile(path.join(fixtures, 'viewer-avatar-blue.png'), cachedAvatar)

const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const pass = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/')
const launch = () => electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000
})
const findBanner = (app, main) => app.windows().find((w) => w !== main && w.url().includes('entrance-widget'))
async function waitBanner(app, main, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = findBanner(app, main)
    if (found) { await found.waitForLoadState('domcontentloaded').catch(() => {}); return found }
    await main.waitForTimeout(150)
  }
  throw new Error('进场横幅窗口没出现')
}
// 横幅里当前那张头像：<img class="avatar"> 的 src；默认头像（皇冠）时返回 'default'
const bannerAvatar = (banner) => banner.evaluate(() => {
  const img = document.querySelector('.banner img.avatar, .banner .arrival-avatar')
  if (img) return img.getAttribute('src')
  return document.querySelector('.banner .avatar.empty') ? 'default' : ''
})
async function waitBannerName(banner, name) {
  await banner.waitForFunction((n) => document.querySelector('.banner')?.textContent?.includes(n), name, { timeout: 5000 })
}

let app = await launch()
let failure
try {
  let page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.viewerList && !!window.api?.connectorSimulate && !!window.api?.entranceConfigure)
  const send = async (line) => {
    const r = await page.evaluate((t) => window.api.connectorSimulate(t), line)
    assert.equal(r.ok, true, `${line} → ${r.error ?? ''}`)
  }
  const viewers = async () => (await page.evaluate(() => window.api.viewerList())).rows

  assert.deepEqual(await viewers(), [], '新档案的观众名单应该是空的')

  // ① 各类事件里的昵称进名单
  await send('[connector] 进场: 阿彪')
  await sleep(80)
  await send('[connector] 礼物: 小心心 x2  by 小王 1 分/个')
  await sleep(80)
  await send('[connector] 弹幕: 路人甲 主播好帅')
  await sleep(80)
  await send('[connector] 关注  by 关注哥')
  await sleep(80)
  await send('[connector] 已连接直播间 577117602')
  await sleep(80)
  await send('[connector] 进场: 阿彪')
  await sleep(300)
  const v1 = await viewers()
  assert.deepEqual(v1.map((r) => r.name), ['阿彪', '关注哥', '路人甲', '小王'], `最近出现的在前，实际 ${v1.map((r) => r.name).join('，')}`)
  assert.equal(v1.find((r) => r.name === '阿彪').seen, 2, '阿彪进场两次应记 2 次')
  assert.ok(!v1.some((r) => /已连接|577117602/.test(r.name)), '状态行不该被当成观众')
  pass('进场/礼物/弹幕/关注的昵称都进名单，最近在前', v1.map((r) => `${r.name}×${r.seen}`).join('，'))

  // ② 头像行配头像；没头像的空着；连接器磁盘缓存能找回
  await send(`[connector] 头像: 阿彪 -> ${redAvatar}`)
  await sleep(300)
  const v2 = await viewers()
  assert.equal(v2.find((r) => r.name === '阿彪').avatar, redAvatar, '「头像:」行要配到阿彪头上')
  assert.equal(v2.find((r) => r.name === '路人甲').avatar, undefined, '没头像的空着（界面用默认头像）')
  assert.equal(v2.find((r) => r.name === '小王').avatar, cachedAvatar, '小王从没发过头像行，但连接器 avatars/ 里有按昵称哈希的缓存，要找回来')
  pass('头像行配头像、缺失留空、磁盘缓存按昵称哈希找回')

  // ④ 重名：带观众 id 的 JSON 事件分两条
  await send('[connector] ' + JSON.stringify({ type: 'gift', giftName: '玫瑰', count: 1, sender: '大哥', uid: '10001', avatar: redAvatar }))
  await sleep(80)
  await send('[connector] ' + JSON.stringify({ type: 'gift', giftName: '玫瑰', count: 1, sender: '大哥', uid: '10002' }))
  await sleep(300)
  const v3 = await viewers()
  const twins = v3.filter((r) => r.name === '大哥')
  assert.equal(twins.length, 2, `重名两个 id 应是两条，实际 ${twins.length}`)
  assert.equal(twins.find((r) => r.uid === '10001').avatar, redAvatar, '10001 的头像')
  assert.equal(twins.find((r) => r.uid === '10002').avatar, undefined, '10002 没头像，不许拿 10001 的顶（连按昵称补头像的兜底也不许）')
  pass('重名按观众 id 分两条，头像不串', twins.map((r) => `${r.name}#${r.uid}:${r.avatar ? '有图' : '无图'}`).join('，'))

  // ⑤ 老规则原样保留；新规则存 avatar/uid
  const legacy = { id: 'old', enabled: true, match: 'equals', name: '老规则人', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  const picked = { id: 'vip', enabled: true, match: 'equals', name: '阿彪', avatar: redAvatar, uid: '', text: '大哥 {name} 驾到', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  const twin = { id: 'twin', enabled: true, match: 'equals', name: '大哥', avatar: redAvatar, uid: '10001', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  const anyRule = { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  await page.evaluate((rules) => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules }), [legacy, picked, twin, anyRule])
  const st1 = await page.evaluate(() => window.api.entranceState())
  const oldRule = st1.config.rules.find((r) => r.id === 'old')
  assert.equal('avatar' in oldRule, false, '老规则不该被塞进 avatar 字段')
  assert.equal('uid' in oldRule, false, '老规则不该被塞进 uid 字段')
  assert.equal(st1.config.rules.find((r) => r.id === 'vip').avatar, redAvatar, '选人规则存了头像')
  assert.equal(st1.config.rules.find((r) => r.id === 'twin').uid, '10001', '选人规则存了观众 id')
  const saved = JSON.parse(await fs.readFile(path.join(profile, 'data/entrance.json'), 'utf8'))
  assert.deepEqual(Object.keys(saved.rules[0]).sort(), Object.keys(legacy).sort(), '老规则落盘形状不变')
  pass('老规则原样、选人规则带 avatar/uid 落盘')

  // ⑥ 真进场用上选的头像
  assert.equal((await page.evaluate(() => window.api.entranceOpen())).ok, true, '进场横幅窗口打开失败')
  const banner = await waitBanner(app, page)
  // 6a 进场事件不带头像 → 横幅用规则里选的（连接器头像行已把阿彪的头像挂在内存表，先验一个内存表没有的人）
  await send('[connector] 进场: 老规则人')
  await waitBannerName(banner, '老规则人')
  assert.equal(await bannerAvatar(banner), 'default', '老规则没选头像 → 默认头像')
  await page.evaluate((p) => window.api.entranceConfigure({ rules: [
    { id: 'old', enabled: true, match: 'equals', name: '老规则人', avatar: p, text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 },
    { id: 'vip', enabled: true, match: 'equals', name: '阿彪', avatar: p, text: '大哥 {name} 驾到', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 },
    { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  ] }), blueAvatar)
  await send('[connector] 进场: 老规则人')
  await sleep(600)
  assert.equal(await bannerAvatar(banner), fileUrl(blueAvatar), '事件没带头像 → 横幅用规则里选的那张（file:/// 形式）')
  pass('进场事件不带头像时横幅用规则里选的头像')
  // 6b 事件带头像（连接器头像行已登记阿彪=红）→ 以事件为准，不用规则里的蓝
  await send('[connector] 进场: 阿彪')
  await waitBannerName(banner, '阿彪')
  await sleep(300)
  assert.equal(await bannerAvatar(banner), fileUrl(redAvatar), '事件自带头像优先于规则里存的')
  pass('进场事件自带头像时以事件为准')
  // 6c 试一试带头像
  const t = await page.evaluate((p) => window.api.entranceTest('随便谁', p), redAvatar)
  assert.equal(t.ok, true, '试一试应命中「任何人」')
  await waitBannerName(banner, '随便谁')
  await sleep(300)
  assert.equal(await bannerAvatar(banner), fileUrl(redAvatar), '试一试选的头像要上横幅')
  await banner.screenshot({ path: path.join(output, 'banner-with-avatar.png') })
  pass('试一试带头像上横幅')
  // 6d 事件与规则都没头像 → 默认头像，不报错
  const t2 = await page.evaluate(() => window.api.entranceTest('无头像观众'))
  assert.equal(t2.ok, true)
  await waitBannerName(banner, '无头像观众')
  assert.equal(await bannerAvatar(banner), 'default', '没头像用默认皇冠')
  pass('没头像时横幅用默认头像')

  // ⑧ 2026-09-13：带 ZWJ 表情的昵称（用户实测「飞鸟🐦‍⬛🐦‍⬛🐦‍⬛🦅🦅🦅」）按「包含」命中；规则专属皮肤生效；观众 id 匹配；main.log 有痕迹
  const bird = '飞鸟🐦‍⬛🐦‍⬛🐦‍⬛🦅🦅🦅'
  await page.evaluate((rules) => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules }), [
    { id: 'bird', enabled: true, match: 'contains', name: bird, text: '大哥 {name} 驾到，全体起立！', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0, bannerStyle: 'neon' },
    { id: 'byuid', enabled: true, match: 'equals', name: '改过名的大哥', uid: '7788', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0, bannerStyle: 'not-a-skin' },
    { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  ])
  const st3 = await page.evaluate(() => window.api.entranceState())
  assert.equal(st3.config.rules.find((r) => r.id === 'bird').bannerStyle, 'neon', '规则专属皮肤落盘')
  assert.equal('bannerStyle' in st3.config.rules.find((r) => r.id === 'byuid'), false, '非法皮肤值不写键（跟全局）')
  await send('[connector] 进场: ' + bird)
  await waitBannerName(banner, '飞鸟')
  await sleep(300)
  const birdBanner = await banner.evaluate(() => ({ cls: document.querySelector('.banner')?.className || '', text: document.querySelector('.banner')?.textContent || '' }))
  assert.ok(birdBanner.cls.includes('neon'), `带表情昵称命中「包含」且用规则专属皮肤 neon，实际 class=${birdBanner.cls}`)
  assert.ok(birdBanner.text.includes('全体起立'), '横幅文案是这条规则的')
  pass('带 ZWJ 表情的昵称按「包含」命中，横幅用规则专属皮肤', birdBanner.cls)
  // 全局皮肤改成 clean，正在显示的专属横幅不被换掉
  await page.evaluate(() => window.api.entranceConfigure({ bannerStyle: 'clean' }))
  await sleep(200)
  assert.ok((await banner.evaluate(() => document.querySelector('.banner')?.className || '')).includes('neon'), '改全局皮肤不影响正在显示的专属横幅')
  pass('改全局皮肤不影响规则专属横幅')
  // 观众 id 命中：昵称对不上但 uid 一样
  await send(JSON.stringify({ type: 'member', sender: '大哥新昵称', uid: '7788' }))
  await waitBannerName(banner, '大哥新昵称')
  await sleep(200)
  const uidBanner = await banner.evaluate(() => ({ cls: document.querySelector('.banner')?.className || '', text: document.querySelector('.banner')?.textContent || '' }))
  assert.ok(uidBanner.cls.includes('clean') && !uidBanner.cls.includes('neon'), '按观众 id 命中的规则没有专属皮肤 → 用全局 clean')
  pass('观众 id 一样、昵称改了也能命中')
  // main.log 有进场痕迹
  await sleep(300)
  const mainLog = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
  assert.ok(mainLog.includes('[entrance] 迎宾 飞鸟') && mainLog.includes('皮肤 neon·规则专属'), 'main.log 应记录迎宾与皮肤')
  await send('[connector] 进场: 路人乙')
  await page.evaluate(() => window.api.entranceConfigure({ rules: [{ id: 'only', enabled: true, match: 'equals', name: '没这个人', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }] }))
  await send('[connector] 进场: 路人丙')
  await sleep(300)
  const mainLog2 = await fs.readFile(path.join(profile, 'logs/main.log'), 'utf8').catch(() => '')
  assert.ok(mainLog2.includes('进场 路人丙') && mainLog2.includes('没有规则命中'), 'main.log 应记录未命中')
  pass('main.log 记录了迎宾 / 未命中')
  await page.evaluate((rules) => window.api.entranceConfigure({ bannerStyle: 'gold', rules }), [
    { id: 'old', enabled: true, match: 'equals', name: '老规则人', avatar: blueAvatar, text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 },
    { id: 'vip', enabled: true, match: 'equals', name: '阿彪', avatar: blueAvatar, text: '大哥 {name} 驾到', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 },
    { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  ])

  // ⑦ 重启：名单和规则头像都在
  await sleep(1300)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.viewerList)
  const v4 = await viewers()
  assert.ok(v4.length >= 6, `重启后名单应还在，实际 ${v4.length} 人`)
  assert.equal(v4.find((r) => r.name === '阿彪').avatar, redAvatar, '重启后阿彪头像还在')
  assert.equal(v4.find((r) => r.name === '小王').avatar, cachedAvatar, '重启后小王仍能从磁盘缓存找回头像')
  const st2 = await page.evaluate(() => window.api.entranceState())
  assert.equal(st2.config.rules.find((r) => r.id === 'vip').avatar, blueAvatar, '重启后规则里的头像还在')
  // 头像文件被连接器清理掉后名单里不再给这条路径
  await fs.unlink(cachedAvatar)
  await sleep(50)
  pass('重启后名单与规则头像都在', `${v4.length} 人`)
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await fs.writeFile(path.join(profile, 'results.json'), JSON.stringify({ checks, failure, profile, modDir }, null, 2))
  try { await app.close() } catch { /* ignore */ }
  console.log(`SUMMARY ${checks.length}/9 PASS` + (failure ? ' (有失败)' : ''))
  console.log('Evidence: ' + profile)
}
if (failure) process.exitCode = 1

// 压力复现（2026-09-11 用户实测「礼物积压二十条一条没播、有的卡最后一帧」）：
// 隔离 Electron 实例里只开绿幕窗口，时间盲盒礼物（视频到指定窗口，走 replace 直播路）和规则视频（video-play，走排队模型）混着连发，
// 逐 150ms 记录绿幕槽位的素材变化、排队数、盲盒队列长度，判：有没有卡住（同一素材停留远超视频时长）、最后是否全部出队并回绿底。
// 用法：node tools/verify-box-gift-stress.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'box-gift-stress')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const errors = []
const VIDEO_SECONDS = 0.8

function attachErrors(page) {
  const where = () => page.url().split('/').pop()
  page.on('pageerror', (error) => errors.push(`[${where()}] ${error.message}`))
}

async function waitForApiState(page, predicate, arg = null, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return
    await page.waitForTimeout(100)
  }
  throw new Error(`等待主进程状态超时：${predicate}`)
}

async function ensureTestSession(page) {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  const result = await page.evaluate(async () => {
    const username = 'box_gift_stress'
    const password = 'Fixture123!'
    await window.api.register(username, password, '压力验证')
    const login = await window.api.login(username, password)
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return login
  })
  assert.equal(result.ok, true, result.error || '本地测试账号登录失败')
  await waitForApiState(page, () => window.api.getSettings().then((r) => (r.settings ?? r).guideSeen === true))
}

async function makeVideo(file, color, audio = false, seconds = VIDEO_SECONDS) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=15:d=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:d=${VIDEO_SECONDS}`, '-af', 'volume=0.03', '-c:a', 'aac', '-shortest')
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', file)
  await run('ffmpeg', args, { windowsHide: true })
}

/** 一轮压测：openSlots=先开哪些空绿幕窗口，boxSlot=时间插件指定窗口，boxes/rules=各连发几次 */
async function stress(app, page, name, { openSlots, boxSlot, boxes, rules, boxVideo, ruleVideo, combo = 0 }) {
  const api = (fn, arg) => page.evaluate(fn, arg)
  // 场景前提：关掉所有绿幕、只开指定的空窗口；时间插件指定窗口按场景来
  await api(() => window.api.greenScreenClose())
  await page.waitForTimeout(200)
  for (const slot of openSlots) assert.equal((await api((s) => window.api.greenScreenOpen('', 'video', '', s), slot)).ok, true, `开绿幕 ${slot}`)
  await api(({ boxSlot }) => window.api.timeWidgetUpdate({ boxVideoSlot: boxSlot, boxVideoOverflow: true }), { boxSlot })
  await api(() => window.api.timeWidgetCancelQueue())
  await page.waitForTimeout(300)

  // 混着连发：每个盲盒礼物后面跟两个规则礼物
  const t0 = Date.now()
  if (combo) await api((n) => window.api.connectorSimulate(`礼物: 规则视频 ×${n}  by 压测`), combo)
  for (let i = 0; i < (combo ? 0 : Math.max(boxes, 1)); i++) {
    if (boxes) {
      const reply = await api(() => window.api.timeWidgetTestGift('盲盒'))
      assert.equal(reply.ok, true, `盲盒礼物没排上：${JSON.stringify(reply)}`)
    }
    for (let j = 0; j < Math.ceil(rules / Math.max(boxes, 1)); j++) await api(() => window.api.connectorSimulate('礼物: 规则视频 ×1  by 压测'))
    await page.waitForTimeout(40)
  }

  // 逐 150ms 观察，直到全部出队且回绿底，或超时
  const timeline = [], trace = []
  let last = null, lastChangeAt = Date.now(), plays = 0, boxPlays = 0, rulePlays = 0, maxQueued = 0, maxBoxQueue = 0, stuck = null, settledSince = null
  const deadline = Date.now() + 60_000 + (boxes + rules) * 2500
  while (Date.now() < deadline) {
    const green = await api(() => window.api.greenScreenState())
    const time = await api(() => window.api.timeWidgetState())
    const slots = green.slots.filter((s) => s.open).map((s) => `${s.slot}:${s.src ? (s.text ? '盲盒' : '规则') : '绿底'}`).join(' ')
    // 盲盒连播同一个文件时槽位素材不变，得把「正在跑哪个盲盒任务」也算进变化，否则会把正常连播误判成卡住
    // 同一个文件连着播时素材键不变，回绿底的一瞬间也常抓不到：把排队数也算进变化（每出队一条就变），盲盒任务 id 同理
    const key = green.slots.map((s) => `${s.slot}|${s.src}|${s.text}`).join(';') + `#box:${time.activeEvent?.id || ''}:${time.lastResult?.id || ''}#q:${green.queued || 0}`
    maxQueued = Math.max(maxQueued, green.queued || 0)
    maxBoxQueue = Math.max(maxBoxQueue, time.queueLength || 0)
    if (key !== last) {
      for (const s of green.slots) {
        const prev = last ? last.split('#')[0].split(';').find((x) => x.startsWith(`${s.slot}|`)) : null
        const now = `${s.slot}|${s.src}|${s.text}`
        if (s.src && now !== prev) { plays++; if (s.text) boxPlays++; else rulePlays++ }
      }
      timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${slots || '(无窗口)'} 排队=${green.queued || 0} 盲盒队列=${time.queueLength || 0}`)
      last = key; lastChangeAt = Date.now()
    } else if (green.slots.some((s) => s.src) && Date.now() - lastChangeAt > (VIDEO_SECONDS + 11) * 1000 && !stuck) {
      stuck = `素材停留超过 ${VIDEO_SECONDS + 11}s 没换（看门狗也没救回来）：${slots}`
      console.log('  ★卡住时看门狗读数：' + JSON.stringify(green.watchdog || {}))
      for (const w of app.windows()) {
        try {
          const info = await w.evaluate(() => { const v = document.querySelector('video'); return { href: location.href.slice(-24), title: document.title, video: v ? { ended: v.ended, paused: v.paused, t: v.currentTime, dur: v.duration, ready: v.readyState, net: v.networkState, err: v.error?.code || 0, loop: v.loop, src: v.currentSrc.slice(-16) } : null } })
          if (info.video || /green/.test(info.href)) console.log('  ★卡住时页面状态：' + JSON.stringify(info))
        } catch {}
      }
      break
    }
    if (process.argv.includes('--trace')) {
      for (const w of app.windows()) {
        try {
          const info = await w.evaluate(() => { const v = document.querySelector('video'); return v ? { title: document.title, t: v.currentTime, paused: v.paused, ended: v.ended, ready: v.readyState } : null })
          if (info) trace.push(`${((Date.now() - t0) / 1000).toFixed(2)}s ${info.title} t=${info.t.toFixed(2)} paused=${info.paused} ended=${info.ended} ready=${info.ready}`)
        } catch {}
      }
    }
    const idle = !(green.queued || 0) && !(time.queueLength || 0) && !time.activeEvent && !green.slots.some((s) => s.src)
    if (idle) { settledSince ??= Date.now(); if (Date.now() - settledSince > 1500) break } else settledSince = null
    await page.waitForTimeout(150)
  }
  const green = await api(() => window.api.greenScreenState())
  const time = await api(() => window.api.timeWidgetState())
  const log = await api(() => window.api.timeWidgetLog())
  const boxErrors = log.filter((row) => row.error).map((row) => row.error)
  boxPlays = Math.max(boxPlays, log.filter((row) => !row.error).length)
  console.log(`\n[${name}] 开着 ${openSlots.join('/')} 号，指定 ${boxSlot} 号，连发 盲盒×${boxes} 规则视频×${rules}`)
  console.log('  ' + timeline.slice(0, 60).join('\n  ') + (timeline.length > 60 ? `\n  …共 ${timeline.length} 条` : ''))
  console.log(`  播放次数=${plays}（盲盒 ${boxPlays} / 规则 ${rulePlays}） 排队峰值=${maxQueued} 盲盒队列峰值=${maxBoxQueue} 结束排队=${green.queued || 0} 盲盒队列=${time.queueLength || 0} 盲盒记录=${log.length} 盲盒报错=${boxErrors.length}${boxErrors.length ? '：' + [...new Set(boxErrors)].join(' | ') : ''}`)
  console.log(`  看门狗累计：推醒 ${green.nudged || 0} 次 / 撤掉 ${green.rescued || 0} 次`)
  if (stuck) console.log('  ★卡住：' + stuck)
  if (trace.length) { console.log('  [trace]'); for (const line of trace) console.log('  ' + line) }
  return { plays, boxPlays, rulePlays, maxQueued, maxBoxQueue, queued: green.queued || 0, boxQueue: time.queueLength || 0, stuck, finalSrc: green.slots.filter((s) => s.src).length, boxErrors, logRows: log.length, rescued: green.rescued || 0, nudged: green.nudged || 0 }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  const userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const boxVideo = path.join(userDataDir, '盲盒视频.mp4'), ruleVideo = path.join(userDataDir, '规则视频.mp4')
  const withAudio = process.argv.includes('--audio')
  await makeVideo(boxVideo, 'green', withAudio); await makeVideo(ruleVideo, 'blue', withAudio)
  // 千连击用的长视频（10 分钟）：第一条一直占着窗口，后面 999 条全得排着，好数
  const longVideo = path.join(userDataDir, '长视频.mp4'); await makeVideo(longVideo, 'red', false, 600)
  console.log(withAudio ? '素材带音轨' : '素材无音轨')
  const visible = process.argv.includes('--visible')
  if (visible) console.log('窗口真实显示（贴近主播桌面，会在屏幕上闪绿幕窗口）')
  const entry = await writeHiddenElectronBootstrap(root, userDataDir, { visible })
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const extra = process.argv.includes('--bgm') ? ['--disable-background-media-suspend'] : []
  if (extra.length) console.log('Chromium 开关：' + extra.join(' '))
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox', ...extra], cwd: root, env, timeout: 30_000 })
  app.on('window', attachErrors)
  const page = await app.firstWindow()
  attachErrors(page)
  const api = (fn, arg) => page.evaluate(fn, arg)
  const results = {}
  try {
    await ensureTestSession(page)
    const opened = await api(({ boxVideo }) => window.api.timeWidgetOpen({
      on: true, enable: true, title: '压力', initial: 100, clockSpeed: 60000, addGift: '', addSeconds: 60, subGift: '', subSeconds: 30,
      autoHide: false, showGift: false, showNegative: true, showSeconds: true, zeroText: '时间到', bgImage: '', theme: '1',
      titleColor: '#ffffff', timeColor: '#ffffff', startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' }, posX: 200, posY: 30,
      gifts: [{ name: '盲盒', mode: 'blindbox', blindBoxEventIds: ['v'], op: '加减', seconds: 7 }],
      blindBoxEvents: [{ id: 'v', name: '盲盒视频', op: 'multiply', value: 1, action: 'none', video: boxVideo }],
      boxVideoSlot: 4, boxVideoOverflow: true
    }), { boxVideo })
    assert.equal(opened.ok, true, opened.error || '倒计时挂件打开失败')
    await waitForApiState(page, () => window.api.timeWidgetState().then((s) => s.open))
    const added = await api(({ ruleVideo }) => window.api.entertainmentRuleAdd({
      id: '', giftName: '规则视频', actionType: 'command', commandCmd: 'video-play', commandParam: ruleVideo, enabled: true, queueMode: 'instant', multiply: true, extraActions: []
    }), { ruleVideo })
    assert.equal(added.ok, true, added.error || '规则没加上')

    const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
    const want = (k) => !only || only === k
    if (want('rulesOnly')) results.rulesOnly = await stress(app, page, '只发规则视频，只开 1 号', { openSlots: [1], boxSlot: 4, boxes: 0, rules: 12, boxVideo, ruleVideo })
    if (want('boxesOnly')) results.boxesOnly = await stress(app, page, '只发盲盒，只开 1 号', { openSlots: [1], boxSlot: 4, boxes: 8, rules: 0, boxVideo, ruleVideo })
    for (const slot of [1, 2, 3, 4]) {
      if (want(`only${slot}`)) results[`only${slot}`] = await stress(app, page, `只开 ${slot} 号，指定 4 号`, { openSlots: [slot], boxSlot: 4, boxes: 4, rules: 8, boxVideo, ruleVideo })
      if (want(`home${slot}`)) results[`home${slot}`] = await stress(app, page, `只开 ${slot} 号且指定 ${slot} 号`, { openSlots: [slot], boxSlot: slot, boxes: 4, rules: 8, boxVideo, ruleVideo })
    }
    if (want('pair23')) results.pair23 = await stress(app, page, '开 2 号和 3 号，指定 3 号', { openSlots: [2, 3], boxSlot: 3, boxes: 4, rules: 10, boxVideo, ruleVideo })
    if (want('all4')) results.all4 = await stress(app, page, '四个都开，指定 4 号', { openSlots: [1, 2, 3, 4], boxSlot: 4, boxes: 6, rules: 16, boxVideo, ruleVideo })
    // ×1000 连击：规则按节拍逐条执行（默认 120ms 一条，一千条约两分钟），全部进排队后应正好 999 条（第一条占着窗口播 600 秒），
    // 没有上限一条不丢；最后「停止视频」一键清空排队和正在播的
    if (want('combo1000')) {
      await api(() => window.api.greenScreenClose()); await page.waitForTimeout(200)
      assert.equal((await api(() => window.api.greenScreenOpen('', 'video', '', 3))).ok, true)
      const addedLong = await api(({ longVideo }) => window.api.entertainmentRuleAdd({ id: '', giftName: '千连击', actionType: 'command', commandCmd: 'video-play', commandParam: longVideo, enabled: true, queueMode: 'instant', multiply: true, extraActions: [] }), { longVideo })
      assert.equal(addedLong.ok, true, addedLong.error || '千连击规则没加上')
      await api(() => { window.__q = null; window.api.onQueueChanged((snapshot) => { window.__q = snapshot }) })
      const t0 = Date.now()
      await api(() => window.api.connectorSimulate('礼物: 千连击 ×1000  by 压测'))
      let peak = 0, pendingHits = -1
      while (Date.now() - t0 < 240_000) {
        const g = await api(() => window.api.greenScreenState()); peak = Math.max(peak, g.queued || 0)
        pendingHits = await api(() => window.__q ? (window.__q.total ?? window.__q.pending.length) + (window.__q.running ? 1 : 0) : -1)
        if (pendingHits === 0 && (g.queued || 0) >= 999) break
        await page.waitForTimeout(500)
      }
      const before = await api(() => window.api.greenScreenState())
      const stopped = await api(() => window.api.entertainmentCommand('video-stop', ''))
      await page.waitForTimeout(800)
      const after = await api(() => window.api.greenScreenState())
      console.log(`[×1000 连击] 规则执行用时 ${((Date.now() - t0) / 1000).toFixed(0)}s 排队峰值=${peak} 停止前排队=${before.queued} 规则剩余=${pendingHits} 停止视频→${JSON.stringify(stopped)} 之后排队=${after.queued} 槽位素材=${after.slots.filter((x) => x.src).length}`)
      results.combo1000 = { plays: 0, boxPlays: 0, rulePlays: 0, maxQueued: peak, maxBoxQueue: 0, queued: after.queued || 0, boxQueue: 0, stuck: (before.queued || 0) >= 999 && pendingHits === 0 ? null : `一千条只排上 ${before.queued} 条（规则还剩 ${pendingHits} 次没执行）`, finalSrc: after.slots.filter((x) => x.src).length, boxErrors: [], logRows: 0, rescued: after.rescued || 0, nudged: after.nudged || 0 }
    }
    if (want('combo66')) results.combo66 = await stress(app, page, '只开 2 号，一条 ×66 连击', { openSlots: [2], boxSlot: 2, boxes: 0, rules: 66, combo: 66, boxVideo, ruleVideo })
    if (want('onlyOne')) results.onlyOne = await stress(app, page, '只开 1 号', { openSlots: [1], boxSlot: 4, boxes: 6, rules: 12, boxVideo, ruleVideo })
    if (want('oneAndFour')) results.oneAndFour = await stress(app, page, '开 1 号和 4 号', { openSlots: [1, 4], boxSlot: 4, boxes: 6, rules: 12, boxVideo, ruleVideo })
    if (want('sameSlot')) results.sameSlot = await stress(app, page, '只开 1 号且指定 1 号', { openSlots: [1], boxSlot: 1, boxes: 6, rules: 12, boxVideo, ruleVideo })
    if (want('burst')) results.burst = await stress(app, page, '只开 1 号，猛发', { openSlots: [1], boxSlot: 4, boxes: 12, rules: 30, boxVideo, ruleVideo })
    assert.deepEqual(errors, [], `Electron 页面错误：${errors.join(' | ')}`)
  } finally {
    await app.close().catch(() => {})
    await fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  }
  const bad = Object.entries(results).filter(([, r]) => r.stuck || r.queued || r.boxQueue || r.finalSrc)
  if (bad.length) { console.log('\nFAIL：' + bad.map(([k, r]) => `${k}: ${r.stuck || `排队剩 ${r.queued} / 盲盒队列剩 ${r.boxQueue} / 还有 ${r.finalSrc} 个窗口没回绿底`}`).join('；')); process.exit(1) }
  console.log('\n全部场景出队、回绿底，没有卡住')
}

main().catch((error) => { console.error(error); process.exit(1) })

// 挂件帧率对照：共用进程（lean） vs 独立进程（stable），礼物/进场/弹幕连轰时每个挂件页面每秒真正画了多少帧。
// CPU 百分比不能说明卡不卡，帧率能：共用进程下十个页面挤一个主线程，理论上会互相拖，这里量出来。
// 用法：node tools/probe-widget-fps.mjs [--minutes 3] [--rate 300]   （先 npm run build）
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'widget-fps')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const argv = process.argv.slice(2)
const argNum = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt }
const MINUTES = argNum('--minutes', 3), RATE_MS = argNum('--rate', 300)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const NAMES = ['榜一大哥', '大哥阿彪', '小美吖', '老王头', '球球', '路人甲', '神秘人', '用户✨']
const pick = a => a[Math.floor(Math.random() * a.length)]
const line = () => { const r = Math.random(); return r < 0.3 ? `礼物: 规则视频 ×${1 + Math.floor(Math.random() * 3)}  by ${pick(NAMES)}` : r < 0.45 ? `礼物: 小心心 ×${1 + Math.floor(Math.random() * 10)}  by ${pick(NAMES)}` : r < 0.75 ? `进场: ${pick(NAMES)}` : `弹幕: ${pick(NAMES)} 666` }

// 每个页面装一个帧计数器：rAF 每帧 +1；读的时候算「上次读取以来每秒帧数」
const PROBE = `(() => { if (!window.__zlFps) { window.__zlFps = { n: 0, t: performance.now() }; const tick = () => { window.__zlFps.n++; requestAnimationFrame(tick) }; requestAnimationFrame(tick) } const f = window.__zlFps; const dt = (performance.now() - f.t) / 1000; const fps = dt > 0 ? f.n / dt : 0; f.n = 0; f.t = performance.now(); return Math.round(fps * 10) / 10 })()`

async function measure(mode) {
  await fs.mkdir(outputDir, { recursive: true })
  const profile = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  // --visible：窗口真显示（隐藏窗口的 rAF 会被 Chromium 节流到 1fps，量不出真实帧率）
  const entry = await writeHiddenElectronBootstrap(root, profile, { visible: argv.includes('--visible') })
  const sp = path.join(profile, 'data', 'settings.json'); const st = JSON.parse(await fs.readFile(sp, 'utf8')); st.processMode = mode; await fs.writeFile(sp, JSON.stringify(st, null, 2))
  const video = path.join(profile, 'v.mp4'); await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25:d=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true })
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  await page.evaluate(async () => { await window.api.register('fps_user', 'Fixture123!', '帧率'); await window.api.login('fps_user', 'Fixture123!'); await window.api.saveSettings({ guideSeen: true, autoLogin: false }); localStorage.setItem('zl-guide-seen', '1') })
  const api = (fn, arg) => page.evaluate(fn, arg)
  await api((v) => window.api.entertainmentRuleAdd({ id: '', giftName: '规则视频', actionType: 'command', commandCmd: 'video-play', commandParam: v, enabled: true, queueMode: 'instant', multiply: true, extraActions: [] }), video)
  await api(() => window.api.entertainmentRuleAdd({ id: '', giftName: '小心心', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '1', enabled: true, queueMode: 'normal', multiply: true, extraActions: [] }))
  await api(() => window.api.greenScreenClose()); await sleep(200)
  await api(() => window.api.greenScreenOpen('', 'video', '', 1)); await api(() => window.api.greenScreenOpen('', 'video', '', 2))
  await api(() => window.api.effectsOpen())
  await api(() => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules: [{ id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }] }))
  await api(() => window.api.entranceOpen()); await api(() => window.api.queueOpen())
  await api(() => window.api.marqueeOpen({ giftOn: true, chatOn: true, gifts: [], chatKeywords: '', style: 'neon', fontSize: 24, position: 'top-right' }))
  await api(() => window.api.progressOpen()); await api(() => window.api.wishOpen())
  await api(() => window.api.timeWidgetOpen({ on: true, enable: true, title: '帧率', initial: 600, clockSpeed: 1000, addGift: '小心心', addSeconds: 5, subGift: '', subSeconds: 30, autoHide: false, showGift: true, showNegative: true, showSeconds: true, zeroText: '时间到', bgImage: '', theme: '1', titleColor: '#ffffff', timeColor: '#ffffff', startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' }, posX: 200, posY: 30, gifts: [], blindBoxEvents: [], boxVideoSlot: 2, boxVideoOverflow: true }))
  await sleep(3000)
  // 装计数器（第一次读丢弃）
  const readAll = () => app.evaluate(async ({ BrowserWindow }, probe) => {
    const out = []
    for (const w of BrowserWindow.getAllWindows()) { if (w.isDestroyed()) continue; try { out.push({ title: w.getTitle(), fps: await w.webContents.executeJavaScript(probe) }) } catch { out.push({ title: w.getTitle(), fps: -1 }) } }
    return out
  }, PROBE)
  await readAll(); await sleep(2000); await readAll()
  const idle = await (async () => { await sleep(5000); return readAll() })()
  const samples = []
  const t0 = Date.now(), end = t0 + MINUTES * 60_000
  let next = t0 + 10_000, sent = 0
  while (Date.now() < end) {
    await api(l => window.api.connectorSimulate(l), line()); sent++
    if (Date.now() >= next) { samples.push(await readAll()); next += 10_000 }
    await sleep(RATE_MS)
  }
  const cpu = await app.evaluate(({ app }) => app.getAppMetrics().reduce((s, m) => s + (m.cpu?.percentCPUUsage || 0), 0))
  try { await app.evaluate(({ app }) => app.quit()) } catch { /* */ }
  await sleep(1500)
  // 汇总：每个窗口连轰期间平均 / 最低 fps
  const titles = [...new Set(samples.flat().map(s => s.title))]
  const rows = titles.map(t => { const v = samples.flat().filter(s => s.title === t && s.fps >= 0).map(s => s.fps); const i = idle.find(s => s.title === t)?.fps ?? -1; return { title: t, idle: i, avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : -1, min: v.length ? Math.min(...v) : -1 } })
  return { mode, sent, rows, cpu: Math.round(cpu) }
}

const results = []
for (const mode of ['stable', 'lean']) { console.log(`===== ${mode} 连轰 ${MINUTES} 分钟 =====`); const r = await measure(mode); results.push(r); for (const row of r.rows) console.log(`  ${row.title.padEnd(8)} 空闲 ${row.idle} fps  连轰平均 ${row.avg}  最低 ${row.min}`); console.log(`  已发 ${r.sent} 条，结束时 CPU ${r.cpu}%`) }
console.log('\n===== 对照（连轰期间平均帧率）=====')
const [s, l] = results
for (const row of s.rows) { const lr = l.rows.find(x => x.title === row.title); if (!lr) continue; console.log(`  ${row.title.padEnd(8)} 独立 ${row.avg} → 共用 ${lr.avg}（最低 ${row.min} → ${lr.min}）`) }

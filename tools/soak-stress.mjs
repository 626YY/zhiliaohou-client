// 长跑压力：照主播真实用法把挂件全开（倒计时盲盒 / 礼物动画 / 大哥进场 / 整蛊排队 / 飘屏 / 进度 / 心愿 / 两个绿幕窗口），
// 然后礼物、进场、弹幕按固定节奏连轰 N 分钟，每 15 秒抽一次全进程内存 / CPU / 每个窗口的监听器数，
// 结束后看：内存有没有越跑越大（泄漏）、监听器有没有堆积（MaxListenersExceededWarning 的根）、有没有进程挂掉 / 页面报错。
// 用法：node tools/soak-stress.mjs [--minutes 8] [--rate 300]   （先 npm run build；隔离 userData、窗口全隐藏，不碰主播正式实例）
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output', 'playwright', 'soak-stress')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const run = promisify(execFile)
const argv = process.argv.slice(2)
const argNum = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt }
const MINUTES = argNum('--minutes', 8)
const RATE_MS = argNum('--rate', 300)
const SAMPLE_MS = 15_000
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pageErrors = []

function attachErrors(page) {
  const where = () => page.url().split('/').pop()
  page.on('pageerror', e => pageErrors.push(`[${where()}] ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[${where()}] console: ${m.text().slice(0, 200)}`) })
}

async function makeVideo(file, color, seconds) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=25:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', file], { windowsHide: true })
}

async function ensureTestSession(page) {
  await page.waitForFunction(() => Boolean(window.api?.login), null, { timeout: 15_000 })
  const r = await page.evaluate(async () => {
    await window.api.register('soak_stress', 'Fixture123!', '长跑压测')
    const login = await window.api.login('soak_stress', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return login
  })
  if (!r.ok) throw new Error(r.error || '本地测试账号登录失败')
}

const NAMES = ['榜一大哥', '大哥阿彪', '小美吖', '老王头', '球球', '路人甲', '🌈ღᩚ浪人', '二月🦋（困了哥哥的小舔🐶）', '飞鸟🐦‍⬛🐦‍⬛🦅', 'CKl0k (΄◉◞౪◟◉｀)', '神秘人', '用户✨']
const CHATS = ['666', '主播好帅', '来个盲盒', '哈哈哈哈哈', '这是什么游戏', '？？？', '再来一次', '晚上好呀', '刷个火箭看看', '🐦‍⬛🐦‍⬛🐦‍⬛']
const pick = a => a[Math.floor(Math.random() * a.length)]
function randomLine() {
  const r = Math.random()
  if (r < 0.18) return `礼物: 规则视频 ×${1 + Math.floor(Math.random() * 3)}  by ${pick(NAMES)}`
  if (r < 0.30) return `礼物: 小心心 ×${1 + Math.floor(Math.random() * 10)}  by ${pick(NAMES)}`
  if (r < 0.38) return `礼物: 盲盒 ×1  by ${pick(NAMES)}`
  if (r < 0.45) return `礼物: 玫瑰 ×${1 + Math.floor(Math.random() * 5)}  by ${pick(NAMES)}`
  if (r < 0.72) return `进场: ${pick(NAMES)}`
  return `弹幕: ${pick(NAMES)} ${pick(CHATS)}`
}

async function sample(app) {
  return app.evaluate(({ app, BrowserWindow }) => {
    const metrics = app.getAppMetrics()
    const mu = process.memoryUsage()
    let sysFree = -1
    try { sysFree = Math.round(process.getSystemMemoryInfo().free / 1024) } catch {}
    return {
      procs: metrics.length,
      totalWsMb: Math.round(metrics.reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024),
      // 私有提交内存：工作集会被系统回收，OOM 看的是这个
      totalPrivMb: Math.round(metrics.reduce((s, m) => s + (m.memory?.privateBytes || 0), 0) / 1024),
      cpuPct: Math.round(metrics.reduce((s, m) => s + (m.cpu?.percentCPUUsage || 0), 0)),
      byType: Object.fromEntries(['Browser', 'Tab', 'GPU', 'Utility'].map(t => [t, Math.round(metrics.filter(m => m.type === t).reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024)])),
      rssMb: Math.round(mu.rss / 1048576), heapMb: Math.round(mu.heapUsed / 1048576), sysFreeMb: sysFree,
      windows: BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => {
        const wc = w.webContents
        const names = wc.eventNames()
        const counts = Object.fromEntries(names.map(n => [String(n), wc.listenerCount(n)]))
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
        return { title: (w.getTitle() || '').slice(0, 14), url: wc.getURL().split('/').pop().slice(0, 28), listeners: Object.values(counts).reduce((a, b) => a + b, 0), top }
      })
    }
  })
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  const userDataDir = await fs.mkdtemp(path.join(outputDir, 'userdata-'))
  const logFile = path.join(userDataDir, 'logs', 'main.log')
  const boxVideo = path.join(userDataDir, '盲盒视频.mp4'), ruleVideo = path.join(userDataDir, '规则视频.mp4'), vipVideo = path.join(userDataDir, '大哥视频.mp4')
  await makeVideo(boxVideo, 'green', 1.2); await makeVideo(ruleVideo, 'blue', 0.8); await makeVideo(vipVideo, 'red', 1.5)
  const entry = await writeHiddenElectronBootstrap(root, userDataDir)
  // --mode lean|stable：写进隔离 profile 的 settings.processMode（进程模式对照实验）
  const modeIdx = argv.indexOf('--mode')
  if (modeIdx >= 0) {
    const sp = path.join(userDataDir, 'data', 'settings.json')
    const st = JSON.parse(await fs.readFile(sp, 'utf8')); st.processMode = argv[modeIdx + 1]; await fs.writeFile(sp, JSON.stringify(st, null, 2))
    console.log('进程模式：' + argv[modeIdx + 1])
  }
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  // --chromium a,b,c：额外 Chromium 开关（如 process-per-site,renderer-process-limit=1），做进程模型 / 内存对照实验
  const extraIdx = argv.indexOf('--chromium')
  const extra = extraIdx >= 0 ? argv[extraIdx + 1].split(',').filter(Boolean).map(a => '--' + a) : []
  if (extra.length) console.log('附加 Chromium 开关：' + extra.join(' '))
  const app = await electron.launch({ executablePath: electronPath, args: [entry, `--user-data-dir=${userDataDir}`, '--no-sandbox', ...extra], cwd: root, env, timeout: 30_000 })
  app.on('window', attachErrors)
  const page = await app.firstWindow()
  attachErrors(page)
  const api = (fn, arg) => page.evaluate(fn, arg)
  const must = (r, what) => { if (!r?.ok) throw new Error(`${what}：${r?.error || JSON.stringify(r)}`) }

  await ensureTestSession(page)
  // ---- 挂件全开 ----
  must(await api(({ boxVideo }) => window.api.timeWidgetOpen({
    on: true, enable: true, title: '压力', initial: 600, clockSpeed: 1000, addGift: '小心心', addSeconds: 5, subGift: '', subSeconds: 30,
    autoHide: false, showGift: true, showNegative: true, showSeconds: true, zeroText: '时间到', bgImage: '', theme: '1',
    titleColor: '#ffffff', timeColor: '#ffffff', startHotkey: { enabled: false, func: '无', key: '' }, endHotkey: { enabled: false, func: '无', key: '' }, posX: 200, posY: 30,
    gifts: [{ name: '盲盒', mode: 'blindbox', blindBoxEventIds: ['v'], op: '加减', seconds: 7 }],
    blindBoxEvents: [{ id: 'v', name: '盲盒视频', op: 'multiply', value: 1, action: 'none', video: boxVideo }],
    boxVideoSlot: 2, boxVideoOverflow: true
  }), { boxVideo }), '倒计时挂件')
  must(await api(({ ruleVideo }) => window.api.entertainmentRuleAdd({ id: '', giftName: '规则视频', actionType: 'command', commandCmd: 'video-play', commandParam: ruleVideo, enabled: true, queueMode: 'instant', multiply: true, extraActions: [] }), { ruleVideo }), '规则视频')
  must(await api(() => window.api.entertainmentRuleAdd({ id: '', giftName: '玫瑰', actionType: 'command', commandCmd: 'countdown-adjust', commandParam: '1', enabled: true, queueMode: 'normal', multiply: true, extraActions: [] })), '玫瑰规则')
  await api(() => window.api.greenScreenClose()); await sleep(200)
  must(await api(() => window.api.greenScreenOpen('', 'video', '', 1)), '绿幕 1')
  must(await api(() => window.api.greenScreenOpen('', 'video', '', 2)), '绿幕 2')
  must(await api(() => window.api.effectsOpen()), '礼物动画')
  await api(({ vipVideo }) => window.api.entranceConfigure({ enabled: true, bannerStyle: 'gold', rules: [
    { id: 'vip', enabled: true, match: 'contains', name: '大哥', text: '大哥 {name} 驾到', video: vipVideo, videoWindow: 'video', sound: '', dedupeSeconds: 0 },
    { id: 'any', enabled: true, match: 'any', name: '', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 0 }
  ] }), { vipVideo })
  must(await api(() => window.api.entranceOpen()), '大哥进场')
  must(await api(() => window.api.queueOpen()), '整蛊排队')
  await api(() => window.api.marqueeOpen({ giftOn: true, chatOn: true, gifts: [], chatKeywords: '', style: 'neon', fontSize: 24, position: 'top-right' }))
  must(await api(() => window.api.progressOpen()), '进度')
  must(await api(() => window.api.wishOpen()), '心愿')
  await sleep(2000)
  const first = await sample(app)
  console.log(`挂件全开：${first.windows.length} 个窗口，${first.procs} 个进程，共 ${first.totalWsMb}MB（私有 ${first.totalPrivMb}MB）；开始连轰 ${MINUTES} 分钟，每 ${RATE_MS}ms 一条`)

  // ---- 连轰 + 抽样 ----
  const samples = []
  const t0 = Date.now(), end = t0 + MINUTES * 60_000
  let sent = 0, nextSample = t0 + SAMPLE_MS
  while (Date.now() < end) {
    await api(l => window.api.connectorSimulate(l), randomLine()); sent++
    if (Date.now() >= nextSample) {
      const s = await sample(app); s.t = Math.round((Date.now() - t0) / 1000); s.sent = sent; samples.push(s); nextSample += SAMPLE_MS
      const worst = [...s.windows].sort((a, b) => b.listeners - a.listeners)[0]
      console.log(`${String(s.t).padStart(4)}s 已发 ${sent}  总 ${s.totalWsMb}MB 私有 ${s.totalPrivMb}MB（主 ${s.rssMb} 堆 ${s.heapMb} 页面 ${s.byType.Tab} GPU ${s.byType.GPU}） CPU ${s.cpuPct}%  系统剩余 ${s.sysFreeMb}MB  窗口 ${s.windows.length}  监听器最多 ${worst?.url}=${worst?.listeners}${worst?.top?.length ? '（' + worst.top.map(([n, c]) => `${n}:${c}`).join(' ') + '）' : ''}`)
    }
    await sleep(RATE_MS)
  }
  // --idle N：停轰后等 N 秒再取最后样本（默认 25），看内存会不会回落
  const IDLE_S = argNum('--idle', 25)
  console.log(`停止连轰，等 ${IDLE_S} 秒让排队消化…`)
  await sleep(IDLE_S * 1000)
  const last = await sample(app); last.t = Math.round((Date.now() - t0) / 1000); last.sent = sent; samples.push(last)

  // ---- 判定 ----
  const mainLog = await fs.readFile(logFile, 'utf8').catch(() => '')
  const bad = mainLog.split('\n').filter(l => /\[(uncaughtException|unhandledRejection|render-process-gone|child-process-gone|page-error|warning)\]/.test(l))
  const base = samples.find(s => s.t >= 60) || samples[0]
  const growHeap = last.heapMb - base.heapMb, growMain = last.rssMb - base.rssMb, growTotal = last.totalWsMb - base.totalWsMb
  const maxListeners = Math.max(...samples.flatMap(s => s.windows.map(w => w.listeners)))
  const perfLines = mainLog.split('\n').filter(l => l.includes('[perf]'))
  console.log('\n===== 结果 =====')
  console.log(`发了 ${sent} 条（礼物/进场/弹幕），跑了 ${last.t} 秒`)
  console.log(`主进程 RSS  ${base.rssMb}MB → ${last.rssMb}MB（${growMain >= 0 ? '+' : ''}${growMain}）   V8 堆 ${base.heapMb}MB → ${last.heapMb}MB（${growHeap >= 0 ? '+' : ''}${growHeap}）`)
  console.log(`客户端全部进程 ${base.totalWsMb}MB → ${last.totalWsMb}MB（${growTotal >= 0 ? '+' : ''}${growTotal}）   页面进程 ${base.byType.Tab}MB → ${last.byType.Tab}MB   GPU ${base.byType.GPU}MB → ${last.byType.GPU}MB`)
  console.log(`系统剩余内存 ${base.sysFreeMb}MB → ${last.sysFreeMb}MB   单窗口监听器峰值 ${maxListeners}`)
  // 平均值 / 峰值（连轰期间的样本，排除起步第一个）：给「优化了百分之几」用
  const during = samples.slice(1, -1)
  const avg = k => Math.round(during.reduce((a, s) => a + s[k], 0) / Math.max(1, during.length))
  const peak = k => Math.max(...during.map(s => s[k]))
  console.log(`连轰期间：总内存 平均 ${avg('totalWsMb')}MB / 峰值 ${peak('totalWsMb')}MB   私有内存 平均 ${avg('totalPrivMb')}MB / 峰值 ${peak('totalPrivMb')}MB / 结束 ${last.totalPrivMb}MB   CPU 平均 ${avg('cpuPct')}% / 峰值 ${peak('cpuPct')}%   进程数 ${last.procs}`)
  console.log(`main.log 里的异常/警告 ${bad.length} 条${bad.length ? '：\n  ' + bad.slice(0, 8).map(l => l.slice(0, 200)).join('\n  ') : ''}`)
  console.log(`页面报错 ${pageErrors.length} 条${pageErrors.length ? '：\n  ' + [...new Set(pageErrors)].slice(0, 8).join('\n  ') : ''}`)
  console.log(`[perf] 曲线 ${perfLines.length} 条，最后一条：${perfLines.at(-1)?.slice(0, 160) || '无'}`)
  const verdicts = []
  if (growHeap > 60) verdicts.push(`主进程 V8 堆涨了 ${growHeap}MB，像泄漏`)
  if (growTotal > 400) verdicts.push(`全部进程内存涨了 ${growTotal}MB`)
  if (maxListeners > 40) verdicts.push(`单个窗口监听器堆到 ${maxListeners}，有监听器没解绑`)
  if (bad.some(l => /process-gone|uncaughtException/.test(l))) verdicts.push('有进程挂掉或未捕获异常')
  console.log(verdicts.length ? '★ 判定：' + verdicts.join('；') : '判定：稳定（内存没有持续上涨、无进程挂掉、无监听器堆积）')
  await fs.writeFile(path.join(userDataDir, 'samples.json'), JSON.stringify({ samples, bad, pageErrors }, null, 2))
  console.log(`样本 ${path.join(userDataDir, 'samples.json')}`)

  await api(() => window.api.greenScreenClose()).catch(() => {})
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await sleep(3000)
  process.exit(verdicts.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })

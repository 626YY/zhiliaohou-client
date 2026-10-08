// 麦克风玩法的检测回归：把各种声音按不同音量喂给真的检测代码（shared.ts 的 ZL.startClap / ZL.startShout，
// 数每一档认出几次。
//   声音：合成掌声、两段真实的「啪」（拍蚊子 / 毛毛虫拖鞋拍打素材）、短元音（像说一个字）、长元音（像喊）、
//         键盘咔哒、蚊子嗡嗡（玩法自己的声音从音箱漏进麦克风）
//   音量：峰值 −30 / −24 / −20 / −15 / −10 / −6 / −3 dBFS，每档 3 次，底下一直垫着 −55 dB 的房间底噪
//   检测：同一路声音同时跑四套——拍手默认阈值 180 / 调低到 110，喊叫默认阈值 240 / 调低到 160
//         （阈值是设置里的 0~500 刻度：块有效值^0.28×300，满幅约 300）
// 2026-10-07 以前的版本特征口径和掌声模型训练时的定义对不上，什么都认不出来；这个用例守住识别行为。
// 假麦克风 = 页面里一个 AudioContext 的输出流（不碰真设备）；离屏 Electron 窗口不可见不聚焦（不抢前台）、静音。
// 用法：node tools/verify-mic-detect.mjs [--report]   （--report 只打表不判过不过）
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const REPORT = process.argv.includes('--report')
const output = path.join(root, 'output/playwright/mic-detect')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })

const bundle = path.join(output, 'mic-bundle.cjs')
await build({
  stdin: {
    contents: `export {SHARED_JS, MIC_CLAP_JS} from './src/main/special-games/shared';
export {SPECIAL_GAMES, defaultSpecialConfig} from './src/shared/specialGames';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SHARED_JS, MIC_CLAP_JS, SPECIAL_GAMES, defaultSpecialConfig } = createRequire(import.meta.url)(bundle)
const params = (id) => defaultSpecialConfig(SPECIAL_GAMES.find((g) => g.id === id)).params
const clapCfg = params('mosquito'), shoutCfg = params('talisman_seal')
const DETECTORS = [
  { id: 'clap', name: `拍手@${clapCfg.threshold}（默认）`, kind: 'clap', threshold: clapCfg.threshold },
  { id: 'clapLow', name: '拍手@110（调低）', kind: 'clap', threshold: 110 },
  { id: 'shout', name: `喊叫@${shoutCfg.threshold}（默认）`, kind: 'shout', threshold: shoutCfg.threshold },
  { id: 'shoutLow', name: '喊叫@160（调低）', kind: 'shout', threshold: 160 }
]

const asset = (rel) => pathToFileURL(path.join(root, 'assets/special-games', rel)).href
const html = `<!doctype html><meta charset="utf-8"><body><script>
// 假麦克风：一个 AudioContext 的输出流，测试往里放声音。每次给一份克隆：玩法停麦会 stop 自己那份音轨，真设备每次也是新流
window.__micAc=new AudioContext({ sampleRate:48000 });
window.__micDest=window.__micAc.createMediaStreamDestination();
navigator.mediaDevices.getUserMedia=function(){ return Promise.resolve(window.__micDest.stream.clone()); };
navigator.mediaDevices.enumerateDevices=function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake', groupId:'g' }]); };
</script><script>${SHARED_JS}</script><script>${MIC_CLAP_JS}</script></body>`
const file = path.join(output, 'mic.html')
await fs.writeFile(file, html)

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:400,height:300,show:false,focusable:false,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const LEVELS = [-30, -24, -20, -15, -10, -6, -3]
const PER = 3
const GAP = 1.3
const KINDS = [
  { id: 'clap', name: '合成掌声' },
  { id: 'slap1', name: '真实「啪」·拍蚊子', src: asset('big_mosquito/slap.mp3') },
  { id: 'slap2', name: '真实「啪」·拖鞋拍打', src: asset('caterpillar/slap.wav') },
  { id: 'word', name: '说一个字（短元音）' },
  { id: 'shout', name: '喊（长元音 0.7 秒）' },
  { id: 'click', name: '键盘咔哒' },
  { id: 'buzz', name: '蚊子嗡嗡漏进麦克风', src: asset('mosquito/mosquito.mp3') }
]

let passed = 0, failed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const bad = (m) => { failed++; console.log('FAIL ' + m) }

try {
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => window.__ZL && typeof window.__ZL.startClap === 'function' && typeof window.__ZL.startShout === 'function')
  await page.evaluate(() => window.__ZL.bind({ preview: false, asset: (r) => r, fileUrl: (p) => p, cfg: {} }))
  const table = []
  for (const kind of KINDS) {
    const res = await page.evaluate(async ({ kind, LEVELS, PER, GAP, clapCfg, shoutCfg, DETECTORS }) => {
      const ac = window.__micAc, ZL = window.__ZL
      if (ac.state !== 'running') await ac.resume()
      const SR = ac.sampleRate
      let seed = 7
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1 }
      const norm = (a, peak) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); for (let i = 0; i < a.length; i++) a[i] = a[i] / (m || 1) * peak; return a }
      // 合成掌声：1 毫秒起音的噪声爆发，35 毫秒衰减，带 1.2 kHz 附近的共鸣（手掌腔体）
      const clap = (peak) => { const n = Math.round(SR * 0.12), a = new Float32Array(n); let y1 = 0, y2 = 0; const w = 2 * Math.PI * 1200 / SR, r = 0.97
        for (let i = 0; i < n; i++) { const t = i / SR, env = t < 0.001 ? t / 0.001 : Math.exp(-(t - 0.001) / 0.035); const x = rnd(); const y = x + 2 * r * Math.cos(w) * y1 - r * r * y2; y2 = y1; y1 = y; a[i] = (x * 0.6 + y * 0.08) * env } return norm(a, peak) }
      // 元音：140~220 Hz 基频带谐波（共振峰 700/1200 Hz 附近加重），起止渐变；短的像说一个字，长的像喊
      const vowel = (peak, dur) => { const n = Math.round(SR * dur), a = new Float32Array(n); const f0 = 140 + Math.random() * 80
        for (let i = 0; i < n; i++) { const t = i / SR; let v = 0; for (let h = 1; h <= 16; h++) { const f = f0 * h; const g = Math.exp(-Math.pow((f - 700) / 350, 2)) * 1.4 + Math.exp(-Math.pow((f - 1200) / 400, 2)) + 0.25 / h; v += Math.sin(2 * Math.PI * f * t + h * 1.7) * g }
          const env = Math.min(1, t / 0.04, (dur - t) / 0.06); a[i] = v * Math.max(0, env) + rnd() * 0.01 } return norm(a, peak) }
      // 键盘咔哒：4 毫秒的尖脉冲 + 一点点余振
      const click = (peak) => { const n = Math.round(SR * 0.03), a = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; a[i] = rnd() * Math.exp(-t / 0.004) + Math.sin(2 * Math.PI * 3500 * t) * Math.exp(-t / 0.008) * 0.5 } return norm(a, peak) }
      let decoded = null
      if (kind.src) { const buf = await (await fetch(kind.src)).arrayBuffer(); decoded = await ac.decodeAudioData(buf) }
      const fromFile = (peak, maxSec) => { const ch = decoded.getChannelData(0); const n = Math.min(ch.length, Math.round(SR * maxSec)); const a = new Float32Array(n); a.set(ch.subarray(0, n)); return norm(a, peak) }
      const make = (peak) => kind.id === 'clap' ? clap(peak) : kind.id === 'word' ? vowel(peak, 0.22) : kind.id === 'shout' ? vowel(peak, 0.7) : kind.id === 'click' ? click(peak) : kind.id === 'buzz' ? fromFile(peak, 1.0) : fromFile(peak, 0.6)
      // 底噪：整段垫 −55 dBFS（有效值）的白噪声；声音按计划时间排进假麦克风
      const total = 1.5 + LEVELS.length * PER * GAP + 1.0
      const bed = ac.createBuffer(1, Math.round(SR * total), SR); const bd = bed.getChannelData(0); for (let i = 0; i < bd.length; i++) bd[i] = rnd() * 0.0031
      const t0 = ac.currentTime + 0.3, p0 = performance.now() + 300
      const bs = ac.createBufferSource(); bs.buffer = bed; bs.connect(window.__micDest); bs.start(t0)
      const events = []
      LEVELS.forEach((db, li) => { for (let k = 0; k < PER; k++) {
        const at = 1.5 + (li * PER + k) * GAP; const a = make(Math.pow(10, db / 20)); const b = ac.createBuffer(1, a.length, SR); b.copyToChannel(a, 0)
        const s = ac.createBufferSource(); s.buffer = b; s.connect(window.__micDest); s.start(t0 + at); events.push({ db, at: p0 + at * 1000, len: a.length / SR * 1000 }) } })
      // 旁路探针：另开一个 AudioContext 从同一路假麦克风读峰值，确认检测器那头真收到了声音
      const pac = new AudioContext(); const pan = pac.createAnalyser(); pan.fftSize = 1024; pan.smoothingTimeConstant = 0
      pac.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({ audio: true })).connect(pan)
      const pbuf = new Float32Array(pan.fftSize), probe = []
      const ptimer = setInterval(() => { pan.getFloatTimeDomainData(pbuf); let pk = 0; for (const v of pbuf) pk = Math.max(pk, Math.abs(v)); probe.push({ t: performance.now(), pk }) }, 20)
      // 四套检测同时听
      const hits = {}, levels = [], cands = [], handles = []
      for (const d of DETECTORS) {
        hits[d.id] = []
        const push = (lv) => hits[d.id].push({ t: performance.now(), lv })
        if (d.kind === 'clap') handles.push(ZL.startClap({ sensitivity: clapCfg.clapSensitivity, threshold: d.threshold, cooldownMs: clapCfg.cooldownMs, triggerMode: clapCfg.triggerMode, deviceLabel: '', onClap: push, onState: () => {},
          onLevel: d.id === 'clap' ? (lv) => levels.push({ t: performance.now(), lv }) : null, onCandidate: d.id === 'clapLow' ? (f) => cands.push(f) : null }))
        else handles.push(ZL.startShout({ threshold: d.threshold, cooldownMs: shoutCfg.cooldownMs, deviceLabel: '', onShout: push, onState: () => {} }))
      }
      await new Promise((r) => setTimeout(r, total * 1000 + 600))
      for (const h of handles) h.stop()
      bs.stop(); clearInterval(ptimer); pac.close()
      const inWin = (t, e) => t >= e.at - 50 && t <= e.at + Math.max(400, e.len + 200)
      const probeDb = {}, lvMax = {}
      for (const e of events) {
        let m = 0; for (const p of probe) if (inWin(p.t, e)) m = Math.max(m, p.pk); probeDb[e.db] = Math.max(probeDb[e.db] || 0, m)
        let l = 0; for (const x of levels) if (inWin(x.t, e)) l = Math.max(l, x.lv); lvMax[e.db] = Math.max(lvMax[e.db] || 0, l)
      }
      let quiet = 0; for (const p of probe) if (p.t >= p0 + 200 && p.t <= p0 + 1300) quiet = Math.max(quiet, p.pk)
      const dbOf = (x) => x > 0 ? Math.round(20 * Math.log10(x)) : -99
      // 每次检测归到那一下（声音开始前 0.1 秒到声音结束后 0.4 秒）；同一下认出多次只算一次；归不进去的算「凭空」
      const tally = (list) => { const by = {}; let stray = 0; for (const h of list) { const e = events.find((e) => h.t >= e.at - 100 && h.t <= e.at + e.len + 400); if (!e) { stray++; continue } by[e.db] = by[e.db] || new Set(); by[e.db].add(e.at) } return { by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.size])), stray } }
      const round = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]))
      return { det: Object.fromEntries(DETECTORS.map((d) => [d.id, tally(hits[d.id])])), probe: LEVELS.map((d) => dbOf(probeDb[d])), quiet: dbOf(quiet),
        lv: LEVELS.map((d) => Math.round(lvMax[d] || 0)), rejected: cands.filter((c) => !c.ok).slice(0, 3).map(round) }
    }, { kind, LEVELS, PER, GAP, clapCfg, shoutCfg, DETECTORS })
    table.push({ kind, res })
    const row = (r) => LEVELS.map((db) => `${r.by[db] || 0}`).join('') + (r.stray ? ` 凭空${r.stray}` : '')
    console.log(`${kind.name.padEnd(12, '　')}  刻度音量 ${res.lv.map((v) => String(v).padStart(3)).join(' ')}  ｜ ${DETECTORS.map((d) => `${d.name} ${row(res.det[d.id])}`).join('  ')}`)
    if (process.argv.includes('--debug')) console.log('  探针峰值', res.probe.join('/'), '底噪', res.quiet, ' 调低后仍被拒的候选：', JSON.stringify(res.rejected))
    if (Math.max(...res.probe) < LEVELS[LEVELS.length - 1] - 6) bad(`${kind.name}：探针没听到声音（假麦克风没出声，结果作废）`)
  }
  console.log(`（每组数字 = 从 ${LEVELS.join(' / ')} dBFS 各档 ${PER} 次里认出几次）`)
  if (!REPORT) {
    const row = (id) => table.find((t) => t.kind.id === id)
    const at = (id, det, pred) => { const r = row(id); return LEVELS.reduce((s, db, i) => s + (pred(r.res.lv[i], db) ? (r.res.det[det].by[db] || 0) : 0), 0) }
    const of = (id, pred) => { const r = row(id); return LEVELS.reduce((s, db, i) => s + (pred(r.res.lv[i], db) ? PER : 0), 0) }
    // 1. 真实的「啪」：音量比阈值高出一截（+15）的基本都认出来（默认 180 和调低 110 两套都看）
    for (const det of ['clap', 'clapLow']) {
      const th = DETECTORS.find((d) => d.id === det).threshold
      for (const id of ['slap1', 'slap2']) {
        const want = of(id, (lv) => lv >= th + 15), got = at(id, det, (lv) => lv >= th + 15)
        if (want === 0) bad(`${id}：没有一档音量够得着 ${th}+15，用例本身失效`)
        else got >= want - 1 ? ok(`${id} @${th}：够响的 ${got}/${want} 认出`) : bad(`${id} @${th}：够响的只认出 ${got}/${want}`)
      }
    }
    // 2. 音量没到阈值的绝不算（拍手、喊叫四套都看）
    for (const d of DETECTORS) {
      let n = 0
      for (const k of KINDS) n += at(k.id, d.id, (lv) => lv < d.threshold - 5)
      n === 0 ? ok(`${d.name}：音量不到阈值的一次没算`) : bad(`${d.name}：音量不到阈值也算了 ${n} 次`)
    }
    // 3. 不是拍手的声音：默认阈值下说话、喊、键盘、嗡嗡都不算；阈值调低后长声音（喊、嗡嗡）仍然不算
    //    （调低后短促的字音、键盘声会被掌声模型当成拍手——模型本身如此，调低阈值的代价，只打表不判）
    //    默认阈值下：正常音量（−6 dB 及以下）一次都不能算；贴着麦克风接近爆音（−3 dB）的单个字音允许偶尔误认 1 次（模型在那里概率接近门槛）
    for (const det of ['clap', 'clapLow']) {
      for (const id of det === 'clap' ? ['word', 'shout', 'click', 'buzz'] : ['shout', 'buzz']) {
        const loud = det === 'clap' && id === 'word' ? at(id, det, (lv, db) => db >= -3) : 0
        if (loud > 1) bad(`${id} 接近爆音时被当成拍手 ${loud} 次 @${DETECTORS.find((d) => d.id === det).threshold}`)
        const n = at(id, det, (lv, db) => !(det === 'clap' && id === 'word' && db >= -3))
        n === 0 ? ok(`${id} 不当成拍手 @${DETECTORS.find((d) => d.id === det).threshold}`) : bad(`${id} 被当成拍手 ${n} 次 @${DETECTORS.find((d) => d.id === det).threshold}`)
      }
    }
    // 4. 喊叫（只看音量）：长元音够阈值的都认出来
    for (const det of ['shout', 'shoutLow']) {
      const th = DETECTORS.find((d) => d.id === det).threshold
      const want = of('shout', (lv) => lv >= th + 8), got = at('shout', det, (lv) => lv >= th + 8)
      if (want === 0) console.log(`  （喊叫 @${th}：测试里最响的喊也没到 ${th}+8，这一档不判——默认阈值要喊得很响）`)
      else got >= want ? ok(`喊 @${th}：够响的 ${got}/${want} 认出`) : bad(`喊 @${th}：够响的只认出 ${got}/${want}`)
    }
    // 5. 没有凭空触发（声音之间的安静段）
    let stray = 0
    for (const t of table) for (const d of DETECTORS) stray += t.res.det[d.id].stray
    stray === 0 ? ok('安静段没有凭空触发') : bad(`安静段凭空触发 ${stray} 次`)
  }
} catch (e) {
  bad(String(e && e.stack || e))
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n页面错误：'); for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e) }
console.log(`\nMIC DETECT: ${passed} PASS, ${failed} FAIL${errors.length ? `，页面错误 ${errors.length}` : ''}`)
if (failed || errors.length) process.exitCode = 1

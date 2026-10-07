// 麦克风玩法端到端：在真的「特色整蛊」直播窗口页面里（buildSpecialWindowPage，全部玩法默认设置），
// 假麦克风放真实的「啪」/ 说话 / 喊，看玩法自己的反应——
//   声控拍蚊子：拍手灭蚊（越响灭得越多），说话不灭；改成「只看音量」后说话够响也算
//   手势拍蚊子（切到拍手声控）：拍手打中蚊子（扣血）
//   符咒封印：默认阈值下正常说话不破；喊得够响一声掉一点，喊到归零碎裂；阈值调低后正常音量也能喊破
// 不启动客户端、不碰用户配置；离屏窗口不可见不聚焦（不抢前台）、静音；假麦克风 = 页面里一个 AudioContext 的输出流。
// 用法：node tools/verify-mic-games.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/mic-games')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const assetBase = pathToFileURL(path.join(root, 'assets/special-games')).href.replace(/\/?$/, '/')

const bundle = path.join(output, 'special-bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig} from './src/shared/specialGames';
export {buildSpecialWindowPage} from './src/main/special-page';
export {GAME_CODE} from './src/main/special-games';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SPECIAL_GAMES, SPECIAL_LAYER_ORDER, DEFAULT_SPECIAL_WINDOW, defaultSpecialConfig, buildSpecialWindowPage, GAME_CODE } = createRequire(import.meta.url)(bundle)

// 假麦克风（每次给一份克隆，玩法停麦只停自己那份）+ 一直垫着 −55 dB 的房间底噪；冻结 rAF，只靠 __step 推帧
const TEST_PRE = `<script>(function(){
  window.__micAc=new AudioContext({ sampleRate:48000 });
  window.__micDest=window.__micAc.createMediaStreamDestination();
  var n=window.__micAc.sampleRate*4, b=window.__micAc.createBuffer(1,n,window.__micAc.sampleRate), d=b.getChannelData(0), s=11;
  for(var i=0;i<n;i++){ s=(s*1103515245+12345)&0x7fffffff; d[i]=(s/0x7fffffff*2-1)*0.0031; }
  var bed=window.__micAc.createBufferSource(); bed.buffer=b; bed.loop=true; bed.connect(window.__micDest); bed.start();
  var fake={ getUserMedia:function(){ return Promise.resolve(window.__micDest.stream.clone()); },
    enumerateDevices:function(){ return Promise.resolve([{ kind:'audioinput', label:'假麦克风', deviceId:'fake', groupId:'g' }]); } };
  try{ Object.defineProperty(navigator,'mediaDevices',{ value:fake, configurable:true }); }catch(e){}
  window.__realRaf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=function(){ return 0; };
})();</script>`

const W = 1280, H = 720
const win = { ...DEFAULT_SPECIAL_WINDOW, width: W, height: H }
const html = buildSpecialWindowPage(SPECIAL_GAMES.map((meta) => ({ meta, cfg: defaultSpecialConfig(meta), code: GAME_CODE[meta.id] || '' })), win, SPECIAL_LAYER_ORDER, assetBase)
  .replace('<div id="stage">', TEST_PRE + '<div id="stage">')
const file = path.join(output, 'special-window.html')
await fs.writeFile(file, html)

const profile = await fs.mkdtemp(path.join(output, 'session-'))
const entry = path.join(profile, 'main.cjs')
await fs.writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const win=new BrowserWindow({width:${W},height:${H},show:false,focusable:false,frame:false,transparent:true,webPreferences:{offscreen:true,backgroundThrottling:false,webSecurity:false,autoplayPolicy:'no-user-gesture-required'}});win.loadURL('about:blank')});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [entry, '--force-device-scale-factor=1', '--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  cwd: root,
  env
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|play\(\) request was interrupted/.test(m.text())) errors.push('[console] ' + m.text()) })

let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const apply = (cmd) => page.evaluate((c) => window.__apply(c), cmd)
const dbg = (id) => page.evaluate((g) => { const o = window.__game(g); return o && o.debug ? JSON.parse(JSON.stringify(o.debug(), (k, v) => (typeof v === 'function' || (typeof HTMLMediaElement !== 'undefined' && v instanceof HTMLMediaElement)) ? undefined : v)) : null }, id)
const step = (n, dt = 40) => page.evaluate(({ n, dt }) => { let a = false; for (let i = 0; i < n; i++) a = window.__step(dt) || a; return a }, { n, dt })
const wait = (ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms)
const slapUrl = pathToFileURL(path.join(root, 'assets/special-games/big_mosquito/slap.mp3')).href
// 往假麦克风里放 count 下声音（kind：slap 真实的「啪」/ word 说一个字 / shout 长喊 / roar 喊到快爆音），等放完
const play = async (kind, db, count, gapMs) => {
  await page.evaluate(async ({ kind, db, count, gapMs, slapUrl }) => {
    const ac = window.__micAc
    if (ac.state !== 'running') await ac.resume()
    const SR = ac.sampleRate, peak = Math.pow(10, db / 20)
    const norm = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); for (let i = 0; i < a.length; i++) a[i] = a[i] / (m || 1) * peak; return a }
    const vowel = (dur, drive) => { const n = Math.round(SR * dur), a = new Float32Array(n), f0 = 170
      for (let i = 0; i < n; i++) { const t = i / SR; let v = 0; for (let h = 1; h <= 16; h++) { const f = f0 * h; const g = Math.exp(-Math.pow((f - 700) / 350, 2)) * 1.4 + Math.exp(-Math.pow((f - 1200) / 400, 2)) + 0.25 / h; v += Math.sin(2 * Math.PI * f * t + h * 1.7) * g }
        const env = Math.max(0, Math.min(1, t / 0.04, (dur - t) / 0.06)); a[i] = drive ? Math.tanh(v * drive) * env : v * env }
      return norm(a) }
    let make
    if (kind === 'slap') { if (!window.__slap) window.__slap = await ac.decodeAudioData(await (await fetch(slapUrl)).arrayBuffer()); const ch = window.__slap.getChannelData(0); make = () => norm(Float32Array.from(ch.subarray(0, Math.min(ch.length, Math.round(SR * 0.6))))) }
    else if (kind === 'word') make = () => vowel(0.22, 0)
    else if (kind === 'shout') make = () => vowel(0.5, 0)
    else make = () => vowel(0.5, 6)
    const t0 = ac.currentTime + 0.15
    for (let k = 0; k < count; k++) {
      const a = make(); const b = ac.createBuffer(1, a.length, SR); b.copyToChannel(a, 0)
      const s = ac.createBufferSource(); s.buffer = b; s.connect(window.__micDest); s.start(t0 + k * gapMs / 1000)
    }
    // 放的同时按实时推帧（真实窗口里有东西在动就一直在画，玩法的时钟跟着走）
    const ms = 150 + count * gapMs + 700
    await new Promise((r) => { const t = setInterval(() => window.__step(40), 40); setTimeout(() => { clearInterval(t); r() }, ms) })
    return ms
  }, { kind, db, count, gapMs, slapUrl })
  await step(2)
}

try {
  const bw = await app.browserWindow(page)
  await bw.evaluate((w, s) => w.setContentSize(s.w, s.h), { w: W, h: H })
  await page.goto(pathToFileURL(file).href)
  await page.waitForFunction(() => typeof window.__applyMany === 'function' && typeof window.__game === 'function')

  // ---- 1. 声控拍蚊子 ----
  await apply({ game: 'mosquito', operation: 'add', count: 30, username: '测试' })
  await step(5); await wait(900); await step(2)
  const m0 = await dbg('mosquito')
  assert.equal(m0.micState, '', `麦克风应该在听：${JSON.stringify(m0.micState)}`)
  assert.equal(m0.alive, 30, `蚊子应该全在：${m0.alive}`)
  await play('word', -4, 3, 700)
  const m1 = await dbg('mosquito')
  assert.equal(m1.alive, m0.alive, `说话不该灭蚊：${m0.alive} → ${m1.alive}`)
  ok(`声控拍蚊子：正常说话（−4 dB 的短字音 ×3）不灭蚊，还剩 ${m1.alive} 只`)
  await play('slap', -4, 4, 700)
  const m2 = await dbg('mosquito')
  assert.ok(m1.alive - m2.alive >= 3, `拍 4 下至少认出 3 下：${m1.alive} → ${m2.alive}`)
  ok(`声控拍蚊子：拍 4 下（−4 dB）灭了 ${m1.alive - m2.alive} 只（越响一次灭得越多）`)
  await play('slap', -18, 3, 700)
  const m3 = await dbg('mosquito')
  assert.equal(m3.alive, m2.alive, `太轻的拍手不该算（默认阈值 180）：${m2.alive} → ${m3.alive}`)
  ok(`声控拍蚊子：太轻的拍手（−18 dB，没到默认阈值）不算`)
  // 只看音量：说话够响也算
  await page.evaluate(() => window.__config({ triggerMode: 'volume' }, 'mosquito'))
  await step(2); await wait(900)
  await play('shout', -3, 2, 900)
  const m4 = await dbg('mosquito')
  assert.ok(m3.alive - m4.alive >= 2, `只看音量时够响的喊声也算：${m3.alive} → ${m4.alive}`)
  ok(`识别方式改「只看音量」：喊两声也灭了 ${m3.alive - m4.alive} 只`)
  await apply({ game: 'mosquito', operation: 'clear', count: 1, wipe: true })
  await step(3)

  // ---- 2. 手势拍蚊子切到拍手声控 ----
  await page.evaluate(() => window.__config({ controlMode: 'clap' }, 'big_mosquito'))
  await apply({ game: 'big_mosquito', operation: 'add', count: 3, size: 'small', username: '测试' })
  await step(5); await wait(900); await step(2)
  const b0 = await dbg('big_mosquito')
  assert.ok(b0.clap, `声控模式下应该开着麦克风：${JSON.stringify(b0)}`)
  const hp0 = b0.hpNow.reduce((s, v) => s + v, 0)
  await play('slap', -4, 2, 800)
  const b1 = await dbg('big_mosquito')
  const hp1 = b1.hpNow.reduce((s, v) => s + v, 0)
  assert.ok(hp1 < hp0 || b1.alive < b0.alive, `拍手应该打中蚊子：血量 ${hp0} → ${hp1}，只数 ${b0.alive} → ${b1.alive}`)
  ok(`手势拍蚊子（拍手声控）：拍 2 下，血量 ${hp0} → ${hp1}、还剩 ${b1.alive} 只`)
  await apply({ game: 'big_mosquito', operation: 'clear', count: 1, wipe: true })
  await step(3)

  // ---- 3. 符咒封印 ----
  await apply({ game: 'talisman_seal', operation: 'add', count: 3, username: '测试' })
  for (let i = 0; i < 30; i++) { await step(2); const t = await dbg('talisman_seal'); if (t.phase === 'sustain') break }
  await wait(900)
  const t0 = await dbg('talisman_seal')
  assert.equal(t0.phase, 'sustain', `符咒应该贴好了：${JSON.stringify(t0)}`)
  assert.equal(t0.micState, '', `麦克风应该在听：${t0.micState}`)
  await play('shout', -6, 2, 900)
  const t1 = await dbg('talisman_seal')
  assert.equal(t1.remaining, t0.remaining, `默认阈值 240 下正常音量的喊不该破：${t0.remaining} → ${t1.remaining}`)
  ok(`符咒封印：正常音量的喊（−6 dB，没到默认阈值 240）不破，还剩 ${t1.remaining} 点`)
  await play('roar', -0.5, 1, 900)
  const t2 = await dbg('talisman_seal')
  assert.ok(t2.remaining < t1.remaining, `喊到快爆音应该掉点：${t1.remaining} → ${t2.remaining}`)
  ok(`符咒封印：喊到快爆音 1 声，${t1.remaining} → ${t2.remaining} 点`)
  // 阈值调低：正常音量的喊也能破，喊到归零碎裂
  await page.evaluate(() => window.__config({ threshold: 160 }, 'talisman_seal'))
  await play('shout', -6, 4, 900)
  const t3 = await dbg('talisman_seal')
  assert.ok(t3.remaining === 0 && (t3.phase === 'breaking' || t3.phase === 'idle'), `阈值 160 时喊 4 声应该喊破：${JSON.stringify(t3)}`)
  ok(`符咒封印：阈值调到 160 后正常音量喊几声就破了（${t3.phase}）`)
  for (let i = 0; i < 40; i++) await step(2)
  await apply({ game: 'talisman_seal', operation: 'clear', count: 1, wipe: true })

  // ---- 4. 都停了以后，麦克风全部释放 ----
  await step(5); await wait(300)
  const live = await page.evaluate(() => {
    // 页面里用过的流：玩法各自 getUserMedia 拿到的克隆；没法枚举，就看各玩法自己的状态
    const g = (id) => window.__game(id) && window.__game(id).debug ? window.__game(id).debug() : {}
    return { mosquito: g('mosquito').alive, big: g('big_mosquito').clap, talisman: g('talisman_seal').phase }
  })
  assert.equal(live.big, false, '手势拍蚊子清掉后应该关麦克风')
  ok(`都清掉以后：拍蚊子 ${live.mosquito} 只、手势拍蚊子关了麦克风、符咒 ${live.talisman}`)
} catch (e) {
  console.log('FAIL ' + (e && e.message))
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
if (errors.length) { console.log('\n页面错误：'); for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e) }
console.log(`\nMIC GAMES: ${passed} PASS${process.exitCode ? '，有失败' : ''}${errors.length ? `，页面错误 ${errors.length}` : ''}`)
if (errors.length) process.exitCode = 1

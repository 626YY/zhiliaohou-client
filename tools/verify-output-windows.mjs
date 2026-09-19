// 输出窗口统一行为验证：绿幕 / 转盘 / 九宫格 / 视频 / 排队 都 (1) 默认不置顶 (2) 「输出窗口总在最前」总开关一改立刻套到所有已开窗口
// (3) 按住窗口空白处能拖动（通用注入脚本）。隐藏隔离实例，真实 preload/IPC。用法：node tools/verify-output-windows.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output/playwright/output-windows')
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(out, 'session-'))
const entry = await writeHiddenElectronBootstrap(root, profile)
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30000 })
const checks = []
const pass = (name, detail = '') => { checks.push(name); console.log('PASS ' + name + (detail ? ' | ' + detail : '')) }
const png = path.join(root, 'build/icon.png')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 主进程里按标题找窗口
const winInfo = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), top: w.isAlwaysOnTop(), pos: w.getPosition() })))
let failure
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.greenScreenOpen)
  const s0 = await page.evaluate(() => window.api.getSettings())
  assert.notEqual(s0.settings.outputsAlwaysOnTop, true)
  const items = [{ name: '奖1', weight: 1 }, { name: '奖2', weight: 1 }, { name: '奖3', weight: 1 }]
  let r = await page.evaluate((p) => window.api.greenScreenOpen(p, 'image', '', 1), png); assert.equal(r.ok, true, '绿幕 ' + r.error)
  r = await page.evaluate((it) => window.api.lotteryOpen('wheel', it), items); assert.equal(r.ok, true, '转盘 ' + r.error)
  r = await page.evaluate((it) => window.api.lotteryOpen('nine', it), items); assert.equal(r.ok, true, '九宫格 ' + r.error)
  r = await page.evaluate((it) => window.api.lotteryOpen('lucky', it), items); assert.equal(r.ok, true, '幸运大转盘 ' + r.error)
  await sleep(1500)
  // 0.3.12 起普通转盘并入幸运转盘：wheel/lucky 同一个窗口
  let info = await winInfo()
  // 0.3.41 起默认短窗口名（绿幕1/九宫格/幸运转盘），设置里可切回旧长名（知了猴绿幕 1…）——两种都认。
  const OUT_TITLE = /^(?:知了猴)?(?:绿幕|转盘|九宫格|幸运转盘|视频|排队|倒计时|进场|飘屏|礼物动画)/
  const outs = info.filter((w) => OUT_TITLE.test(w.title) && w.title !== '知了猴整蛊台')
  assert.ok(outs.length >= 3, '输出窗口不够：' + JSON.stringify(info.map((w) => w.title)))
  assert.ok(outs.every((w) => !w.top), '有窗口仍置顶：' + JSON.stringify(outs))
  pass('默认不置顶（绿幕 / 九宫格 / 幸运转盘）', outs.map((w) => w.title).join(' '))

  // 总开关：开 → 全部置顶；关 → 全部不置顶（不用重开窗口）
  await page.evaluate(() => window.api.saveSettings({ outputsAlwaysOnTop: true })); await sleep(300)
  info = (await winInfo()).filter((w) => outs.some((o) => o.id === w.id))
  assert.ok(info.every((w) => w.top), '开总开关后仍有不置顶：' + JSON.stringify(info))
  await page.evaluate(() => window.api.saveSettings({ outputsAlwaysOnTop: false })); await sleep(300)
  info = (await winInfo()).filter((w) => outs.some((o) => o.id === w.id))
  assert.ok(info.every((w) => !w.top), '关总开关后仍有置顶：' + JSON.stringify(info))
  pass('总开关「输出窗口总在最前」开/关立刻套到全部已开窗口')

  // 拖动：对每个输出窗口，在空白处按下→移动→松开，窗口位置应变
  const pages = app.windows()
  for (const o of outs) {
    const bw = await app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); return w ? w.getPosition() : null }, o.id)
    const target = pages.find((p) => o.title.includes('绿幕') ? p.url().includes('green-') : o.title.includes('九宫格') ? p.url().includes('lottery-nine') : (p.url().includes('lottery-') && !p.url().includes('lottery-nine')))
    assert.ok(target, '找不到页面 ' + o.title)
    await target.waitForFunction(() => window.__zlOutputDrag === true, null, { timeout: 8000 })
    // 找一个空白落点：按钮 / 输入框 / 系统拖动条（-webkit-app-region:drag）上按下不算拖（和注入脚本同一套判断）
    const pt = await target.evaluate(() => {
      const skip = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (e.matches('button,input,select,textarea,a,[contenteditable],[data-nodrag]')) return true; if (getComputedStyle(e).webkitAppRegion === 'drag') return true } return false }
      for (const [fx, fy] of [[0.5, 0.45], [0.5, 0.08], [0.08, 0.5], [0.92, 0.5], [0.5, 0.92], [0.15, 0.15], [0.85, 0.85], [0.5, 0.3], [0.3, 0.5]]) {
        const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy)
        const el = document.elementFromPoint(x, y)
        if (!skip(el)) return [x, y, el ? el.tagName + (el.id ? '#' + el.id : '') : 'none']
      }
      return null
    })
    assert.ok(pt, o.title + ' 页面上找不到空白落点')
    const x0 = pt[0], y0 = pt[1]
    await target.mouse.move(x0, y0); await target.mouse.down(); await target.mouse.move(x0 + 60, y0 + 40, { steps: 6 }); await target.mouse.up()
    await sleep(300)
    const after = await app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); return w ? w.getPosition() : null }, o.id)
    assert.ok(after && (after[0] !== bw[0] || after[1] !== bw[1]), o.title + ' 拖不动：' + JSON.stringify({ bw, after }))
    pass(o.title + ' 可拖动', `落点 ${pt[2]} ${bw} → ${after}`)
  }
} catch (e) { failure = e; console.log('FAIL ' + (e?.stack || e)) }
finally {
  await app.close().catch(() => {})
  await fs.writeFile(path.join(out, 'results.txt'), checks.map((c) => 'PASS ' + c).join('\n') + (failure ? '\nFAIL ' + failure : '') + '\n')
}
if (failure) process.exit(1)
console.log(`全部通过 ${checks.length} 项`)

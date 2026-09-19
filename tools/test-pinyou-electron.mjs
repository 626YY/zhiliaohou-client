// 构建后运行：实际 preload → IPC → 配置解析/原子保存；只用独立 userData。
// 用法：unset ELECTRON_RUN_AS_NODE; node tools/test-pinyou-electron.mjs [--hidden] [--out=<electron-vite 产物目录，默认 out>]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'
const root = path.resolve(import.meta.dirname, '..')
const outDir = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'out'
const output = path.join(root, 'output', 'playwright', 'pinyou-import')
await fs.mkdir(output, { recursive: true })
const userData = await fs.mkdtemp(path.join(output, 'electron-userdata-'))
const file = path.join(userData, '品游配置_IPC.py')
await fs.writeFile(file, JSON.stringify({
  '第一个方案': { 'ＡＢＣ': { 动作: { 执行功能: '正常按键', 功能代码: 'M' } } },
  '第二个方案': { '关注触发': { 动作: { 执行功能: '正常按键', 功能代码: 'F3' } } }
}), 'utf8')
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const hidden = process.argv.includes('--hidden')
if (!hidden && outDir !== 'out') throw new Error('--out 只在 --hidden 模式下生效（非隐藏模式走 package.json 的 main）')
const entry = hidden ? await writeHiddenElectronBootstrap(root, userData, { outDir }) : '.'
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [entry, `--user-data-dir=${userData}`, '--no-sandbox'], cwd: root, env, timeout: 30_000 })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.api?.entertainmentPinyouApply === 'function')
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData)
  if (hidden) {
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible() && !win.isFocused())), true)
    console.log('PASS hidden bootstrap: independent userData; all test windows invisible and unfocused')
  }
  // 替代系统选文件操作，其后解析、preload 和主进程保存全部是真实代码。
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, file)
  const parsed = await page.evaluate(() => window.api.entertainmentPinyouImport())
  assert.equal(parsed.ok, true, parsed.error)
  assert.equal(parsed.plans.length, 2)
  const old = await page.evaluate(() => window.api.entertainmentRuleAdd({ id: '', giftName: 'abc', actionType: 'key', keySeq: 'a' }))
  assert.equal(old.ok, true)
  assert.match(old.id, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i)
  const first = await page.evaluate(rules => window.api.entertainmentPinyouApply(rules, true), parsed.plans[0].rules)
  assert.equal(first.ok, true, first.error)
  assert.equal(first.added, 1)
  assert.equal(first.removed, 1)
  const second = await page.evaluate(rules => window.api.entertainmentPinyouApply(rules, false), parsed.plans[1].rules)
  assert.equal(second.ok, true, second.error)
  const saved = await page.evaluate(() => window.api.entertainmentRulesList())
  assert.equal(saved.length, 2)
  assert.equal(saved[0].keySeq, 'm')
  assert.equal(saved[1].triggerType, 'follow')
  const invalid = await page.evaluate(() => window.api.entertainmentPinyouApply([{ id:'', giftName:'', actionType:'key' }], true))
  assert.equal(invalid.ok, false)
  assert.deepEqual(await page.evaluate(() => window.api.entertainmentRulesList()), saved)
  const stored = JSON.parse(await fs.readFile(path.join(userData, 'data/entertainment_rules.json'), 'utf8'))
  assert.deepEqual(stored, saved)
  if (hidden) assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible() && !win.isFocused())), true)
  await fs.writeFile(path.join(output, 'electron-ipc-result.json'), JSON.stringify({ parsedPlans: parsed.plans.length, first, second, invalid, rules: saved }, null, 2))
  console.log('PASS P0-2 Electron: real preload+IPC parse 2 plans / UUID / NFKC replacement / append / invalid import preserves disk rules')

  // ===== 2026-09-06 端到端：主播视角的「一键导入」——假品游安装目录 + 品游真实内置方案（GBK）
  //   选文件 → 自动认出品游目录 → 预览数据（规则数 / 素材路径 / 提示）→ 确认导入 → 规则表 → 模拟送礼 → 规则真的被命中
  const install = path.join(userData, '娱乐助手Pro')
  for (const d of ['音效', '视频\\绿幕', '视频\\盲盒', '视频\\平底锅', '脚本', '配置']) await fs.mkdir(path.join(install, d), { recursive: true })
  await fs.writeFile(path.join(install, '娱乐助手Pro9.71.exe'), '') // 只做存在性判断，绝不执行
  await fs.writeFile(path.join(install, '音效', '小女孩挖呀挖.mp3'), '')
  await fs.writeFile(path.join(install, '视频', '绿幕', '木鱼狗.mp4'), '')
  await fs.writeFile(path.join(install, '视频', '绿幕', '开盲盒.mp4'), '')
  await fs.writeFile(path.join(install, '脚本', '木鱼狗.脚本'), '正常按键:F10,1次\r\n延迟时间:0.3秒\r\n', 'utf8')
  const config = path.join(install, '配置', '品游配置_黑神话悟空2.py')
  await fs.copyFile(path.join(root, 'tools', 'fixtures', 'pinyou', '品游配置_黑神话悟空2.py'), config)
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, config)
  const imported = await page.evaluate(() => window.api.entertainmentPinyouImport())
  assert.equal(imported.ok, true, imported.error)
  assert.equal(imported.root, install, '要自动认出品游目录')
  assert.equal(imported.plans.length, 1)
  const plan = imported.plans[0]
  assert.equal(plan.name, '黑神话悟空2')
  assert.ok(plan.rules.length >= 20, `真实方案 23 个礼物至少导出 20 条规则，实际 ${plan.rules.length}`)
  const media = plan.rules.flatMap(r => [r.soundPath, r.commandCmd === 'video-play' || r.commandCmd === 'video-random' || r.commandCmd === 'sound-random' ? r.commandParam : undefined]).filter(Boolean)
  assert.ok(media.length >= 10 && media.every(p => p.startsWith(install + path.sep)), '所有音效 / 视频路径都要指向品游目录：' + JSON.stringify(media))
  assert.equal(plan.rules.find(r => r.giftName === '抖音')?.soundPath, path.join(install, '音效', '小女孩挖呀挖.mp3'))
  assert.equal(plan.rules.find(r => r.giftName === '加油鸭' && r.commandCmd === 'video-play')?.commandParam, path.join(install, '视频', '绿幕', '木鱼狗.mp4') + '|0.9')
  assert.ok(plan.notes.some(n => n.gift === '荧光棒' && /蹦迪\.MP3/.test(n.text)), '品游目录里没有的音效要在预览里提示')
  assert.ok(!plan.notes.some(n => n.gift === '抖音'), '存在的素材不提示')
  const applied = await page.evaluate(rules => window.api.entertainmentPinyouApply(rules, true), plan.rules)
  assert.equal(applied.ok, true, applied.error)
  assert.equal(applied.added, plan.rules.length)
  const stored2 = await page.evaluate(() => window.api.entertainmentRulesList())
  assert.equal(stored2.filter(r => r.giftName === '抖音').length, 1)
  // 模拟一条真实格式的礼物日志（只挑「抖音 → 播放音效」这条，执行只会给渲染层发一个播音效事件，不会碰键鼠）
  await page.evaluate(() => { window.__pinyouSounds = []; window.api.onEntertainmentSound(e => window.__pinyouSounds.push(e)) })
  const sim = await page.evaluate(() => window.api.connectorSimulate('礼物: 抖音 x1 by 测试观众'))
  assert.equal(sim.ok, true, sim.error)
  await page.waitForFunction(() => window.__pinyouSounds.length > 0, null, { timeout: 10_000 })
  const sounds = await page.evaluate(() => window.__pinyouSounds)
  assert.equal(sounds[0].path, path.join(install, '音效', '小女孩挖呀挖.mp3'), '送礼后规则要按品游目录里的音效执行')
  await fs.writeFile(path.join(output, 'electron-e2e-result.json'), JSON.stringify({ root: imported.root, rules: plan.rules.length, notes: plan.notes, skipped: plan.skipped, applied, sounds }, null, 2))
  console.log(`PASS 2026-09-06 Electron e2e: real built-in plan (GBK) → auto-detected install dir → ${plan.rules.length} rules / ${plan.notes.length} notes / ${plan.skipped.length} skipped → applied → simulated gift hit sound rule`)
} finally { await app.close() }

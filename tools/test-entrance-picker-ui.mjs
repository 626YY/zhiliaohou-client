// 真实「大哥进场」页 UI 回归：esbuild 把 EntertainmentEntrance.tsx 打成浏览器包、喂受控的 window.api，
// 验「选观众」下拉（头像 + 昵称）在页面里的表现（不进 Electron，秒级）。
//   2026-09-13 用户：「大哥进场功能，要读取粉丝的名字和头像，做成下拉列表样式」。
//   ① 页面加载只读配置，不往主进程写（不覆盖主播数据）；老规则（没 avatar/uid）照常显示
//   ② 点昵称框弹出名单：每行头像 + 昵称，没头像的用默认头像；标题写「已出现的观众」不冒充粉丝列表
//   ③ 打字即搜索，按昵称 / 观众 id 过滤
//   ④ 重名两条都在，带 id 尾号；选中后 name/avatar/uid 一起写进规则
//   ⑤ 选完再手改昵称 → 头像 / id 清掉
//   ⑥ 名单为空：一句可操作的引导，手填照旧
//   ⑦ 「试一试」选人后模拟进场带头像
// 用法：node tools/test-entrance-picker-ui.mjs   （需要先 npm run build 生成 out/renderer/assets 的样式）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/entrance-picker-ui')
await fs.mkdir(output, { recursive: true })

const now = Date.now()
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
import Entrance from './src/renderer/src/pages/EntertainmentEntrance';
import {useToast} from './src/renderer/src/stores/ui';
localStorage.setItem('zl-theme','dark'); document.documentElement.dataset.theme='dark';
const NOW = ${now};
const rule = (extra) => ({ id: 'r1', enabled: true, match: 'equals', name: '老规则人', text: '欢迎 {name}', video: '', videoWindow: 'video', sound: '', dedupeSeconds: 60, ...extra });
window.qa = { configure: [], tests: [], viewerCalls: 0, viewers: [
  { name: '阿彪', avatar: 'F:/fixture/abiao.png', lastSeen: NOW - 60_000, seen: 3 },
  { name: '大哥', uid: '10001', avatar: 'F:/fixture/dage1.png', lastSeen: NOW - 120_000, seen: 2 },
  { name: '大哥', uid: '10002', lastSeen: NOW - 180_000, seen: 1 },
  { name: '路人甲', lastSeen: NOW - 86_400_000 * 2, seen: 1 },
  { name: '测试号', lastSeen: NOW - 300_000, seen: 1, sim: true }
], config: { enabled: true, rules: [rule({})], bannerSeconds: 5, bannerStyle: 'gold', bannerPosition: 'top', bannerWidth: 640, bannerHeight: 140, videoSeconds: 0 } };
window.toasts = () => useToast.getState().toasts;
window.api = {
  entranceState: async () => ({ open: false, config: window.qa.config, recent: [] }),
  entranceConfigure: async (patch) => { window.qa.configure.push(patch); window.qa.config = { ...window.qa.config, ...patch }; return { ok: true } },
  entranceOpen: async () => ({ ok: true }), entranceClose: async () => ({ ok: true }),
  entranceTest: async (name, avatar) => { window.qa.tests.push({ name, avatar }); return { ok: true } },
  onEntranceChanged: (cb) => { window.pushEntrance = cb; return () => { window.pushEntrance = undefined } },
  viewerList: async () => { window.qa.viewerCalls++; return { rows: window.qa.viewers, total: window.qa.viewers.length } },
  emojiAssets: async () => ({ dir: 'F:/fixture/emoji72', keys: ['1f426-200d-2b1b', '1f985'] }),
  selectFile: async () => ({ ok: false })
};
createRoot(document.getElementById('root')).render(<MemoryRouter><Entrance/></MemoryRouter>);
`

const bundle = await build({
  stdin: { contents: source, loader: 'tsx', resolveDir: root },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { '@shared': path.join(root, 'src/shared') }
})
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const checks = []
const pass = (name) => { checks.push(name); console.log('PASS ' + name) }
let failure
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://zl-entrance.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
  // zlmedia:// 在纯浏览器里打不开，图片 onerror 会退回默认头像；这里把它们截成一张 1×1 PNG，验「有头像的显示 <img>」
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await page.route('zlmedia://**', (r) => r.fulfill({ contentType: 'image/png', body: png })).catch(() => {})
  await page.goto('https://zl-entrance.test/')
  const assets = path.join(root, 'out/renderer/assets')
  const css = (await fs.readdir(assets)).find((n) => n.startsWith('index-') && n.endsWith('.css'))
  if (css) await page.addStyleTag({ content: await fs.readFile(path.join(assets, css), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  // ① 加载只读不写；老规则照常显示
  await page.getByText('进场规则', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.qa.configure.length), 0, '一加载页面不该往主进程写配置')
  const ruleInput = page.getByRole('combobox', { name: '规则 1 观众' })
  assert.equal(await ruleInput.inputValue(), '老规则人', '老规则的昵称照常显示')
  assert.equal(await page.locator('[data-viewer-picker]').last().locator('[data-viewer-avatar="default"]').count(), 1, '老规则没头像 → 默认头像')
  pass('加载不覆盖配置，老规则照常显示')

  // ② 点开名单：头像 + 昵称
  await ruleInput.click()
  if (process.env.ZL_DEBUG) { await page.waitForTimeout(500); console.log('DEBUG', await page.evaluate(() => ({ calls: window.qa.viewerCalls, lists: document.querySelectorAll('[data-viewer-list]').length, pops: document.querySelectorAll('.zl-pop').length, html: [...document.querySelectorAll('[data-viewer-picker]')].at(-1)?.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g,'<svg/>').slice(0, 2500) }))); await page.screenshot({ path: path.join(output, 'debug.png'), fullPage: true }) }
  await page.locator('[data-viewer-list]').waitFor()
  assert.match(await page.locator('.zl-pop').first().textContent(), /已出现的观众 · 5 人/, '标题写清来源和人数')
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-viewer-option]')].map((b) => ({
    name: b.dataset.viewerOption, uid: b.dataset.viewerUid, avatar: b.querySelector('[data-viewer-avatar]')?.dataset.viewerAvatar, text: b.textContent
  })))
  assert.deepEqual(rows.map((r) => r.name), ['阿彪', '大哥', '大哥', '路人甲', '测试号'], '名单按最近出现排列')
  assert.deepEqual(rows.map((r) => r.avatar), ['image', 'image', 'default', 'default', 'default'], '有头像的显示图片，没有的默认头像')
  assert.ok(rows[2].text.includes('暂无头像'), '没头像的行要写「暂无头像」')
  assert.ok(rows[4].text.includes('模拟'), '模拟事件造的人要标「模拟」')
  const imgSrc = await page.evaluate(() => document.querySelector('[data-viewer-option] img')?.getAttribute('src'))
  assert.match(imgSrc, /^zlmedia:\/\/local\//, '头像走 zlmedia 协议')
  await page.screenshot({ path: path.join(output, 'picker-open.png'), fullPage: true })
  pass('名单每行头像 + 昵称，缺头像用默认头像')

  // ③ 搜索
  await ruleInput.fill('大')
  await page.waitForTimeout(100)
  const hits = await page.evaluate(() => [...document.querySelectorAll('[data-viewer-option]')].map((b) => b.dataset.viewerOption + '#' + b.dataset.viewerUid))
  assert.deepEqual(hits, ['大哥#10001', '大哥#10002'], `打字过滤，实际 ${hits.join('，')}`)
  await ruleInput.fill('10002')
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-viewer-option]')].map((b) => b.dataset.viewerUid)), ['10002'], '也能按观众 id 搜')
  await ruleInput.fill('不存在的人')
  await page.locator('[data-viewer-nomatch]').waitFor()
  pass('打字即搜索（昵称 / 观众 id），搜不到有提示且手填照旧')

  // ④ 重名两条都在、带 id 尾号；选中写 name/avatar/uid
  await ruleInput.fill('大哥')
  await page.waitForTimeout(100)
  const tails = await page.evaluate(() => [...document.querySelectorAll('[data-viewer-option]')].map((b) => b.textContent.match(/#\d{4}/)?.[0]))
  assert.deepEqual(tails, ['#0001', '#0002'], '重名各带 id 尾号')
  await page.locator('[data-viewer-option][data-viewer-uid="10001"]').click()
  await page.waitForTimeout(100)
  const last = await page.evaluate(() => window.qa.configure.at(-1))
  const r1 = last.rules[0]
  assert.equal(r1.name, '大哥')
  assert.equal(r1.avatar, 'F:/fixture/dage1.png', '选中的头像一起写进规则')
  assert.equal(r1.uid, '10001', '选中的观众 id 一起写进规则')
  assert.equal(r1.dedupeSeconds, 60, '规则其它字段不动')
  assert.equal(await page.locator('[data-viewer-list]').count(), 0, '选完名单收起')
  assert.equal(await page.locator('[data-viewer-picker]').last().locator('[data-viewer-avatar="image"]').count(), 1, '输入框旁显示选中的头像')
  pass('重名按 id 区分，选中后昵称/头像/id 一起写进规则')

  // ⑤ 手改昵称 → 头像/id 清掉
  await ruleInput.fill('大哥哥')
  await page.waitForTimeout(100)
  const edited = (await page.evaluate(() => window.qa.configure.at(-1))).rules[0]
  assert.equal(edited.name, '大哥哥')
  assert.ok(!edited.avatar && !edited.uid, `手改昵称后头像/id 要清掉，实际 avatar=${edited.avatar} uid=${edited.uid}`)
  await page.keyboard.press('Escape')
  pass('手改昵称后头像与 id 清掉，不张冠李戴')

  // ⑦ 试一试选人带头像
  // 2026-09-13：带 ZWJ 表情的昵称（用户实测「飞鸟🐦‍⬛…」在主窗口是一串空方块）→ 下拉行里 emoji 贴成图（img.emo，走 zlmedia 协议），文字部分仍在
  await page.evaluate(() => { window.qa.viewers.push({ name: '飞鸟🐦‍⬛🦅', lastSeen: Date.now(), seen: 4 }) })
  await page.keyboard.press('Escape')
  await ruleInput.click()
  const birdRow = page.locator('[data-viewer-option*="飞鸟"]').first()
  await birdRow.waitFor({ timeout: 5000 })
  const birdEmo = await birdRow.locator('img.emo').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')))
  assert.equal(birdEmo.length, 2, `飞鸟行应贴 2 张 emoji 图：${JSON.stringify(birdEmo)}`)
  assert.ok(birdEmo.every((src) => src.startsWith('zlmedia://local/') && src.endsWith('.png')), `emoji 图应走 zlmedia 协议：${JSON.stringify(birdEmo)}`)
  assert.ok((await birdRow.textContent()).includes('飞鸟'), '文字部分仍在')
  pass('带 ZWJ 表情的昵称在下拉里贴成 Twemoji 图', birdEmo.map((s) => s.split('/').pop()).join(','))
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.qa.viewers.pop() })
  const testInput = page.getByRole('combobox', { name: '试一试观众' })
  await testInput.click()
  await page.locator('[data-viewer-list]').waitFor()
  await testInput.fill('阿')
  await page.waitForTimeout(100)
  await page.locator('[data-viewer-option="阿彪"]').click()
  await page.getByRole('button', { name: /模拟进场/ }).click()
  await page.waitForFunction(() => window.qa.tests.length === 1)
  assert.deepEqual(await page.evaluate(() => window.qa.tests[0]), { name: '阿彪', avatar: 'F:/fixture/abiao.png' }, '试一试把选中的头像一起发给主进程')
  pass('试一试选人后模拟进场带头像')

  // ⑥ 名单为空：引导一句，手填照旧
  await page.evaluate(() => { window.qa.viewers = [] })
  await page.keyboard.press('Escape')
  await ruleInput.click()
  await page.locator('[data-viewer-empty]').waitFor()
  const emptyText = await page.locator('[data-viewer-empty]').textContent()
  assert.match(emptyText, /连接直播间/, '空名单要告诉主播怎么才会有人')
  assert.ok(!/粉丝列表|授权|服务/.test(emptyText), '不冒充粉丝列表、不露内部信息')
  await ruleInput.fill('手填的人')
  await page.waitForTimeout(100)
  assert.equal((await page.evaluate(() => window.qa.configure.at(-1))).rules[0].name, '手填的人', '空名单时手填照旧写进规则')
  await page.screenshot({ path: path.join(output, 'picker-empty.png'), fullPage: true })
  pass('空名单给可操作引导，手填照旧')

  assert.deepEqual(errors, [], '页面不该有报错')
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await browser.close()
  console.log(`SUMMARY ${checks.length}/7 PASS` + (failure ? ' (有失败)' : ''))
}
if (failure) process.exitCode = 1

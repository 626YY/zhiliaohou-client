// 真实「直播互动统计」页 UI 回归：用 esbuild 把 Stats.tsx 打成浏览器包、喂受控的 window.api，
// 验礼物记录/送礼榜/空态/清空确认弹窗都对（不进 Electron，秒级）。
//   2026-09-07 用户：「客户端里面也要有礼物记录的」——这页新加了礼物记录与送礼榜两块，
//   本文件锁住：谁送了什么按时间倒序列出、礼物图出得来、送礼榜按抖币排序、清空要先确认。
// 用法：node tools/test-stats-ui.mjs   （需要先 npm run build 生成 out/renderer/assets 的样式）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/playwright/stats-ui')
await fs.mkdir(output, { recursive: true })

const now = Date.now()
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
import Stats from './src/renderer/src/pages/Stats';
import {useToast} from './src/renderer/src/stores/ui';
localStorage.setItem('zl-theme','dark'); document.documentElement.dataset.theme='dark';
const NOW = ${now};
window.qa = {clearCalls:0, limits:[], log:{
  rows:[
    {ts:NOW-1000,  sender:'榜一大哥', gift:'火箭',   count:1, coins:6000, image:''},
    {ts:NOW-60000, sender:'阿彪',     gift:'小心心', count:3, coins:3,    image:'C:/fixture/小心心.png'},
    {ts:NOW-90000, sender:'',         gift:'玫瑰',   count:2, coins:20,   image:''},
    {ts:NOW-95000, sender:'测试',     gift:'甜甜圈', count:1, coins:52,   image:'', sim:true}
  ],
  senders:[
    {sender:'榜一大哥', gifts:1, coins:6000, last:NOW-1000},
    {sender:'',         gifts:2, coins:20,   last:NOW-90000},
    {sender:'阿彪',     gifts:3, coins:3,    last:NOW-60000}
  ],
  kept:4, total:7, totalCoins:6075
}};
window.toasts = () => useToast.getState().toasts;
window.api = {
  liveStats: async () => ({ok:true, remotePranks:2, session:{room:'577117602', started:Math.floor(NOW/1000)-3600, last:Math.floor(NOW/1000), gifts:6, coins:6023, likes:12, follows:2, running:1}, board:{ts:0, cells:[]}}),
  giftLogState: async (limit) => {window.qa.limits.push(limit); return window.qa.log},
  giftLogClear: async () => {window.qa.clearCalls++; window.qa.log={rows:[],senders:[],kept:0,total:0,totalCoins:0}; return {ok:true, cleared:4}},
  onGiftLogChanged: (cb) => {window.pushLog = (next) => cb(next); return () => {window.pushLog = undefined}}
};
createRoot(document.getElementById('root')).render(<MemoryRouter><Stats/></MemoryRouter>);
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://zl-stats.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
  await page.goto('https://zl-stats.test/')
  const assets = path.join(root, 'out/renderer/assets')
  const css = (await fs.readdir(assets)).find((n) => n.startsWith('index-') && n.endsWith('.css'))
  if (css) await page.addStyleTag({ content: await fs.readFile(path.join(assets, css), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  // ① 礼物记录：按时间倒序，谁送了什么/几个/多少抖币都在
  await page.getByText('礼物记录', { exact: true }).waitFor()
  const rows = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')]
    const head = tables.find((t) => t.querySelector('thead')?.textContent?.includes('送礼人'))
    return [...(head?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
  })
  assert.equal(rows.length, 4, `礼物记录应有 4 条，实际 ${rows.length}`)
  assert.deepEqual(rows.map((r) => r[1]), ['榜一大哥', '阿彪', '未知观众', '测试'], '送礼人一列（空昵称显示未知观众）')
  const giftNames = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')]
    const head = tables.find((t) => t.querySelector('thead')?.textContent?.includes('送礼人'))
    // 礼物名读 title（无图时格子里还有个装饰性首字徽标，textContent 会是「火火箭」）
    return [...(head?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelectorAll('td')[2].querySelector('[title]')?.getAttribute('title'))
  })
  assert.deepEqual(giftNames, ['火箭', '小心心', '玫瑰', '甜甜圈'], '礼物名一列')
  assert.deepEqual(rows.map((r) => r[3]), ['1', '3', '2', '1'], '个数一列')
  assert.deepEqual(rows.map((r) => r[4]), ['6,000', '3', '20', '52'], '抖币一列（千分位）')
  pass('礼物记录列出谁送了什么/几个/多少抖币')

  // ② 礼物图出得来（走 zlmedia 协议），没有图的用首字兜底
  const imgs = await page.evaluate(() => [...document.querySelectorAll('table img')].map((i) => i.getAttribute('src')))
  assert.equal(imgs.length, 1, `只有一条记录带图，实际 ${imgs.length}`)
  assert.match(imgs[0], /^zlmedia:\/\/local\//, '礼物图要走 zlmedia 协议，写 file:// 会被安全策略拦掉')
  pass('礼物图走 zlmedia 协议渲染')

  // ②b 模拟事件造出来的礼物要带「模拟」标记（否则调试假礼物混在记录里看不出来）
  const simMarks = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')]
    const head = tables.find((t) => t.querySelector('thead')?.textContent?.includes('送礼人'))
    return [...(head?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelectorAll('td')[2].textContent.includes('模拟'))
  })
  assert.deepEqual(simMarks, [false, false, false, true], '只有模拟那条带「模拟」标记')
  pass('模拟礼物带「模拟」标记')

  // ③ 汇总角标 + 送礼榜按抖币从高到低
  // 别用 /抖币$/ 找角标：「礼物抖币」那个 Stat 标签也以抖币结尾，会先命中
  assert.match(await page.getByText(/个 · [\d,]+ 抖币/).first().textContent(), /7 个 · 6,075 抖币/, '角标要给礼物总个数和总抖币')
  const board = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')]
    const t = tables.find((x) => x.querySelector('thead')?.textContent?.includes('名次'))
    return [...(t?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
  })
  assert.deepEqual(board.map((r) => r[1]), ['榜一大哥', '未知观众', '阿彪'], '送礼榜按抖币从高到低')
  assert.deepEqual(board.map((r) => r[3]), ['6,000', '20', '3'], '送礼榜抖币列')
  pass('送礼榜按抖币排序')

  // ④ 主进程推送新记录，页面即时跟上（不靠 3 秒轮询）
  await page.evaluate(() => window.pushLog({
    rows: [{ ts: Date.now(), sender: '新来的', gift: '嘉年华', count: 1, coins: 30000, image: '' }, ...window.qa.log.rows],
    senders: [{ sender: '新来的', gifts: 1, coins: 30000, last: Date.now() }, ...window.qa.log.senders],
    kept: 4, total: 7, totalCoins: 36023
  }))
  await page.getByText('嘉年华', { exact: true }).waitFor({ timeout: 3000 })
  pass('主进程推送新礼物页面即时跟上')

  // ⑤ 清空要先确认，取消不掉数据
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByText('清空礼物记录', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.evaluate(() => window.qa.clearCalls), 0, '点取消不该真清')
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByText(/将删除本机保存的全部/).waitFor()
  await page.locator('button', { hasText: '清空' }).last().click()
  await page.waitForFunction(() => window.qa.clearCalls === 1)
  await page.getByText(/暂无礼物记录/).waitFor({ timeout: 3000 })
  assert.match(await page.evaluate(() => window.toasts().at(-1).text), /已清空 4 条/, '清空后要有提示')
  pass('清空先确认、确认后清干净并提示')

  await page.screenshot({ path: path.join(output, 'stats-after-clear.png'), fullPage: true })
  assert.equal(await page.evaluate(() => window.qa.limits.every((l) => l === 200)), true, '取明细固定 200 条上限')
  assert.deepEqual(errors, [], '页面不该有报错')
} catch (error) {
  failure = String(error.stack || error)
  console.error('FAIL ' + failure)
} finally {
  await browser.close()
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, failure }, null, 2))
}
console.log(`直播统计页 UI 回归：${checks.length}/6 PASS` + (failure ? ' (有失败)' : ''))
console.log('Evidence: ' + output)
if (failure) process.exitCode = 1

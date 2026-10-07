// 特色整蛊 × 整蛊器 融合的界面回归：真实 React 页面 + 假 window.api，Edge 无头跑（不起客户端、不连服务器）。
// 覆盖：
//   整蛊遥控  ① 只管游戏：没有特色整蛊分组 / 盲盒按钮 / 「特色整蛊」字样（2026-10-07 用户要求分开）
//             ② 礼物联动下拉只有游戏整蛊；整蛊台建的特色整蛊礼物规则不列在这里
//             ③ 游戏整蛊的 GiftMap 绑定照旧（保存时写 config）
//             ④ 模拟观众：没开游戏也能点，送礼走客户端事件（礼物触发 / 特色整蛊响应），游戏没开不发 bridge
//   礼物触发  ⑤ 动作类型「特色整蛊」「游戏整蛊」各一格，保存出 special-play / game-prank
// 用法：npx electron-vite build --outDir output/special-build（取样式）&& node tools/test-remote-special-ui.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output', 'playwright', 'remote-special-ui')
await fs.mkdir(output, { recursive: true })
const cssDir = ['output/special-build/renderer/assets', 'out/renderer/assets'].map((d) => path.join(root, d))

const source = `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import PrankControl from './src/renderer/src/pages/PrankControl';
  import Rules from './src/renderer/src/pages/EntertainmentGiftRules';
  import { usePrankStore } from './src/renderer/src/stores/pranks';
  import { ConfigurationProvider, ExpandedConfiguration } from './src/renderer/src/lib/configurationLevel';
  import { DEFAULT_SPECIAL_WINDOW, defaultSpecialBoxEvents } from './src/shared/specialGames';
  window.calls = []; window.rules = window.__SEED_RULES || [];
  const log = (kind, ...args) => { window.calls.push({ kind, args }); };
  const impl = {
    gamesList: async () => [{ id: '4wheel-challenge', name: '轮椅模拟器', appid: '1', installed: true }],
    session: async () => ({ email: '' }),
    getSettings: async () => ({ settings: { currentGameId: '4wheel-challenge', guideSeen: true } }),
    setGameCurrent: async () => ({ ok: true }),
    readConfig: async () => ({ ok: true, values: { GiftMap: { '保时捷': 'flip' }, Binds: {}, CustomBoxes: [] } }),
    saveConfig: async (patch) => { log('saveConfig', patch); return { ok: true } },
    readPranks: async () => ({ defaults: { binds: {} } }),
    liveState: async () => ({ running: false, bridgeOk: false }),
    liveCmd: async (cmd) => { log('liveCmd', cmd); return { ok: true } },
    statsPrankTick: () => log('statsPrankTick'),
    specialTest: async (id, action) => { log('specialTest', id, action); return { ok: true } },
    specialBoxEvents: async () => defaultSpecialBoxEvents(),
    specialBoxEventsSave: async (events) => { log('boxEventsSave', events); return { ok: true, events } },
    specialBoxDraw: async (param) => { log('specialBoxDraw', param); return { ok: true, opened: ['抓鸭子 +7只'] } },
    specialState: async () => ({ games: [], window: { ...DEFAULT_SPECIAL_WINDOW, open: false }, assetDir: '' }),
    connectorSimulate: async (line) => { log('simulate', line); return { ok: true } },
    prankCatalog: async () => ({}),
    entertainmentRulesList: async () => window.rules.map((r) => ({ ...r })),
    entertainmentRuleAdd: async (r) => { const id = 'r' + (window.rules.length + 1); window.rules.push({ ...r, id }); log('ruleAdd', r); return { ok: true, id } },
    entertainmentRuleUpdate: async (r) => { const i = window.rules.findIndex((x) => x.id === r.id); if (i >= 0) window.rules[i] = { ...r }; log('ruleUpdate', r); return { ok: true } },
    entertainmentRuleRemove: async (id) => { window.rules = window.rules.filter((x) => x.id !== id); log('ruleRemove', id); return { ok: true } },
    queueState: async () => ({ config: null, open: false, snapshot: { running: null, pending: [] } }),
    obsState: async () => ({ connection: { connected: false }, filters: [], scenes: { scenes: [] } }),
    selectFile: async () => ({ ok: false })
  };
  // 没写到的接口：on* 返回退订函数，其它返回成功
  window.api = new Proxy(impl, { get: (t, k) => (k in t ? t[k] : (String(k).startsWith('on') ? () => () => {} : async () => ({ ok: true }))) });
  usePrankStore.setState({ loaded: true, catalog: { '4wheel-challenge': [
    { id: 'car', name: '车辆', items: [ { id: 'flip', name: '翻车' }, { id: 'boost', name: '加速' }, { id: 'quit', name: '退出游戏', danger: true } ] }
  ] } });
  const view = window.__VIEW || 'remote';
  // 基础 / 高级模式：about:blank 里读不到 localStorage，ConfigurationProvider 就落到「基础」；高级用 ExpandedConfiguration 强制
  const page = <MemoryRouter>{view === 'remote' ? <PrankControl /> : <Rules />}</MemoryRouter>;
  createRoot(document.getElementById('root')).render(
    view === 'wizard' ? <ConfigurationProvider>{page}</ConfigurationProvider> : <ConfigurationProvider><ExpandedConfiguration>{page}</ExpandedConfiguration></ConfigurationProvider>
  );
`
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@shared': path.join(root, 'src/shared') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' })
let css = ''
for (const dir of cssDir) {
  const name = (await fs.readdir(dir).catch(() => [])).find((n) => n.startsWith('index-') && n.endsWith('.css'))
  if (name) { css = await fs.readFile(path.join(dir, name), 'utf8'); break }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
let passed = 0
const ok = (m) => { passed++; console.log('PASS ' + m) }
const calls = (page, kind) => page.evaluate((k) => window.calls.filter((c) => c.kind === k), kind)
async function open(view, seedRules = []) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<html><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>')
  await page.evaluate(({ v, seed }) => { window.__VIEW = v; window.__SEED_RULES = seed }, { v: view, seed: seedRules })
  if (css) await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return { page, errors }
}

try {
  // ================= 整蛊遥控 =================
  // 预置一条整蛊台那边建的特色整蛊礼物规则：游戏的礼物联动里不该列出来
  const { page, errors } = await open('remote', [{ id: 'sp1', name: '特色整蛊·锁链特效', group: '特色整蛊', giftName: '小心心', triggerType: 'gift', actionType: 'command', commandCmd: 'special-play', commandParam: 'chain_challenge|add|5', times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true }])
  await page.getByText('整蛊遥控', { exact: true }).waitFor({ timeout: 15_000 })
  // ① 整蛊遥控只管游戏（2026-10-07 用户：「游戏是游戏的，整蛊台是整蛊台的，不应该混淆」）：
  //    没有特色整蛊分组 / 盲盒抽一次按钮，礼物联动下拉里没有特色整蛊和盲盒，已有的特色整蛊礼物规则不列在这里
  const body = await page.locator('body').innerText()
  assert.ok(!/叠在直播画面上|盲盒抽一次|特色整蛊/.test(body), '整蛊遥控页不该出现特色整蛊：' + (body.match(/.{0,20}(叠在直播画面上|盲盒抽一次|特色整蛊).{0,20}/)?.[0] ?? ''))
  assert.equal(await page.getByRole('button', { name: '粉丝来电', exact: true }).count(), 0, '不该有特色整蛊玩法按钮')
  ok('① 整蛊遥控页没有特色整蛊分组、盲盒按钮和「特色整蛊」字样')

  const giftInput = page.getByPlaceholder('礼物名（如 保时捷）')
  const prankSelect = page.locator('select').filter({ has: page.locator('option[value="flip"]') }).first()
  assert.equal(await prankSelect.locator('option[value="specialbox"], option[value^="special:"]').count(), 0, '礼物联动下拉里不该有特色整蛊 / 盲盒')
  assert.equal(await prankSelect.locator('optgroup[label*="特色整蛊"]').count(), 0)
  ok('② 礼物联动下拉里只有游戏整蛊（没有特色整蛊 / 盲盒）')

  // 已有的特色整蛊礼物规则（在整蛊台那边建的，开页前就预置了）不出现在游戏的礼物联动列表里
  await page.waitForTimeout(300)
  assert.equal(await page.getByRole('button', { name: '解绑 小心心' }).count(), 0, '特色整蛊的礼物规则不该列在游戏礼物联动里')
  ok('② 整蛊台里建的特色整蛊礼物规则不列在游戏的礼物联动里')

  // ③ 游戏整蛊的 GiftMap 照旧
  await giftInput.fill('跑车')
  await prankSelect.selectOption('flip')
  await page.getByRole('button', { name: '绑定', exact: true }).click()
  await page.getByRole('button', { name: /保存绑定/ }).click()
  await page.waitForTimeout(150)
  const saved = (await calls(page, 'saveConfig')).at(-1)?.args?.[0]
  assert.deepEqual(saved?.GiftMap, { '保时捷': 'flip', '跑车': 'flip' })
  assert.equal((await calls(page, 'ruleAdd')).length, 0, '游戏礼物联动不该建整蛊台的礼物规则')
  ok('③ 游戏整蛊绑定照旧写 GiftMap（保时捷、跑车 → 翻车），不碰整蛊台的礼物规则')
  await page.screenshot({ path: path.join(output, 'remote-linked.png'), fullPage: true })

  // ④ 模拟观众
  const simSection = page.locator('section', { has: page.locator('h3', { hasText: '模拟观众' }) })
  const firstGift = simSection.locator('div.grid').first().getByRole('button').first() // 第一排是礼物数量 1/5/10，礼物按钮在网格里
  assert.equal(await firstGift.isDisabled(), false, '没开游戏时模拟观众也应能点')
  const giftLabel = (await firstGift.innerText()).trim()
  await firstGift.click()
  await page.waitForTimeout(150)
  const sim = (await calls(page, 'simulate')).at(-1)?.args?.[0]
  assert.equal(sim, `礼物: ${giftLabel} ×1  by 模拟观众`)
  assert.equal((await calls(page, 'liveCmd')).filter((c) => String(c.args[0]).startsWith('gift')).length, 0, '游戏没开时不该往 bridge 发模拟礼物')
  await simSection.getByRole('button', { name: '关注', exact: true }).click()
  await page.waitForTimeout(100)
  assert.equal((await calls(page, 'simulate')).at(-1)?.args?.[0], '关注 by 模拟观众')
  ok(`④ 模拟观众没开游戏也能点：「${giftLabel}」→ 客户端事件（整蛊台的礼物触发响应），不发 bridge`)
  await page.screenshot({ path: path.join(output, 'remote.png'), fullPage: true })
  assert.deepEqual(errors, [], '整蛊遥控页面报错：' + errors.join(' | '))
  await page.close()

  // ================= 礼物触发：特色整蛊 / 游戏整蛊 两种动作 =================
  const r = await open('rules')
  await r.page.getByRole('button', { name: /新增规则/ }).first().click()
  const dialog = r.page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByPlaceholder('如：火箭 / 小心心').fill('火箭')
  const a0 = dialog.getByTestId('action-0')
  await a0.getByRole('button', { name: '游戏整蛊', exact: true }).click()
  const save = dialog.getByRole('button', { name: '保存', exact: true })
  assert.equal(await save.isDisabled(), true, '没选游戏整蛊时不能保存')
  await a0.getByLabel('游戏整蛊').last().selectOption('4wheel-challenge|flip')
  assert.equal(await a0.locator('option[value="4wheel-challenge|quit"]').count(), 0, '危险整蛊不该出现在礼物规则里')
  // 第二个动作：特色整蛊
  await dialog.getByRole('button', { name: /添加动作/ }).click()
  const a1 = dialog.getByTestId('action-1')
  await a1.getByRole('button', { name: '特色整蛊', exact: true }).click()
  await a1.getByLabel('特色整蛊玩法').selectOption('catch_duck')
  await a1.getByRole('button', { name: '固定数量', exact: true }).click()
  await a1.getByLabel('特色整蛊数量', { exact: true }).fill('8')
  await r.page.screenshot({ path: path.join(output, 'rule-editor.png'), fullPage: true })
  await save.click()
  await r.page.waitForTimeout(200)
  const rule = (await r.page.evaluate(() => window.rules))[0]
  assert.equal(rule.commandCmd, 'game-prank')
  assert.equal(rule.commandParam, '4wheel-challenge|flip|翻车')
  assert.equal(rule.extraActions?.[0]?.commandCmd, 'special-play')
  assert.equal(rule.extraActions?.[0]?.commandParam, 'catch_duck|add|8')
  await r.page.getByText('游戏整蛊 翻车 → 特色整蛊 抓鸭子 +8只').first().waitFor({ timeout: 5000 })
  ok('⑤ 礼物触发一条规则：游戏整蛊「翻车」+ 特色整蛊「抓鸭子 +8」，列表摘要正确')
  // 「盲盒随机」：特色整蛊下切到盲盒，选一个
  await r.page.getByRole('button', { name: /新增规则/ }).first().click()
  const d2 = r.page.getByRole('dialog')
  await d2.getByPlaceholder('如：火箭 / 小心心').fill('玫瑰')
  const b0 = d2.getByTestId('action-0')
  await b0.getByRole('button', { name: '特色整蛊', exact: true }).click()
  await b0.getByRole('button', { name: '盲盒随机', exact: true }).click()
  await b0.locator('[data-testid="special-box-pool"]').waitFor({ timeout: 5000 })
  await b0.getByRole('button', { name: '清空选择' }).click()
  await b0.getByRole('button', { name: '展开 抓鸭子', exact: true }).click()
  await b0.getByRole('button', { name: '展开 扔粑粑', exact: true }).click()
  await b0.getByRole('checkbox', { name: '抽奖事件 抓鸭子 +5只', exact: true }).click()
  await b0.getByRole('checkbox', { name: '抽奖事件 扔粑粑 +5个', exact: true }).click()
  await b0.getByLabel('盲盒名字').fill('玫瑰盲盒')
  await r.page.screenshot({ path: path.join(output, 'rule-editor-box.png'), fullPage: true })
  await d2.getByRole('button', { name: '保存', exact: true }).click()
  await r.page.waitForTimeout(200)
  const boxed = (await r.page.evaluate(() => window.rules)).find((x) => x.giftName === '玫瑰')
  assert.equal(boxed.commandCmd, 'special-box')
  assert.equal(boxed.commandParam, 'sbe-v-catch_duck-add-5,sbe-v-throw_poop-add-5|玫瑰盲盒')
  await r.page.getByText('特色整蛊盲盒「玫瑰盲盒」（2 选 1）').first().waitFor({ timeout: 5000 })
  ok('⑥ 礼物触发「特色整蛊 → 盲盒随机」：清空后勾「抓鸭子」「扔粑粑」两个事件，列表摘要「玫瑰盲盒（2 选 1）」')
  assert.deepEqual(r.errors, [], '礼物触发页面报错：' + r.errors.join(' | '))

  // ================= 基础模式：礼物互动向导里的特色整蛊 / 盲盒 =================
  const w = await open('wizard')
  await w.page.getByRole('button', { name: /新增规则/ }).first().click()
  const wd = w.page.getByRole('dialog')
  await wd.getByRole('button', { name: '特色整蛊', exact: true }).waitFor({ timeout: 10_000 })
  assert.ok(await wd.getByRole('button', { name: '游戏整蛊', exact: true }).count(), '向导第一步应有「游戏整蛊」')
  await w.page.screenshot({ path: path.join(output, 'wizard-kinds.png'), fullPage: true })
  await wd.getByRole('button', { name: '特色整蛊', exact: true }).click()
  await wd.getByRole('radio', { name: '抓鸭子', exact: true }).click()
  assert.equal(await wd.getByLabel('特色整蛊数量最少').inputValue(), '5', '默认随机范围下限')
  assert.equal(await wd.getByLabel('特色整蛊数量最多').inputValue(), '15', '默认随机范围上限')
  await w.page.screenshot({ path: path.join(output, 'wizard-special.png'), fullPage: true })
  await wd.getByRole('button', { name: '下一步' }).click()
  await wd.getByRole('button', { name: '跳过，不加新动作' }).click()
  await wd.getByRole('button', { name: '小心心', exact: true }).click()
  await wd.getByRole('button', { name: '下一步' }).click()
  await wd.getByText('特色整蛊：抓鸭子 +5~15只').waitFor({ timeout: 5000 })
  await wd.getByRole('button', { name: '完成并启用' }).click()
  await wd.getByTestId('setup-question').filter({ hasText: '设置完成' }).waitFor()
  const wr = (await w.page.evaluate(() => window.rules)).at(-1)
  assert.equal(wr.commandCmd, 'special-play')
  assert.equal(wr.commandParam, 'catch_duck|add|5~15')
  assert.equal(wr.queueMode, 'instant')
  assert.equal(wr.group, '特色整蛊')
  ok('⑦ 基础向导：特色整蛊 → 抓鸭子（默认随机 5~15）→ 小心心 → 存成即时执行的礼物规则')
  await wd.getByRole('button', { name: '返回规则列表' }).click()
  // 盲盒
  await w.page.getByRole('button', { name: /新增规则/ }).first().click()
  const wd2 = w.page.getByRole('dialog')
  await wd2.getByRole('button', { name: '特色整蛊', exact: true }).click()
  await wd2.getByRole('radio', { name: '盲盒随机' }).click()
  await wd2.locator('[data-testid="special-box-pool"]').waitFor({ timeout: 5000 })
  const LIB2 = await w.page.evaluate(() => window.api.specialBoxEvents().then((l) => l.length))
  await wd2.getByText(`抽奖事件 · 已选 ${LIB2} 项`).waitFor({ timeout: 5000 })
  await wd2.getByRole('button', { name: '展开 锁链特效', exact: true }).click()
  await wd2.getByRole('checkbox', { name: '抽奖事件 锁链特效 +1环', exact: true }).click()
  await w.page.screenshot({ path: path.join(output, 'wizard-box.png'), fullPage: true })
  await wd2.getByRole('button', { name: '下一步' }).click()
  await wd2.getByRole('button', { name: '跳过，不加新动作' }).click()
  await wd2.getByRole('button', { name: '鲜花', exact: true }).click()
  await wd2.getByRole('button', { name: '下一步' }).click()
  await wd2.getByRole('button', { name: '完成并启用' }).click()
  await wd2.getByTestId('setup-question').filter({ hasText: '设置完成' }).waitFor()
  const wb = (await w.page.evaluate(() => window.rules)).at(-1)
  assert.equal(wb.commandCmd, 'special-box')
  assert.equal(wb.commandParam.split(',').length, LIB2 - 1, `去掉「锁链 +1」后奖池应剩 ${LIB2 - 1} 个：${wb.commandParam}`)
  assert.ok(!wb.commandParam.split('|')[0].split(',').includes('sbe-v-chain_challenge-add-1'))
  ok('⑧ 基础向导：特色整蛊 → 盲盒随机（默认全勾，去掉「锁链 +1」）→ 鲜花 → special-box 礼物规则')
  assert.deepEqual(w.errors, [], '向导页面报错：' + w.errors.join(' | '))
} catch (e) {
  console.log('FAIL ' + e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
console.log(`\nREMOTE × SPECIAL UI: ${passed} PASS${process.exitCode ? '，有失败' : ''}  截图：${output}`)

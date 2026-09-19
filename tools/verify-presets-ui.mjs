// 项目分组开关 + 项目预设 + 透明图从规则生成 + 时间插件分组/导出导入 —— 真界面端到端
// （2026-09-08 用户：「不同直播可能是不同的预设方案，主播可以存可以选，也可以导出配置文件」
//   「时间插件也要做项目规划预设开关规划。导出导入设置」
//   「透明图那边还是只有从游戏配置生成，没有从启动规则方案处生成…透明图那边也是读预设就好了」）
//
// ★断言一律看【页面上真的显示了什么】。上一轮「盲盒事件库 0」就是因为我只验了主进程内存，
//   而页面读的是渲染进程 localStorage —— 测试全绿、用户一点就是 0。
//
// 覆盖：
//   一·礼物规则
//     ① 导入品游项目后，列表按项目分组显示，组标题写着 N 条未绑礼物
//     ② 绑了礼物后点组开关 → 组标题变 2/2 启用，规则上的「停用」标记消失
//     ③ 存成预设 → 把另一个项目也打开 → 选回预设 → 只有预设里的项目是开的
//     ④ 「导出配置」导出的 JSON 里带着 presets（换台电脑能带走）
//     ⑤ 导入那份 JSON：规则和预设都回来了
//   二·透明图
//     ⑥ 「从礼物规则生成」只出【当前启用】项目的礼物（预设关掉的项目不出现）
//   三·时间插件
//     ⑦ 导入时间项目后事件库按项目分组，每组一个开关
//     ⑧ 关掉一个项目 → 页面显示「整组停用」，localStorage 里那组 enabled=false
//     ⑨ 「导出设置」带 config+plans，「导入设置」能把整套读回来
// 用法：node tools/verify-presets-ui.mjs（先 npm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { writeHiddenElectronBootstrap } from './electron-test-bootstrap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'output', 'playwright', 'presets-ui')
const passed = []
const pass = (n, d = '') => { passed.push(n); console.log('PASS ' + n + (d ? ' | ' + d : '')) }

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// ---- 夹具素材库：两个条目类项目 + 两个时间类项目 ----
const lib = path.join(out, 'assets')
const { default: iconv } = await import('iconv-lite')
const mkProject = async (name, items) => {
  const dir = path.join(lib, name)
  await fs.mkdir(dir, { recursive: true })
  for (const [item, script] of items) {
    await fs.writeFile(path.join(dir, `${item}.mp4`), Buffer.from('zl-test'))
    if (script) await fs.writeFile(path.join(dir, `${item}.脚本`), iconv.encode(script, 'gbk'))
  }
}
await mkProject('甲项目', [['甲一', '键盘操作:锁定WSAD'], ['甲二', null]])
await mkProject('乙项目', [['乙一', '键盘操作:锁定WSAD'], ['乙二', null]])
await mkProject('时间甲', [['时甲加', '加班增加:60秒'], ['时甲减', '加班减少:60秒']])
await mkProject('时间乙', [['时乙倍', '加班乘以:2'], ['时乙半', '加班除以:2']])

const profile = await fs.mkdtemp(path.join(out, 'session-'))
await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'settings.json'), JSON.stringify({ guideSeen: true, pinyouAssetRoot: lib }))
const entry = await writeHiddenElectronBootstrap(root, profile, { isolateGames: false })
const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [entry, `--user-data-dir=${profile}`, '--no-sandbox'], cwd: root, env, timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.api?.entertainmentPresetList && window.api?.login), null, { timeout: 30_000 })
  const login = await page.evaluate(async () => {
    await window.api.register('entertainment_regression', 'Fixture123!', '娱乐助手回归')
    const r = await window.api.login('entertainment_regression', 'Fixture123!')
    await window.api.saveSettings({ guideSeen: true, autoLogin: false })
    localStorage.setItem('zl-guide-seen', '1')
    return r
  })
  assert.equal(login.ok, true, login.error || '夹具账号登录失败')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 20_000 })

  // 干净起点
  await page.evaluate(async () => {
    for (const r of await window.api.entertainmentRulesList()) await window.api.entertainmentRuleRemove(r.id)
    for (const p of (await window.api.entertainmentPresetList()).presets) await window.api.entertainmentPresetRemove(p.id)
    localStorage.removeItem('ent_time_cfg')
    localStorage.removeItem('ent_time_plans')
  })

  // 导出用：拦下 blob，别真去下载（会弹保存框）
  const armDownloadTrap = () => page.evaluate(() => {
    if (window.__zlTrapped) return
    window.__zlTrapped = true
    window.__zlBlobs = []
    const origCreate = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { window.__zlBlobs.push(blob); return origCreate(blob) }
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__zlDownload = this.download; return }
      return origClick.call(this)
    }
  })
  const lastExport = () => page.evaluate(async () => {
    const blob = window.__zlBlobs?.[window.__zlBlobs.length - 1]
    return blob ? JSON.parse(await blob.text()) : null
  })
  // 往隐藏的 file input 里塞一个文件，走真正的 onChange 导入分支
  const feedFile = (selector, payload, name) => page.evaluate(({ selector, payload, name }) => {
    const input = document.querySelector(selector)
    if (!input) throw new Error('找不到文件输入框：' + selector)
    const file = new File([JSON.stringify(payload)], name, { type: 'application/json' })
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { selector, payload, name })

  // ★隐藏窗口里【不能】往挂着 datalist 的输入框打字：窗口是 show:false 建起来的，
  //   Chromium 要弹原生候选框时没地方挂，整个 Electron 直接 0xC0000005 崩掉。
  //   正常客户端里打字没事（tools/probe-datalist-real.mjs 实测过），所以这里只是把
  //   候选框摘掉再打字，测的仍是真实的 React 处理逻辑。
  const stripDatalists = () => page.evaluate(() => {
    document.querySelectorAll('input[list]').forEach((el) => el.removeAttribute('list'))
  })

  const gotoRules = async () => {
    for (let i = 0; i < 5; i++) {
      if (await page.getByRole('button', { name: '导入项目', exact: true }).count()) return
      // 娱乐助手记着上次进的子页，先「返回功能列表」才看得到卡片
      const back = page.getByRole('button', { name: '返回功能列表' }).first()
      if (await back.count()) { await back.click().catch(() => {}); await page.waitForTimeout(800) }
      const card = page.getByText('礼物触发', { exact: true }).first()
      if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(900); continue }
      await page.evaluate(() => { window.location.hash = '#/ent' })
      await page.waitForTimeout(800)
    }
    assert.fail('进不到礼物触发页')
  }
  const groupHeader = (name) => page.locator(`[aria-label="项目 ${name}"]`).first()
  const headerText = async (name) => (await groupHeader(name).innerText()).replace(/\s+/g, ' ').trim()

  // ================= 一·礼物规则 =================
  await page.evaluate(() => { window.location.hash = '#/ent' })
  await page.waitForTimeout(600)
  await gotoRules()
  await armDownloadTrap()

  // ① 按条目导入两个项目 → 列表按项目分组
  await page.getByRole('button', { name: '导入项目', exact: true }).click()
  await page.getByText('导入方式').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '每个视频一条规则' }).click()
  // 只勾两个条目类项目（弹窗默认全勾，先全不选再点想要的）
  await page.getByRole('button', { name: '全不选' }).click()
  for (const name of ['甲项目', '乙项目']) {
    await page.getByRole('checkbox', { name: new RegExp(name) }).first().check()
  }
  await page.getByRole('button', { name: /^导入 \d+ 条规则$/ }).click()
  await page.waitForTimeout(2500)
  const rules = await page.evaluate(() => window.api.entertainmentRulesList())
  const groups = [...new Set(rules.map((r) => r.group))].sort()
  assert.ok(groups.includes('甲项目') && groups.includes('乙项目'), `导入的规则该带项目分组，实际：${JSON.stringify(groups)}`)
  await groupHeader('甲项目').waitFor({ timeout: 15_000 })
  const first = await headerText('甲项目')
  assert.match(first, /0\/2 启用/, `刚导入没绑礼物，该显示 0/2 启用：${first}`)
  assert.match(first, /2 条未绑礼物/, `该提示未绑礼物：${first}`)
  pass('★规则列表按项目分组，组标题标出「未绑礼物」', first)

  // ①b 行内绑礼物（用户 2026-09-08：「点进项目规则里面太麻烦，希望在外面很快速地设置礼物」）
  //    以前要点「编辑」→ 填 → 「保存」→ 关弹窗，几十条规则得点上百下。
  const giftBox = (ruleName) => page.getByLabel(`规则 ${ruleName} 的礼物名`)
  await giftBox('甲一').waitFor({ timeout: 15_000 })
  // ★每行只有礼物名输入框，没有行内开关：开关只在项目标题上一个
  //   （2026-09-08 用户：「项目规则的开关你做了俩。做多了」）
  const switchesInRow = await page.evaluate(() => {
    const input = document.querySelector('[aria-label="规则 甲一 的礼物名"]')
    const row = input?.closest('.rounded-lg')
    return row ? row.querySelectorAll('button[role="switch"]').length : -1
  })
  assert.equal(switchesInRow, 0, `规则行里不该再有开关，实际有 ${switchesInRow} 个`)
  // 连着填：回车存下并跳到下一条（不碰鼠标）
  const plan = [['甲一', '小心心'], ['甲二', '小心心'], ['乙一', '棒棒糖'], ['乙二', '棒棒糖']]
  await stripDatalists()
  for (const [ruleName, gift] of plan) {
    await stripDatalists() // 每次 load() 后行可能重建，候选框会回来
    await giftBox(ruleName).fill(gift)
    await giftBox(ruleName).press('Enter')
    await page.waitForTimeout(700)
    // 回车后焦点应该已经在下一行的输入框上
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '')
    const index = plan.findIndex(([n]) => n === ruleName)
    if (index < plan.length - 1) {
      assert.equal(focused, `规则 ${plan[index + 1][0]} 的礼物名`, `★回车该跳到「${plan[index + 1][0]}」的输入框，实际焦点在：${focused}`)
    }
  }
  const bound = await page.evaluate(() => window.api.entertainmentRulesList())
  assert.deepEqual(
    Object.fromEntries(bound.map((r) => [r.name, r.giftName])),
    { 甲一: '小心心', 甲二: '小心心', 乙一: '棒棒糖', 乙二: '棒棒糖' },
    '★行内填的礼物名要真的存进库里：' + JSON.stringify(bound.map((r) => [r.name, r.giftName]))
  )
  // ★行内填礼物名不自动启用：一次导入几十条，自动启用等于突然全部生效
  assert.deepEqual([...new Set(bound.map((r) => r.enabled))], [false], '填礼物名不该顺手把规则打开')
  pass('★礼物名直接在列表行里填，回车存下并跳下一条', '4 条一气填完')

  pass('★规则行里只有礼物名输入框，开关只在项目标题上一个')

  // ② 点组开关 → 页面显示 2/2
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '游戏库', exact: true }).waitFor({ timeout: 20_000 })
  await armDownloadTrap()
  await page.evaluate(() => { window.location.hash = '#/ent' })
  await page.waitForTimeout(600)
  await gotoRules()
  await groupHeader('甲项目').waitFor({ timeout: 15_000 })
  await groupHeader('甲项目').getByRole('switch').click()
  await page.waitForTimeout(1200)
  const afterOn = await headerText('甲项目')
  assert.match(afterOn, /2\/2 启用/, `点了组开关该显示 2/2 启用，实际：${afterOn}`)
  assert.doesNotMatch(afterOn, /未绑礼物/, `绑了礼物就不该再提示：${afterOn}`)
  const stillOff = await headerText('乙项目')
  assert.match(stillOff, /0\/2 启用/, `只开甲项目，乙项目该还是 0/2：${stillOff}`)
  pass('★组开关只影响那一个项目', `甲 ${afterOn.slice(0, 18)} / 乙 ${stillOff.slice(0, 18)}`)

  // ③ 存成预设 → 两个都开 → 选回预设 → 只剩预设里的项目开着
  await page.getByLabel('预设名').fill('甲场')
  await page.getByRole('button', { name: /存为预设/ }).click()
  await page.waitForTimeout(1200)
  await groupHeader('乙项目').getByRole('switch').click()
  await page.waitForTimeout(1200)
  assert.match(await headerText('乙项目'), /2\/2 启用/, '先把乙项目也打开')
  const presetSelect = page.getByLabel('选择项目预设')
  const options = await presetSelect.locator('option').allInnerTexts()
  assert.ok(options.some((t) => t.includes('甲场')), `下拉里该有「甲场」预设：${JSON.stringify(options)}`)
  await presetSelect.selectOption({ label: options.find((t) => t.includes('甲场')) })
  await page.waitForTimeout(1500)
  const backA = await headerText('甲项目')
  const backB = await headerText('乙项目')
  assert.match(backA, /2\/2 启用/, `应用预设后甲项目该是开的：${backA}`)
  assert.match(backB, /0\/2 启用/, `★应用预设后乙项目该被关掉，实际：${backB}`)
  pass('★选预设一键切换「今晚开哪几个项目」', `甲 2/2、乙 0/2`)

  // ④ 导出的 JSON 带 presets
  await page.getByRole('button', { name: /导出配置/ }).click()
  await page.waitForTimeout(1000)
  const exported = await lastExport()
  assert.ok(exported && Array.isArray(exported.rules) && Array.isArray(exported.presets), `导出内容不对：${JSON.stringify(exported).slice(0, 120)}`)
  assert.equal(exported.rules.length, 4)
  assert.deepEqual(exported.presets.map((p) => p.name), ['甲场'])
  assert.deepEqual(exported.presets[0].groups, ['甲项目'])
  assert.ok(exported.rules.every((r) => r.group), '导出的规则要带分组，否则导回去就散了')
  pass('★导出配置带着项目预设', `${exported.rules.length} 条规则 + ${exported.presets.length} 个预设`)

  // ⑤ 清空后导入那份 JSON：规则和预设都回来
  await page.evaluate(async () => {
    for (const r of await window.api.entertainmentRulesList()) await window.api.entertainmentRuleRemove(r.id)
    for (const p of (await window.api.entertainmentPresetList()).presets) await window.api.entertainmentPresetRemove(p.id)
  })
  await feedFile('input[type=file][accept*="json"]', exported, '规则.json')
  await page.waitForTimeout(2500)
  const restored = await page.evaluate(async () => ({
    rules: await window.api.entertainmentRulesList(),
    presets: (await window.api.entertainmentPresetList()).presets
  }))
  assert.equal(restored.rules.length, 4, `导入该恢复 4 条规则，实际 ${restored.rules.length}`)
  assert.deepEqual([...new Set(restored.rules.map((r) => r.group))].sort(), ['乙项目', '甲项目'])
  assert.deepEqual(restored.presets.map((p) => p.name), ['甲场'], '预设也要一起回来')
  pass('★导入配置文件把规则和预设一起读回来')

  // 项目标题上那个导出按钮要在（真机上点它会弹选目录的框，这里只验它存在）
  assert.equal(await page.getByLabel('导出项目 甲项目').count(), 1, '项目标题上要有导出按钮')

  // ⑤c 单个预设导出（一份 JSON：预设 + 它涉及项目的规则；素材走上面的项目文件夹）
  // 刚才走过一轮「清空 → 导入」，预设是新 id，先在下拉里重新选一次
  const opts2 = await presetSelect.locator('option').allInnerTexts()
  await presetSelect.selectOption({ label: opts2.find((t) => t.includes('甲场')) })
  await page.waitForTimeout(1500)
  await page.getByLabel('导出这个预设').click()
  await page.waitForTimeout(900)
  const onePreset = await lastExport()
  assert.deepEqual(onePreset?.presets?.map((p) => p.name), ['甲场'], `该只导出选中的那个预设：${JSON.stringify(onePreset).slice(0, 120)}`)
  assert.ok(onePreset.rules.length > 0 && onePreset.rules.every((r) => r.group === '甲项目'), '预设导出要带上它那些项目的规则')
  pass('★单个预设单独导出（连它的项目规则）', `${onePreset.rules.length} 条规则`)

  // ⑤b 单个项目导出成【一个文件夹】（用户：「导出项目的时候应该导出的是一个文件夹」
  //     「别的主播也想要这个项目的话，可以直接导出这个项目给别人」）
  const shareDir = path.join(out, 'share')
  await fs.mkdir(shareDir, { recursive: true })
  const exportedFolder = await page.evaluate(async (dest) => {
    const list = await window.api.entertainmentRulesList()
    const rows = list.filter((r) => r.group === '甲项目')
    return window.api.projectExport('甲项目', rows, dest)
  }, shareDir)
  assert.equal(exportedFolder.ok, true, exportedFolder.error || '导出失败')
  assert.equal(exportedFolder.withMedia, true, '该带上素材')
  const folderFiles = await fs.readdir(exportedFolder.dir)
  assert.ok(folderFiles.includes('项目规则.json'), `文件夹里要有项目规则.json：${folderFiles}`)
  assert.ok(folderFiles.includes('甲一.mp4') && folderFiles.includes('甲一.脚本'), `视频和脚本都要复制过去：${folderFiles}`)
  const manifest = JSON.parse(await fs.readFile(path.join(exportedFolder.dir, '项目规则.json'), 'utf8'))
  assert.equal(manifest.project, '甲项目')
  assert.equal(manifest.rules.length, 2)
  assert.ok(
    manifest.rules.every((r) => String(r.commandParam || '').startsWith('<项目>')),
    `★素材路径要写成占位符，别把导出机器的绝对路径带给别人：${JSON.stringify(manifest.rules.map((r) => r.commandParam))}`
  )
  pass('★项目导出成一个文件夹（素材 + 项目规则.json，路径写占位符）', `${exportedFolder.files} 个文件`)

  // ⑤b2 别人拿到这个文件夹 → 点「导入项目」直接能用
  await page.evaluate(async () => {
    for (const r of await window.api.entertainmentRulesList()) {
      if (r.group === '甲项目') await window.api.entertainmentRuleRemove(r.id)
    }
  })
  const backIn = await page.evaluate((dir) => window.api.projectImportFolder(dir), exportedFolder.dir)
  assert.equal(backIn.ok, true, backIn.error || '从文件夹导入失败')
  assert.equal(backIn.fromManifest, true, '该按对方的 项目规则.json 建规则')
  assert.equal(backIn.added, 2, `该建 2 条规则，实际 ${backIn.added}`)
  const imported = (await page.evaluate(() => window.api.entertainmentRulesList())).filter((r) => r.group === backIn.project)
  assert.equal(imported.length, 2)
  for (const r of imported) {
    assert.ok(!String(r.commandParam || '').includes('<项目>'), `占位符要换成本机路径：${r.commandParam}`)
    assert.ok(String(r.commandParam || '').includes(backIn.project), `路径要指向本机那份项目：${r.commandParam}`)
  }
  assert.deepEqual(imported.map((r) => r.giftName).sort(), ['小心心', '小心心'], '对方绑好的礼物名一起带过来')
  pass('★别人的项目文件夹「导入项目」直接可用', `${backIn.added} 条规则，素材 ${backIn.copied} 个文件`)

  // ⑤b3 新建项目：素材目录里建文件夹 + 复制视频 + 自动建规则
  const made = await page.evaluate((files) => window.api.projectCreate('我的新项目', files), [
    path.join(lib, '甲项目', '甲一.mp4'),
    path.join(lib, '甲项目', '甲二.mp4')
  ])
  assert.equal(made.ok, true, made.error || '新建项目失败')
  assert.equal(made.copied, 2, `该复制 2 个视频，实际 ${made.copied}`)
  assert.equal(made.added, 2, `该自动建 2 条规则，实际 ${made.added}`)
  const madeFiles = await fs.readdir(made.dir)
  assert.ok(madeFiles.includes('甲一.mp4') && madeFiles.includes('甲一.脚本'), `视频旁边的同名脚本要一起带过来：${madeFiles}`)
  const madeRules = (await page.evaluate(() => window.api.entertainmentRulesList())).filter((r) => r.group === '我的新项目')
  assert.equal(madeRules.length, 2, '新建的项目要能按项目分组')
  pass('★新建项目：建文件夹、复制视频、自动建规则', `${made.added} 条`)

  // ⑤d 导入 JSON 配置时，别人机器上的素材路径要能改到本机素材目录
  //     （项目文件夹那条路走占位符；这条管的是「只发了一份 JSON」的情况）
  const mine = (await page.evaluate(() => window.api.entertainmentRulesList())).filter((r) => r.group === '乙项目')
  assert.equal(mine.length, 2, '乙项目该有 2 条规则')
  const foreign = {
    kind: 'zhiliao-ent-rules',
    version: 1,
    project: '乙项目',
    rules: mine.map((r) => ({
      ...r,
      id: '',
      commandParam: String(r.commandParam || '').replace(/^.*?乙项目/, String.raw`Z:\别人的素材库\乙项目`)
    }))
  }
  assert.ok(foreign.rules.every((r) => r.commandParam.startsWith('Z:')), '夹具没构造成功：' + JSON.stringify(foreign.rules.map((r) => r.commandParam)))
  await page.evaluate(async () => {
    for (const r of await window.api.entertainmentRulesList()) {
      if (r.group === '乙项目') await window.api.entertainmentRuleRemove(r.id)
    }
  })
  await feedFile('input[type=file][accept*="json"]', foreign, '乙项目.json')
  await page.waitForTimeout(2500)
  const relocated = (await page.evaluate(() => window.api.entertainmentRulesList())).filter((r) => r.group === '乙项目')
  assert.equal(relocated.length, 2, `该导入 2 条，实际 ${relocated.length}`)
  for (const r of relocated) {
    assert.ok(!String(r.commandParam || '').startsWith('Z:'), `★对方的路径要改到本机素材目录，实际还是：${r.commandParam}`)
    assert.ok(String(r.commandParam || '').includes('乙项目'), `改完还得指向同名项目文件夹：${r.commandParam}`)
  }
  pass('★导入别人的 JSON 配置，素材路径自动改到本机素材目录', relocated[0].commandParam.slice(-26))

  // ================= 二·透明图：从礼物规则生成 =================
  // 当前状态：甲项目启用（小心心）、乙项目停用（棒棒糖）
  // 按礼物名开停（前面走过「导出成文件夹 → 再导入」，同机重名让分组变成了 甲项目(2)，
  // 这段只关心「启用的规则才进菜单」，所以按礼物名判定最稳）
  await page.evaluate(async () => {
    const list = await window.api.entertainmentRulesList()
    for (const r of list) await window.api.entertainmentRuleUpdate({ ...r, enabled: r.giftName === '小心心' })
  })
  await page.evaluate(() => { window.location.hash = '#/ent' })
  await page.waitForTimeout(600)
  for (let i = 0; i < 5; i++) {
    if (await page.getByRole('button', { name: /从礼物规则生成/ }).count()) break
    // 娱乐助手记着上次进的子页，先「返回功能列表」才看得到卡片
    const back = page.getByRole('button', { name: '返回功能列表' }).first()
    if (await back.count()) { await back.click().catch(() => {}); await page.waitForTimeout(800) }
    const card = page.getByText('透明图合成', { exact: true }).first()
    if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(1500); continue }
    await page.evaluate(() => { window.location.hash = '#/ent' })
    await page.waitForTimeout(800)
  }
  const fromRules = page.getByRole('button', { name: /从礼物规则生成/ })
  await fromRules.waitFor({ timeout: 20_000 })
  await fromRules.click()
  await page.waitForTimeout(1500)
  const menuText = await page.evaluate(() => {
    const box = document.querySelector('input[placeholder^="搜列表"]')?.closest('div')?.parentElement
    return (box?.innerText || document.body.innerText).replace(/\s+/g, ' ')
  })
  assert.ok(menuText.includes('小心心'), `菜单该有启用项目的礼物「小心心」：${menuText.slice(0, 160)}`)
  assert.ok(!menuText.includes('棒棒糖'), `★停用项目的礼物「棒棒糖」不该出现在观众菜单里：${menuText.slice(0, 160)}`)
  pass('★透明图「从礼物规则生成」只出当前启用的项目', '有小心心、无棒棒糖')

  // ================= 三·时间插件 =================
  await page.evaluate(() => { window.location.hash = '#/ent' })
  await page.waitForTimeout(600)
  await gotoRules()
  await page.getByRole('button', { name: '导入项目', exact: true }).click()
  await page.getByText('导入方式').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '并进时间盲盒' }).click()
  await page.waitForTimeout(600)
  // 只勾两个时间项目
  await page.getByRole('button', { name: '全不选' }).click()
  for (const name of ['时间甲', '时间乙']) {
    await page.getByRole('checkbox', { name: new RegExp(name) }).first().check()
  }
  await page.getByRole('button', { name: /加入时间盲盒/ }).click()
  let cfg = {}
  for (let i = 0; i < 60; i++) {
    cfg = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ent_time_cfg') || '{}') } catch { return {} } })
    if ((cfg.blindBoxEvents || []).length >= 4) break
    await page.waitForTimeout(200)
  }
  const evs = cfg.blindBoxEvents || []
  assert.equal(evs.length, 4, `该导入 4 个时间事件，实际 ${evs.length}`)
  assert.deepEqual([...new Set(evs.map((e) => e.group))].sort(), ['时间乙', '时间甲'], '事件要带项目名')

  // 进时间插件页
  const back = page.getByRole('button', { name: '返回功能列表' }).first()
  if (await back.count()) { await back.click().catch(() => {}); await page.waitForTimeout(800) }
  for (const sel of ['倒计时 · 时间盲盒 · 礼物加减时间', '时间插件']) {
    const el = page.getByText(sel, { exact: false }).first()
    if (await el.count()) {
      await el.click().catch(() => {})
      await page.waitForTimeout(1200)
      if (await page.getByText('盲盒事件库').count()) break
    }
  }
  await page.locator('[aria-label="时间盲盒事件库"]').waitFor({ timeout: 20_000 })
  const timeHeader = (name) => page.locator(`[data-testid="time-blindbox-group"][aria-label="项目 ${name}"]`).first()
  await timeHeader('时间甲').waitFor({ timeout: 15_000 })
  const th = (await timeHeader('时间甲').innerText()).replace(/\s+/g, ' ')
  assert.match(th, /2\/2 启用/, `时间事件库该按项目分组显示 2/2：${th}`)
  pass('★时间插件事件库按项目分组，每组一个开关', th.slice(0, 24))

  // ⑧ 关掉「时间乙」
  await timeHeader('时间乙').getByRole('switch').click()
  await page.waitForTimeout(1200)
  const offText = (await timeHeader('时间乙').innerText()).replace(/\s+/g, ' ')
  assert.match(offText, /0\/2 启用/, `关掉后该显示 0/2：${offText}`)
  assert.match(offText, /整组停用/, `关掉后该有「整组停用」标记：${offText}`)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ent_time_cfg') || '{}').blindBoxEvents || [])
  const byGroup = (g) => saved.filter((e) => e.group === g)
  assert.deepEqual(byGroup('时间乙').map((e) => e.enabled), [false, false], '★页面读的那份 localStorage 里也要落成停用')
  assert.deepEqual(byGroup('时间甲').map((e) => e.enabled), [true, true], '另一个项目不受影响')
  pass('★关掉项目会真的写进页面读的配置里', offText.slice(0, 26))

  // ⑨ 导出设置 / 导入设置
  await armDownloadTrap()
  await page.getByRole('button', { name: /导出设置/ }).click()
  await page.waitForTimeout(1000)
  const timeExport = await lastExport()
  assert.ok(timeExport?.config && Array.isArray(timeExport.plans), `导出内容不对：${JSON.stringify(timeExport).slice(0, 120)}`)
  assert.equal((timeExport.config.blindBoxEvents || []).length, 4)
  assert.equal(timeExport.config.blindBoxEvents.filter((e) => e.enabled === false).length, 2, '导出要带上项目开关状态')
  pass('★时间插件「导出设置」带整套配置和项目开关', `${timeExport.config.blindBoxEvents.length} 个事件`)

  // 改一份再导回来：把停用的打开、加一套方案
  const edited = {
    ...timeExport,
    config: { ...timeExport.config, blindBoxEvents: timeExport.config.blindBoxEvents.map((e) => ({ ...e, enabled: true })) },
    plans: [{ name: '外景场', config: timeExport.config }]
  }
  await feedFile('input[type=file][accept*="json"]', edited, '时间插件设置.json')
  await page.waitForTimeout(2500)
  const afterImport = await page.evaluate(() => ({
    events: JSON.parse(localStorage.getItem('ent_time_cfg') || '{}').blindBoxEvents || [],
    plans: JSON.parse(localStorage.getItem('ent_time_plans') || '[]')
  }))
  assert.equal(afterImport.events.length, 4, `导入后该还是 4 个事件，实际 ${afterImport.events.length}`)
  assert.equal(afterImport.events.filter((e) => e.enabled === false).length, 0, '★导入的设置里项目都是开的，页面就该都开着')
  assert.deepEqual(afterImport.plans.map((p) => p.name), ['外景场'], '方案也要一起导进来')
  const onAgain = (await timeHeader('时间乙').innerText()).replace(/\s+/g, ' ')
  assert.match(onAgain, /2\/2 启用/, `★导入后界面上该显示 2/2，实际：${onAgain}`)
  pass('★「导入设置」把配置和方案都读回来，界面跟着变', onAgain.slice(0, 22))
} finally {
  await app?.close().catch(() => {})
}
console.log(`\n项目分组/预设 UI ${passed.length} 项 PASS`)

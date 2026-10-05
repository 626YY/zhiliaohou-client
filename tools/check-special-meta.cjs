// 特色整蛊 · 玩法元数据 + 玩法代码健康检查（不启动 Electron，纯 Node）。
// 查：元数据字段齐全且自洽（countDef/ops/fields/unit/category/how/statLabel/各类参数）、
//     每个玩法每个操作的动作短描述不含 undefined/NaN、动作参数拆合往返一致、
//     玩法页面代码能被解析（语法）、源码模板串里没有反引号/${ 注入风险。
// 用法：node tools/check-special-meta.cjs（有问题退出码 1）
const { build } = require('esbuild')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

;(async () => {
  const outfile = path.join(root, 'output/playwright/special-games/meta-check.cjs')
  await build({
    stdin: {
      contents: `export {SPECIAL_GAMES, SPECIAL_CATEGORY_LABELS, parseSpecialParam, joinSpecialParam, specialActionText, resolveSpecialCount, defaultSpecialConfig} from './src/shared/specialGames';
export {GAME_CODE} from './src/main/special-games';`,
      resolveDir: root,
      loader: 'ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning'
  })
  delete require.cache[outfile]
  const m = require(outfile)
  const problems = []
  const bad = (msg) => problems.push(msg)
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0

  const ids = m.SPECIAL_GAMES.map((g) => g.id)
  ids.filter((v, i) => ids.indexOf(v) !== i).forEach((id) => bad(`玩法 id 重复：${id}`))
  ids.filter((id) => !m.GAME_CODE[id]).forEach((id) => bad(`缺玩法代码：${id}`))

  const PARAM_TYPES = ['number', 'toggle', 'select', 'color', 'text', 'file', 'files', 'device']
  const FILE_KINDS = ['image', 'audio', 'video']
  const GROUPS = ['play', 'look', 'sound', 'media']
  const FIELD_KEYS = ['size', 'kind', 'color']

  let actionTexts = 0
  for (const g of m.SPECIAL_GAMES) {
    const at = `${g.id}`
    // —— 卡片/详情字段 ——
    for (const k of ['name', 'emoji', 'desc', 'how', 'unit', 'tint']) if (!isStr(g[k])) bad(`${at}：${k} 为空`)
    if (!(g.category in m.SPECIAL_CATEGORY_LABELS)) bad(`${at}：category 不认识 ${g.category}`)
    if (typeof g.interactive !== 'boolean') bad(`${at}：interactive 不是布尔`)
    if (!/^#[0-9a-f]{6}$/i.test(String(g.tint))) bad(`${at}：tint 不是 #rrggbb`)
    if (!(Number.isInteger(g.width) && g.width >= 160 && Number.isInteger(g.height) && g.height >= 160)) bad(`${at}：默认窗口尺寸不对`)
    if (!(Number.isInteger(g.countDef) && g.countDef >= 1)) bad(`${at}：countDef 应为 ≥1 的整数（${g.countDef}）`)
    if (g.statLabel !== undefined && !isStr(g.statLabel)) bad(`${at}：statLabel 为空串`)

    // —— 操作 ——
    if (!Array.isArray(g.ops) || g.ops.length === 0) bad(`${at}：ops 为空`)
    const opVals = (g.ops || []).map((o) => o.value)
    opVals.filter((v, i) => opVals.indexOf(v) !== i).forEach((v) => bad(`${at}：操作重复 ${v}`))
    for (const o of g.ops || []) {
      if (!isStr(o.value) || !/^[a-z]+$/.test(o.value)) bad(`${at}：操作 value 不合法 ${o.value}`)
      if (!isStr(o.label)) bad(`${at}.${o.value}：操作 label 为空`)
      if (o.count !== undefined && typeof o.count !== 'boolean') bad(`${at}.${o.value}：count 不是布尔`)
      if (o.countLabel !== undefined && !isStr(o.countLabel)) bad(`${at}.${o.value}：countLabel 为空串`)
    }

    // —— 每次触发的选项 ——
    const fkeys = (g.fields || []).map((f) => f.key)
    fkeys.filter((v, i) => fkeys.indexOf(v) !== i).forEach((k) => bad(`${at}：选项重复 ${k}`))
    for (const f of g.fields || []) {
      if (!FIELD_KEYS.includes(f.key)) bad(`${at}：选项 key 不认识 ${f.key}`)
      if (!isStr(f.label)) bad(`${at}.${f.key}：选项 label 为空`)
      const vals = (f.options || []).map((o) => o.value)
      if (!vals.length) bad(`${at}.${f.key}：选项没有候选`)
      if (!vals.includes(f.def)) bad(`${at}.${f.key}：默认值 ${f.def} 不在候选里`)
      vals.filter((v, i) => vals.indexOf(v) !== i).forEach((v) => bad(`${at}.${f.key}：候选重复 ${v}`))
      for (const o of f.options || []) if (!isStr(o.value) || !isStr(o.label) || /[|;=]/.test(o.value)) bad(`${at}.${f.key}：候选不合法 ${JSON.stringify(o)}`)
    }

    // —— 可调参数 ——
    const ks = g.params.map((p) => p.key)
    ks.filter((v, i) => ks.indexOf(v) !== i).forEach((k) => bad(`${at}：参数重复 ${k}`))
    for (const p of g.params) {
      const pa = `${at}.${p.key}`
      if (!PARAM_TYPES.includes(p.type)) { bad(`${pa}：参数类型不认识 ${p.type}`); continue }
      if (!isStr(p.label)) bad(`${pa}：label 为空`)
      if (p.def === undefined) bad(`${pa}：缺默认值`)
      if (p.group !== undefined && !GROUPS.includes(p.group)) bad(`${pa}：group 不认识 ${p.group}`)
      if (p.type === 'number') {
        if (typeof p.def !== 'number' || typeof p.min !== 'number' || typeof p.max !== 'number' || p.min > p.max || p.def < p.min || p.def > p.max) bad(`${pa}：数值默认越界 ${p.def} ∉ [${p.min},${p.max}]`)
        if (p.step !== undefined && !(p.step > 0)) bad(`${pa}：step 应 >0`)
      } else if (p.type === 'toggle') {
        if (typeof p.def !== 'boolean') bad(`${pa}：开关默认值不是布尔`)
      } else if (p.type === 'select') {
        if (!(p.options || []).some((o) => o.value === p.def)) bad(`${pa}：select 默认不在选项 ${p.def}`)
      } else if (p.type === 'color') {
        if (!/^#[0-9a-f]{6}$/i.test(String(p.def))) bad(`${pa}：颜色默认值不是 #rrggbb`)
      } else {
        // text / file / files / device：字符串，文件类要说明选什么文件
        if (typeof p.def !== 'string') bad(`${pa}：默认值应为字符串`)
        if ((p.type === 'file' || p.type === 'files') && !FILE_KINDS.includes(p.fileKind)) bad(`${pa}：fileKind 应为 image/audio/video`)
        if ((p.type === 'file' || p.type === 'files' || p.type === 'device') && p.def !== '') bad(`${pa}：文件/设备默认应为空（= 内置 / 系统默认）`)
      }
    }
    const cfg = m.defaultSpecialConfig(g)
    for (const p of g.params) if (!(p.key in cfg.params)) bad(`${at}.${p.key}：defaultSpecialConfig 缺这个参数`)

    // —— 动作参数拆合 + 短描述（每个操作 × 数量写法 × 每个选项取值）——
    const fieldCombos = [{}]
    for (const f of g.fields || []) for (const o of f.options) fieldCombos.push({ [f.key]: o.value })
    if ((g.fields || []).length > 1) fieldCombos.push(Object.fromEntries(g.fields.map((f) => [f.key, f.options[f.options.length - 1].value])))
    for (const o of g.ops) {
      for (const count of ['', '3', '2~8', String(g.countDef)]) {
        for (const fields of fieldCombos) {
          const raw = m.joinSpecialParam({ id: g.id, op: o.value, count, fields })
          const text = m.specialActionText(raw)
          actionTexts++
          if (/undefined|NaN|null|\[object/i.test(text) || !text.startsWith(g.name)) bad(`${at}.${o.value}：短描述异常「${text}」（${raw}）`)
          const back = m.parseSpecialParam(raw)
          if (back.id !== g.id || back.op !== o.value) bad(`${at}.${o.value}：拆合不往返（${raw} → ${back.id}|${back.op}）`)
          if (o.count === false && back.count !== '') bad(`${at}.${o.value}：不需要数量的操作拼出了数量（${raw}）`)
          for (const [k, v] of Object.entries(fields)) {
            const spec = (g.fields || []).find((f) => f.key === k)
            if (v !== spec.def && back.fields[k] !== v) bad(`${at}.${o.value}：选项 ${k}=${v} 拆合丢失（${raw}）`)
          }
          const n = m.resolveSpecialCount(back.count, g.countDef)
          if (!(Number.isInteger(n) && n >= 1)) bad(`${at}.${o.value}：数量解析异常 ${back.count} → ${n}`)
        }
      }
    }
    // 旧值 / 未知操作：回落默认操作
    const legacy = m.parseSpecialParam(`${g.id}|spawn|3`)
    if (legacy.op !== g.ops[0].value) bad(`${at}：旧操作 spawn 没回落到默认操作（得到 ${legacy.op}）`)
  }

  // —— 玩法页面代码：能解析；代码里认的操作（var OPS=[…]）和元数据 ops 一致且顺序相同（第一项 = 默认操作）——
  for (const id of Object.keys(m.GAME_CODE)) {
    const src = m.GAME_CODE[id]
    try { new Function(src) } catch (e) { bad(`${id}：页面代码语法错误 ${e.message}`) }
    const meta = m.SPECIAL_GAMES.find((g) => g.id === id)
    const hit = src.match(/var OPS=\[([^\]]*)\]/)
    if (!hit) { bad(`${id}：页面代码里没有 OPS 操作表`); continue }
    const codeOps = hit[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    const metaOps = meta ? meta.ops.map((o) => o.value) : []
    if (codeOps.join(',') !== metaOps.join(',')) bad(`${id}：代码操作表 [${codeOps}] 与元数据 ops [${metaOps}] 不一致`)
  }

  // —— 源码模板串注入风险：模板串内部不许有反引号 / ${（swat-factory 的 TS 层 CONF 插值除外）——
  const dir = path.join(root, 'src/main/special-games')
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const parts = src.split('`')
    if ((parts.length - 1) % 2 !== 0) { bad(`${f}：反引号不成对`); continue }
    for (let i = 1; i < parts.length; i += 2) {
      const inner = f === 'swat-factory.ts' ? parts[i].replace('${CONF}', '') : parts[i]
      if (inner.includes('${')) bad(`${f}：模板串里出现 \${（会被 TS 插值吃掉）`)
    }
  }

  console.log(`玩法数: ${m.SPECIAL_GAMES.length}，动作描述检查 ${actionTexts} 条`)
  if (problems.length) {
    console.log('\n问题：')
    for (const p of problems) console.log('  - ' + p)
    console.log(`\nCHECK FAILED：${problems.length} 个问题`)
    process.exit(1)
  }
  console.log('CHECK DONE：0 个问题')
})()

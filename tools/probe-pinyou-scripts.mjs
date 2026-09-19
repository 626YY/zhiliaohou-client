// 用主播真实的品游素材库实证解析覆盖率（2026-09-07 用户给了 F:\知了猴工作室\视频）。
// 品游的组织方式：一个项目 = 一个文件夹；文件夹里是「视频 + 同名 .脚本」成对，
// 盲盒/转盘触发时从文件夹里随机抽一条，播那个视频并执行它的脚本。
// 这里把每个 .脚本 喂给 parsePinyouScript，看哪些指令我们还认不出来。
// 用法：node tools/probe-pinyou-scripts.mjs ["F:\\知了猴工作室\\视频"]
import fs from 'node:fs'
import path from 'node:path'
import { parsePinyouScript } from '../src/shared/pinyou.ts'

const root = process.argv[2] || 'F:\\知了猴工作室\\视频'
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.flv', '.wmv'])

function decode(buf) {
  // 品游全线 GBK；先按 GBK 解，解不出再退 UTF-8
  for (const enc of ['gbk', 'utf-8']) {
    try {
      const s = new TextDecoder(enc, { fatal: true }).decode(buf)
      if (s && !s.includes('\uFFFD')) return s
    } catch {
      /* 换下一个编码 */
    }
  }
  return new TextDecoder('utf-8').decode(buf)
}

const projects = []
for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name)
  let st
  try {
    st = fs.statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory()) continue
  const files = fs.readdirSync(dir)
  const videos = files.filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
  const scripts = files.filter((f) => f.endsWith('.脚本'))
  // 配对：视频去掉扩展名后同名的 .脚本
  const paired = videos.filter((v) => scripts.includes(path.basename(v, path.extname(v)) + '.脚本'))
  projects.push({ name, videos: videos.length, scripts: scripts.length, paired: paired.length, dir, files })
}

console.log(`素材库：${root}`)
console.log(`项目（文件夹）${projects.length} 个\n`)
console.log('项目'.padEnd(22) + '视频'.padStart(6) + '脚本'.padStart(6) + '成对'.padStart(6))
for (const p of projects) {
  console.log(p.name.padEnd(22) + String(p.videos).padStart(6) + String(p.scripts).padStart(6) + String(p.paired).padStart(6))
}

let total = 0
let okCount = 0
const unknownLines = new Map()
const cmdCount = new Map()
for (const p of projects) {
  for (const f of p.files.filter((x) => x.endsWith('.脚本'))) {
    total += 1
    const text = decode(fs.readFileSync(path.join(p.dir, f)))
    const { commands, unknown } = parsePinyouScript(text)
    if (unknown.length === 0 && commands.length > 0) okCount += 1
    for (const c of commands) cmdCount.set(c.cmd, (cmdCount.get(c.cmd) || 0) + 1)
    for (const u of unknown) {
      const key = u.split(':')[0] + (u.includes(':') ? ':…' : '')
      if (!unknownLines.has(key)) unknownLines.set(key, { n: 0, samples: [] })
      const e = unknownLines.get(key)
      e.n += 1
      if (e.samples.length < 3) e.samples.push(`${p.name}/${f} → ${u}`)
    }
  }
}

console.log(`\n脚本 ${total} 个，完全认出 ${okCount} 个（${((okCount / total) * 100).toFixed(1)}%）`)
console.log('\n认出的动作：')
for (const [c, n] of [...cmdCount].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(20)} ${n}`)
if (unknownLines.size) {
  console.log('\n★认不出来的（要补的就是这些）：')
  for (const [k, v] of [...unknownLines].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(18)} ${v.n} 次`)
    for (const s of v.samples) console.log(`      ${s}`)
  }
} else {
  console.log('\n没有认不出来的指令')
}

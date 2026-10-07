// 特色整蛊盲盒开奖配音：把要随包带的句子用 Edge 在线语音（晓伊、正常语速）念好，放进 assets/special-games/box_voice/。
// 念哪些：默认事件库里每个事件的那句（锁链加5、大鸭子加5…），再加每个玩法每种操作的常用数量
// （加 1~30 和到 100 的整十整五、减 1~20 到 50、乘除 2~10），随机数量、连送合并后的数量大多也能直接用上。
// 不在包里的句子客户端开奖时现念、存本机缓存（special-voice.ts），所以这里漏了也不影响用，只是要联网。
// 文件名 = sha1(声音|语速|句子) 前 16 位，和客户端的查找规则一致（voiceFileName）；已经有的跳过，可以反复跑补齐。
// 用法：node tools/gen-special-voice.mjs [--force]
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'assets/special-games/box_voice')
const tmp = path.join(root, 'output/special-voice-gen')
await fs.mkdir(outDir, { recursive: true })
await fs.mkdir(tmp, { recursive: true })
const bundle = path.join(tmp, 'bundle.cjs')
await build({
  stdin: {
    contents: `export {SPECIAL_GAMES, DEFAULT_SPECIAL_REVEAL, defaultSpecialBoxEvents, parseSpecialParam, resolveSpecialCount, specialBoxEventVoice, specialVoiceLine} from './src/shared/specialGames';
export {edgeTts} from './src/main/edge-tts';
export {voiceFileName} from './src/main/special-voice-name';`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
const { SPECIAL_GAMES, DEFAULT_SPECIAL_REVEAL, defaultSpecialBoxEvents, parseSpecialParam, resolveSpecialCount, specialBoxEventVoice, specialVoiceLine, edgeTts, voiceFileName } =
  createRequire(import.meta.url)(bundle)

const force = process.argv.includes('--force')
const voice = DEFAULT_SPECIAL_REVEAL.voiceName
const rate = DEFAULT_SPECIAL_REVEAL.rate
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const COUNTS = {
  add: [...range(1, 30), 35, 40, 45, 50, 60, 70, 80, 90, 100],
  reduce: [...range(1, 20), 25, 30, 35, 40, 50, 60],
  multiply: range(2, 10),
  divide: range(2, 10),
  accelerate: range(2, 10),
  tornado: [5, 10, 15, 20, 25, 30, 40, 50]
}

const lines = new Set()
for (const e of defaultSpecialBoxEvents()) {
  const p = parseSpecialParam(e.param)
  const line = specialBoxEventVoice(e, resolveSpecialCount(p.count, 1))
  if (line) lines.add(line)
}
for (const g of SPECIAL_GAMES) {
  if (!g.say) continue
  for (const op of g.ops) {
    if (op.count === false) continue
    for (const n of COUNTS[op.value] ?? []) {
      const line = specialVoiceLine(`${g.id}|${op.value}|${n}`, n)
      if (line) lines.add(line)
    }
  }
}

const todo = []
const index = {}
for (const text of lines) {
  const file = voiceFileName(voice, rate, text)
  index[text] = file
  const exists = await fs.stat(path.join(outDir, file)).then((s) => s.size > 0).catch(() => false)
  if (force || !exists) todo.push({ text, file })
}
console.log(`共 ${lines.size} 句，要念 ${todo.length} 句（${voice}，语速 ${rate}%）`)

let done = 0
let failed = 0
async function worker() {
  for (;;) {
    const job = todo.shift()
    if (!job) return
    let ok = false
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const mp3 = await edgeTts(job.text, { voice, rate, timeoutMs: 15000 })
        await fs.writeFile(path.join(outDir, job.file), mp3)
        ok = true
      } catch (e) {
        if (attempt === 4) console.warn(`念不出来：${job.text}（${e.message}）`)
        else await new Promise((r) => setTimeout(r, 800 * attempt))
      }
    }
    if (ok) done++
    else failed++
    if ((done + failed) % 50 === 0) console.log(`  …${done + failed}`)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify({ voice, rate, lines: index }, null, 1) + '\n', 'utf8')
console.log(`念好 ${done} 句，失败 ${failed} 句；索引 box_voice/index.json 共 ${Object.keys(index).length} 句`)
if (failed) process.exitCode = 1

// 品游配置文件层：解码（易语言默认 GBK）、从文本里抠 JSON、认品游安装目录。不依赖 electron，能在 node 里单测。
import fs from 'fs'
import path from 'path'
import type { PinyouPlan } from '@shared/types'
import {
  convertPinyouTable,
  extractJsonObjects,
  findGiftTables,
  planNameFromFile,
  type PinyouAssetRoots
} from '../shared/pinyou'

const MAX_BYTES = 8 * 1024 * 1024   // 品游配置都是 KB 级；上限只防误选大文件把主进程卡住

/** 认品游目录的规则（可调）：素材子目录名、往上找几层、上层目录要有几个素材目录才算、安装程序名 */
export const PINYOU_ROOT_RULES = {
  /** 品游安装目录 / 导出素材目录里的三个素材子目录 */
  markers: { sounds: '音效', videos: '视频', scripts: '脚本' },
  /** 导出配置「品游配置_<方案>.py」旁边的素材目录名前缀 */
  exportPrefix: '品游素材_',
  /** 从配置文件所在目录最多往上找几层 */
  maxUp: 6,
  /** 配置文件自己所在的目录：有 1 个素材子目录就算 */
  minMarkersHere: 1,
  /** 上层目录：至少要有这么多个素材子目录（或者有品游主程序）才算，免得把主播自己的 D:\视频\ 当成品游 */
  minMarkersAbove: 2,
  /** 目录里有这样的 exe 就是品游安装目录 */
  exeName: /^(品游)?娱乐助手.*\.exe$/i
}

function decodeGbk(buf: Buffer): string | null {
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    /* 没有 ICU 的 gbk 就退 iconv-lite */
  }
  try {
    const iconv = require('iconv-lite') as { decode: (b: Buffer, enc: string) => string }
    return iconv.decode(buf, 'gbk')
  } catch {
    return null
  }
}

/** 没有 BOM 的 UTF-16：偶数位（LE）或奇数位（BE）几乎全是 0 */
function looksUtf16(buf: Buffer): 'le' | 'be' | null {
  const n = Math.min(buf.length, 4096) & ~1
  if (n < 8) return null
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) evenZero++
    if (buf[i + 1] === 0) oddZero++
  }
  const pairs = n / 2
  if (oddZero > pairs * 0.4 && evenZero < pairs * 0.1) return 'le'
  if (evenZero > pairs * 0.4 && oddZero < pairs * 0.1) return 'be'
  return null
}

/** UTF-8 BOM / UTF-16（带或不带 BOM）/ 严格合法的 UTF-8 直接用；UTF-8 解不通就按 GBK 解 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const sw = Buffer.from(buf.subarray(2)); sw.swap16(); return sw.toString('utf16le') }
  const u16 = looksUtf16(buf)
  if (u16 === 'le') return buf.subarray(0, buf.length & ~1).toString('utf16le')
  if (u16 === 'be') { const sw = Buffer.from(buf.subarray(0, buf.length & ~1)); sw.swap16(); return sw.toString('utf16le') }
  try {
    // 严格解码：合法 UTF-8 里本来就有的 U+FFFD 不会被误判成 GBK
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return decodeGbk(buf) ?? buf.toString('utf8')
  }
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 某个目录下有哪些品游素材子目录；有品游主程序也算证据 */
function markersIn(dir: string): { roots: PinyouAssetRoots; count: number; hasExe: boolean } {
  const { markers, exeName } = PINYOU_ROOT_RULES
  const roots: PinyouAssetRoots = {}
  let count = 0
  for (const [key, name] of Object.entries(markers) as [keyof typeof markers, string][]) {
    const p = path.join(dir, name)
    if (isDir(p)) { roots[key] = p; count++ }
  }
  let hasExe = false
  try {
    hasExe = fs.readdirSync(dir).some((name) => exeName.test(name))
  } catch { /* 读不了目录就当没有 */ }
  return { roots, count, hasExe }
}

/**
 * 认品游的素材根目录。顺序：
 *   1. 导出配置「品游配置_<方案>.py」旁边的「品游素材_<方案>」（品游「导出配置」时勾「导出相关联素材」就会生成）
 *   2. 配置文件自己所在的目录（品游安装目录里直接有 音效\ 视频\ 脚本\）
 *   3. 往上最多 maxUp 层，但上层必须有 ≥ minMarkersAbove 个素材目录或品游主程序，避免把主播的 D:\视频\ 当成品游
 */
export function findAssetRoots(fromDir: string, fileName = ''): PinyouAssetRoots & { root?: string } {
  const { exportPrefix, maxUp, minMarkersHere, minMarkersAbove } = PINYOU_ROOT_RULES
  const accept = (dir: string, found: ReturnType<typeof markersIn>): PinyouAssetRoots & { root: string } => ({ root: dir, ...found.roots })
  // 1. 导出配置旁边的素材目录
  const plan = planNameFromFile(fileName)
  const siblingCandidates = fileName ? [path.join(fromDir, `${exportPrefix}${plan}`)] : []
  try {
    for (const name of fs.readdirSync(fromDir)) {
      if (name.startsWith(exportPrefix) && !siblingCandidates.includes(path.join(fromDir, name))) siblingCandidates.push(path.join(fromDir, name))
    }
  } catch { /* 目录读不了就跳过这一步 */ }
  for (const dir of siblingCandidates) {
    if (!isDir(dir)) continue
    const found = markersIn(dir)
    if (found.count >= minMarkersHere) return accept(dir, found)
  }
  // 2. 自己所在目录  3. 上层
  let dir = fromDir
  for (let i = 0; i <= maxUp; i++) {
    const found = markersIn(dir)
    const need = i === 0 ? minMarkersHere : minMarkersAbove
    if (found.count >= need || (found.hasExe && found.count > 0)) return accept(dir, found)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

/** Python 单引号字面量（{'礼物': {...}, 'x': True}）→ JSON。只在整段没有双引号时做，避免误伤正常 JSON 里的撇号 */
function pyLiteralToJson(c: string): string | null {
  if (c.includes('"') || !c.includes("'")) return null
  return c.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
}

/** 解析一个文件，返回里面找到的所有方案（一般一个文件一张表） */
export function parsePinyouFile(file: string): { plans: PinyouPlan[]; root?: string } {
  const st = fs.statSync(file)
  if (st.size > MAX_BYTES) throw new Error('文件太大，不像要导入的配置')
  return parsePinyouBuffer(file, fs.readFileSync(file))
}

/** 导入对话框用：读文件走异步，多选时逐个让出事件循环，别把主进程卡住 */
export async function parsePinyouFileAsync(file: string): Promise<{ plans: PinyouPlan[]; root?: string }> {
  const st = await fs.promises.stat(file)
  if (st.size > MAX_BYTES) throw new Error('文件太大，不像要导入的配置')
  const buf = await fs.promises.readFile(file)
  await new Promise<void>((resolve) => setImmediate(resolve))
  return parsePinyouBuffer(file, buf)
}

function parsePinyouBuffer(file: string, buf: Buffer): { plans: PinyouPlan[]; root?: string } {
  const text = decodeText(buf)
  const roots = findAssetRoots(path.dirname(file), path.basename(file))
  roots.exists = (p: string): boolean => fs.existsSync(p)
  if (roots.scripts) {
    const contents: Record<string, string> = {}
    try {
      for (const name of fs.readdirSync(roots.scripts)) {
        if (!/\.脚本$/i.test(name) && !/\.(txt|script|ini|json)$/i.test(name)) continue
        const p = path.join(roots.scripts, name)
        try { if (fs.statSync(p).isFile()) contents[name] = decodeText(fs.readFileSync(p)) } catch { /* 单个脚本损坏不影响其余配置 */ }
      }
    } catch { /* 脚本目录不可读时由导入预览提示缺文件 */ }
    roots.scriptContents = contents
  }
  let candidates = extractJsonObjects(text)
  if (candidates.length === 0) {
    // 整份都是单引号 Python 字面量时，提取器一个 JSON 都认不出：先整段保守转成 JSON 写法再提一次
    const py = pyLiteralToJson(text)
    if (py) candidates = extractJsonObjects(py)
  }
  if (candidates.length === 0) candidates.push(text.trim())
  const plans: PinyouPlan[] = []
  const baseName = planNameFromFile(path.basename(file))
  for (const c of candidates) {
    let v: unknown
    try {
      v = JSON.parse(c)
    } catch {
      const py = pyLiteralToJson(c)
      if (!py) continue
      try { v = JSON.parse(py) } catch { continue }
    }
    for (const table of findGiftTables(v)) {
      const name = plans.length === 0 ? baseName : `${baseName}（${plans.length + 1}）`
      plans.push(convertPinyouTable(table, name, file, roots))
    }
  }
  return { plans, root: roots.root }
}

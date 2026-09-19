// emoji 切分（与 src/main/emoji-assets.ts 里的挂件页面脚本同一套规则，Twemoji 文件名规则来自轮椅整蛊台 mod/EmojiArt.cs）：
//   简单 emoji 去 FE0F、ZWJ 组合里留 FE0F、最长匹配逐级回退；裸的单个 BMP 符号（★☆♀♂）留给文字。
// 渲染层（React 主窗口）用它把昵称 / 礼物名里的 emoji 贴成图，和挂件页面一个画风。改规则两处一起改。
export type EmojiSegment = { text: string; key?: string }

function maybe(cp: number): boolean {
  if (cp < 0xa9) return false
  if (cp >= 0x10000) return true
  if (cp === 0xa9 || cp === 0xae) return true
  return cp >= 0x203c && cp <= 0x3299
}
function joiner(cp: number): boolean {
  return cp === 0xfe0f || cp === 0x20e3 || cp === 0x200d || (cp >= 0x1f3fb && cp <= 0x1f3ff)
}
function ri(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff
}
function key(cps: number[], n: number, keepVS: boolean): string {
  let s = ''
  for (let k = 0; k < n; k++) {
    if (!keepVS && cps[k] === 0xfe0f) continue
    if (s) s += '-'
    s += cps[k].toString(16)
  }
  return s
}

function match(cps: number[], i: number, keys: Set<string>): { key: string; used: number } | null {
  const keycap = (cps[i] === 0x23 || cps[i] === 0x2a || (cps[i] >= 0x30 && cps[i] <= 0x39)) && (cps[i + 1] === 0xfe0f || cps[i + 1] === 0x20e3)
  if (!maybe(cps[i]) && !keycap) return null
  const seq: number[] = []
  let p = i
  let prevZWJ = false
  while (p < cps.length) {
    const cp = cps[p]
    if (seq.length) {
      const cont = prevZWJ || joiner(cp) || (seq.length === 1 && ri(seq[0]) && ri(cp))
      if (!cont) break
    }
    seq.push(cp)
    p++
    prevZWJ = cp === 0x200d
    if (seq.length > 12) break
  }
  if (seq[0] <= 0xffff && seq.length === 1) return null
  if (!keys.size) return null
  for (let n = seq.length; n >= 1; n--) {
    if (seq[n - 1] === 0x200d) continue
    const k = key(seq, n, true)
    if (keys.has(k)) return { key: k, used: n }
    const k2 = key(seq, n, false)
    if (k2 !== k && k2 && keys.has(k2)) return { key: k2, used: n }
  }
  return null
}

/** 把文本切成「文字段 / emoji 图段」；keys 为空时整段都是文字 */
export function splitEmoji(text: unknown, keys: Set<string>): EmojiSegment[] {
  const cps = Array.from(String(text == null ? '' : text)).map((c) => c.codePointAt(0) as number)
  const out: EmojiSegment[] = []
  let buf = ''
  let i = 0
  while (i < cps.length) {
    const m = match(cps, i, keys)
    if (m) {
      if (buf) { out.push({ text: buf }); buf = '' }
      out.push({ key: m.key, text: String.fromCodePoint(...cps.slice(i, i + m.used)) })
      i += m.used
    } else {
      buf += String.fromCodePoint(cps[i])
      i++
    }
  }
  if (buf) out.push({ text: buf })
  return out
}

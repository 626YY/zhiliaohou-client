import { app } from 'electron'
import { join, dirname, normalize, basename } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import JSZip from 'jszip'
import { catalogDir } from './mods'
import type { ModManifest } from '@shared/types'

export function sha256File(path: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(path, 'r')
  try {
    const buf = Buffer.alloc(4 * 1024 * 1024)
    let n = 0
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

// 流式下载 + 进度：轮椅 mod 的安装包 200 多 MB，一次性读进内存再写盘既吃内存又没进度可报。
async function downloadFile(url: string, target: string, onProgress?: (percent: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  const tmp = target + '.part'
  const out = fs.createWriteStream(tmp)
  const reader = res.body.getReader()
  let done = 0
  let lastPct = -1
  let failed: unknown = null
  try {
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      if (value) {
        if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once('drain', () => r()))
        done += value.byteLength
        if (total > 0) {
          const pct = Math.floor((done / total) * 100)
          if (pct !== lastPct) {
            lastPct = pct
            onProgress?.(pct)
          }
        }
      }
    }
  } catch (e) {
    failed = e
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  if (!failed && total > 0 && done !== total) failed = new Error(`下载不完整：${done}/${total} 字节`)
  if (failed) {
    // 半截的 .part 别留在盘上（轮椅 214MB 一次失败就是 200MB 垃圾）
    try { fs.rmSync(tmp, { force: true }) } catch { /* 清不掉也不影响报错 */ }
    throw failed
  }
  fs.renameSync(tmp, target)
}

export type DownloadPhase = 'download' | 'cached' | 'verify'

/**
 * 取安装包到 userData/downloads。
 * 已有同名文件且 sha256 对得上就直接复用（重装、断网、或者主播自己拷过来的包），不再下 200MB。
 */
export async function downloadMod(
  mod: ModManifest,
  onProgress?: (phase: DownloadPhase, percent: number) => void,
  // 内置包的文件名和 sha：远端清单把版本抬高后，OSS 下不动回落到内置包时，得按内置清单的 sha 校验，不能拿远端新版的 sha 去验旧包
  fallback?: { filename: string; sha256?: string }
): Promise<string> {
  const dir = join(app.getPath('userData'), 'downloads')
  fs.mkdirSync(dir, { recursive: true })
  const target = join(dir, mod.download.filename)
  const want = (mod.download.sha256 || '').toLowerCase()

  if (want && fs.existsSync(target)) {
    onProgress?.('verify', 0)
    if (sha256File(target).toLowerCase() === want) {
      onProgress?.('cached', 100)
      return target
    }
    fs.rmSync(target, { force: true })
  }

  // 0.3.16 起三款 mod 的安装包都放阿里云 OSS（download.url）；客户端里仍随包带一份图书馆 / DON'T SCREAM 的 zip，
  // OSS 下不动（断网、桶被改私有、地址写错）时回落到内置包，主播照样装得上。轮椅 214 MB 不随包，没有回落。
  const local = join(catalogDir(), 'demos', fallback?.filename || mod.download.filename)
  let usedFallback = false
  let downloadError = ''
  if (mod.download.url) {
    onProgress?.('download', 0)
    try {
      await downloadFile(mod.download.url, target, (pct) => onProgress?.('download', pct))
    } catch (err) {
      fs.rmSync(target, { force: true })
      fs.rmSync(target + '.part', { force: true })
      downloadError = err instanceof Error ? err.message : String(err)
      if (!fs.existsSync(local)) throw new Error(`下载失败：${downloadError}`)
      console.warn(`[downloader] ${mod.download.url} 下载失败，改用内置包：${downloadError}`)
      fs.copyFileSync(local, target)
      usedFallback = true
      onProgress?.('download', 100)
    }
  } else {
    if (!fs.existsSync(local)) {
      throw new Error(`找不到内置安装包: ${mod.download.filename}`)
    }
    fs.copyFileSync(local, target)
    onProgress?.('download', 100)
  }

  const expect = usedFallback ? String(fallback?.sha256 || want).toLowerCase() : want
  if (expect) {
    onProgress?.('verify', 0)
    const hash = sha256File(target)
    if (hash.toLowerCase() !== expect) {
      fs.rmSync(target, { force: true })
      throw new Error(usedFallback
        ? `更新源下载失败（${downloadError}），内置安装包又与清单校验值不符，已阻止安装`
        : '下载包 SHA256 校验失败，已阻止安装（可能下载中断，请重试）')
    }
  }
  onProgress?.('verify', 100)
  return target
}

export async function unzipTo(zipPath: string, dest: string): Promise<void> {
  const data = fs.readFileSync(zipPath)
  const zip = await JSZip.loadAsync(data)
  const root = normalize(dest)
  const entries = Object.values(zip.files)
  for (const entry of entries) {
    if (entry.dir) continue
    const out = normalize(join(dest, entry.name))
    if (out !== root && !out.startsWith(root + '\\') && !out.startsWith(root + '/')) {
      throw new Error(`安装包包含非法路径: ${entry.name}`)
    }
    // 更新已装 mod 时保留主播自己的 config.json（礼物映射、快捷键、参数），只有首次安装才写包里的默认配置；
    // mod 对缺失的新键自己取默认值。
    if (basename(entry.name) === 'config.json' && fs.existsSync(out)) continue
    fs.mkdirSync(dirname(out), { recursive: true })
    fs.writeFileSync(out, await entry.async('nodebuffer'))
  }
}

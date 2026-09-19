import { app, BrowserWindow } from 'electron'
import { join, dirname, basename } from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { createCollection } from './db'
import { getSettings } from './settings'
import { gamePathFor } from './games'
import { isProcessRunning } from './game-launcher'
import { downloadMod, unzipTo } from './downloader'
import { Ipc, type InstalledMod, type ModInstallProgress, type ModManifest, type ModsListResult } from '@shared/types'
import { installBlockedReason, modStatusOf } from '@shared/modsCatalog'
import { applyRemoteCatalog } from './mods-catalog-remote'
import { logLine } from './crash-log'
import { catalogDir } from './catalog-dir'

// 自带 mod 目录的位置挪到了 catalog-dir.ts（定义包 schema-store 也要用，放这里会和 mods-catalog-remote 绕成环）；老引用照旧
export { catalogDir }

const installedColl = createCollection<InstalledMod>('installed_mods')

function readManifests(): ModManifest[] {
  const dir = join(catalogDir(), 'manifests')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(join(dir, f), 'utf-8')) as ModManifest
      } catch {
        return null
      }
    })
    .filter((m): m is ModManifest => m !== null)
}

/** 生效清单 = 自带清单 + 远端覆盖层（listMods / 安装 / 卸载都必须用这份，否则游戏库显示新版、点更新却装回旧版，永远「可更新」） */
function effectiveManifests(): ModManifest[] {
  return applyRemoteCatalog(readManifests())
}

function normalizeDir(p: string): string {
  return String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

/** mod 在游戏目录里的「存在证据」文件（清单 installedMarker，相对游戏 exe 所在目录）。 */
function markerPath(mod: ModManifest): string {
  if (!mod.gameId || !mod.installedMarker) return ''
  const gp = gamePathFor(mod.gameId)
  return gp ? join(dirname(gp), mod.installedMarker) : ''
}

/** 客户端装完 mod 后留在 mod 目录旁的版本标记，重装客户端、换账号后仍能认出装的是哪一版。 */
function versionFilePath(mod: ModManifest): string {
  const marker = markerPath(mod)
  return marker ? join(dirname(marker), `.zl-version-${mod.id}`) : ''
}

/**
 * 不是客户端装的也要认得出版本：先看客户端留的版本标记；轮椅 mod 再看 MelonLoader 日志里的「WheelLive vX」
 * （安装程序装的也会有）。UE4SS 那两款 mod 没有别的版本文件，读不到就留空（界面上显示「本机检测到」）。
 */
function detectVersion(mod: ModManifest, exeDir: string): string {
  const vf = versionFilePath(mod)
  if (vf && fs.existsSync(vf)) {
    const v = fs.readFileSync(vf, 'utf-8').trim()
    if (/^\d+(\.\d+)+$/.test(v)) return v
  }
  if (mod.id === 'wheellive') {
    try {
      const log = fs.readFileSync(join(exeDir, 'MelonLoader', 'Latest.log'), 'utf-8')
      const all = [...log.matchAll(/WheelLive v(\d+(?:\.\d+)+)/g)]
      if (all.length) return all[all.length - 1][1]
    } catch {
      /* 没跑过游戏就没有日志 */
    }
  }
  return ''
}

/**
 * 已安装清单 = 客户端自己的安装记录 ∪ 游戏目录里实际存在的 mod。
 * 主播可能用安装程序装的轮椅 mod、或者拷贝过来的目录——客户端是「整蛊台」，必须以游戏目录里的真实情况为准，
 * 否则游戏库一直显示「安装」、环境自检一直报「mod 没装」。记录还在但游戏目录里已经没了的，也按没装算。
 */
export function listMods(): ModsListResult {
  // 自带清单是保底，远端清单只盖 version / download / changelog，且只在远端更新时才盖。
  // 这样上新一版 mod 不用再发一版客户端（mods-catalog-remote.ts 里写了完整分工）。
  const mods = effectiveManifests()
  const installed: Record<string, InstalledMod> = {}
  for (const im of installedColl.all()) installed[im.modId] = im
  for (const mod of mods) {
    const marker = markerPath(mod)
    if (!marker) continue
    const present = fs.existsSync(marker)
    const exeDir = dirname(gamePathFor(mod.gameId!))
    let record: InstalledMod | undefined = installed[mod.id]
    // 装进游戏目录的 mod，安装记录只对「当前这个游戏目录」有效：主播换了游戏路径、或记录指向别处，
    // 记录就不能代表眼前这份，改按游戏目录里的证据重新认（版本标记 / MelonLoader 日志）。
    if (record && mod.installInto === 'exeDir' && normalizeDir(record.installPath) !== normalizeDir(exeDir)) {
      delete installed[mod.id]
      record = undefined
    }
    if (present && !record) {
      let installedAt = Date.now()
      try {
        installedAt = fs.statSync(marker).mtimeMs
      } catch {
        /* 用当前时间兜底 */
      }
      installed[mod.id] = {
        id: mod.id,
        modId: mod.id,
        version: detectVersion(mod, exeDir),
        installPath: exeDir,
        installedAt,
        detected: true
      }
    } else if (!present && record && !fs.existsSync(record.installPath)) {
      delete installed[mod.id]
    }
  }
  return { mods, installed }
}

/**
 * 给页面看的清单：下架（unlisted）的 mod 不给。★只在 IPC 出口用这份；主进程内部
 * （mod-health 修复 / self-check / installedVersionForGame → 连接器本机版本）一律用 listMods() 全量 ——
 * 下架的 mod 主播可能还装着，从全量里删掉它，连接器就会按 0.0.0 去重下老包、自检会报「没装」。
 * 待发售（coming_soon）的照常给：游戏库要显示「待发售」，只是不让装（installMod 里挡）。
 */
export function visibleMods(): ModsListResult {
  const { mods, installed } = listMods()
  // 下架只对「还没装」的人生效：已经装着的主播照样要在游戏库里看到它、启动它、调参数（2026-09-19 全部游戏转未上架时不能影响老用户）
  return { mods: mods.filter((m) => modStatusOf(m) !== 'unlisted' || !!installed[m.id]), installed }
}

/** 某游戏已装 mod 的版本（客户端记录或本机检测），连接器启动时用它做「本机版本」，避免把老版本当成新版本反复提示更新。 */
export function installedVersionForGame(gameId: string): string {
  const { mods, installed } = listMods()
  for (const mod of mods) {
    if (mod.gameId === gameId && installed[mod.id]?.version) return installed[mod.id].version
  }
  return ''
}

/** 比较 a、b 两个点分版本号：>0 表示 a 更新。 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '').split('.').map((n) => Number(n) || 0)
  const pb = String(b || '').split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function pushProgress(p: ModInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Ipc.ModsInstallProgress, p)
  }
}

/** 跑 Inno Setup 类安装程序（轮椅 mod）：静默、不重启、装进指定游戏目录。 */
function runInstaller(exe: string, gameDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/NOCANCEL', `/DIR=${gameDir}`], {
      windowsHide: true,
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('安装程序超过 10 分钟没有结束，已中止'))
    }, 10 * 60 * 1000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`安装程序退出码 ${code}${code === 5 || code === 2 ? '（被取消）' : ''}，请关掉游戏后重试`))
    })
  })
}

// 同一 mod 同一时刻只跑一份安装：双击 / 启动自修撞上手点 / 修复撞上安装，第二路直接复用第一路的结果
const installing = new Map<string, Promise<{ ok: boolean; error?: string }>>()

export function installMod(modId: string): Promise<{ ok: boolean; error?: string }> {
  const inflight = installing.get(modId)
  if (inflight) return inflight
  const task = installModInner(modId).finally(() => installing.delete(modId))
  installing.set(modId, task)
  return task
}

async function installModInner(
  modId: string
): Promise<{ ok: boolean; error?: string }> {
  const mod = effectiveManifests().find((m) => m.id === modId)
  if (!mod) return { ok: false, error: '未找到该 mod' }
  // 上架状态守卫：待发售 / 下架的只拦「首次安装」。已经装在机器上的（客户端记录，或游戏目录里检测到的）
  // 重装、升级、mod-health 一键修复与启动自修照常放行 —— 下架不等于把主播手里的整蛊器收走，
  // 而且修复走的就是这条 installMod，拦了它下架 mod 一坏就再也修不好。判据用 listMods().installed（全量，不是给页面的过滤版）。
  const blocked = installBlockedReason(mod, !!listMods().installed[modId])
  if (blocked) return { ok: false, error: blocked }
  const bundled = readManifests().find((m) => m.id === modId)

  const settings = getSettings()
  // exeDir 类 mod（UE4SS / 轮椅安装程序）：直接装进游戏 exe 所在目录；其余进客户端数据目录
  let targetRoot: string
  let gamePath = ''
  if (mod.installInto === 'exeDir' && mod.gameId) {
    gamePath = gamePathFor(mod.gameId)
    if (!gamePath) {
      return { ok: false, error: '尚未定位该游戏，请先到「启动游戏」页自动搜索游戏。' }
    }
    targetRoot = dirname(gamePath)
  } else {
    targetRoot =
      settings.modRootPath && settings.modRootPath.trim()
        ? settings.modRootPath
        : join(app.getPath('userData'), 'mods')
  }

  try {
    if (gamePath && (await isProcessRunning(basename(gamePath), true))) {
      return { ok: false, error: '游戏正在运行，先关掉游戏再安装。' }
    }
    const pkg = await downloadMod(mod, (phase, percent) => pushProgress({ modId, phase, percent }), bundled?.download ? { filename: bundled.download.filename, sha256: bundled.download.sha256 } : undefined)
    const installPath = mod.installInto === 'exeDir' ? targetRoot : join(targetRoot, modId)
    // 装到哪、包从哪来，都记一笔：主播说「没装进游戏目录」时能直接对路径
    logLine('mods', `${modId} ${mod.version} 目标目录 ${installPath}（游戏 exe ${gamePath || '-'}，包 ${basename(pkg)}，方式 ${mod.download.kind}）`)
    fs.mkdirSync(installPath, { recursive: true })
    if (mod.download.kind === 'installer') {
      pushProgress({ modId, phase: 'install', percent: 0, detail: '安装程序运行中' })
      await runInstaller(pkg, installPath)
    } else {
      pushProgress({ modId, phase: 'install', percent: 0 })
      await unzipTo(pkg, installPath)
    }
    // 装完以游戏目录里的证据为准，别只信安装程序的退出码
    const marker = markerPath(mod)
    if (marker && !fs.existsSync(marker)) {
      return { ok: false, error: `安装程序跑完了，但游戏目录里没看到 ${mod.installedMarker}，请检查游戏路径是否正确。` }
    }
    installedColl.remove(modId)
    installedColl.insert({
      id: modId,
      modId,
      version: mod.version,
      installPath,
      installedAt: Date.now()
    })
    try {
      const vf = versionFilePath(mod)
      if (vf) fs.writeFileSync(vf, mod.version, 'utf-8')
    } catch {
      /* 写不进版本标记不影响安装结果 */
    }
    pushProgress({ modId, phase: 'done', percent: 100 })
    return { ok: true }
  } catch (err) {
    pushProgress({ modId, phase: 'done', percent: 0, detail: err instanceof Error ? err.message : String(err) })
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function uninstallMod(modId: string): { ok: boolean; error?: string } {
  const mod = effectiveManifests().find((m) => m.id === modId)
  const im = listMods().installed[modId]
  if (!im) return { ok: false, error: '该 mod 未安装' }
  try {
    if (mod?.download.kind === 'installer') {
      // 安装程序装的：有卸载器就交给卸载器（它知道自己放了哪些文件），静默跑
      const unins = join(im.installPath, 'unins000.exe')
      if (fs.existsSync(unins)) {
        const child = spawn(unins, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { windowsHide: true, stdio: 'ignore', detached: true })
        child.on('error', () => { /* 起不来（EACCES 等）是异步事件，不挂监听会变成主进程未捕获异常 */ })
        child.unref()
      } else {
        return { ok: false, error: '没找到卸载程序，请到游戏目录手动删除 Mods 里的 WheelLive。' }
      }
    } else if (mod?.installInto === 'exeDir' && mod.installedMarker) {
      // 装进游戏目录的 zip：只删 mod 自己的目录（installedMarker 所在目录），绝不删游戏目录本身
      const modDir = dirname(join(im.installPath, mod.installedMarker))
      if (modDir !== im.installPath) fs.rmSync(modDir, { recursive: true, force: true })
    } else {
      fs.rmSync(im.installPath, { recursive: true, force: true })
    }
    installedColl.remove(modId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

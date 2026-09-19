// 授权总开关（2026-09-19 用户拍板：卡密平台连不上就断授权、弹「未授权」，太难受 → 暂时彻底不查；以后想加回来也能加回来）。
//
//   enforce=false（免检）时：
//     · 客户端所有授权门（cardRequire* / IPC 门禁 / 旧邮箱授权 / 直播间绑定额度）一律放行，复核循环不再向平台发请求；
//     · 授权快照对界面报「全部已激活（永久）」，任何页面都不会再出现「未授权 / 未激活」门禁；
//     · 轮椅整蛊器：客户端把 Mods/WheelLive/local-card-license.json 写成 {"provider":"card","free":true}，
//       1.0.0.12 起的 mod 看到它直接视为已授权；组件随客户端携带（output/local-card-mod），启动 / 用游戏功能时自动换上。
//     · 登录 / 账号 / 直播间管理页照旧可用（那些是身份，不是授权），平台连不上也不影响使用。
//   来源优先级：环境变量 ZL_LICENSE_ENFORCE（测试用）> userData/license-policy.json（更新源下发的缓存）> 随安装包的
//   resources/license-policy.json（开发态读 build/license-policy.json）> 默认启用。两个文件都带 since 日期，新的赢：
//   以后要恢复检查，往更新源放一份 {"enforce":true,"since":"..."} 即可，不用再发客户端（下次启动生效，运行中不热切换）。
import { app, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { logLine } from './crash-log'

export type LicensePolicySource = 'env' | 'userData' | 'resources' | 'default'
export interface LicensePolicy {
  enforce: boolean
  since: string
  note: string
  source: LicensePolicySource
}

const FILE = 'license-policy.json'
const REMOTE_URL = ((process.env.WL_UPDATER_FEED as string) || 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/').replace(/\/+$/, '') + '/' + FILE
let cached: LicensePolicy | undefined

function parse(text: string, source: LicensePolicySource): LicensePolicy | null {
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || typeof o.enforce !== 'boolean') return null
    return { enforce: o.enforce, since: String(o.since || ''), note: String(o.note || ''), source }
  } catch {
    return null
  }
}

function userDataFile(): string {
  return path.join(app.getPath('userData'), FILE)
}

function shippedFile(): string {
  return app.isPackaged ? path.join(process.resourcesPath, FILE) : path.join(app.getAppPath(), 'build', FILE)
}

function readFile(file: string, source: LicensePolicySource): LicensePolicy | null {
  try {
    return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), source) : null
  } catch {
    return null
  }
}

function resolve(): LicensePolicy {
  const env = process.env.ZL_LICENSE_ENFORCE
  if (env === '0' || env === '1') return { enforce: env === '1', since: '', note: '环境变量', source: 'env' }
  const local = readFile(userDataFile(), 'userData')
  const shipped = readFile(shippedFile(), 'resources')
  // 两份都有：since 大的赢（新发的客户端能盖过旧缓存，新下发的缓存也能盖过旧客户端）；相同则听更新源的
  if (local && shipped) return local.since >= shipped.since ? local : shipped
  return local || shipped || { enforce: true, since: '', note: '', source: 'default' }
}

/** 读一次并缓存：运行中不热切换（半程切换会让已放行的输出和复核循环打架）。 */
export function licensePolicy(): LicensePolicy {
  if (!cached) cached = resolve()
  return cached
}

/** 是否还要查授权。false = 免检：任何地方都不得再弹「未授权」。 */
export function licenseEnforced(): boolean {
  return licensePolicy().enforce
}

export function logLicensePolicy(): void {
  const p = licensePolicy()
  logLine('license', p.enforce ? `授权检查：已启用（来源 ${p.source}${p.since ? '，' + p.since : ''}）` : `授权检查：已暂停，全部功能免检（来源 ${p.source}${p.since ? '，' + p.since : ''}${p.note ? '，' + p.note : ''}）`)
}

/**
 * 启动后拉一次更新源上的策略文件；和本机缓存不同就存下来，下次启动生效。
 * 拉不到（404 / 断网 / 超时）什么都不动：没有这份文件就按安装包自带的来。
 */
export async function refreshLicensePolicyFromRemote(): Promise<void> {
  try {
    // 带时间戳绕过任何中间缓存；Electron 的 net.fetch 不认 cache 选项
    const res = await net.fetch(REMOTE_URL + '?t=' + Date.now(), { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return
    const text = await res.text()
    const remote = parse(text, 'userData')
    if (!remote) return
    const current = readFile(userDataFile(), 'userData')
    if (current && current.enforce === remote.enforce && current.since === remote.since) return
    fs.writeFileSync(userDataFile(), JSON.stringify({ enforce: remote.enforce, since: remote.since, note: remote.note }), 'utf8')
    const now = licensePolicy()
    if (now.enforce !== remote.enforce) logLine('license', `更新源下发了新的授权策略：${remote.enforce ? '恢复检查' : '暂停检查'}（${remote.since}），下次启动生效`)
  } catch {
    /* 拉不到就用本机的 */
  }
}

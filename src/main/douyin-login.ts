import { app, BrowserWindow, session, type Session } from 'electron'
import fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const LOGIN_URL = 'https://live.douyin.com/'
const PARTITION = 'persist:zhiliao-douyin'
const LOGIN_TIMEOUT = 6 * 60_000
const LOGIN_TITLE = '抖音扫码登录 · 登录后自动保存'
// 抖音首页不会自动展开二维码。只点击页面已有的“登录”入口，不触碰账号或验证码输入。
const OPEN_QR_LOGIN = `(() => {
  const visible = el => el.getClientRects().length > 0;
  const labels = [...document.querySelectorAll('button, a, p, span, [role="button"]')];
  if (labels.some(el => el.textContent?.trim() === '扫码登录' && visible(el))) return true;
  const login = labels.find(el => el.textContent?.trim() === '登录' && visible(el));
  login?.click();
  return false;
})()`
export type LoginResult = { ok: boolean; cookie?: string; error?: string }
let pending: Promise<LoginResult> | null = null
let loginWindow: BrowserWindow | null = null
let cancelLogin: (() => void) | null = null
// 卡密模式的绑定扫码用各自的私有分区，一次只允许一个扫码窗口（和旧登录窗口互斥）
let scanBusy = false

export function hasLogin(cookie: string): boolean {
  return /(?:^|;\s*)sessionid(?:_ss)?=[^;\s]+/.test(cookie)
}

async function sessionCookie(ses: Session): Promise<string> {
  // 只读取登录窗口所在分区里、实际会发送给直播站的 Cookie。
  const cookies = await ses.cookies.get({ url: LOGIN_URL })
  const values = new Map(cookies.map(c => [c.name, c.value]))
  const header = [...values].map(([name, value]) => `${name}=${value}`).join('; ')
  return hasLogin(header) ? header : ''
}

async function browserCookie(): Promise<string> {
  return sessionCookie(session.fromPartition(PARTITION))
}

export async function readDouyinCookie(modDir = ''): Promise<string> {
  // 与轮椅 Login.HasCookie 共用这份登录态；游戏里换号后客户端也使用新令牌。
  if (modDir) {
    try {
      const old = fs.readFileSync(join(modDir, 'douyin_cookie.txt'), 'utf8')
        .replace(/^\uFEFF/, '').replace(/^\s*cookie\s*:\s*/i, '').trim()
      if (hasLogin(old)) return old
    } catch { /* 首次使用没有旧登录文件 */ }
  }
  return browserCookie()
}

export function saveDouyinCookie(modDir: string, cookie: string): void {
  if (!modDir) return
  // Python 连接器沿用原文件格式。先完整写临时文件，失败时保留原登录态。
  const target = join(modDir, 'douyin_cookie.txt')
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, cookie, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temp, target)
  } catch {
    throw new Error('登录状态保存失败，请检查 Mod 目录是否可写后重试')
  } finally {
    try { fs.unlinkSync(temp) } catch { /* 已重命名或未创建 */ }
  }
}

function allowedLoginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      (url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))
  } catch { return false }
}

interface OpenLoginOptions {
  /** 登录窗口所在分区；缺省 = 旧的共享分区 persist:zhiliao-douyin */
  session?: Session
  /** 拿到取消句柄（卡密扫码要能被退出 / 换号 / 停止连接单独取消） */
  onCancel?: (cancel: () => void) => void
  title?: string
}

async function openLogin(force: boolean, options: OpenLoginOptions = {}): Promise<LoginResult> {
  const ses = options.session ?? session.fromPartition(PARTITION)
  if (force) await ses.clearStorageData({ storages: ['cookies'] })
  return new Promise(resolve => {
    let settled = false
    let checking = false
    let openingQr = false
    let qrOpened = false
    let checkAgain = false
    let lastCookieChange = 0
    let cookieTimer: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let win: BrowserWindow | null = null
    const finish = (result: LoginResult) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timeout)
      clearTimeout(cookieTimer)
      ses.cookies.removeListener('changed', changed)
      app.removeListener('before-quit', cancelled)
      if (cancelLogin === cancelled) cancelLogin = null
      if (loginWindow === win) loginWindow = null
      if (win && !win.isDestroyed()) win.destroy()
      resolve(result)
    }
    const cancelled = () => finish({ ok: false, error: '已取消抖音登录，点击连接可重新扫码' })
    const revealQr = async () => {
      if (settled || openingQr || qrOpened || !win || win.isDestroyed()) return
      if (!allowedLoginUrl(win.webContents.getURL())) return
      openingQr = true
      try { qrOpened = await win.webContents.executeJavaScript(OPEN_QR_LOGIN, true) }
      catch { /* 页面跳转或尚未加载时，下次轮询继续 */ }
      finally { openingQr = false }
    }
    const check = async () => {
      if (settled) return
      // 登录响应往往连续设置多枚 Cookie，等这一批写完再保存。
      if (Date.now() - lastCookieChange < 400) return
      if (checking) { checkAgain = true; return }
      checking = true
      try {
        const observedChange = lastCookieChange
        const cookie = await sessionCookie(ses)
        if (cookie && !settled) {
          await ses.cookies.flushStore()
          if (observedChange !== lastCookieChange) return
          ses.flushStorageData()
          finish({ ok: true, cookie })
        }
      } catch {
        finish({ ok: false, error: '无法保存抖音登录状态，请重试' })
      } finally {
        checking = false
        if (checkAgain && !settled) { checkAgain = false; void check() }
      }
    }
    const changed = () => {
      lastCookieChange = Date.now()
      clearTimeout(cookieTimer)
      cookieTimer = setTimeout(() => { void check() }, 400)
    }
    cancelLogin = cancelled
    options.onCancel?.(cancelled)
    app.once('before-quit', cancelled)
    ses.cookies.on('changed', changed)
    try {
      // 不带 preload、不开 node：网页里拿不到客户端任何接口；导航只允许官方 https 抖音子域
      win = new BrowserWindow({
        width: 1100, height: 780, autoHideMenuBar: true,
        title: options.title ?? LOGIN_TITLE,
        webPreferences: {
          session: ses, nodeIntegration: false,
          contextIsolation: true, sandbox: true
        }
      })
      loginWindow = win
      win.on('page-title-updated', event => event.preventDefault())
      win.once('close', cancelled)
      win.once('closed', cancelled)
      win.webContents.on('will-navigate', (event, url) => {
        if (!allowedLoginUrl(url)) event.preventDefault()
      })
      win.webContents.on('will-redirect', (event, url) => {
        if (!allowedLoginUrl(url)) event.preventDefault()
      })
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedLoginUrl(url)) void win?.loadURL(url).catch(() => {})
        return { action: 'deny' }
      })
      win.webContents.on('did-finish-load', () => { changed(); void revealQr() })
      poll = setInterval(() => { void check(); void revealQr() }, 1000)
      timeout = setTimeout(() => finish({ ok: false, error: '扫码登录超时，请点击连接重试' }), LOGIN_TIMEOUT)
      // 使用当前内置 Chromium 的 UA，去掉客户端/Electron 标识。
      const userAgent = ses.getUserAgent().replace(/\s(?:Electron|zhiliao-client)\/\S+/gi, '')
      void win.loadURL(LOGIN_URL, { userAgent }).catch(error => {
        if (error?.code === 'ERR_ABORTED' || error?.errno === -3) return
        finish({ ok: false, error: '无法打开抖音登录网页，请检查网络后重试' })
      })
    } catch {
      finish({ ok: false, error: '无法打开抖音登录窗口，请重试' })
    }
  })
}

function focusLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    if (loginWindow.isMinimized()) loginWindow.restore()
    loginWindow.focus()
  }
}

export function loginDouyin(force = false): Promise<LoginResult> {
  if (pending) {
    focusLoginWindow()
    return pending
  }
  if (scanBusy) {
    focusLoginWindow()
    return Promise.resolve({ ok: false, error: '正在进行直播间绑定扫码，请先完成或关闭那个窗口' })
  }
  pending = openLogin(force)
    .catch(() => ({ ok: false, error: '抖音登录失败，请重试' }))
    .finally(() => { pending = null })
  return pending
}

/**
 * 卡密模式的绑定扫码：在调用方给的私有分区里开一个全新的登录窗口（分区先清空 cookie，一定重新扫码），
 * 不碰共享分区 persist:zhiliao-douyin 里别的主播 / 游戏的登录态。拿到的 cookie 只回给主进程调用方。
 * 同一时刻只允许一个登录 / 扫码窗口；cancel 由调用方保存，退出 / 换号 / 停止连接时用它关窗口。
 */
export function scanDouyinLogin(ses: Session, options: { title?: string } = {}): { result: Promise<LoginResult>; cancel: () => void } {
  if (pending || scanBusy) {
    focusLoginWindow()
    return { result: Promise.resolve({ ok: false, error: '已有抖音登录窗口打开，请先完成或关闭它' }), cancel: () => {} }
  }
  scanBusy = true
  let cancel: () => void = () => {}
  const result = openLogin(true, { session: ses, title: options.title ?? '抖音扫码 · 核实直播间归属', onCancel: (fn) => { cancel = fn } })
    .catch(() => ({ ok: false, error: '抖音登录失败，请重试' }))
    .finally(() => { scanBusy = false })
  return { result, cancel: () => cancel() }
}

export function cancelDouyinLogin(): void {
  cancelLogin?.()
}

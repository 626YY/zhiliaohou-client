// 抖音直播间身份验证：绑定前读取直播间主播昵称+头像，防止乱填房号
import { wheelLiveDir } from './bridge'
import { loginDouyin, readDouyinCookie, saveDouyinCookie } from './douyin-login'
import type { DouyinRoomLookup } from '@shared/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// 抖音接口偶发挂起：不给超时的话 fetch 会一直挂着，绑定流程被卡死。8s 没响应直接放弃。
async function fetchTimeout(
  url: string,
  init: RequestInit = {},
  ms = 8000
): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

function mstoken(n = 182) {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  let s = ''
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

// 页面上是 HTML 实体编码的 JSON，先解实体再 parse（同 douyin_room.py 的 html.unescape）
function unescape(s: string): string {
  return s
    .replace(/\\\//g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
}

// 浏览器 cookie 可能含中文/emoji，HTTP 头只收 latin-1：先 utf-8 编字节再按 latin-1 解（同 _hdr_safe）
function hdrSafe(s: string): string {
  if (!s) return s
  try {
    return Buffer.from(s, 'utf-8').toString('latin1')
  } catch {
    return s
  }
}

// 解 JS 字符串转义（页面内联脚本里的 JSON 是 \" 形式）：\" → "，\/ → /，& → &
function jsUnescape(s: string): string {
  return s
    .replace(/\\(["\\/bfnrt])/g, '$1')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// 兜底：douyin_cookie.txt 是主播自己的登录 cookie，页面里必有 defaultHeaderUserInfo（当前登录账号的昵称+头像）。
// 直播间没开播时页面不内联房主信息，就回落到登录账号身份（offline），提示用户核对房号归属。
// 内联 JSON 引号可能是 \"（转义）也可能是 "（普通），两种都兼容。
function loggedInUser(t: string): DouyinRoomLookup | null {
  const i = t.indexOf('defaultHeaderUserInfo')
  if (i < 0) return null
  const win = t.slice(i, i + 5000)
  const loggedIn = /\\"isLogin\\":true/.test(win) || /"isLogin":true/.test(win)
  if (!loggedIn) return null
  const nickM =
    win.match(/\\"realName\\":\\"([\s\S]*?)\\"/) ||
    win.match(/"realName":"([\s\S]*?)"/) ||
    win.match(/\\"nickname\\":\\"([\s\S]*?)\\"/) ||
    win.match(/"nickname":"([\s\S]*?)"/)
  const avatarM =
    win.match(/\\"avatarUrl\\":\\"([\s\S]*?)\\"/) || win.match(/"avatarUrl":"([\s\S]*?)"/)
  const nick = nickM?.[1]
  const avatar = avatarM?.[1]
  if (!nick || nick === '$undefined') return null
  return { ok: true, nickname: jsUnescape(nick), avatar: avatar ? jsUnescape(avatar) : '' }
}

export async function lookupRoom(room: string, interactive = false): Promise<DouyinRoomLookup> {
  const r = room.trim()
  if (!r) return { ok: false, error: '请先输入直播间号' }
  const dir = wheelLiveDir()
  try {
    let cookie = await readDouyinCookie(dir)
    let loggedIn = false
    if (!cookie && interactive) {
      const login = await loginDouyin()
      if (!login.ok) return { ok: false, needLogin: true, error: login.error }
      cookie = login.cookie || ''
      loggedIn = true
      saveDouyinCookie(dir, cookie)
    }
    if (!cookie) return { ok: false, needLogin: true, error: '请点击绑定或连接，在打开的抖音网页扫码登录，登录状态会自动保存' }
    let result = await lookupWithCookie(r, cookie)
    // 只有主动绑定/连接才打开网页。启动时的头像刷新保持静默；过期只重试一次。
    if (result.needLogin && interactive && !loggedIn) {
      const login = await loginDouyin(true)
      if (!login.ok) return { ok: false, needLogin: true, error: login.error }
      cookie = login.cookie || ''
      saveDouyinCookie(dir, cookie)
      result = await lookupWithCookie(r, cookie)
    }
    return result
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '抖音登录失败，请重试' }
  }
}

/**
 * 主播输入的可能是房号，也可能是整条直播间链接（https://live.douyin.com/123456?…）。
 * 只认 live.douyin.com/<id> 这一种链接；别的域名 / 首页链接一律不猜，回空让界面提示重填。
 */
export function parseRoomInput(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  if (/^[0-9A-Za-z_-]{1,64}$/.test(text)) return text
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text)
    if (url.hostname !== 'live.douyin.com') return ''
    const id = url.pathname.split('/').filter(Boolean)[0] || ''
    return /^[0-9A-Za-z_-]{1,64}$/.test(id) ? id : ''
  } catch {
    return ''
  }
}

/**
 * 只给主进程用（cookie 绝不出主进程）：用一份指定的登录态核实直播间归属，不读 mod 目录、不开登录窗口。
 * 卡密模式的绑定扫码拿到 cookie 后走这里；needLogin=true 表示这份登录态已失效。
 */
export function lookupRoomWithCookie(room: string, cookie: string): Promise<DouyinRoomLookup> {
  const r = room.trim()
  if (!r) return Promise.resolve({ ok: false, error: '请先输入直播间号' })
  if (!cookie) return Promise.resolve({ ok: false, needLogin: true, error: '还没有抖音登录状态，请先扫码' })
  return lookupWithCookie(r, cookie)
}

/**
 * 只给主进程用：扫码后读登录账号本人的昵称 / 头像（live.douyin.com 首页的 defaultHeaderUserInfo）。
 * 抖音页面不会可靠地给出「本人直播间号」，这里绝不从首页推荐里猜房号——房号让主播自己粘贴。
 */
export async function douyinProfileWithCookie(cookie: string): Promise<{ ok: boolean; nickname?: string; avatar?: string; needLogin?: boolean; error?: string }> {
  if (!cookie) return { ok: false, needLogin: true, error: '还没有抖音登录状态，请先扫码' }
  try {
    const res = await fetchTimeout('https://live.douyin.com/', {
      headers: { 'User-Agent': UA, referer: 'https://live.douyin.com/', cookie: hdrSafe(cookie) }
    })
    if (res.status === 401) return { ok: false, needLogin: true, error: '抖音登录已过期，请重新扫码登录' }
    if (!res.ok) return { ok: false, error: `抖音请求失败（${res.status}），稍后再试` }
    const t = await res.text()
    const userInfoAt = t.indexOf('defaultHeaderUserInfo')
    if (userInfoAt >= 0 && /\\?"isLogin\\?"\s*:\s*false/.test(t.slice(userInfoAt, userInfoAt + 5000))) {
      return { ok: false, needLogin: true, error: '抖音登录已过期，请重新扫码登录' }
    }
    const me = loggedInUser(t)
    if (me) return { ok: true, nickname: me.nickname, avatar: me.avatar }
    if (/verify\.snssdk\.com|captcha-verify|cap_verify/.test(t)) return { ok: false, error: '抖音风控拦截，稍等一分钟再试' }
    // 页面没给出账号资料不算失败：登录态本身有效，只是这次没读到昵称
    return { ok: true }
  } catch {
    return { ok: false, error: '网络错误，无法连接抖音，稍后再试' }
  }
}

async function lookupWithCookie(r: string, cookie: string): Promise<DouyinRoomLookup> {
  try {
    // cookie 里没有 ttwid 才去首页拿（同连接器 _fetch_ttwid）
    let ttwid = ''
    if (!/ttwid=/.test(cookie)) {
      const home = await fetchTimeout('https://live.douyin.com/', {
        headers: { 'User-Agent': UA }
      })
      ttwid = (home.headers.get('set-cookie') || '').match(/ttwid=([^;]+)/)?.[1] || ''
    }
    const cookieHdr = hdrSafe(ttwid ? `ttwid=${ttwid}; ${cookie}` : cookie)

    const res = await fetchTimeout(`https://live.douyin.com/${r}`, {
      headers: {
        'User-Agent': UA,
        referer: 'https://live.douyin.com/',
        cookie: cookieHdr
      }
    })
    if (res.status === 401) return { ok: false, needLogin: true, error: '抖音登录已过期，请重新扫码登录' }
    if (!res.ok) return { ok: false, error: `抖音请求失败（${res.status}），稍后再试` }
    const t = await res.text()
    const userInfoAt = t.indexOf('defaultHeaderUserInfo')
    if (userInfoAt >= 0 && /\\?"isLogin\\?"\s*:\s*false/.test(t.slice(userInfoAt, userInfoAt + 5000))) {
      return { ok: false, needLogin: true, error: '抖音登录已过期，请重新扫码登录' }
    }

    // ① data-anchor-info（最稳，昵称+头像一把抓）
    const m = t.match(/data-anchor-info="(\{[^"]*?\})"/)
    if (m) {
      try {
        const obj = JSON.parse(unescape(m[1]))
        const nick = obj?.nickname
        const avatar = obj?.avatar || obj?.avatarUrl || ''
        if (nick && nick !== '$undefined') {
          const placeholder = nick === r || avatar.includes('aweme_default_avatar')
          if (placeholder) {
            return {
              ok: false,
              room: r,
              error: '这个直播间号对不上主播（昵称/头像不对），请核对房号'
            }
          }
          return { ok: true, room: r, nickname: nick, avatar: avatar || '' }
        }
      } catch {
        // 解析失败走下面兜底
      }
    }

    // ② 兜底 anchorInfo 块
    const m2 = t.match(/anchorInfo&quot;:\{&quot;nickname&quot;:&quot;(.*?)&quot;/)
    if (m2) {
      const nick = unescape(m2[1])
      if (nick && nick !== '$undefined') return { ok: true, room: r, nickname: nick, avatar: '' }
    }

    // ③ 直播间没开播 → data-anchor-info 是空 {}，回落当前登录账号身份（cookie 就是主播本人的）
    const me = loggedInUser(t)
    if (me) return { ...me, room: r, offline: true }

    // ④ 连登录账号信息都没有 → 页面没正常加载（真实风控页才会带 verify 域）
    if (/verify\.snssdk\.com|captcha-verify|cap_verify/.test(t))
      return { ok: false, error: '抖音风控拦截，稍等一分钟再试' }
    return { ok: false, error: '没解析到直播间信息，房号可能不对' }
  } catch {
    return { ok: false, error: '网络错误，无法连接抖音，稍后再试' }
  }
}

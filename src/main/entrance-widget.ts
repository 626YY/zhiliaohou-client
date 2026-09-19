import { ENTRANCE_EFFECT_CSS, entranceEffectMarkup, isEntranceEffect } from '../shared/entranceEffects'
import { WIDGET_SKIN_CSS, ENTRANCE_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { emojiPageScript } from './emoji-assets'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onceOutputPageEvent, captureWindowExists } from './output-window'
// 大哥进场：观众进直播间 → 按规则弹欢迎横幅（透明置顶窗）+ 播进场视频 + 放进场音效。
// 复刻参考软件「大哥进场」插件（进场规则 / 内容 / 视频播放窗口 / 视频文件 / 去重）。
// 规则和去重表由主进程常驻持有，页面切走照样迎宾；去重按「规则 + 观众」计时，0 秒=每次进场都迎。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson, uid } from './db'
import { logLine } from './crash-log'
import { openVideoWidget } from './video-widget'
import { openGreenScreen, closeGreenScreen, greenScreenState } from './green-screen'
import { Ipc, type ConnectorEvent, type EntranceBannerStyle, type EntranceConfig, type EntranceRecent, type EntranceRule, type EntranceState } from '@shared/types'

let win: BrowserWindow | null = null
let config: EntranceConfig = normalizeConfig(readJson<Partial<EntranceConfig>>('entrance', {}))
const recent: EntranceRecent[] = []
// key = 规则 id + 观众标识 → 上次触发时间
const lastHit = new Map<string, number>()
let welcomePreview: { name: string; text: string; avatar: string; style: EntranceBannerStyle } | null = null
let welcomeGeneration = 0
let greenTimer: ReturnType<typeof setTimeout> | null = null

// 皮肤值校验：经典 3 款 / 通用皮肤 / 高能特效之外的一律不认
function normalizeStyle(value: unknown): EntranceBannerStyle | undefined {
  if (isEntranceEffect(value)) return value
  if (value === 'gold' || value === 'neon' || value === 'clean') return value
  const skin = normalizeWidgetSkin(value)
  return skin !== 'classic' ? skin : undefined
}

function normalizeRule(value: Partial<EntranceRule> | undefined): EntranceRule {
  const match = value?.match === 'equals' || value?.match === 'contains' ? value.match : 'any'
  const style = normalizeStyle(value?.bannerStyle)
  return {
    id: String(value?.id || '').trim() || uid(),
    enabled: value?.enabled !== false,
    match,
    name: String(value?.name ?? '').trim(),
    text: String(value?.text ?? '').trim() || '欢迎 {name} 进入直播间',
    video: String(value?.video ?? '').trim(),
    videoWindow: value?.videoWindow === 'green' ? 'green' : 'video',
    sound: String(value?.sound ?? '').trim(),
    dedupeSeconds: Math.max(0, Math.trunc(Number(value?.dedupeSeconds) || 0)),
    // 下拉选观众时一起存的头像 / 观众 id：老规则没有就不写，落盘文件形状不变
    ...(String(value?.avatar ?? '').trim() ? { avatar: String(value?.avatar).trim() } : {}),
    ...(String(value?.uid ?? '').trim() ? { uid: String(value?.uid).trim() } : {}),
    // 规则专属皮肤：没选就不写键（跟全局），老规则落盘形状不变
    ...(style ? { bannerStyle: style } : {})
  }
}

// 横幅页是 file:// 页面（webSecurity 关）：连接器给的是本地路径，得转成 file:/// 才能当 <img src>；
// 网络地址 / data: 原样。以前这里把裸路径直接塞给 img.src，连接器缓存的头像在横幅上从来没显示过。
function mediaSrc(value?: string): string {
  const source = String(value || '').trim()
  if (!source || /^(?:https?|data|file):/i.test(source)) return source
  return 'file:///' + source.replace(/\\/g, '/')
}

function normalizeConfig(value?: Partial<EntranceConfig>): EntranceConfig {
  const num = (item: unknown, fallback: number, min: number, max: number) => {
    const n = Number(item)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  return {
    enabled: value?.enabled !== false,
    rules: Array.isArray(value?.rules) ? value.rules.map(normalizeRule) : [],
    bannerSeconds: num(value?.bannerSeconds, 5, 1, 600),
    bannerStyle: normalizeStyle(value?.bannerStyle) || 'gold',
    bannerPosition: value?.bannerPosition === 'center' || value?.bannerPosition === 'bottom' ? value.bannerPosition : 'top',
    bannerWidth: Math.trunc(num(value?.bannerWidth, 640, 200, 3840)),
    bannerHeight: Math.trunc(num(value?.bannerHeight, 140, 60, 1080)),
    videoSeconds: Math.trunc(num(value?.videoSeconds, 0, 0, 3600))
  }
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
${WIDGET_SKIN_CSS}
${ENTRANCE_SKIN_CSS}
${ENTRANCE_EFFECT_CSS}
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
#stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.banner { display: flex; align-items: center; gap: 14px; max-width: 96%; padding: 12px 26px 12px 14px; border-radius: 18px;
  font-family: "Microsoft YaHei", sans-serif; opacity: 0; transform: translateY(-30px) scale(.9); transition: opacity .35s ease, transform .35s cubic-bezier(.2,.9,.3,1.3); }
.banner.show { opacity: 1; transform: translateY(0) scale(1); }
.banner.hide { opacity: 0; transform: translateY(20px) scale(.95); transition: opacity .4s ease, transform .4s ease; }
.avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: rgba(255,255,255,.15); flex: none; }
.avatar.empty { display: flex; align-items: center; justify-content: center; font-size: 30px; }
.text { min-width: 0; font-weight: bold; font-size: 28px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text b { font-size: 1.1em; }
.sub { font-size: 14px; font-weight: normal; opacity: .85; margin-top: 2px; }
/* 金：红底金边，皇冠 + 扫光 */
.gold { background: linear-gradient(135deg, #b3122b 0%, #e01f3d 55%, #8f0d22 100%); border: 3px solid #ffd76a; color: #fff;
  box-shadow: 0 6px 24px rgba(0,0,0,.45), inset 0 0 22px rgba(255,215,106,.35); position: relative; overflow: hidden; }
.gold .text b { color: #ffe08a; text-shadow: 0 1px 0 #7a4a00; }
.gold:after { content: ''; position: absolute; top: -40%; left: -60%; width: 40%; height: 180%; transform: rotate(20deg);
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.55) 50%, rgba(255,255,255,0) 100%); animation: sweep 1.6s ease-in-out 1; }
@keyframes sweep { from { transform:translateX(0) rotate(20deg); } to { transform:translateX(480%) rotate(20deg); } }
/* 霓虹：黑底青紫描边发光 */
.neon { background: rgba(8, 6, 20, .82); border: 2px solid #7df9ff; color: #fff;
  box-shadow: 0 0 14px #7df9ff, inset 0 0 14px rgba(125,249,255,.25); }
.neon .text b { color: #ff4de1; text-shadow: 0 0 10px #ff4de1, 0 0 22px #ff4de1; }
.neon .text { text-shadow: 0 0 8px #7df9ff; }
/* 简洁：半透明黑底白字 */
.clean { background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.25); color: #fff; }
.clean .text b { color: #ffd54a; }
.banner {max-width:calc(100% - 20px);max-height:calc(100vh - 12px);min-height:0}.banner .avatar {width:clamp(24px,38vh,52px);height:clamp(24px,38vh,52px)}
</style>${emojiPageScript()}</head>
<body><div id="stage"></div>
<script>
  var stage = document.getElementById('stage');
  var zlText = window.__zlText || function (el, t) { el.textContent = t; return el; };
  var timer = 0, lastWelcome = null, welcomeUntil = 0;
  window.__welcome = function (name, text, avatar, style, seconds, rich) {
    lastWelcome = { name:name,text:text,avatar:avatar }; welcomeUntil=Date.now()+seconds*1000;
    clearTimeout(timer);
    stage.innerHTML = '';
    var box = document.createElement('div');
    document.body.dataset.widgetSkin = ['gold','neon','clean'].includes(style) ? 'classic' : style;
    box.className = 'banner entrance-banner skin-panel ' + style;
    if (rich) { box.innerHTML=rich; } else {
    if (avatar) {
      var im = document.createElement('img');
      im.className = 'avatar';
      im.src = avatar;
      im.onerror = function () { this.replaceWith(emptyAvatar()); };
      box.appendChild(im);
    } else box.appendChild(emptyAvatar());
    var t = document.createElement('div');
    t.className = 'text';
    // {name} 高亮成粗体金字，其余原样
    var parts = String(text).split('{name}');
    for (var i = 0; i < parts.length; i++) {
      var piece = document.createElement('span'); zlText(piece, parts[i]); t.appendChild(piece);
      if (i < parts.length - 1) { var b = document.createElement('b'); zlText(b, name); t.appendChild(b); }
    }
    if (parts.length === 1) { var b2 = document.createElement('b'); zlText(b2, ' ' + name); t.appendChild(b2); }
    box.appendChild(t);
    }
    stage.appendChild(box);
    requestAnimationFrame(function () { requestAnimationFrame(function () { box.classList.add('show'); }); });
    timer = setTimeout(function () { box.classList.add('hide'); setTimeout(function () { if (box.parentNode) box.remove(); }, 450); }, Math.max(500, seconds * 1000));
  };
  window.__skin = function(style,rich) { if(lastWelcome && stage.firstElementChild && welcomeUntil>Date.now()) window.__welcome(lastWelcome.name,lastWelcome.text,lastWelcome.avatar,style,(welcomeUntil-Date.now())/1000,rich); };

  function emptyAvatar() { var d = document.createElement('div'); d.className = 'avatar empty'; d.textContent = String.fromCodePoint(0x1F451); return d; }
</script>
</body></html>`

function bannerBounds(): { x: number; y: number } {
  const { screen } = require('electron') as typeof import('electron')
  const area = screen.getPrimaryDisplay().workArea
  const x = Math.round(area.x + (area.width - config.bannerWidth) / 2)
  const y = config.bannerPosition === 'top'
    ? area.y + 40
    : config.bannerPosition === 'bottom'
      ? area.y + area.height - config.bannerHeight - 60
      : Math.round(area.y + (area.height - config.bannerHeight) / 2)
  return { x, y }
}

function broadcast(): void {
  const state = entranceState()
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send(Ipc.EntranceChanged, state)
  }
}

export function openEntranceWindow(): { ok: boolean; error?: string } {
  try {
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'entrance-widget.html')
    fs.writeFileSync(tmp, PAGE)
    const { x, y } = bannerBounds()
    win = createCaptureOutputWindow({
      title: '进场',
      width: config.bannerWidth,
      height: config.bannerHeight,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '进场')
    win.loadFile(tmp)
    registerOutputWindow(win, { clickThrough: true })
    onOutputWindowClosed(win, () => { win = null })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开进场横幅窗口失败：' + (e as Error).message }
  }
}

export function closeEntranceWindow(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  return { ok: true }
}

export function entranceState(): EntranceState {
  return {
    open: !!win && !win.isDestroyed(),
    config: { ...config, rules: config.rules.map((rule) => ({ ...rule })) },
    recent: recent.slice(0, 30)
  }
}

export function configureEntrance(value: Partial<EntranceConfig>): { ok: boolean } {
  const previous = config
  config = normalizeConfig({ ...config, ...value })
  writeJson('entrance', config)
  if (win && !win.isDestroyed()) {
    const moved = previous.bannerWidth !== config.bannerWidth || previous.bannerHeight !== config.bannerHeight || previous.bannerPosition !== config.bannerPosition
    // 正在显示的横幅若是某条规则的专属皮肤，改全局皮肤不该把它换掉
    const style = welcomePreview?.style || config.bannerStyle
    void win.webContents.executeJavaScript(`window.__skin&&window.__skin(${JSON.stringify(style)}, ${JSON.stringify(welcomePreview ? entranceEffectMarkup(style, welcomePreview.name, welcomePreview.text, welcomePreview.avatar) : '')})`).catch(() => {})
    if (moved) {
      win.setResizable(true)
      win.setSize(config.bannerWidth, config.bannerHeight)
      win.setResizable(false)
      const { x, y } = bannerBounds()
      win.setPosition(x, y)
    }
  }
  return { ok: true }
}

function matches(rule: EntranceRule, name: string, uid = ''): boolean {
  if (rule.match === 'any') return true
  // 下拉选人时存了观众 id：同 id 直接算命中（改昵称也认得），重名的另一个人不会误中
  if (rule.uid && uid && rule.uid === uid) return true
  const key = rule.name.trim()
  if (!key) return false
  if (rule.match === 'equals') return name.trim() === key
  return name.includes(key)
}

function playSound(soundPath: string): void {
  // 播放由常驻 App 根组件负责（和礼物规则音效同一条路），主进程只负责调度
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send(Ipc.EntertainmentSound, { path: soundPath, mode: 'sync' })
  }
}

function playVideo(rule: EntranceRule, text: string): void {
  if (rule.videoWindow === 'green') {
    // 进场视频固定用绿幕 4 号窗，不占主播自己摆的 1～3 号
    // 只放一遍、到秒数自动收：交给绿幕自己带代际守卫的计时器——以前这里无条件 closeGreenScreen(4)，
    // 10 秒内来了时间盲盒/礼物视频（同用 4 号槽）会被这颗定时器误关
    if (greenTimer) {
      clearTimeout(greenTimer)
      greenTimer = null
    }
    // 开哪个才有哪个：主播没开 4 号绿幕窗口就不播（直播伴侣里本来也没这个来源）
    if (!greenScreenState().slots.find(slot => slot.slot === 4)?.open) {
      console.warn('[entrance] 绿幕 4 号窗口没打开，进场视频没播')
      return
    }
    openGreenScreen(rule.video, 'video', text, 4, { loop: false, maxSeconds: Math.max(3, config.videoSeconds || 10), replace: true })
    return
  }
  openVideoWidget({
    path: rule.video,
    loop: false,
    muted: false,
    volume: 1,
    topMost: true,
    width: 640,
    height: 360,
    bgColor: '#000000',
    autoClose: true,
    maxSeconds: config.videoSeconds
  })
}

function welcome(name: string, liveAvatar: string | undefined, rule: EntranceRule, source: 'live' | 'test'): void {
  const text = rule.text.includes('{name}') ? rule.text : `${rule.text} {name}`
  // 头像：事件自带的（连接器缓存 / 观众名单补的）优先；没有才用规则里下拉选人时存的那张
  const avatar = mediaSrc(liveAvatar || rule.avatar || '')
  // 皮肤：规则专属优先，其次全局
  const style = rule.bannerStyle || config.bannerStyle
  welcomePreview = {name, text, avatar, style}
  const generation = ++welcomeGeneration
  logLine('entrance', `迎宾 ${name}（规则 ${rule.match === 'any' ? '任何人' : rule.match + ':' + rule.name}，皮肤 ${style}${rule.bannerStyle ? '·规则专属' : ''}，窗口${win && !win.isDestroyed() ? '已开' : '未开：横幅不会显示'}${source === 'test' ? '，测试' : ''}）`)
  if (win && !win.isDestroyed()) {
    const target = win
    const present = () => {
      if (target !== win || target.isDestroyed() || generation !== welcomeGeneration) return
      void target.webContents.executeJavaScript(
      `window.__welcome && window.__welcome(${JSON.stringify(name)}, ${JSON.stringify(text)}, ${JSON.stringify(avatar)}, ${JSON.stringify(style)}, ${config.bannerSeconds}, ${JSON.stringify(entranceEffectMarkup(style, name, text, avatar))})`
      ).catch((error) => logLine('entrance', '横幅注入失败：' + (error instanceof Error ? error.message : String(error))))
    }
    // 刚打开窗口就测试/收到进场时，等页面就绪再展示，避免第一条横幅被吞。
    if (target.webContents.isLoadingMainFrame()) onceOutputPageEvent(target, 'did-finish-load', present)
    else present()
  }
  if (rule.video) playVideo(rule, text.replace(/\{name\}/g, name))
  if (rule.sound) playSound(rule.sound)
  recent.unshift({ name: source === 'test' ? `${name}（测试）` : name, ts: Date.now(), rule: rule.match === 'any' ? '任何人' : `${rule.match === 'equals' ? '昵称=' : '包含'}${rule.name}` })
  if (recent.length > 30) recent.length = 30
  broadcast()
}

// 连接器事件入口（connector-runtime 统一分发）：只吃进场事件
export function handleEntranceEvent(event: ConnectorEvent, source: 'live' | 'test' = 'live'): void {
  if (event.type !== 'member') return
  const name = String(event.sender || '').trim()
  if (!config.enabled) { logLine('entrance', `进场 ${name}：总开关关着，忽略`); return }
  if (!name) return
  const who = event.uid || name
  const now = Date.now()
  const rule = config.rules.find((item) => item.enabled && matches(item, name, String(event.uid || '')))
  if (!rule) {
    logLine('entrance', `进场 ${name}${event.uid ? '#' + event.uid : ''}：没有规则命中（${config.rules.filter((r) => r.enabled).length} 条启用）`)
    recent.unshift({ name, ts: now, rule: '' })
    if (recent.length > 30) recent.length = 30
    broadcast()
    return
  }
  if (rule.dedupeSeconds > 0) {
    const key = `${rule.id}|${who}`
    const last = lastHit.get(key) || 0
    if (now - last < rule.dedupeSeconds * 1000) { logLine('entrance', `进场 ${name}：命中规则但在去重期内（还剩 ${Math.ceil((rule.dedupeSeconds * 1000 - (now - last)) / 1000)} 秒），不迎`); return }
    lastHit.set(key, now)
    // 去重表别无限长：超过 5000 条清掉过期的
    if (lastHit.size > 5000) {
      for (const [k, ts] of lastHit) if (now - ts > 3600_000) lastHit.delete(k)
    }
  }
  welcome(name, event.avatar, rule, source)
}

export function entranceTest(name: string, avatar = ''): { ok: boolean; error?: string } {
  const who = String(name || '').trim() || '测试观众'
  if (!config.enabled) return { ok: false, error: '大哥进场总开关是关的' }
  const rule = config.rules.find((item) => item.enabled && matches(item, who))
  if (!rule) return { ok: false, error: `没有规则能匹配「${who}」` }
  if (!win || win.isDestroyed()) return { ok: false, error: '进场横幅窗口没打开，先点「开启横幅窗口」' }
  // 测试不受去重限制，直接迎；「试一试」下拉选了观众就带上那张头像，和真进场看到的一致
  welcome(who, String(avatar || '').trim() || undefined, rule, 'test')
  return { ok: true }
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
  if (greenTimer) clearTimeout(greenTimer)
})

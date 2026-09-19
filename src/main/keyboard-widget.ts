import { WIDGET_SKIN_CSS, normalizeWidgetSkin } from '../shared/widgetSkins'
import { captureTitle } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onceOutputPageEvent } from './output-window'
// 键盘显示挂件：把主播实时按下的键鼠显示给观众（复刻参考软件「键盘显示」插件：卡通 / 专业两种样式）。
//   卡通：按下的键冒出大键帽气泡排成一行，松开后渐隐；鼠标左右键/滚轮也有小图标。
//   专业：画一整块 87 键 TKL 键盘，按下的键高亮。
// 键鼠事件来自 keyboard-hook.ts；窗口关闭且没有键盘锁定动作时停止钩子。
import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { readJson, writeJson } from './db'
import { keyboardHookState, onKeyHookEvent, startKeyboardHook, stopKeyboardHook, type KeyHookEvent } from './keyboard-hook'
import { KEYBOARD_ROWS, KEY_LABELS } from '../shared/keyLabels'
import type { KeyboardWidgetConfig, KeyboardWidgetState } from '@shared/types'

let win: BrowserWindow | null = null
let config: KeyboardWidgetConfig = loadConfig()

/**
 * 读盘时把「按键停留 0.1~0.2 秒」这种存档抬到 0.7 秒：松手就没，主播按半天以为功能坏了。
 * 只在启动读盘时修一次，之后设置页填多少就是多少（想要更短照样可以）。
 */
function loadConfig(): KeyboardWidgetConfig {
  const saved = readJson<Partial<KeyboardWidgetConfig>>('keyboard-widget', {})
  const fade = Number(saved?.fadeMs)
  if (Number.isFinite(fade) && fade > 0 && fade < 300) {
    const fixed = normalizeConfig({ ...saved, fadeMs: 700 })
    try { writeJson('keyboard-widget', fixed) } catch { /* 存不下就下次再说，不拦启动 */ }
    return fixed
  }
  return normalizeConfig(saved)
}
let unsubscribe: (() => void) | null = null

function normalizeConfig(value?: Partial<KeyboardWidgetConfig>): KeyboardWidgetConfig {
  const num = (item: unknown, fallback: number, min: number, max: number) => {
    const n = Number(item)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  return {
    style: value?.style === 'pro' ? 'pro' : 'cartoon',
    theme: value?.theme === 'light' || value?.theme === 'neon' ? value.theme : normalizeWidgetSkin(value?.theme) !== 'classic' ? normalizeWidgetSkin(value?.theme) : 'dark',
    showMouse: value?.showMouse !== false,
    keyScale: num(value?.keyScale, 1, 0.4, 3),
    fadeMs: Math.trunc(num(value?.fadeMs, 700, 100, 10_000)),
    maxKeys: Math.trunc(num(value?.maxKeys, 8, 1, 30)),
    opacity: num(value?.opacity, 1, 0.2, 1),
    background: value?.background === 'green' ? 'green' : 'transparent',
    width: Math.trunc(num(value?.width, value?.style === 'pro' ? 980 : 720, 200, 3840)),
    height: Math.trunc(num(value?.height, value?.style === 'pro' ? 360 : 140, 60, 2160))
  }
}

function pageConfig(cfg: KeyboardWidgetConfig) {
  return { style: cfg.style, theme: cfg.theme, showMouse: cfg.showMouse, keyScale: cfg.keyScale, fadeMs: cfg.fadeMs, maxKeys: cfg.maxKeys, opacity: cfg.opacity }
}

const page = (cfg: KeyboardWidgetConfig) => `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { background: ${cfg.background === 'green' ? '#00FF00' : 'transparent'}; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; }
#root { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
/* 主题变量 */
body.dark { --cap: #2b2f3a; --cap-edge: #171a22; --cap-text: #f4f6fb; --hot: #ff8a3d; --hot-text: #fff; --glow: rgba(255,138,61,.8); }
body.light { --cap: #f5f6fa; --cap-edge: #c8ccd6; --cap-text: #222; --hot: #ff8a3d; --hot-text: #fff; --glow: rgba(255,138,61,.7); }
body.neon { --cap: #0d0f1a; --cap-edge: #3af0ff; --cap-text: #9df3ff; --hot: #ff4de1; --hot-text: #fff; --glow: rgba(255,77,225,.9); }
/* 卡通样式 */
#bubbles { display: flex; gap: 10px; align-items: flex-end; justify-content: center; }
.bubble { min-width: 64px; height: 64px; padding: 0 16px; border-radius: 16px; display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 800; color: var(--hot-text); background: var(--hot); border: 3px solid rgba(255,255,255,.85);
  box-shadow: 0 6px 0 rgba(0,0,0,.35), 0 0 18px var(--glow); transform: scale(.4); opacity: 0; transition: transform .12s cubic-bezier(.2,1.4,.4,1), opacity .12s ease; }
.bubble.on { transform: scale(1); opacity: 1; }
.bubble.off { transform: scale(.85) translateY(10px); opacity: 0; transition: transform .3s ease, opacity .3s ease; }
.bubble.mouse { background: var(--cap); color: var(--cap-text); border-color: var(--cap-edge); }
/* 专业样式：整块键盘 */
#board { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 16px; background: rgba(0,0,0,.35); }
body.light #board { background: rgba(255,255,255,.35); }
.krow { display: flex; gap: 6px; }
.key { height: 44px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700;
  color: var(--cap-text); background: var(--cap); border-bottom: 4px solid var(--cap-edge); transition: background .08s, transform .08s, box-shadow .08s; white-space: nowrap; overflow: hidden; }
.key.gap { visibility: hidden; }
.key.on { background: var(--hot); color: var(--hot-text); border-bottom-width: 1px; transform: translateY(3px); box-shadow: 0 0 16px var(--glow); }
/* 鼠标图标（两种样式共用） */
#mouse { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-left: 18px; }
.mouse-body { width: 44px; height: 68px; border-radius: 22px 22px 20px 20px; background: var(--cap); border: 3px solid var(--cap-edge); position: relative; overflow: hidden; }
.mbtn { position: absolute; top: 0; width: 50%; height: 42%; background: transparent; transition: background .08s; }
.mbtn.l { left: 0; border-right: 2px solid var(--cap-edge); border-bottom: 2px solid var(--cap-edge); }
.mbtn.r { right: 0; border-bottom: 2px solid var(--cap-edge); }
.mbtn.on { background: var(--hot); box-shadow: inset 0 0 12px var(--glow); }
.mwheel { position: absolute; left: 50%; top: 10px; width: 8px; height: 16px; margin-left: -4px; border-radius: 4px; background: var(--cap-edge); z-index: 2; transition: background .08s; }
.mwheel.on { background: var(--hot); box-shadow: 0 0 10px var(--glow); }
.mlabel { font-size: 11px; color: var(--cap-text); opacity: .8; height: 14px; }
${WIDGET_SKIN_CSS}
body[data-widget-skin]:not([data-widget-skin="classic"]) {--cap:var(--ws-bg);--cap-edge:var(--ws-line);--cap-text:var(--ws-text);--hot:var(--ws-accent);--hot-text:var(--ws-bg);--glow:transparent}
body[data-widget-skin="arcade"] .key {border-radius:0}
body[data-widget-skin="paper"] .key {border-radius:3px}
</style></head>
<body class="${cfg.theme}">
<div id="root"></div>
<script>
  var CFG = ${JSON.stringify(pageConfig(cfg))};
  var LABELS = ${JSON.stringify(KEY_LABELS)};
  var ROWS = ${JSON.stringify(KEYBOARD_ROWS)};
  var root = document.getElementById('root');
  var bubbles = {}, keyEls = {}, mouseEls = null, wheelTimer = 0;

  function label(vk) { return LABELS[vk] || ('#' + vk); }
  function applyOpacity() { root.style.opacity = CFG.opacity; }
  // 整块键盘比窗口大时整体缩放塞进去，主播随便拖窗口尺寸都不会裁掉半排键
  function fitBoard() {
    var board = document.getElementById('board');
    if (!board) return;
    var mouse = document.getElementById('mouse');
    var totalW = board.scrollWidth + (mouse ? mouse.offsetWidth + 18 : 0);
    var totalH = Math.max(board.scrollHeight, mouse ? mouse.offsetHeight : 0);
    var s = Math.min(1, (window.innerWidth - 16) / totalW, (window.innerHeight - 16) / totalH);
    root.style.transform = 'scale(' + s + ')';
    root.style.transformOrigin = 'center center';
  }
  window.addEventListener('resize', function () { setTimeout(fitBoard, 50); });

  function buildMouse() {
    if (!CFG.showMouse) return null;
    var box = document.createElement('div');
    box.id = 'mouse';
    box.innerHTML = '<div class="mouse-body"><div class="mbtn l"></div><div class="mbtn r"></div><div class="mwheel"></div></div><div class="mlabel"></div>';
    mouseEls = { l: box.querySelector('.mbtn.l'), r: box.querySelector('.mbtn.r'), wheel: box.querySelector('.mwheel'), label: box.querySelector('.mlabel') };
    return box;
  }

  function build() {
    root.innerHTML = '';
    bubbles = {}; keyEls = {}; mouseEls = null;
    document.body.className = CFG.theme;
    document.body.dataset.widgetSkin = ['dark','light','neon'].includes(CFG.theme) ? 'classic' : CFG.theme;
    if (CFG.style === 'pro') {
      var board = document.createElement('div');
      board.id = 'board';
      board.className = 'skin-motion-panel';
      var unit = 44 * CFG.keyScale;
      ROWS.forEach(function (row) {
        var r = document.createElement('div');
        r.className = 'krow';
        row.forEach(function (cap) {
          var k = document.createElement('div');
          var w = (cap.w || 1) * unit + ((cap.w || 1) - 1) * 6;
          k.className = 'key' + (cap.vk <= 0 ? ' gap' : '');
          k.style.width = w + 'px';
          k.style.height = unit + 'px';
          k.style.fontSize = Math.round(14 * CFG.keyScale) + 'px';
          k.textContent = cap.vk > 0 ? (cap.label || label(cap.vk)) : '';
          if (cap.vk > 0) { (keyEls[cap.vk] = keyEls[cap.vk] || []).push(k); }
          r.appendChild(k);
        });
        board.appendChild(r);
      });
      // 通用修饰键 vk（0x10/0x11/0x12）映射到左边那个键帽，钩子没给左右区分时也能亮
      [[0x10, 0xa0], [0x11, 0xa2], [0x12, 0xa4]].forEach(function (p) { if (!keyEls[p[0]] && keyEls[p[1]]) keyEls[p[0]] = keyEls[p[1]]; });
      root.appendChild(board);
      var m = buildMouse();
      if (m) root.appendChild(m);
      fitBoard();
    } else {
      var wrap = document.createElement('div');
      wrap.id = 'bubbles';
      root.appendChild(wrap);
      var m2 = buildMouse();
      if (m2) root.appendChild(m2);
    }
    applyOpacity();
  }

  function bubbleShow(id, text, isMouse) {
    var wrap = document.getElementById('bubbles');
    if (!wrap) return;
    var b = bubbles[id];
    if (b) { clearTimeout(b.timer); b.el.classList.remove('off'); b.el.classList.add('on'); return; }
    var el = document.createElement('div');
    el.className = 'bubble' + (isMouse ? ' mouse' : '');
    el.textContent = text;
    var s = 64 * CFG.keyScale;
    el.style.height = s + 'px'; el.style.minWidth = s + 'px'; el.style.fontSize = Math.round(26 * CFG.keyScale) + 'px';
    wrap.appendChild(el);
    bubbles[id] = { el: el, timer: 0 };
    requestAnimationFrame(function () { el.classList.add('on'); });
    // 超过上限就把最早的挤掉
    var ids = Object.keys(bubbles);
    while (ids.length > CFG.maxKeys) { bubbleDrop(ids.shift(), true); }
  }
  function bubbleDrop(id, now) {
    var b = bubbles[id];
    if (!b) return;
    if (now) { delete bubbles[id]; b.el.remove(); return; }
    clearTimeout(b.timer);
    b.timer = setTimeout(function () {
      b.el.classList.remove('on'); b.el.classList.add('off');
      setTimeout(function () { if (bubbles[id] === b) { delete bubbles[id]; b.el.remove(); } }, 320);
    }, CFG.fadeMs);
  }

  function setKey(vk, on) {
    if (CFG.style === 'pro') {
      var els = keyEls[vk] || [];
      for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', on);
    } else {
      if (on) bubbleShow('k' + vk, label(vk), false); else bubbleDrop('k' + vk, false);
    }
  }
  var MOUSE_NAMES = { l: '左键', r: '右键', m: '中键', x1: '侧键1', x2: '侧键2' };
  function setMouse(btn, on) {
    if (mouseEls) {
      if (btn === 'l' || btn === 'r') mouseEls[btn].classList.toggle('on', on);
      if (btn === 'm') mouseEls.wheel.classList.toggle('on', on);
      mouseEls.label.textContent = on ? (MOUSE_NAMES[btn] || btn) : '';
    }
    if (CFG.style !== 'pro') { if (on) bubbleShow('m' + btn, MOUSE_NAMES[btn] || btn, true); else bubbleDrop('m' + btn, false); }
  }
  function wheel(delta) {
    var text = delta > 0 ? '滚轮↑' : '滚轮↓';
    if (mouseEls) { mouseEls.wheel.classList.add('on'); mouseEls.label.textContent = text; clearTimeout(wheelTimer); wheelTimer = setTimeout(function () { mouseEls.wheel.classList.remove('on'); mouseEls.label.textContent = ''; }, 250); }
    if (CFG.style !== 'pro') { bubbleShow('w', text, true); bubbleDrop('w', false); }
  }

  window.__key = function (kind, action, vk, button, delta) {
    if (kind === 'key') { setKey(vk, action === 'down'); return; }
    if (!CFG.showMouse) return;
    if (action === 'wheel') wheel(delta); else setMouse(button, action === 'down');
  };
  window.__config = function (next) { for (var k in next) CFG[k] = next[k]; build(); };
  // 卡通样式平时是空的，按键才冒泡。刚打开时先冒一下，主播才知道它已经在了、位置在哪。
  window.__hello = function () {
    if (CFG.style === 'pro') return;
    bubbleShow('hello', '键盘显示已开启', true);
    setTimeout(function () { bubbleDrop('hello', false); }, 1600);
  };
  build();
</script>
</body></html>`

// 「按了没反应」不好查：钩子收到了没有、有没有送进窗口、窗口报没报错，各记一笔，
// 状态里能直接看出断在哪一环。
let forwarded = 0
let forwardError: string | undefined

function forward(event: KeyHookEvent): void {
  if (!win || win.isDestroyed()) { forwardError = '键盘窗口不在了'; return }
  forwarded++
  win.webContents.executeJavaScript(
    `window.__key && window.__key(${JSON.stringify(event.kind)}, ${JSON.stringify(event.action)}, ${Number(event.vk) || 0}, ${JSON.stringify(event.button || '')}, ${Number(event.delta) || 0})`
  ).then(() => { forwardError = undefined }).catch((error: Error) => { forwardError = String(error?.message || error) })
}

export function openKeyboardWindow(value?: Partial<KeyboardWidgetConfig>): { ok: boolean; error?: string } {
  try {
    if (value) configureKeyboardWidget(value, false)
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'keyboard-widget.html')
    fs.writeFileSync(tmp, page(config))
    win = createCaptureOutputWindow({
      title: '键盘',
      width: config.width,
      height: config.height,
      frame: false,
      transparent: config.background === 'transparent',
      backgroundColor: config.background === 'transparent' ? undefined : '#00FF00',
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '键盘')
    win.loadFile(tmp)
    registerOutputWindow(win)
    const opened = win
    onceOutputPageEvent(opened, 'did-finish-load', () => {
      void opened.webContents.executeJavaScript('window.__hello && window.__hello()').catch(() => {})
    })
    onOutputWindowClosed(win, () => {
      win = null
      // 关闭显示订阅；仍有锁定动作时由钩子模块保留到解锁。
      if (unsubscribe) unsubscribe()
      unsubscribe = null
      stopKeyboardHook()
    })
    const started = startKeyboardHook()
    if (!started.ok) return { ok: true, error: started.error }
    if (unsubscribe) unsubscribe()
    unsubscribe = onKeyHookEvent(forward)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开键盘显示窗口失败：' + (e as Error).message }
  }
}

export function closeKeyboardWindow(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  stopKeyboardHook()
  return { ok: true }
}

export function keyboardWidgetState(): KeyboardWidgetState {
  const hook = keyboardHookState()
  return { open: !!win && !win.isDestroyed(), config: { ...config }, hook: { running: hook.running, error: hook.error, lastEventAt: hook.lastEventAt, forwarded, forwardError }, lock: hook.lock }
}

export function configureKeyboardWidget(value: Partial<KeyboardWidgetConfig>, reopen = true): { ok: boolean } {
  const previous = config
  config = normalizeConfig({ ...config, ...value })
  writeJson('keyboard-widget', config)
  if (win && !win.isDestroyed()) {
    if (previous.background !== config.background && reopen) {
      openKeyboardWindow()
    } else {
      if (previous.width !== config.width || previous.height !== config.height) win.setSize(config.width, config.height)
      win.webContents.executeJavaScript(`window.__config && window.__config(${JSON.stringify(pageConfig(config))})`).catch(() => {})
    }
  }
  return { ok: true }
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  stopKeyboardHook()
})

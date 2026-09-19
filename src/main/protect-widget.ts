import { captureTitle } from './capture-output'
import { createCaptureOutputWindow, outputsAlwaysOnTop, registerOutputWindow, onOutputWindowClosed, onceOutputPageEvent } from './output-window'
// 保护主播计时窗口：保护期间在屏幕右上角挂一个「主播保护中 00:12」的小牌子，透明置顶、鼠标穿透。
// 复刻参考软件「保护主播」的「显示保护计时界面」；计时从开启保护那一刻起走。
import { BrowserWindow, app, screen } from 'electron'
import fs from 'fs'
import path from 'path'

let win: BrowserWindow | null = null

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
#card { position: absolute; right: 12px; top: 12px; display: flex; align-items: center; gap: 12px; padding: 10px 18px 10px 14px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(10, 60, 40, .92), rgba(6, 40, 30, .92)); border: 2px solid #34d399; color: #fff;
  font-family: "Microsoft YaHei", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.45), 0 0 16px rgba(52,211,153,.5); animation: pulse 1.6s ease-in-out infinite alternate; }
@keyframes pulse { from { box-shadow: 0 6px 20px rgba(0,0,0,.45), 0 0 10px rgba(52,211,153,.35); } to { box-shadow: 0 6px 20px rgba(0,0,0,.45), 0 0 24px rgba(52,211,153,.8); } }
.icon { font-size: 26px; }
.title { font-size: 15px; font-weight: 700; color: #a7f3d0; letter-spacing: 1px; }
.time { font-size: 26px; font-weight: 900; font-variant-numeric: tabular-nums; }
</style></head>
<body>
<div id="card"><span class="icon">&#128737;&#65039;</span><div><div class="title">主播保护中</div><div class="time" id="t">00:00</div></div></div>
<script>
  var start = Date.now();
  window.__start = function (ts) { start = ts || Date.now(); tick(); };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var s = Math.max(0, Math.floor((Date.now() - start) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    document.getElementById('t').textContent = (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(sec);
  }
  tick();
  setInterval(tick, 250);
</script>
</body></html>`

let startedAtValue = 0

/** 保护页切走再回来要按真值显示（以前只存在页面 state 里，回来显示「开启保护」而规则其实还停着） */
export function protectWidgetState(): { open: boolean; startedAt: number } {
  const open = !!win && !win.isDestroyed()
  return { open, startedAt: open ? startedAtValue : 0 }
}

export function openProtectWidget(startedAt = Date.now()): { ok: boolean; error?: string } {
  startedAtValue = startedAt
  try {
    if (win) {
      try { win.close() } catch { /* ignore */ }
      win = null
    }
    const tmp = path.join(app.getPath('userData'), 'protect-widget.html')
    fs.writeFileSync(tmp, PAGE)
    const area = screen.getPrimaryDisplay().workArea
    const width = 260
    const height = 90
    win = createCaptureOutputWindow({
      title: '保护计时',
      width,
      height,
      x: area.x + area.width - width - 20,
      y: area.y + 20,
      frame: false,
      transparent: true,
      alwaysOnTop: outputsAlwaysOnTop(),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: { webSecurity: false, backgroundThrottling: false }
    })
    captureTitle(win, '保护计时')
    win.loadFile(tmp)
    registerOutputWindow(win, { clickThrough: true })
    onOutputWindowClosed(win, () => { win = null })
    onceOutputPageEvent(win, 'did-finish-load', () => {
      win?.webContents.executeJavaScript(`window.__start && window.__start(${startedAt})`).catch(() => {})
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: '打开保护计时窗口失败：' + (e as Error).message }
  }
}

export function closeProtectWidget(): { ok: boolean } {
  try { win?.close() } catch { /* ignore */ }
  win = null
  startedAtValue = 0
  return { ok: true }
}

app.on('before-quit', () => {
  try { win?.close() } catch { /* ignore */ }
  win = null
})

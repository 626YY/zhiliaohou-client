// 内置绿幕抠图：给挂件窗口里的 <video> 套一层 WebGL 画布，把纯绿背景扣成透明。
// 透明底模式下这个窗口本身就是带 alpha 的源，直播伴侣/OBS 就不用再开自己的绿幕抠像。
//
// 参数含义跟直播伴侣 / OBS 的「色度键」对齐：
//   抠图颜色  默认纯绿 #00FF00（片子的绿幕偏青、偏黄就改这个）
//   相似度    越大，跟抠图颜色越像的像素越容易被扣掉（0~100）
//   边缘平滑  抠除边界的过渡范围，太大人物边缘会发虚（0~100）
//   溢色抑制  压掉人物边缘残留的绿边（0~100）
import type { BrowserWindow } from 'electron'
import { getSettings } from './settings'
import type { ChromaKeyConfig } from '@shared/types'

export const DEFAULT_CHROMA: Required<ChromaKeyConfig> = {
  enabled: false,
  color: '#00ff00',
  similarity: 40,
  smoothness: 12,
  spill: 30
}

export function normalizeChroma(value?: Partial<ChromaKeyConfig> | null): Required<ChromaKeyConfig> {
  const clamp = (raw: unknown, fallback: number): number =>
    Number.isFinite(Number(raw)) ? Math.max(0, Math.min(100, Math.round(Number(raw)))) : fallback
  const raw = String(value?.color || '').trim().replace(/^#/, '')
  return {
    enabled: value?.enabled === true,
    color: /^[0-9a-f]{6}$/i.test(raw) ? '#' + raw.toLowerCase() : DEFAULT_CHROMA.color,
    similarity: clamp(value?.similarity, DEFAULT_CHROMA.similarity),
    smoothness: clamp(value?.smoothness, DEFAULT_CHROMA.smoothness),
    spill: clamp(value?.spill, DEFAULT_CHROMA.spill)
  }
}

/** 某个动作要不要抠图：动作里只存开关，参数统一用设置页那一套。 */
export function chromaFor(enabled: boolean | undefined): Required<ChromaKeyConfig> {
  return { ...normalizeChroma(getSettings().chromaKey), enabled: enabled === true }
}

/** 给已经加载好的挂件窗口套上/关掉抠图（窗口没开或没有 video 就静默跳过）。 */
export function applyChromaKey(win: BrowserWindow | null | undefined, enabled: boolean | undefined): void {
  if (!win || win.isDestroyed()) return
  const config = chromaFor(enabled)
  void win.webContents
    .executeJavaScript(`window.__zlChromaSet&&window.__zlChromaSet(${JSON.stringify(config)})`)
    .catch(() => {})
}

/** 注入到每个输出窗口：抠图脚本本身什么都不做，等业务调 window.__zlChromaSet 才生效。 */
export const CHROMA_SCRIPT = `(function () {
  if (window.__zlChromaSet) return;
  var state = { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30 };
  var video = null, canvas = null, gl = null, tex = null, prog = null, uni = {}, raf = 0;
  function rgb(hex) {
    var h = String(hex || '#00ff00').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16); if (!isFinite(n)) n = 0x00ff00;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  var VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = vec2((p.x+1.0)*0.5, (1.0-p.y)*0.5); gl_Position = vec4(p,0.0,1.0); }';
  var FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex; uniform vec3 uKey; uniform float uSim; uniform float uSmooth; uniform float uSpill;',
    'vec2 uv(vec3 c){ return vec2(-0.169*c.r - 0.331*c.g + 0.5*c.b, 0.5*c.r - 0.419*c.g - 0.081*c.b); }',
    'void main(){',
    '  vec4 c = texture2D(uTex, vUv);',
    '  float d = distance(uv(c.rgb), uv(uKey));',
    '  float a = smoothstep(uSim, uSim + uSmooth + 0.001, d);',
    '  float spill = uSpill * (1.0 - a);',
    '  vec3 rgb = mix(c.rgb, vec3(c.r, min(c.g, max(c.r, c.b)), c.b), spill);',
    '  gl_FragColor = vec4(rgb, c.a * a);',
    '}'
  ].join('\\n');
  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  function ensure() {
    if (canvas) return true;
    video = document.querySelector('video');
    if (!video) return false;
    canvas = document.createElement('canvas');
    canvas.id = 'zl-chroma';
    // borderRadius:0 必须的：转盘页面的 canvas 通配选择器带 border-radius:50%，会把这块画布套成圆形（0.3.42 用户报「视频套了圆圈蒙版」）
    canvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:3;display:none;border-radius:0';
    document.body.appendChild(canvas);
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) { canvas.remove(); canvas = null; return false; }
    var vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { canvas.remove(); canvas = null; return false; }
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); canvas = null; return false; }
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uni.tex = gl.getUniformLocation(prog, 'uTex'); uni.key = gl.getUniformLocation(prog, 'uKey');
    uni.sim = gl.getUniformLocation(prog, 'uSim'); uni.smooth = gl.getUniformLocation(prog, 'uSmooth'); uni.spill = gl.getUniformLocation(prog, 'uSpill');
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }
  function layout() {
    if (!canvas || !video) return;
    var vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return;
    // 和 object-fit:contain 对齐：画布只盖住画面本身，两侧留白交给窗口底色/透明区
    var scale = Math.min(innerWidth / vw, innerHeight / vh);
    var w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.style.left = Math.round((innerWidth - w) / 2) + 'px';
    canvas.style.top = Math.round((innerHeight - h) / 2) + 'px';
    if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
    gl.viewport(0, 0, vw, vh);
  }
  function frame() {
    raf = 0;
    if (!state.enabled || !gl || !video) return;
    if (video.readyState >= 2) {
      layout();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch (e) { }
      gl.uniform1i(uni.tex, 0);
      gl.uniform3fv(uni.key, rgb(state.color));
      gl.uniform1f(uni.sim, Math.max(0.01, state.similarity / 100 * 0.6));
      gl.uniform1f(uni.smooth, Math.max(0.002, state.smoothness / 100 * 0.35));
      gl.uniform1f(uni.spill, state.spill / 100);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    raf = requestAnimationFrame(frame);
  }
  window.__zlChromaSet = function (next) {
    if (next) state = Object.assign(state, next);
    var v = document.querySelector('video');
    if (!state.enabled) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      // 关掉时把画布清空：下次再开的第一帧不会先闪一下上一次视频的最后一帧
      if (canvas && gl) { try { gl.clear(gl.COLOR_BUFFER_BIT); } catch (e) { } }
      if (canvas) canvas.style.display = 'none';
      if (v) v.style.visibility = '';
      return { ok: true, enabled: false };
    }
    if (!ensure()) return { ok: false, error: '窗口里没有可抠图的视频' };
    video.style.visibility = 'hidden';
    canvas.style.display = 'block';
    layout();
    if (!raf) raf = requestAnimationFrame(frame);
    return { ok: true, enabled: true };
  };
  window.__zlChromaState = function () {
    return { enabled: state.enabled, canvas: !!canvas, size: canvas ? [canvas.width, canvas.height] : null, params: state };
  };
  window.addEventListener('resize', function () { if (state.enabled) layout(); });
})();`

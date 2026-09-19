// mod manifest 里的封面/截图写成 `/mod-images/xxx.jpg`（站点根路径）。
// dev 下渲染层是 http://localhost:5173，根路径没问题；打包后主窗口是 file:///…/out/renderer/index.html，
// 根路径会被解析到盘符根（file:///F:/mod-images/…）直接 404——安装版游戏库封面全空。
// 统一把根路径转成相对 index.html 的地址，两种环境都能命中 public 目录里的文件。
export function assetUrl(value: string | undefined | null): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^(?:https?|data|blob|file|zlmedia):/i.test(raw)) return raw
  if (raw.startsWith('/')) {
    try {
      return new URL(raw.replace(/^\/+/, ''), document.baseURI).href
    } catch {
      return raw
    }
  }
  return raw
}

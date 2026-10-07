// 特色整蛊玩法的素材目录解析（图片/音效/视频）。
// 打包后在 resources/special-games，开发时在仓库 assets/special-games；找不到回空串（玩法代码要对缺图容错）。
//
// 还管 zlspecial:// 协议：详情页的预览舞台（iframe）从这里拿页面、素材和主播自选的本地文件。
// 三者同源，fetch / 音视频 / 图片都能用；比 zlmedia 多一条「预览页面」路由，素材路由只认素材目录。
import { app, net, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { buildMicTestPage } from './special-games/mic-test-page'

let cachedDir: string | undefined

/** 素材目录的绝对路径；找不到回空串。 */
export function specialAssetDir(): string {
  if (cachedDir !== undefined) return cachedDir
  const candidates = [
    path.join(process.resourcesPath || '', 'special-games'),
    path.join(app.getAppPath(), 'assets', 'special-games')
  ]
  cachedDir = candidates.find((d) => {
    try {
      return fs.statSync(d).isDirectory()
    } catch {
      return false
    }
  }) || ''
  return cachedDir
}

/** 素材目录的 file:// 前缀（带结尾 /）；找不到素材目录回空串。 */
export function specialAssetBase(): string {
  const dir = specialAssetDir()
  return dir ? pathToFileURL(dir).href.replace(/\/?$/, '/') : ''
}

export const SPECIAL_SCHEME = 'zlspecial'
// 预览只放行媒体/字体/节拍数据：这条通道和 zlmedia 一样能读本地文件，别让它读到配置和凭据
const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|apng|avif|mp4|webm|mov|mkv|avi|m4v|mp3|wav|ogg|m4a|flac|aac|ttf|otf|woff2?)$/i

/** 必须在 app ready 之前、和其它自定义协议放在同一次 registerSchemesAsPrivileged 里注册 */
export const SPECIAL_SCHEME_PRIVILEGES = {
  scheme: SPECIAL_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, stream: true }
}

// 文件不存在（缩略图还没生成、主播删了自选文件）回安静的 404，别让 net.fetch 的拒绝冒成主进程报错
const fetchFile = (file: string): Promise<Response> =>
  net.fetch(pathToFileURL(file).toString()).catch(() => new Response('not found', { status: 404 }))

export function registerSpecialProtocol(previewHtml: (id: string) => string | null): void {
  protocol.handle(SPECIAL_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      const route = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      // zlspecial://app/mictest.html：详情页的麦克风测试（和直播窗口同一份识别代码）
      if (route === 'mictest.html') {
        return new Response(buildMicTestPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      }
      // zlspecial://app/preview/<玩法>.html
      const page = /^preview\/([a-z_]+)\.html$/.exec(route)
      if (page) {
        const html = previewHtml(page[1])
        if (!html) return new Response('not found', { status: 404 })
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      }
      // zlspecial://app/assets/<相对路径>：只认素材目录里面的文件
      if (route.startsWith('assets/')) {
        const dir = specialAssetDir()
        if (!dir) return new Response('not found', { status: 404 })
        const file = path.resolve(dir, route.slice('assets/'.length))
        if (!file.startsWith(path.resolve(dir) + path.sep)) return new Response('forbidden', { status: 403 })
        if (!MEDIA_EXT.test(file) && !/\.json$/i.test(file)) return new Response('forbidden', { status: 403 })
        return fetchFile(file)
      }
      // zlspecial://app/file/<绝对路径>：主播自选的图片/音效/视频/音乐
      if (route.startsWith('file/')) {
        const raw = route.slice('file/'.length)
        if (!raw || !MEDIA_EXT.test(raw)) return new Response('forbidden', { status: 403 })
        return fetchFile(raw)
      }
      return new Response('not found', { status: 404 })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

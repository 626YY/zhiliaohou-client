// 公告：优先从更新源同一台服务器拉 updates/news.json（发版脚本一并上传），拉不到就用内置公告。
// 这样发新版时顺手把「本次更新了什么」推给所有客户端，不依赖本机后台在不在线。
import { net } from 'electron'
import type { NewsItem } from '@shared/types'
import { getSettings } from './settings'

// 内置公告故意留空：公告一律从更新源的 updates/news.json 拉。
// 这里原来有 4 条 7~9 月初的宣传稿，而内置公告是和服务器公告【合并显示】的，
// 于是服务器那份删干净了、主播还是能看到那些过时内容。拉不到服务器时公告页
// 本来就有「暂无公告」空态，不需要拿旧内容占位。
const builtinNews: NewsItem[] = []

let cache: { at: number; items: NewsItem[] } | null = null

function normalize(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const category = String(row.category ?? '公告')
      return {
        id: String(row.id ?? '').trim(),
        title: String(row.title ?? '').trim(),
        date: String(row.date ?? '').trim(),
        category: (category === '发布' || category === '修复' ? category : '公告') as NewsItem['category'],
        content: String(row.content ?? '').trim()
      }
    })
    .filter((item) => item.id && item.title)
}

function fetchRemote(url: string, timeoutMs = 5000): Promise<NewsItem[]> {
  return new Promise((resolve) => {
    let done = false
    const finish = (items: NewsItem[]) => {
      if (!done) {
        done = true
        resolve(items)
      }
    }
    const timer = setTimeout(() => finish([]), timeoutMs)
    try {
      const request = net.request({ url, method: 'GET' })
      const chunks: Buffer[] = []
      request.on('response', (response) => {
        if ((response.statusCode || 0) >= 400) {
          clearTimeout(timer)
          return finish([])
        }
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearTimeout(timer)
          try {
            finish(normalize(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
          } catch {
            finish([])
          }
        })
        response.on('error', () => {
          clearTimeout(timer)
          finish([])
        })
      })
      request.on('error', () => {
        clearTimeout(timer)
        finish([])
      })
      request.end()
    } catch {
      clearTimeout(timer)
      finish([])
    }
  })
}

// 服务器公告在前、内置公告兜底；同 id 以服务器为准。10 分钟内不重复拉。
export async function listNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.items
  const base = String(getSettings().serverUrl || 'https://47.251.93.171:8770').replace(/\/+$/, '')
  const remote = await fetchRemote(`${base}/updates/news.json`)
  const seen = new Set(remote.map((item) => item.id))
  const items = [...remote, ...builtinNews.filter((item) => !seen.has(item.id))]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  cache = { at: Date.now(), items }
  return items
}

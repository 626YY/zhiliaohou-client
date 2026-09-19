import type { EntertainmentGiftImage } from '@shared/types'

function pathKey(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\\/g, '/').toLocaleLowerCase('zh-CN')
}

export function uniqueGiftImages(items: EntertainmentGiftImage[]): EntertainmentGiftImage[] {
  // Main-process results are already connector-first. Keep that ordering so a gift
  // observed in the current room wins, while different built-in/history images remain selectable.
  const source = [...items].sort((a, b) => Number(a.source !== 'connector') - Number(b.source !== 'connector'))
  const seen = new Set<string>()
  const result: EntertainmentGiftImage[] = []
  for (const item of source) {
    const name = String(item.name || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
    const path = pathKey(item.path)
    if (!name || !path) continue
    const key = `${name}\u0000${path}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function giftImageLabel(item: Pick<EntertainmentGiftImage, 'name' | 'label'>): string {
  return item.label || item.name
}

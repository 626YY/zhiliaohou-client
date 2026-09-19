import { useEffect, useRef } from 'react'

// 完成一次后再排下一次，避免慢 IPC 堆积；卸载后的结果不再更新页面。
export function usePolling<T>(read: () => Promise<T>, commit: (value: T) => void, interval: number): void {
  const readRef = useRef(read)
  const commitRef = useRef(commit)
  readRef.current = read
  commitRef.current = commit
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await readRef.current()
        if (active) commitRef.current(value)
      } catch { /* 下一次自动恢复，保留最后一次有效状态 */ }
      if (active) timer = setTimeout(poll, interval)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [interval])
}

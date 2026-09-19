import { useEffect, useState } from 'react'

// 动态主题只使用三个装饰图层；窗口隐藏时暂停，不启动 JS 动画循环。
export default function ThemeAtmosphere() {
  const [paused, setPaused] = useState(document.hidden)
  useEffect(() => {
    const changed = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  return <div className="theme-atmosphere" data-paused={paused} aria-hidden="true"><i /><i /><i /></div>
}

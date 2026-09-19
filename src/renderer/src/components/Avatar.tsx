import { useState } from 'react'

// 头像：有主播抖音头像显示图片，加载失败/无头像回退首字母色块
export function Avatar({
  name,
  avatar,
  className,
  rounded = 'rounded-full'
}: {
  name: string
  avatar?: string
  className?: string
  rounded?: string
}) {
  const [err, setErr] = useState(false)
  if (avatar && !err) {
    return (
      <img
        key={avatar}
        src={avatar}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
        className={`shrink-0 object-cover ${rounded} ${className ?? ''}`}
      />
    )
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-[var(--accent-soft-2)] font-bold text-[var(--accent-2)] ${rounded} ${className ?? ''}`}
    >
      {(name || '?').slice(0, 1)}
    </div>
  )
}

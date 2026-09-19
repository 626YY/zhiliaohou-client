import { Avatar } from './Avatar'
import { CicadaMark } from './CicadaMark'
import { AuthBackdrop } from './AuthBackdrop'

// Steam 风格登录过渡屏：模糊封面背景 + 蝉剪影（扫描光动画）+ 旋转加载环 + 账号名。
// 用于：启动 Splash（无账号信息）、点登录后（带账号名）。
const COVER =
  'https://cdn.cloudflare.steamstatic.com/steam/apps/3504700/library_hero.jpg'

export function AuthLoading({ name, avatar }: { name?: string; avatar?: string }) {
  return (
    <div className="drag-region relative flex h-full flex-col items-center justify-center overflow-hidden bg-[var(--bg)]">
      <AuthBackdrop cover={COVER} />
      <div className="pointer-events-none absolute inset-0 bg-[var(--bg)]/72" />

      <div className="relative flex items-center justify-center">
        <div
          className="absolute animate-spin rounded-full border-2 border-white/15 border-t-white/85"
          style={{ width: 128, height: 128, animationDuration: '1.1s' }}
        />
        <CicadaMark size={56} />
      </div>
      <div className="relative mt-6 text-sm tracking-wide text-white/90">
        正在登录…
      </div>

      {name && (
        <div className="relative mt-8 flex items-center gap-2.5 rounded-lg bg-black/35 px-3.5 py-2 backdrop-blur">
          <Avatar name={name} avatar={avatar} className="h-8 w-8 text-sm" rounded="rounded-md" />
          <span className="max-w-56 truncate text-sm text-white/85">{name}</span>
        </div>
      )}
    </div>
  )
}

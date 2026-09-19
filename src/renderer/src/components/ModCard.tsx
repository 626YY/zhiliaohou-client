import { useNavigate } from 'react-router-dom'
import type { InstalledMod, ModManifest } from '@shared/types'
import { Tag } from './ui'
import { assetUrl } from '../utils/assetUrl'
import { modUpdateAvailable } from '../lib/version'
import { modStatusOf } from '@shared/modsCatalog'

interface ModCardProps {
  mod: ModManifest
  installed?: InstalledMod
}

export function ModCard({ mod, installed }: ModCardProps) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(`/mod/${mod.id}`)}
      className="zl-card zl-card-hover group overflow-hidden text-left"
    >
      <div
        className="relative flex aspect-[16/7] items-center justify-center overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${mod.color}33, ${mod.color})`
        }}
      >
        {mod.cover ? (
          <img
            src={assetUrl(mod.cover)}
            alt={mod.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="text-4xl font-black text-[var(--text)]/90 drop-shadow-lg">
            {mod.name.slice(0, 1)}
          </span>
        )}
        <span className="tnum absolute right-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          v{mod.version}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-semibold text-[var(--text)]">
            {mod.name}
          </div>
          <Tag className="shrink-0">{mod.category}</Tag>
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-4 text-[var(--text-3)]">
          {mod.tagline}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-[var(--text-4)]">{mod.game}</span>
          {installed && modUpdateAvailable(mod.version, installed.version) ? (
            <span className="tnum font-medium text-[var(--accent)]">可更新 v{mod.version}</span>
          ) : installed ? (
            <span className="tnum font-medium text-[var(--ok)]">
              {installed.version ? `已安装 v${installed.version}` : '已安装 · 本机检测到'}
            </span>
          ) : modStatusOf(mod) === 'coming_soon' ? (
            <span className="rounded-full bg-[var(--warn-soft)] px-2 py-0.5 font-medium text-[var(--warn)]">待发售</span>
          ) : (
            <span className="font-medium text-[var(--accent)]">安装</span>
          )}
        </div>
      </div>
    </button>
  )
}

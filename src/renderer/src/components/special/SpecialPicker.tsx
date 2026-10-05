// 基础引导里的「选一个特色整蛊」：17 个玩法做成带美术的小卡片，点一下选中，下面填数量；
// 第一张是「盲盒随机」：选它就在下面勾奖池（和时间插件的盲盒一样，每份礼物从勾选的事件里随机抽一个）。
// 选中后的参数和礼物规则里的完全一样（玩法|操作|数量|选项），只是换玩法时回到该玩法的默认操作和常用数量；
// 盲盒在向导里记成「box:奖池参数」（和礼物规则向导的约定一致）。
import { useEffect, useState } from 'react'
import SpecialActionFields from '../SpecialActionFields'
import SpecialBoxPool, { defaultSpecialBoxParam } from './SpecialBoxPool'
import { specialArtUrls } from '../../lib/specialArt'
import { useSpecialBoxEvents } from '../../lib/useSpecialBoxEvents'
import { SPECIAL_CATEGORY_LABELS, SPECIAL_GAMES, SPECIAL_GAME_MAP, parseSpecialParam, specialDefaultParam, type SpecialGameId } from '@shared/specialGames'

let assetDirCache: string | null = null

export default function SpecialPicker({ value, onChange, simple = true }: { value: string; onChange: (param: string) => void; simple?: boolean }) {
  const [assetDir, setAssetDir] = useState(assetDirCache ?? '')
  useEffect(() => {
    if (assetDirCache !== null) return
    void window.api.specialState().then((st) => { assetDirCache = st.assetDir || ''; setAssetDir(assetDirCache) }).catch(() => {})
  }, [])
  const { events } = useSpecialBoxEvents()
  const isBox = value.startsWith('box:')
  const current = isBox ? '' : parseSpecialParam(value).id
  const pick = (id: SpecialGameId) => {
    if (id === current) return
    onChange(specialDefaultParam(id))
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 min-[560px]:grid-cols-4" role="radiogroup" aria-label="选择特色整蛊玩法">
        <button
          type="button"
          role="radio"
          aria-checked={isBox}
          aria-label="盲盒随机"
          title="每份礼物从你勾选的事件里随机抽一个"
          onClick={() => { if (!isBox) onChange('box:' + defaultSpecialBoxParam(events)) }}
          className={`group flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition ${isBox ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-elev)]'}`}
        >
          <span className="flex h-12 w-full items-center justify-center rounded-md text-2xl" style={{ background: 'linear-gradient(135deg, #ff7a18, #ff3d7f 60%, #8b5cf6)' }}>🎁</span>
          <span className={`truncate text-xs ${isBox ? 'font-semibold text-[var(--accent-2)]' : 'text-[var(--text-2)]'}`}>盲盒随机</span>
        </button>
        {SPECIAL_GAMES.map((g) => {
          const on = g.id === current
          const art = specialArtUrls(g.id, assetDir)[0]
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={g.name}
              title={g.desc}
              onClick={() => pick(g.id)}
              className={`group flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition ${on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-elev)]'}`}
            >
              <span
                className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-md"
                style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${g.tint} 85%, #fff), color-mix(in srgb, ${g.tint} 55%, #05070a))` }}
              >
                {art ? (
                  <img src={art} alt="" draggable={false} className="h-10 w-[80%] object-contain transition-transform group-hover:scale-110" style={{ filter: 'drop-shadow(0 3px 4px rgb(0 0 0 / 0.35))' }} />
                ) : (
                  <span className="text-2xl">{g.emoji}</span>
                )}
              </span>
              <span className={`text-xs ${on ? 'font-semibold text-[var(--accent-2)]' : 'text-[var(--text-2)]'}`}>{g.name}</span>
            </button>
          )
        })}
      </div>
      {isBox && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <p className="mb-2 text-xs leading-5 text-[var(--text-3)]">勾选这个礼物抽哪些事件。事件（玩法、数量）在「特色整蛊」页的盲盒事件库里改。</p>
          <SpecialBoxPool value={value.slice(4)} onChange={(v) => onChange('box:' + v)} idp="setup-special-box" />
        </div>
      )}
      {current && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <p className="mb-3 text-xs leading-5 text-[var(--text-3)]">
            <span className="mr-1 rounded bg-[var(--bg-card)] px-1.5 py-px text-[10px] text-[var(--text-3)]">{SPECIAL_CATEGORY_LABELS[SPECIAL_GAME_MAP[current].category]}</span>
            {SPECIAL_GAME_MAP[current].how}
          </p>
          <SpecialActionFields fixedId={current} value={value} onChange={onChange} idp="setup-special" simple={simple} />
        </div>
      )}
    </div>
  )
}

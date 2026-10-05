import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap,
  Radio,
  ShieldCheck,
  Gift,
  Gamepad2,
  Save,
  Trash2,
  Link2,
  Check,
  Wand2,
  ChevronRight
} from 'lucide-react'
import type { CustomBox, EntertainmentRule, LiveStateResult, NativeKeybinds } from '@shared/types'
import { SPECIAL_GAMES, SPECIAL_GAME_MAP, parseSpecialBoxParam, parseSpecialParam, specialDefaultParam, type SpecialGameId } from '@shared/specialGames'
import { useSpecialBoxes } from '../lib/useSpecialBoxes'
import { prankGroups, usePrankCatalog } from '../lib/pranks'
import { PRESET_GIFTS } from '../lib/blindbox'
import GameSelector from '../components/GameSelector'
import { keyLabel } from '../components/KeyBindEditor'
import { GatePanel } from '../components/GatePanel'
import { Btn, Input, Kbd, Loading, Pill, Select } from '../components/ui'
import { useGameAuth } from '../lib/useGameAuth'
import { useToast } from '../stores/ui'

const PROTECT_SECS = [15, 30, 60]

function ActionBtn({
  onClick,
  flashed,
  danger,
  disabled,
  children
}: {
  onClick: () => void
  flashed?: boolean
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-w-[4.5rem] items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition active:scale-[0.97] disabled:opacity-40 ${
        flashed
          ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
          : danger
            ? 'border border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)] hover:border-[var(--danger)]'
            : 'bg-[var(--bg-elev)] text-[var(--text-2)] hover:bg-[var(--line)] hover:text-[var(--text)]'
      }`}
    >
      <Check size={13} className={flashed ? '' : 'invisible'} aria-hidden />
      {children}
    </button>
  )
}

export default function PrankControl() {
  const toast = useToast((s) => s.toast)
  const navigate = useNavigate()
  const { games, ready, gameId, setGameId, authorized } = useGameAuth()
  const canEdit = ready && !!gameId && authorized(gameId)
  const [live, setLive] = useState<LiveStateResult | null>(null)
  const [flashed, setFlashed] = useState<string | null>(null)
  const [giftCount, setGiftCount] = useState(1)
  const [customBoxes, setCustomBoxes] = useState<CustomBox[]>([])
  // 礼物联动：观众送礼物 → 自动触发整蛊（写 config.json 的 GiftMap，mod 启动时加载）
  const [giftMap, setGiftMap] = useState<Record<string, string>>({})
  const [giftName, setGiftName] = useState('')
  const [giftPrank, setGiftPrank] = useState('')
  const [giftDirty, setGiftDirty] = useState(false)
  const [configBinds, setConfigBinds] = useState<Record<string, string>>({})
  const [defaults, setDefaults] = useState<NativeKeybinds | null>(null)
  // 上次已保存的 GiftMap 快照：实时同步时做增量 diff（新增/改绑/解绑分别推送）
  const lastSaved = useRef<Record<string, string>>({})
  // 特色整蛊的礼物联动：画面整蛊在客户端执行，存成娱乐助手「礼物触发」规则（和游戏整蛊列在同一个礼物联动里）
  const [specialRules, setSpecialRules] = useState<EntertainmentRule[]>([])
  const [boxRules, setBoxRules] = useState<EntertainmentRule[]>([])
  const { boxes } = useSpecialBoxes()
  const loadSpecialRules = useCallback(async () => {
    const list = await window.api.entertainmentRulesList()
    const gift = (r: EntertainmentRule) => (r.triggerType || 'gift') === 'gift' && r.actionType === 'command'
    setSpecialRules(list.filter((r) => gift(r) && r.commandCmd === 'special-play' && !!parseSpecialParam(r.commandParam).id))
    setBoxRules(list.filter((r) => gift(r) && r.commandCmd === 'special-box'))
  }, [])
  useEffect(() => { void loadSpecialRules() }, [loadSpecialRules])

  const refresh = useCallback(async () => {
    setLive(await window.api.liveState())
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  // 与 mod 共享 config.json 的数据直接读取展示：盲盒 / 礼物联动(GiftMap) / 快捷键(Binds)
  // gameId 变化（切游戏）要重读，不然还显示上一个游戏的配置
  useEffect(() => {
    setGiftMap({})
    setConfigBinds({})
    setCustomBoxes([])
    lastSaved.current = {}
    window.api.readConfig().then((r) => {
      if (!r.ok) return
      if (Array.isArray(r.values.CustomBoxes)) {
        setCustomBoxes(r.values.CustomBoxes as CustomBox[])
      }
      const gm = r.values.GiftMap
      if (gm && typeof gm === 'object' && !Array.isArray(gm)) {
        setGiftMap(gm as Record<string, string>)
        lastSaved.current = gm as Record<string, string>
      }
      const bd = r.values.Binds
      if (bd && typeof bd === 'object' && !Array.isArray(bd)) {
        setConfigBinds(bd as Record<string, string>)
      }
    })
  }, [gameId])

  // mod 原生默认键位：config 里的 Binds 覆盖它，取并集后每个整蛊都能显示快捷键
  useEffect(() => {
    window.api.readPranks().then(({ defaults }) => setDefaults(defaults))
  }, [gameId])

  const connected = !!(live && live.running && live.bridgeOk)

  const flash = (key: string) => {
    setFlashed(key)
    setTimeout(() => setFlashed((cur) => (cur === key ? null : cur)), 1200)
  }

  const run = async (cmd: string, key: string) => {
    const res = await window.api.liveCmd(cmd)
    if (!res.ok) {
      toast(res.error ?? '发送失败', 'error')
      return
    }
    flash(key)
    window.api.statsPrankTick()
  }

  // 特色整蛊：叠在直播画面上，不经过游戏，没开游戏也能点（玩法窗口没开会自动打开）
  const runSpecial = async (id: SpecialGameId) => {
    const res = await window.api.specialTest(id)
    if (!res.ok) {
      toast(res.error ?? '触发失败', 'error')
      return
    }
    flash(`special-${id}`)
    window.api.statsPrankTick()
  }
  const runBox = async (id: string, name: string) => {
    const res = await window.api.specialBoxTest(id)
    if (!res.ok) { toast(res.error ?? '开盒失败', 'error'); return }
    flash(`specialbox-${id}`)
    toast(`「${name}」开出了 ${res.opened?.length ?? 0} 个特色整蛊`, 'success')
    window.api.statsPrankTick()
  }
  const unbindSpecial = async (rule: EntertainmentRule) => {
    await window.api.entertainmentRuleRemove(rule.id)
    void loadSpecialRules()
  }

  // 模拟观众：游戏里的整蛊器收一份（bridge），客户端的礼物触发 / 特色整蛊也收一份——和真礼物走的两条路一样
  const simulate = async (bridgeCmd: string, line: string, key: string) => {
    const client = await window.api.connectorSimulate(line)
    if (connected) {
      const res = await window.api.liveCmd(bridgeCmd)
      if (!res.ok) toast(res.error ?? '发送失败', 'error')
    }
    if (client.ok) flash(key)
  }

  // prankId → 中文名，礼物联动列表里显示绑定的整蛊。菜单来自定义包（更新源刷新会变），所以订阅整表
  const prankCatalog = usePrankCatalog()
  const groups = useMemo(() => prankGroups(gameId ?? ''), [gameId, prankCatalog])
  const prankNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) for (const it of g.items) m.set(it.id, it.name)
    return m
  }, [groups])
  // prankId → 快捷键（config 的 Binds 覆盖 mod 原生默认）
  const keyOf = useCallback(
    (pid: string) => configBinds[pid] ?? defaults?.binds?.[pid] ?? '',
    [configBinds, defaults]
  )
  const keyText = (pid: string) => {
    const k = keyLabel(keyOf(pid))
    return k === '未绑定' ? '' : k
  }

  const bindGift = async () => {
    const name = giftName.trim()
    if (!name) {
      toast('先填礼物名', 'info')
      return
    }
    if (!giftPrank) {
      toast('先选要触发的整蛊', 'info')
      return
    }
    // 特色整蛊盲盒：同样存成礼物触发规则，立即生效
    if (giftPrank.startsWith('specialbox:')) {
      const box = boxes.find((b) => b.id === giftPrank.slice('specialbox:'.length))
      if (!box) return
      const r = await window.api.entertainmentRuleAdd({
        id: '', name: `特色整蛊盲盒·${box.name}`, group: '特色整蛊', giftName: name, triggerType: 'gift',
        actionType: 'command', commandCmd: 'special-box', commandParam: `${box.id}|${box.name}`,
        times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true
      })
      if (!r.ok) { toast(r.error ?? '绑定失败', 'error'); return }
      toast(`已绑定：${name} → 特色整蛊盲盒「${box.name}」，立即生效`, 'success')
      setGiftName('')
      void loadSpecialRules()
      return
    }
    // 特色整蛊：直接存成礼物触发规则，立即生效（不经过游戏，也不用点保存）
    if (giftPrank.startsWith('special:')) {
      const meta = SPECIAL_GAME_MAP[giftPrank.slice('special:'.length)]
      if (!meta) return
      const r = await window.api.entertainmentRuleAdd({
        id: '', name: `特色整蛊·${meta.name}`, group: '特色整蛊', giftName: name, triggerType: 'gift',
        actionType: 'command', commandCmd: 'special-play',
        commandParam: specialDefaultParam(meta.id),
        times: 1, repeat: 1, multiply: true, queueMode: 'instant', enabled: true
      })
      if (!r.ok) { toast(r.error ?? '绑定失败', 'error'); return }
      toast(`已绑定：${name} → 特色整蛊「${meta.name}」，立即生效`, 'success')
      setGiftName('')
      void loadSpecialRules()
      return
    }
    setGiftMap((prev) => ({ ...prev, [name]: giftPrank }))
    setGiftName('')
    setGiftDirty(true)
  }

  const removeGift = (name: string) => {
    setGiftMap((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    setGiftDirty(true)
  }

  // 实时同步到运行中的 mod（bridge bind 命令，走 Live.BindGift 与菜单同路径）后落盘持久化。
  // 未连接时只落盘 config.json，下次开播生效。
  const saveGiftMap = async () => {
    // 增量 diff：新增/改绑 → bind <name> | <pid>；解绑 → bind <name> |（空 pid）
    const diffs: { name: string; pid: string }[] = []
    for (const [name, pid] of Object.entries(giftMap)) {
      if (lastSaved.current[name] !== pid) diffs.push({ name, pid })
    }
    for (const name of Object.keys(lastSaved.current)) {
      if (!(name in giftMap)) diffs.push({ name, pid: '' })
    }
    if (connected && diffs.length > 0) {
      let failed = 0
      for (const d of diffs) {
        const res = await window.api.liveCmd(`bind ${d.name} | ${d.pid}`)
        if (!res.ok) failed++
      }
      if (failed > 0) {
        // 单条失败不中断其余推送；落盘仍写全量，游戏重启后以 config.json 为准
        toast(`${failed} 条未同步进游戏，已写入配置文件，重开游戏后生效`, 'error')
      }
    }
    const res = await window.api.saveConfig({ GiftMap: giftMap })
    if (res.ok) {
      lastSaved.current = giftMap
      toast(connected ? '已同步到游戏' : '已保存，下次开播生效', 'success')
      setGiftDirty(false)
    } else {
      toast(res.error ?? '保存失败', 'error')
    }
  }

  if (!ready) {
    return <Loading className="p-16" />
  }

  if (!canEdit) {
    const gateName = games.find((g) => g.id === gameId)?.name ?? '该游戏'
    return (
      <div className="p-6">
        <div className="mb-5">
          <GameSelector
            games={games}
            gameId={gameId}
            authorized={authorized}
            onSelect={(id) => setGameId(id)}
          />
        </div>
        <GatePanel gameName={gateName} gameId={gameId} feature="遥控整蛊" onGo={() => navigate('/launch')} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text)]">
            <Zap size={20} className="text-[var(--accent-2)]" />
            整蛊遥控
          </h2>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            游戏运行中一键触发，整蛊效果实时出现在直播间里。
          </p>
          <div className="mt-3">
            <GameSelector
              games={games}
              gameId={gameId}
              authorized={authorized}
              onSelect={(id) => setGameId(id)}
            />
          </div>
        </div>
        {(() => {
          // 有心跳的 mod（轮椅 / 图书管理员）按心跳说话：在不在局内、事件桥开没开，比「进程在跑」诚实得多
          if (!connected) return <Pill tone="muted" dot>未连接 · 需先启动游戏</Pill>
          if (live?.modAlive === undefined) return <Pill tone="ok" dot pulse>已连接 · 实时触发可用</Pill>
          if (!live.modAlive) return <Pill tone="warn" dot>游戏在跑，还没收到 Mod 心跳（刚启动请稍等；一直没有 = Mod 没加载）</Pill>
          if (!live.bridgeReady) return <Pill tone="danger" dot>Mod 在跑但事件桥未就绪（刚启动稍等；一直如此看 MelonLoader 日志）</Pill>
          return <Pill tone="ok" dot pulse>{live.inGame ? 'Mod 在线 · 局内，实时触发可用' : 'Mod 在线 · 在菜单中，整蛊会等进局后执行'}</Pill>
        })()}
      </div>

      {!connected && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-[var(--accent-soft-2)] bg-[var(--accent-soft)] px-4 py-3 text-xs text-[var(--accent-2)]">
          <Radio size={14} />
          游戏未运行或尚未找到对应 Mod。请先到「启动游戏」页启动游戏，连接成功后即可遥控游戏整蛊；下面的特色整蛊和模拟观众不用开游戏也能用。
        </div>
      )}

      {/* 直播辅助：护体(轮椅) / 盲盒 / 显示开关 */}
      <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <ShieldCheck size={16} className="text-[var(--accent-2)]" />
          直播辅助
        </h3>
        {gameId === 'librarian' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-[var(--text-3)]">施法</span>
          <ActionBtn
            onClick={() => run('prank shield', 'autocast')}
            flashed={flashed === 'autocast'}
            disabled={!connected}
          >
            自动施法 20秒
          </ActionBtn>
        </div>
        )}
        {gameId !== 'librarian' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-[var(--text-3)]">护体</span>
          {PROTECT_SECS.map((sec) => (
            <ActionBtn
              key={sec}
              onClick={() => run(`protect ${sec}`, `protect-${sec}`)}
              flashed={flashed === `protect-${sec}`}
              disabled={!connected}
            >
              {sec}秒
            </ActionBtn>
          ))}
          <ActionBtn
            onClick={() => run('protect off', 'protect-off')}
            flashed={flashed === 'protect-off'}
            disabled={!connected}
          >
            关闭
          </ActionBtn>
        </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-[var(--text-3)]">盲盒</span>
          <ActionBtn
            onClick={() => run('box', 'box')}
            flashed={flashed === 'box'}
            disabled={!connected}
          >
            内置大盲盒
          </ActionBtn>
          {customBoxes.map((b) => (
            <ActionBtn
              key={b.Id}
              onClick={() => {
                if (!b.Gift) {
                  toast('该盲盒还未绑定触发礼物，请先在参数编辑器中设置。', 'info')
                  return
                }
                run(`gift ${b.Gift} 1`, `box-${b.Id}`)
              }}
              flashed={flashed === `box-${b.Id}`}
              disabled={!connected}
            >
              {b.Name}
              {b.OpenCount > 1 ? ` ×${b.OpenCount}` : ''}
            </ActionBtn>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-[var(--text-3)]">显示</span>
          {gameId !== 'librarian' && (
            <>
              <ActionBtn
                onClick={() => run('layout on', 'layout-on')}
                flashed={flashed === 'layout-on'}
                disabled={!connected}
              >
                布局 开
              </ActionBtn>
              <ActionBtn
                onClick={() => run('layout off', 'layout-off')}
                flashed={flashed === 'layout-off'}
                disabled={!connected}
              >
                布局 关
              </ActionBtn>
            </>
          )}
          <ActionBtn
            onClick={() => run(gameId === 'librarian' ? 'board' : 'board on', 'board-on')}
            flashed={flashed === 'board-on'}
            disabled={!connected}
          >
            榜单 开
          </ActionBtn>
          <ActionBtn
            onClick={() => run(gameId === 'librarian' ? 'board hide' : 'board off', 'board-off')}
            flashed={flashed === 'board-off'}
            disabled={!connected}
          >
            榜单 关
          </ActionBtn>
        </div>
      </section>

      {/* 礼物联动：观众送礼物 → 自动触发整蛊 */}
      <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Link2 size={16} className="text-[var(--accent-2)]" />
          礼物联动
          <span className="text-xs font-normal text-[var(--text-4)]">
            观众送指定礼物后自动触发对应整蛊，{connected ? '保存后即时同步到游戏。' : '保存后下次开播生效。'}
          </span>
        </h3>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            list="zl-gift-suggest"
            value={giftName}
            onChange={(e) => setGiftName(e.target.value)}
            placeholder="礼物名（如 保时捷）"
            style={{ width: '10rem' }}
          />
          <datalist id="zl-gift-suggest">
            {PRESET_GIFTS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <Select
            value={giftPrank}
            onChange={(e) => setGiftPrank(e.target.value)}
            className="max-w-64"
          >
            <option value="">选择要触发的整蛊…</option>
            {boxes.length > 0 && (
              <optgroup label="特色整蛊盲盒（随机开一种）">
                {boxes.map((b) => (
                  <option key={b.id} value={`specialbox:${b.id}`}>🎁 {b.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="特色整蛊（画面）">
              {SPECIAL_GAMES.map((g) => (
                <option key={g.id} value={`special:${g.id}`}>{g.name}</option>
              ))}
            </optgroup>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.items.map((it) => {
                  const k = keyText(it.id)
                  return (
                    <option key={it.id} value={it.id}>
                      {it.name}
                      {k ? ` · ${k}` : ''}
                    </option>
                  )
                })}
              </optgroup>
            ))}
          </Select>
          <Btn variant="secondary" onClick={() => void bindGift()}>
            绑定
          </Btn>
          <Btn onClick={saveGiftMap} disabled={!giftDirty}>
            <Save size={14} /> {giftDirty ? '保存绑定' : '已保存'}
          </Btn>
        </div>
        {Object.entries(giftMap).length === 0 && specialRules.length === 0 && boxRules.length === 0 ? (
          <p className="text-xs text-[var(--text-4)]">
            还没绑定礼物。填礼物名、选整蛊，点「绑定」后保存即可；特色整蛊绑定后立即生效。
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* 特色整蛊盲盒：按盲盒归并 */}
            {[...boxRules.reduce((m, r) => { const id = parseSpecialBoxParam(r.commandParam).id; return m.set(id, [...(m.get(id) ?? []), r]) }, new Map<string, EntertainmentRule[]>()).entries()].map(([bid, rules]) => (
              <div key={`box-${bid}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-sm">
                <span>🎁</span>
                <span className="font-medium text-[var(--text)]">{boxes.find((b) => b.id === bid)?.name ?? parseSpecialBoxParam(rules[0].commandParam).name ?? bid}</span>
                <span className="rounded bg-[var(--accent-soft)] px-1.5 py-px text-[10px] text-[var(--accent-2)]">特色整蛊盲盒</span>
                <span className="text-[var(--text-3)]">←</span>
                {rules.map((r) => (
                  <span key={r.id} className={`inline-flex items-center gap-1 rounded-md bg-[var(--bg-card)] px-2 py-0.5 ${r.enabled === false ? 'text-[var(--text-4)] line-through' : 'text-[var(--text-2)]'}`}>
                    {r.giftName}
                    <button onClick={() => void unbindSpecial(r)} title={`解绑 ${r.giftName}`} aria-label={`解绑 ${r.giftName}`} className="text-[var(--text-4)] transition hover:text-[var(--danger)]">
                      <Trash2 size={13} />
                    </button>
                  </span>
                ))}
                <button onClick={() => navigate('/special')} className="ml-auto inline-flex items-center text-xs text-[var(--text-3)] hover:text-[var(--accent-2)]">
                  盲盒内容<ChevronRight size={13} />
                </button>
              </div>
            ))}
            {/* 特色整蛊（画面）：按玩法归并，存在礼物触发规则里，解绑立即生效 */}
            {[...specialRules.reduce((m, r) => { const id = parseSpecialParam(r.commandParam).id as SpecialGameId; return m.set(id, [...(m.get(id) ?? []), r]) }, new Map<SpecialGameId, EntertainmentRule[]>()).entries()].map(([sid, rules]) => (
              <div key={`special-${sid}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-sm">
                <Wand2 size={13} className="text-[var(--accent-2)]" />
                <span className="font-medium text-[var(--text)]">{SPECIAL_GAME_MAP[sid]?.name ?? sid}</span>
                <span className="rounded bg-[var(--accent-soft)] px-1.5 py-px text-[10px] text-[var(--accent-2)]">特色整蛊</span>
                <span className="text-[var(--text-3)]">←</span>
                {rules.map((r) => (
                  <span key={r.id} className={`inline-flex items-center gap-1 rounded-md bg-[var(--bg-card)] px-2 py-0.5 ${r.enabled === false ? 'text-[var(--text-4)] line-through' : 'text-[var(--text-2)]'}`} title={r.enabled === false ? '这条联动停用了' : undefined}>
                    {r.giftName}
                    <button onClick={() => void unbindSpecial(r)} title={`解绑 ${r.giftName}`} aria-label={`解绑 ${r.giftName}`} className="text-[var(--text-4)] transition hover:text-[var(--danger)]">
                      <Trash2 size={13} />
                    </button>
                  </span>
                ))}
                <button onClick={() => navigate(`/special?tool=${sid}`)} className="ml-auto inline-flex items-center text-xs text-[var(--text-3)] hover:text-[var(--accent-2)]">
                  数量和玩法设置<ChevronRight size={13} />
                </button>
              </div>
            ))}
            {/* 按整蛊归并：同一个整蛊绑了几个礼物就列在同一行（一个礼物一行时「抖音→猫头鹰、点赞→猫头鹰」看着像重复，2026-09-14 主播反馈） */}
            {[...Object.entries(giftMap).reduce((m, [name, pid]) => m.set(pid, [...(m.get(pid) ?? []), name]), new Map<string, string[]>()).entries()].map(([pid, names]) => {
              const k = keyText(pid)
              return (
                <div
                  key={pid}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-sm"
                >
                  <span className="text-[var(--accent-2)]">★</span>
                  <span className="font-medium text-[var(--text)]">{prankNames.get(pid) ?? pid}</span>
                  {k && <Kbd>{k}</Kbd>}
                  <span className="text-[var(--text-3)]">←</span>
                  {names.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-card)] px-2 py-0.5 text-[var(--text-2)]"
                    >
                      {name}
                      <button
                        onClick={() => removeGift(name)}
                        title={`解绑 ${name}`}
                        aria-label={`解绑 ${name}`}
                        className="text-[var(--text-4)] transition hover:text-[var(--danger)]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  ))}
                  {names.length > 1 && <span className="text-xs text-[var(--text-4)]">{names.length} 个礼物都触发它</span>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 模拟观众：礼物 / 点赞 / 关注 / 灯牌 */}
      <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Gift size={16} className="text-[var(--accent-2)]" />
          模拟观众
          <span className="text-xs font-normal text-[var(--text-4)]">
            没有观众时也能测试直播效果：游戏整蛊、礼物触发和特色整蛊一起响应，不开游戏也能测画面整蛊。
          </span>
        </h3>
        <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-3)]">
          礼物数量：
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              onClick={() => setGiftCount(n)}
              className={`rounded px-2 py-0.5 transition ${
                giftCount === n
                  ? 'bg-[var(--accent-soft-2)] text-[var(--accent-2)]'
                  : 'bg-[var(--bg-elev)] text-[var(--text-3)] hover:text-[var(--text)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {PRESET_GIFTS.map((name) => (
            <ActionBtn
              key={name}
              onClick={() => void simulate(`gift ${name} ${giftCount}`, `礼物: ${name} ×${giftCount}  by 模拟观众`, `gift-${name}`)}
              flashed={flashed === `gift-${name}`}
            >
              {name}
            </ActionBtn>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ActionBtn
            onClick={() => void simulate('like 10', '点赞: 10 by 模拟观众', 'like10')}
            flashed={flashed === 'like10'}
          >
            点赞 +10
          </ActionBtn>
          <ActionBtn
            onClick={() => void simulate('like 100', '点赞: 100 by 模拟观众', 'like100')}
            flashed={flashed === 'like100'}
          >
            点赞 +100
          </ActionBtn>
          <ActionBtn
            onClick={() => void simulate('follow', '关注 by 模拟观众', 'follow')}
            flashed={flashed === 'follow'}
          >
            关注
          </ActionBtn>
          <ActionBtn
            onClick={() => run('badge', 'badge')}
            flashed={flashed === 'badge'}
            disabled={!connected}
          >
            灯牌
          </ActionBtn>
        </div>
      </section>

      {/* 游戏操作：轮椅专属（重生/坐下/复位） */}
      {gameId !== 'librarian' && gameId !== 'dontscream' && (
      <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--bg-card)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Gamepad2 size={16} className="text-[var(--accent-2)]" />
          游戏操作
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionBtn
            onClick={() => run('respawn', 'respawn')}
            flashed={flashed === 'respawn'}
            disabled={!connected}
          >
            重生
          </ActionBtn>
          <ActionBtn
            onClick={() => run('reseat', 'reseat')}
            flashed={flashed === 'reseat'}
            disabled={!connected}
          >
            重新坐下
          </ActionBtn>
          <ActionBtn
            onClick={() => run('reposition', 'reposition')}
            flashed={flashed === 'reposition'}
            disabled={!connected}
          >
            复位位置
          </ActionBtn>
        </div>
      </section>
      )}

      {/* 全部整蛊：特色整蛊（画面，不用进游戏）+ 游戏里的整蛊分组 */}
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-[var(--text)]">
            <span className="inline-flex items-center gap-1.5"><Wand2 size={14} className="text-[var(--accent-2)]" />特色整蛊</span>
            <span className="text-xs font-normal text-[var(--text-4)]">{SPECIAL_GAMES.length} · 叠在直播画面上，不用进游戏也能点</span>
            <button onClick={() => navigate('/special')} className="ml-auto inline-flex items-center text-xs font-normal text-[var(--text-3)] hover:text-[var(--accent-2)]">
              预览和设置<ChevronRight size={13} />
            </button>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {boxes.map((b) => (
              <ActionBtn key={b.id} onClick={() => void runBox(b.id, b.name)} flashed={flashed === `specialbox-${b.id}`}>
                🎁 {b.name}
              </ActionBtn>
            ))}
            {SPECIAL_GAMES.map((g) => (
              <ActionBtn key={g.id} onClick={() => void runSpecial(g.id)} flashed={flashed === `special-${g.id}`}>
                {g.name}
              </ActionBtn>
            ))}
          </div>
        </section>
        {groups.map((group) => (
          <section key={group.id}>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">
              {group.name}
              <span className="ml-1 text-xs font-normal text-[var(--text-4)]">
                {group.items.length}
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {group.items.map((item) => {
                const k = keyText(item.id)
                return (
                  <ActionBtn
                    key={item.id}
                    onClick={() => run(`prank ${item.id}`, item.id)}
                    flashed={flashed === item.id}
                    danger={item.danger}
                    disabled={!connected}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {item.name}
                      {k && <Kbd>{k}</Kbd>}
                    </span>
                  </ActionBtn>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

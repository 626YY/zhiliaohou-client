import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, RotateCcw, FileWarning, SlidersHorizontal, Zap, Gift, CloudUpload, CloudDownload } from 'lucide-react'
import type { ConfigReadResult, CustomBox, LiveStateResult, NativeKeybinds, PrankDef } from '@shared/types'
import { ParamField } from '../components/ParamField'
import CustomBoxEditor from '../components/CustomBoxEditor'
import { KeyBindEditor } from '../components/KeyBindEditor'
import GameSelector from '../components/GameSelector'
import { GatePanel } from '../components/GatePanel'
import { Btn, Input, Loading, Pill } from '../components/ui'
import { useGameAuth } from '../lib/useGameAuth'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/ui'

import {useConfigurationLevel} from '../lib/configurationLevel'
import {isBasicGameParameter} from '../lib/basicGameParameters'

export default function ConfigEditor() {
  const {level}=useConfigurationLevel()
  const [query,setQuery]=useState('')
  const navigate = useNavigate()
  const toast = useToast((s) => s.toast)
  const user = useAuth((s) => s.user)
  const { games, ready, gameId, setGameId, authorized } = useGameAuth()
  const canEdit = ready && !!gameId && authorized(gameId)
  const [result, setResult] = useState<ConfigReadResult | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [gamePath, setGamePath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<LiveStateResult | null>(null)
  // 实时模式默认开（用户 2026-09-06：「所有游戏默认开实时模式」），关掉会记住
  const [liveMode, setLiveModeState] = useState(() => {
    try { return localStorage.getItem('zl_config_live_mode') !== '0' } catch { return true }
  })
  const setLiveMode = (v: boolean) => {
    setLiveModeState(v)
    try { localStorage.setItem('zl_config_live_mode', v ? '1' : '0') } catch { /* 隐私模式等存不了就只在本次生效 */ }
  }
  const [activeTab, setActiveTab] = useState('')
  const [pranks, setPranks] = useState<PrankDef[]>([])
  const [defaults, setDefaults] = useState<NativeKeybinds | null>(null)
  // 上次读取/保存时的快照：保存时 diff 出改动项，实时推进运行中的游戏
  const lastSaved = useRef<Record<string, unknown>>({})

  const load = async () => {
    const r = await window.api.readConfig()
    setResult(r)
    if (r.ok) {
      const v: Record<string, unknown> = {}
      for (const f of r.schema.fields) {
        v[f.key] = r.values[f.key] ?? f.default
      }
      // 自定义盲盒与 mod 共享 config.json，单独管理、随保存一并写回
      v.CustomBoxes = r.values.CustomBoxes ?? []
      // 快捷键表不在 schema.fields（Dictionary 被跳过），单独从 config 载入
      v.Binds = r.values.Binds ?? {}
      // schema.fields 之外的标量键（如 MenuKey/LeaderboardKey）也要读入，
      // 否则编辑器显示默认值、保存时还会把它们冲掉
      for (const [k, val] of Object.entries(r.values)) {
        if (v[k] === undefined && val !== null && typeof val !== 'object') v[k] = val
      }
      setValues(v)
      lastSaved.current = JSON.parse(JSON.stringify(v))
    }
    setDirty(false)
  }

  const refreshLive = useCallback(async () => {
    setLive(await window.api.liveState())
  }, [])

  useEffect(() => {
    window.api.getSettings().then(({ settings }) => {
      // 当前游戏路径：gamePaths[当前游戏] 优先，WheelLive 兜底旧字段
      const gid = settings.currentGameId ?? ''
      setGamePath(settings.gamePaths?.[gid] || (gid === '4wheel-challenge' ? settings.gamePath : ''))
    })
    window.api
      .readPranks()
      .then(({ pranks, defaults }) => {
        setPranks(pranks)
        setDefaults(defaults)
      })
    refreshLive()
    const t = setInterval(refreshLive, 3000)
    return () => clearInterval(t)
    // gameId 变化（切游戏）要重读 pranks/默认键位，不然还显示上一个游戏的清单
  }, [refreshLive, gameId])

  // 游戏授权通过后才加载参数（未授权游戏只给门禁提示）
  useEffect(() => {
    if (ready && gameId && authorized(gameId)) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gameId, authorized])

  const connected = !!(live && live.running && live.bridgeOk)

  const setField = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    if (liveMode && connected) {
      window.api.liveSet(key, value).then((res) => {
        if (!res.ok) toast(res.error ?? '实时推送失败', 'error')
      })
    }
  }

  // 快捷键等走本地保存，不实时推送（mod 端对 Binds 的实时写入没意义）
  const setLocal = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  // 恢复 mod 原生默认键位：把 config.json 里旧版本残留的旧键/错键刷成源码定义的原生键
  const resetBinds = () => {
    if (!defaults) return
    setValues((prev) => ({ ...prev, Binds: defaults.binds }))
    setDirty(true)
    toast('已填入 mod 原生默认键位，点保存生效', 'info')
  }

  const save = async () => {
    setBusy(true)
    try {
      // 游戏在跑：先把改动项逐条实时推进游戏（cfgset 即时生效），不用重启游戏。
      // 跳过对象/数组（Binds 快捷键表、CustomBoxes 盲盒、list 参数）——这些走落盘，游戏内重开菜单读取。
      let pushed = 0
      let failed = 0
      if (connected) {
        for (const [k, v] of Object.entries(values)) {
          if (v !== null && typeof v === 'object') continue
          if (JSON.stringify(lastSaved.current[k] ?? null) === JSON.stringify(v ?? null)) continue
          const r = await window.api.liveSet(k, v)
          if (r.ok) pushed++
          else failed++
        }
      }
      const res = await window.api.saveConfig(values)
      if (res.ok) {
        lastSaved.current = JSON.parse(JSON.stringify(values))
        setDirty(false)
        if (connected && pushed > 0 && failed === 0) {
          toast(`已保存并同步到游戏，${pushed} 项改动即时生效`, 'success')
        } else if (connected && failed > 0) {
          toast(`已保存到文件，${failed} 项同步游戏失败，重开游戏后生效`, 'error')
        } else if (connected) {
          toast('参数已保存到 config.json', 'success')
        } else {
          toast('已保存到 config.json，游戏未在运行，下次开播生效', 'success')
        }
      } else {
        toast(res.error ?? '保存失败', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const backupCloud = async () => {
    if (!user?.email) return
    setBusy(true)
    try {
      // 云端一份账号一个槽，按游戏分开存：以前轮椅下备份、切到图书管理员再恢复，会把轮椅的键位/盒子/同名标量全写进图书馆 config
      const gid = (await window.api.getSettings()).settings.currentGameId || '4wheel-challenge'
      const prev = await window.api.emailConfigLoad(user.email)
      const games = (prev.ok && prev.has && prev.data && typeof prev.data === 'object' && (prev.data as { __games?: Record<string, unknown> }).__games) || {}
      const payload = { __games: { ...games, [gid]: values }, __savedAt: Date.now(), __game: gid }
      const res = await window.api.emailConfigSave(user.email, payload)
      if (res.ok) toast('参数已备份到云端（' + gid + '）', 'success')
      else toast(res.error ?? '备份失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const restoreCloud = async () => {
    if (!user?.email) return
    setBusy(true)
    try {
      const res = await window.api.emailConfigLoad(user.email)
      if (!res.ok) {
        toast(res.error ?? '拉取失败', 'error')
        return
      }
      if (!res.has) {
        toast('云端还没有备份', 'info')
        return
      }
      const gid = (await window.api.getSettings()).settings.currentGameId || '4wheel-challenge'
      const raw = (res.data || {}) as Record<string, unknown>
      let data: Record<string, unknown> | null = null
      if (raw.__games && typeof raw.__games === 'object') {
        const slot = (raw.__games as Record<string, unknown>)[gid]
        if (!slot || typeof slot !== 'object') {
          toast('云端还没有这款游戏的备份（备份是按游戏分开存的）', 'info')
          return
        }
        data = slot as Record<string, unknown>
      } else if (gid === '4wheel-challenge') {
        data = raw   // 老版本的备份没标游戏，只有轮椅时代存的，只往轮椅恢复
      } else {
        toast('这份云端备份是老版本存的，只能恢复到轮椅模拟器；请在当前游戏重新备份一次', 'info')
        return
      }
      const r = await window.api.saveConfig(data)
      if (r.ok) {
        toast('已从云端恢复', 'success')
        await load()
      } else {
        toast(r.error ?? '恢复写入失败', 'error')
      }
    } finally {
      setBusy(false)
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
        <GatePanel gameName={gateName} gameId={gameId} feature="修改参数" onGo={() => navigate('/launch')} />
      </div>
    )
  }

  if (!result) {
    return <Loading className="p-16" />
  }

  if (!result.ok) {
    const noGame = !gamePath
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16">
        <FileWarning size={40} className="text-[var(--accent)]" />
        <p className="max-w-md text-center text-sm leading-6 text-[var(--text-3)]">
          {result.error}
        </p>
        <Btn size="lg" onClick={() => navigate(noGame ? '/launch' : '/')}>
          {noGame ? '去自动搜索游戏' : '去游戏库安装 Mod'}
        </Btn>
      </div>
    )
  }

  const { schema, configPath } = result
  const matching=schema.fields.filter(f=>!f.hidden && (query.trim() ? `${f.label} ${f.key} ${f.desc||''}`.toLowerCase().includes(query.trim().toLowerCase()) : level==='advanced'||isBasicGameParameter(f.key)))
  const boxes = (values.CustomBoxes as CustomBox[] | undefined) ?? []

  const CUSTOM_TAB = '__custom__'
  // 大类标签：把 14 个业务分组归到 7 个大类，避免标签页一长排
  const CATEGORIES = [
    { id: 'pranks', name: '整蛊大全', groups: ['prank-rocket', 'prank-duck', 'prank-thunder', 'prank-thrust', 'prank-scale', 'prank-fx'] },
    { id: 'core', name: '系统护体', groups: ['system', 'protect'] },
    { id: 'stats', name: '纪录榜单', groups: ['record', 'board'] },
    { id: 'ui', name: '显示界面', groups: ['hud'] },
    { id: 'live', name: '直播互动', groups: ['live'] },
    { id: 'work', name: '上班打卡', groups: ['work'] },
    { id: 'multi', name: '联机', groups: ['multi'] },
    { id: 'keys', name: '快捷键', groups: [] }
  ]
  const groupCount: Record<string, number> = {}
  for (const g of schema.groups) {
    groupCount[g.id] = matching.filter(
      (f) => f.group === g.id
    ).length
  }
  const groupName = (gid: string) =>
    schema.groups.find((g) => g.id === gid)?.name ?? gid
  // 未被 CATEGORIES 覆盖的分组（新游戏的 schema）各自成一个标签页
  const covered = new Set(CATEGORIES.flatMap((c) => c.groups))
  const extraTabs = schema.groups
    .filter((g) => !covered.has(g.id) && (groupCount[g.id] ?? 0) > 0)
    .map((g) => ({ id: 'g:' + g.id, name: g.name, count: groupCount[g.id] }))
  // 自定义盲盒：WheelLive 系（schema 覆盖分组）+ 图书管理员（DarkMage 已支持 CustomBoxes）+ 不要尖叫（0.2.16 起）
  const showCustomBoxes =
    schema.groups.some((g) => covered.has(g.id)) || gameId === 'librarian' || gameId === 'dontscream'
  const catTabs = [
    ...CATEGORIES.filter(
      (c) => c.id !== 'keys' && c.groups.some((gid) => (groupCount[gid] ?? 0) > 0)
    ).map((c) => ({
      id: c.id,
      name: c.name,
      count: c.groups.reduce((n, gid) => n + (groupCount[gid] ?? 0), 0)
    })),
    ...extraTabs,
    { id: 'keys', name: '快捷键', count: undefined },
    ...(showCustomBoxes ? [{ id: CUSTOM_TAB, name: '自定义盲盒', count: undefined }] : [])
  ]
  const cat =
    activeTab && catTabs.some((t) => t.id === activeTab)
      ? activeTab
      : catTabs[0]?.id
  const catGroups = cat.startsWith('g:')
    ? [cat.slice(2)]
    : (CATEGORIES.find((c) => c.id === cat)?.groups ?? []).filter(
        (gid) => (groupCount[gid] ?? 0) > 0
      )

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text)]">
            <SlidersHorizontal size={20} className="text-[var(--accent-2)]" />
            {level==='advanced'?'完整参数编辑器':'常用参数'}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            {liveMode && connected
              ? '实时模式已开启：改动即时生效到运行中的游戏，点保存才落盘。'
              : liveMode
                ? '实时模式已开：游戏运行起来后改动即时生效；现在保存只写入 config.json。'
                : '保存后写入 config.json；游戏运行中会自动同步改动，无需重启。'}
            {configPath && (
              <span className="select-text ml-2 text-[var(--text-4)]">（{configPath}）</span>
            )}
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
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant={liveMode ? 'primary' : 'secondary'}
            onClick={() => setLiveMode(!liveMode)}
            title={connected ? '开着时改动即时推进游戏' : '游戏运行后改动即时生效；关掉则只在保存时同步'}
          >
            <Zap size={14} /> {liveMode ? '实时模式已开' : '实时模式'}
          </Btn>
          <Pill tone={connected ? 'ok' : 'muted'} dot pulse={connected}>
            {connected ? '已连接' : '未连接 · 需游戏运行'}
          </Pill>
          {dirty && (
            <Pill tone="warn" dot pulse>
              有未保存的修改
            </Pill>
          )}
          {user?.email && (
            <>
              <Btn
                variant="secondary"
                onClick={restoreCloud}
                disabled={busy}
                title="从云端拉回上次备份的参数"
              >
                <CloudDownload size={14} /> 云端恢复
              </Btn>
              <Btn
                variant="secondary"
                onClick={backupCloud}
                disabled={busy}
                title="把当前参数整包备份到云端（按邮箱隔离）"
              >
                <CloudUpload size={14} /> 云端备份
              </Btn>
            </>
          )}
          <Btn variant="secondary" onClick={load}>
            <RotateCcw size={14} /> 重新读取
          </Btn>
          <Btn onClick={save} disabled={busy || !dirty}>
            <Save size={14} /> {busy ? '保存中…' : '保存参数'}
          </Btn>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3"><Input aria-label="搜索全部游戏参数" placeholder="搜索全部参数，例如：音量、时长、冷却" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-md"/><span className="text-xs text-[var(--text-3)]">{query.trim()?`找到 ${matching.length} 项`:'先用默认值体验效果，复杂项可到高级调整'}</span></div>
      {/* 大类标签页 */}
      <div className="zl-scroll mb-4 flex gap-1.5 overflow-x-auto pb-2">
        {catTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition ${
              cat === t.id
                ? 'bg-gradient-to-r from-[var(--accent-2)] to-[var(--accent)] font-semibold text-white'
                : 'bg-[var(--bg-elev)] text-[var(--text-3)] hover:bg-[var(--line)] hover:text-[var(--text)]'
            }`}
          >
            {t.name}
            {t.id !== CUSTOM_TAB && (
              <span
                className={`ml-1 text-xs ${
                  cat === t.id ? 'opacity-70' : 'text-[var(--text-4)]'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {query.trim() ? <div className="grid gap-3 xl:grid-cols-2">{matching.map(f=><ParamField key={f.key} field={f} value={values[f.key]} onChange={v=>setField(f.key,v)} boxes={boxes}/>)}{!matching.length&&<p className="text-sm text-[var(--text-3)]">暂无匹配参数，请换个关键词。</p>}</div> : cat === CUSTOM_TAB ? (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text)]">
            <Gift size={16} className="text-[var(--accent-2)]" />
            自定义盲盒
            <span className="text-xs font-normal text-[var(--text-4)]">
              保存后写入 config.json，游戏内同步显示。
            </span>
          </h3>
          <CustomBoxEditor
            boxes={boxes}
            gameId={gameId}
            onChange={(next) => {
              setValues((prev) => ({ ...prev, CustomBoxes: next }))
              setDirty(true)
            }}
          />
        </section>
      ) : cat === 'keys' ? (
        <section className="space-y-2">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--text)]">
            <Zap size={16} className="text-[var(--accent-2)]" />
            快捷键
            <span className="text-xs font-normal text-[var(--text-4)]">
              保存后写入 config.json，游戏内生效。
            </span>
          </h3>
          <KeyBindEditor
            binds={(values.Binds as Record<string, string> | undefined) ?? {}}
            menuKey={String(values.MenuKey ?? defaults?.menu ?? 'F1')}
            leaderboardKey={String(
              values.LeaderboardKey ?? defaults?.leaderboard ?? 'BackQuote'
            )}
            pranks={pranks}
            defaults={defaults ?? undefined}
            onChange={setLocal}
            onReset={resetBinds}
            showSystemKeys={schema.fields.some((f) => f.key === 'MenuKey' || f.key === 'LeaderboardKey')}
          />
        </section>
      ) : (
        <div className="space-y-6">
          {catGroups.map((gid) => (
            <section key={gid}>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text)]">
                {groupName(gid)}
                <span className="text-xs font-normal text-[var(--text-4)]">
                  {groupCount[gid]} 项
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {matching
                  .filter((f) => f.group === gid)
                  .map((f) => (
                    <ParamField
                      key={f.key}
                      field={f}
                      value={values[f.key]}
                      onChange={(v) => setField(f.key, v)}
                      boxes={boxes}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

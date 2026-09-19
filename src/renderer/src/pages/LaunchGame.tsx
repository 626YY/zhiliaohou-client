import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, FileText, Play, Search, Settings, Upload, Wrench } from 'lucide-react'
import type { GameItem, GameProcessState, ModHealth } from '@shared/types'
import { useToast } from '../stores/ui'
import { PageHeader, Pill } from '../components/ui'

// 启动游戏页只管「买没买 / 装没装」：扫描本机 Steam 库定位游戏。
// 授权（买没买我们的 mod）不在这里卡——授权门在 mod 侧（游戏库 → Mod 详情安装）。
// 启动某游戏 = 切主进程当前游戏，整蛊遥控/参数调整/连接器等板块全部跟随。

export default function LaunchGame() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.toast)
  const [games, setGames] = useState<GameItem[]>([])
  const [selected, setSelected] = useState<GameItem | null>(null)
  const [logoOk, setLogoOk] = useState(true)
  const [state, setState] = useState<GameProcessState>({ running: false })
  const [detecting, setDetecting] = useState(true)
  const [busy, setBusy] = useState(false)
  // 整蛊器健康：文件不全 / 装错位置 / 游戏在跑但没加载 → 在启动页直接亮出来并给「修复」按钮
  //（2026-09-07 朋友「快捷键不好使」查不出原因：主播看不到日志、跑不了脚本，只能客户端自己查自己修）
  const [health, setHealth] = useState<ModHealth | null>(null)
  const [repairing, setRepairing] = useState(false)

  const refresh = useCallback(async () => {
    setState(await window.api.gameState())
  }, [])

  const refreshHealth = useCallback(async (gameId?: string) => {
    if (!gameId) return setHealth(null)
    try {
      setHealth(await window.api.modHealth(gameId))
    } catch {
      setHealth(null)
    }
  }, [])

  // 主播那边「看着都正常但游戏里没反应」时，点这个把证据攒成桌面上的一个 txt 发过来
  const [diagnosing, setDiagnosing] = useState(false)
  const diagnose = async (gameId: string) => {
    if (diagnosing) return
    setDiagnosing(true)
    try {
      const r = await window.api.modDiagnose(gameId)
      if (r.ok) toast(`诊断报告已存到桌面：${r.file?.split(/[/\\]/).pop() || ''}，发给客服即可`, 'success')
      else toast(r.error || '导出诊断失败', 'error')
    } finally {
      setDiagnosing(false)
    }
  }

  // 直接传给我们：主播不用找文件、不用发文件，只要把编号念给客服
  const [uploading, setUploading] = useState(false)
  const uploadDiag = async (gameId: string) => {
    if (uploading) return
    setUploading(true)
    try {
      const r = await window.api.modDiagnoseUpload(gameId)
      if (r.ok) toast(`已上传，编号 ${r.code}。把这个编号发给客服就行`, 'success')
      else toast(r.error || '上传失败，可以改用「导出诊断」把文件发给客服', 'error')
    } finally {
      setUploading(false)
    }
  }

  const repair = async (gameId: string) => {
    if (repairing) return
    setRepairing(true)
    try {
      const r = await window.api.modRepair(gameId)
      if (r.ok) toast(r.did.length ? `已修复：${r.did.join('；')}` : '整蛊器没有问题。', 'success')
      else toast(r.error || '修复失败', 'error')
    } finally {
      setRepairing(false)
      await refreshHealth(gameId)
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    setLogoOk(true)
  }, [selected])

  // 进详情就查一次；游戏运行中每 6 秒再查（心跳没来 = 没加载，要提示）
  useEffect(() => {
    if (!selected?.installed) {
      setHealth(null)
      return
    }
    void refreshHealth(selected.id)
    const t = setInterval(() => void refreshHealth(selected.id), 6000)
    return () => clearInterval(t)
  }, [selected, refreshHealth, state.running])

  const loadGames = useCallback(async () => {
    setGames(await window.api.gamesList())
  }, [])

  useEffect(() => {
    let mounted = true
    const init = async () => {
      setDetecting(true)
      try {
        // 全游戏扫盘定位（不改当前游戏），每张卡片都显示真实的 已定位/未安装
        await window.api.detectAllGames()
        if (mounted) await loadGames()
      } finally {
        if (mounted) setDetecting(false)
      }
    }
    init()
    return () => {
      mounted = false
    }
  }, [loadGames])

  // 切主进程当前游戏（bridge/config/启动 全部跟它走）；没路径就顺手定位
  const setCurrentAndDetect = useCallback(
    async (game: GameItem) => {
      await window.api.setGameCurrent(game.id)
      if (!game.installed) {
        const res = await window.api.detectGamePath()
        if (res.ok) await loadGames()
      }
    },
    [loadGames]
  )

  // 选中游戏进详情
  const selectGame = useCallback(
    async (game: GameItem) => {
      setSelected(game)
      await setCurrentAndDetect(game)
    },
    [setCurrentAndDetect]
  )

  const launch = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.launchGame()
      if (res.ok) {
        toast('游戏已启动。', 'success')
        // 打开游戏后自动跳到整蛊遥控（该游戏已是当前游戏，所有板块跟随）
        navigate('/remote')
      } else {
        toast(res.error ?? '启动失败，请确认游戏路径正确后重试。', 'error')
      }
    } finally {
      setBusy(false)
      setTimeout(refresh, 1500)
    }
  }

  // ================= 详情视图（Steam 大图） =================
  if (selected) {
    const located = selected.installed
    return (
      <>
      <div className="flex min-h-full flex-col">
        <div className="relative h-[440px] w-full shrink-0 overflow-hidden bg-[var(--bg-card)]">
          <img
            src={selected.hero}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${located ? '' : 'opacity-40 grayscale'}`}
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/35 to-black/25" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent" />

          <button
            onClick={() => setSelected(null)}
            className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-lg bg-black/40 px-3 py-1.5 text-sm text-white backdrop-blur transition hover:bg-black/60"
          >
            <ChevronLeft size={16} /> 返回游戏库
          </button>

          {selected.logo && logoOk ? (
            <img
              src={selected.logo}
              alt=""
              className="absolute bottom-12 left-10 h-20 max-w-[300px] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)]"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <h1 className="absolute bottom-12 left-10 text-4xl font-black tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
              {selected.name}
            </h1>
          )}

          {/* 认到的是哪个文件：mod 装哪、游戏在不在跑都按它算，认错了要一眼看得出来 */}
          <div className="absolute bottom-5 left-10 max-w-[52%] truncate text-xs drop-shadow">
            {located ? (
              <span className="text-white/65" title={selected.path}>
                {selected.path}
              </span>
            ) : selected.pathError ? (
              <span className="text-[var(--warn)]" title={selected.path}>
                {selected.pathError}
              </span>
            ) : null}
          </div>

          {located ? (
            <button
              onClick={launch}
              disabled={busy || state.running}
              className="absolute bottom-12 right-10 inline-flex items-center gap-3 rounded-md bg-gradient-to-b from-[#79c068] via-[#4aa53d] to-[#2f7a2f] px-10 py-4 text-lg font-bold text-white shadow-[0_6px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <Play size={22} fill="currentColor" />
              {state.running ? '运行中' : busy ? '启动中…' : '开始游戏'}
            </button>
          ) : (
            <div className="absolute bottom-12 right-10 flex flex-col items-end gap-2">
              <span className="inline-flex items-center gap-2 rounded-md border border-white/25 bg-black/50 px-4 py-2.5 text-sm font-bold text-white backdrop-blur">
                未在本机找到该游戏
              </span>
              <button
                onClick={async () => {
                  setBusy(true)
                  try {
                    await window.api.detectGamePath()
                    await loadGames()
                    const g = (await window.api.gamesList()).find((x) => x.id === selected.id)
                    if (g) setSelected(g)
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md px-8 py-3 text-base font-bold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                style={{
                  background: 'linear-gradient(to bottom, var(--accent), var(--accent-2))',
                  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.25)'
                }}
              >
                <Search size={16} /> {busy ? '搜索中…' : '重新搜索本机游戏'}
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-10 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={state.running ? 'ok' : 'muted'} dot pulse={state.running}>
              {state.running
                ? `运行中${state.exeName ? ` · ${state.exeName}` : ''}`
                : '未运行'}
            </Pill>
            {health && health.modId ? (
              health.ok ? (
                <>
                  <Pill tone="ok" dot>
                    {state.running
                      ? health.loaded
                        ? `整蛊器已加载${health.version ? ` v${health.version}` : ''}`
                        : `整蛊器文件正常${health.version ? ` v${health.version}` : ''} · 等待游戏加载…`
                      : `整蛊器就绪${health.version ? ` v${health.version}` : ''}`}
                  </Pill>
                  <button
                    onClick={() => uploadDiag(health.gameId)}
                    disabled={uploading}
                    title="游戏里没有加载横幅、快捷键没反应时点这个：把检查结果和日志直接传给客服，你只需要报一个编号"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-3)] transition hover:text-[var(--text)] disabled:opacity-50"
                  >
                    <Upload size={12} /> {uploading ? '上传中…' : '游戏里没反应？上传诊断'}
                  </button>
                  <button
                    onClick={() => diagnose(health.gameId)}
                    disabled={diagnosing}
                    title="传不上去时用这个：把检查结果和日志存成桌面上的一个 txt，自己发给客服"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-4)] transition hover:text-[var(--text)] disabled:opacity-50"
                  >
                    <FileText size={12} /> {diagnosing ? '导出中…' : '存到桌面'}
                  </button>
                </>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {health.issues.map((i) => (
                    <Pill key={i.code} tone={i.code === 'not-installed' || i.code === 'no-path' ? 'muted' : 'warn'} dot>
                      {i.text}
                    </Pill>
                  ))}
                  {health.issues.some((i) => i.fixable) ? (
                    <button
                      onClick={() => repair(health.gameId)}
                      disabled={repairing || state.running}
                      title={state.running ? '先关掉游戏再修复' : '重新把整蛊器装到正确位置（保留你的快捷键设置）'}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                      style={{ background: 'linear-gradient(to bottom, var(--accent), var(--accent-2))' }}
                    >
                      <Wrench size={12} /> {repairing ? '修复中…' : state.running ? '关游戏后可修复' : '一键修复'}
                    </button>
                  ) : null}
                  <button
                    onClick={() => uploadDiag(health.gameId)}
                    disabled={uploading}
                    title="把检查结果和游戏日志直接传给客服，你只需要报一个编号"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-3)] transition hover:text-[var(--text)] disabled:opacity-50"
                  >
                    <Upload size={12} /> {uploading ? '上传中…' : '上传诊断'}
                  </button>
                  <button
                    onClick={() => diagnose(health.gameId)}
                    disabled={diagnosing}
                    title="传不上去时用这个：把检查结果和游戏日志存成桌面上的一个 txt，自己发给客服"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-4)] transition hover:text-[var(--text)] disabled:opacity-50"
                  >
                    <FileText size={12} /> {diagnosing ? '导出中…' : '存到桌面'}
                  </button>
                </span>
              )
            ) : null}
          </div>
          <span className="text-xs text-[var(--text-4)]">
            {located ? '支持带 Mod 启动。' : '请先在 Steam 安装该游戏，或点「重新搜索本机游戏」。'}
          </span>
        </div>
      </div>
      </>
    )
  }

  // ================= 游戏库网格视图 =================
  const locatedCount = games.filter((g) => g.installed).length
  return (
    <div className="p-6">
      <PageHeader
        title="我的游戏"
        desc={
          <>
            知了猴工作室支持的游戏 · <span className="tnum">{games.length}</span> 款
            <span className="ml-2 text-[var(--text-3)]">已定位 <span className="tnum">{locatedCount}</span> 款</span>
          </>
        }
        actions={
          detecting ? (
            <Pill tone="accent" dot pulse>
              正在自动搜索已安装的游戏…
            </Pill>
          ) : locatedCount > 0 ? (
            <Pill tone="ok" dot>
              已自动定位游戏
            </Pill>
          ) : (
            <span className="flex items-center gap-2">
              <Pill tone="warn" dot>
                未找到已安装的游戏
              </Pill>
              <button
                onClick={() => navigate('/settings')}
                className="inline-flex items-center gap-0.5 text-xs text-[var(--text-3)] underline underline-offset-2 transition hover:text-[var(--text)]"
              >
                <Settings size={12} /> 手动选择
              </button>
            </span>
          )
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            running={state.running && (!state.gameId || state.gameId === game.id)}
            onSelect={() => selectGame(game)}
            onLaunch={async () => {
              await setCurrentAndDetect(game)
              launch()
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface GameCardProps {
  game: GameItem
  running: boolean
  onSelect: () => void
  onLaunch: () => void
}

function GameCard({ game, running, onSelect, onLaunch }: GameCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const located = game.installed
  return (
    <div
      className={`group overflow-hidden rounded-xl border bg-[var(--bg-card)] transition duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
        located ? 'border-[var(--line)] hover:border-[var(--line-strong)]' : 'border-[var(--line-strong)] opacity-70 hover:border-[var(--line-strong)]'
      }`}
    >
      <button onClick={onSelect} className="block w-full text-left">
        <div className="relative aspect-[16/7] overflow-hidden bg-[var(--bg-elev)]">
          {game.header && !imgFailed ? (
            <img
              src={game.header}
              alt={game.name}
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${located ? '' : 'grayscale opacity-50'}`}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-4xl font-black text-[var(--text-4)]">
              {game.name.slice(0, 1)}
            </div>
          )}
          <span className="absolute right-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            {running ? '运行中' : located ? '已定位' : '未安装'}
          </span>
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text)]">
            {game.name}
          </div>
          <div className="text-[11px] text-[var(--text-4)]">
            {located ? (running ? '游戏运行中' : '点击查看详情') : '未在本机找到该游戏'}
          </div>
        </div>
        {located ? (
          <button
            onClick={onLaunch}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gradient-to-b from-[#79c068] via-[#4aa53d] to-[#2f7a2f] px-3.5 py-2 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:brightness-110 disabled:opacity-50"
          >
            <Play size={13} fill="currentColor" />
            {running ? '运行中' : '启动'}
          </button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-elev)] px-3.5 py-2 text-xs font-bold text-[var(--text-3)]">
            未安装
          </span>
        )}
      </div>
    </div>
  )
}

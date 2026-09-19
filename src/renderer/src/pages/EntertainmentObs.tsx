import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal, Plug, Unplug, RefreshCw, Play, KeyRound, Layers, Radio, FolderOpen } from 'lucide-react'
import type { LiveCompanionStatus, ObsPanelState } from '@shared/types'
import { Btn, Card, Field, Input, Pill, Toggle } from '../components/ui'
import { useToast } from '../stores/ui'

function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export default function EntertainmentObs() {
  const toast = useToast((s) => s.toast)
  const [state, setState] = useState<ObsPanelState | null>(null)
  const [busy, setBusy] = useState(false)
  const [enablePassword, setEnablePassword] = useState(randomPassword)
  const [companion, setCompanion] = useState<LiveCompanionStatus | null>(null)
  const [companionBusy, setCompanionBusy] = useState(false)
  const [outputsTop, setOutputsTop] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((r) => setOutputsTop(r.settings?.outputsAlwaysOnTop === true)).catch(() => {})
    window.api.obsState().then(setState)
    window.api.liveCompanionState().then(setCompanion)
    const off = window.api.onObsChanged(setState)
    // OBS 开没开、接口有没有启用这些本机状态，页面开着每 5 秒看一眼
    const timer = window.setInterval(() => window.api.obsState().then(setState), 5000)
    const companionTimer = window.setInterval(() => window.api.liveCompanionState().then(setCompanion), 5000)
    return () => {
      off()
      clearInterval(timer)
      clearInterval(companionTimer)
    }
  }, [])

  const sources = useMemo(() => {
    if (!state) return [] as { source: string; filters: ObsPanelState['filters'] }[]
    const map = new Map<string, ObsPanelState['filters']>()
    for (const f of state.filters) {
      if (!map.has(f.source)) map.set(f.source, [])
      map.get(f.source)!.push(f)
    }
    return [...map.entries()].map(([source, filters]) => ({ source, filters }))
  }, [state])

  if (!state) return null
  const { local, connection, settings } = state

  const patch = (value: Partial<typeof settings>) => {
    setState({ ...state, settings: { ...settings, ...value } })
    void window.api.obsConfigure(value)
  }

  const connect = async () => {
    setBusy(true)
    const r = await window.api.obsConnect()
    setBusy(false)
    if (r.ok) toast(`已连接 OBS${r.version ? ' ' + r.version : ''}`, 'success')
    else toast(r.error || '连接失败', 'error')
  }

  const disconnect = async () => {
    await window.api.obsDisconnect()
    toast('已断开 OBS', 'info')
  }

  const launch = async () => {
    const r = await window.api.obsLaunch()
    if (r.ok) toast('OBS 正在启动，稍等几秒再连接', 'success')
    else toast(r.error || '启动失败', 'error')
  }

  const enableServer = async () => {
    const r = await window.api.obsEnableServer(enablePassword)
    if (r.ok) toast('已在 OBS 配置里启用远程接口，启动 OBS 后即可连接', 'success')
    else toast(r.error || '启用失败', 'error')
    window.api.obsState().then(setState)
  }

  const chooseCompanion = async () => {
    try {
      const selected = await window.api.selectFile({ title: '选择抖音直播伴侣安装目录', properties: ['openDirectory'] })
      if (!selected.ok || !selected.path) return
      const result = await window.api.liveCompanionSetDirectory(selected.path)
      if (!result.ok) return toast(result.error || '目录不可用', 'error')
      setCompanion(await window.api.liveCompanionState(true))
      toast('已保存直播伴侣目录', 'success')
    } catch (error) {
      toast(`保存目录失败：${(error as Error).message}`, 'error')
    }
  }

  const launchCompanion = async () => {
    setCompanionBusy(true)
    const r = await window.api.liveCompanionLaunch().catch((e: Error) => ({ ok: false, error: e.message }))
    setCompanionBusy(false)
    if (r.ok) {
      toast('抖音直播伴侣正在启动', 'success')
      window.setTimeout(() => window.api.liveCompanionState(true).then(setCompanion), 1200)
    } else toast(r.error || '启动抖音直播伴侣失败', 'error')
  }

  const setFilter = async (source: string, filter: string, enabled: boolean) => {
    const r = await window.api.obsSetFilter(source, filter, enabled)
    if (!r.ok) toast(r.error || '滤镜开关失败', 'error')
  }

  const setScene = async (scene: string) => {
    const r = await window.api.obsSetScene(scene)
    if (!r.ok) toast(r.error || '切场景失败', 'error')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Radio size={16} className="shrink-0 text-[var(--accent-2)]" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                抖音直播伴侣
                <Pill tone={companion?.running ? 'ok' : companion?.installed ? 'muted' : 'warn'} dot pulse={!!companion?.running}>
                  {companion?.running ? '运行中' : companion?.installed ? '已安装' : '未找到'}
                </Pill>
              </div>
              <div className="truncate text-[11px] text-[var(--text-4)]" title={companion?.installDir || ''}>
                {companion?.installDir || '桌面快速入口；仅打开程序，不会自动开播'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Btn size="sm" variant="ghost" onClick={chooseCompanion}><FolderOpen size={13} /> 选择目录</Btn>
            <Btn size="sm" variant="secondary" onClick={launchCompanion} disabled={!companion?.installed || companion?.running || companionBusy} title={!companion?.installed ? '没找到 webcast_mate 安装目录' : ''}>
              <Play size={13} /> {companionBusy ? '启动中…' : companion?.running ? '已打开' : '打开直播伴侣'}
            </Btn>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--text-3)]">在直播伴侣添加「窗口捕获」，选择下列输出，并启用绿幕抠像或色度键。倒计时、进场等挂件默认使用绿底；原生透明模式可在「设置 → 挂件窗口采集」选择。请在伴侣预览里确认画面正常。</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text-2)]">
          <Toggle value={outputsTop} onChange={(v) => { setOutputsTop(v); void window.api.saveSettings({ outputsAlwaysOnTop: v }) }} />
          输出窗口总在最前（关闭后可以把挂件放到游戏后面；按住窗口空白处即可拖动）
        </label>
        <div className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
          {companion?.outputs?.length ? companion.outputs.map((output) => (
            <div key={output.title} className="flex justify-between gap-3"><span>{output.title}</span><span className="tnum text-[var(--text-4)]">{output.width} × {output.height}</span></div>
          )) : <span className="text-[var(--text-4)]">暂无输出窗口，请先打开绿幕、视频或互动挂件</span>}
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <SlidersHorizontal size={16} className="text-[var(--accent-2)]" /> OBS 滤镜设置
            <Pill tone={connection.connected ? 'ok' : local.running ? 'warn' : 'muted'} dot pulse={connection.connected}>
              {connection.connected ? `已连接 OBS ${connection.version || ''}` : local.running ? 'OBS 在运行，未连接' : 'OBS 未运行'}
            </Pill>
          </div>
          <div className="flex items-center gap-2">
            {!local.running && <Btn size="sm" variant="secondary" onClick={launch} disabled={!local.exePath} title={local.exePath || '没找到 OBS'}><Play size={13} /> 启动 OBS</Btn>}
            {connection.connected ? (
              <Btn size="sm" variant="secondary" onClick={disconnect}><Unplug size={13} /> 断开</Btn>
            ) : (
              <Btn size="sm" onClick={connect} disabled={busy}><Plug size={13} /> {busy ? '连接中…' : '连接 OBS'}</Btn>
            )}
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-4 text-[var(--text-4)]">
          连上 OBS 后可以直接开关任意源的滤镜、切场景；在「礼物触发」里把动作类型选成 OBS，观众送礼就能触发滤镜特效。
          走的是 OBS 28 以上自带的 WebSocket 远程接口（工具 → WebSocket 服务器设置）。
        </p>
        {connection.error && !connection.connected && (
          <div className="mb-3 rounded-lg border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{connection.error}</div>
        )}
        <div className="grid grid-cols-1 gap-2 text-xs text-[var(--text-3)] sm:grid-cols-2">
          <div className="truncate" title={local.installDir}>安装目录：{local.installDir || '没找到（注册表和 Program Files 都没有）'}</div>
          <div>远程接口：{local.configFound ? (local.wsEnabled ? `已启用 · 端口 ${local.wsPort}${local.wsAuthRequired ? ' · 需要密码' : ''}` : '未启用') : '没读到 OBS 配置（OBS 至少要开过一次）'}</div>
        </div>
        {local.configFound && !local.wsEnabled && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] p-3">
            <Field label="一键启用远程接口（要先关闭 OBS）" className="min-w-[200px] flex-1" hint="会写进 OBS 自己的配置并备份原文件，密码同时填到下面的连接设置">
              <Input value={enablePassword} onChange={(e) => setEnablePassword(e.target.value)} />
            </Field>
            <Btn size="sm" onClick={enableServer} disabled={local.running} title={local.running ? '请先关闭 OBS' : ''}><KeyRound size={13} /> 启用</Btn>
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="地址">
            <Input value={settings.host} onChange={(e) => patch({ host: e.target.value })} />
          </Field>
          <Field label="端口">
            <Input type="number" min={1} max={65535} value={settings.port} onChange={(e) => patch({ port: Number(e.target.value) || 4455 })} />
          </Field>
          <Field label="密码">
            <Input type="password" value={settings.password} onChange={(e) => patch({ password: e.target.value })} placeholder="OBS WebSocket 密码" />
          </Field>
          <div className="flex flex-col justify-end pb-1">
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]"><Toggle value={settings.autoConnect} onChange={(v) => patch({ autoConnect: v })} />OBS 开着就自动连</label>
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Layers size={16} className="text-[var(--accent-2)]" /> 场景
            <span className="text-[11px] font-normal text-[var(--text-4)]">{state.source === 'live' ? '实时' : '离线读取，连接后可切换'}</span>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => window.api.obsRefresh()} title="重新读取"><RefreshCw size={13} /></Btn>
        </div>
        {state.scenes.scenes.length === 0 ? (
          <div className="text-xs text-[var(--text-4)]">没读到场景</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {state.scenes.scenes.map((scene) => (
              <button
                key={scene}
                onClick={() => setScene(scene)}
                disabled={!connection.connected}
                className={`rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${scene === state.scenes.current ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]' : 'border-[var(--line)] bg-[var(--bg-elev)] text-[var(--text-2)] hover:border-[var(--accent)]'}`}
              >
                {scene}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--text)]">
            滤镜 <span className="text-[11px] font-normal text-[var(--text-4)]">{state.source === 'live' ? '实时，点开关直接生效' : '离线读取当前场景集合，连接 OBS 后才能开关'}</span>
          </div>
          <span className="text-xs text-[var(--text-3)]">{state.filters.length} 个</span>
        </div>
        {sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-5 text-center text-xs text-[var(--text-4)]">
            没读到任何滤镜。先在 OBS 里给源加滤镜（右键源 → 滤镜），比如色度键、色彩校正、锐化，再回来刷新。
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map(({ source, filters }) => (
              <div key={source} className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5">
                <div className="mb-1.5 text-xs font-semibold text-[var(--text-2)]">{source}</div>
                <div className="space-y-1">
                  {filters.map((f) => (
                    <div key={`${f.source}\u0000${f.filter}`} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-[var(--text)]">{f.filter}</span>
                      <span className="shrink-0 text-[11px] text-[var(--text-4)]">{f.kind}</span>
                      <Toggle value={f.enabled} disabled={!connection.connected} onChange={(v) => setFilter(f.source, f.filter, v)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

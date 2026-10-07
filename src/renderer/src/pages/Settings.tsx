import AdvancedSection from '../components/AdvancedSection'
import { useEffect, useState } from 'react'
import { Save, FolderOpen, Crosshair, RefreshCw, X, Plus, Mail, Loader2 } from 'lucide-react'
import type { AppVersionInfo, DouyinRoomLookup, EmailLicense, GameItem, Settings as SettingsT } from '@shared/types'
import { baseName, gamePathSample } from '@shared/gamePaths'
import { useToast } from '../stores/ui'
import { useAuth } from '../stores/auth'
import { useLicenseBind } from '../lib/useLicenseBind'
import { getCachedAuth, fetchAuth } from '../lib/gameAuthCache'
import { getThemeMode, setThemeMode, THEME_LABELS, THEME_MODES, MOTION_THEMES, THEME_NOTES, getThemeMotion, setThemeMotion, type ThemeMode } from '../lib/theme'
import { Modal } from '../components/Modal'
import { Btn, Field, Input, Loading, PageHeader, Pill, Segmented, Toggle, Select } from '../components/ui'
import SelfCheckCard from '../components/SelfCheckCard'
import CaptureBackgroundToggle from '../components/CaptureBackgroundToggle'
import { AnnounceSettings } from '../components/AnnounceControls'
import { CardAccountAccess } from '../components/CardAccess'
import RoomManager from '../components/RoomManager'
import { useCardAccess } from '../lib/useCardAccess'

export default function Settings() {
  // 版本号（主播报障要用）与品游素材目录里扫到的项目数
  const [ver, setVer] = useState<AppVersionInfo | null>(null)
  const [projectCount, setProjectCount] = useState<number | null>(null)
  useEffect(() => {
    void window.api.appVersion().then(setVer)
    void window.api.pinyouProjects().then((r) => setProjectCount(r.error ? null : r.projects.length))
  }, [])
  const toast = useToast((s) => s.toast)
  const user = useAuth((s) => s.user)
  const updateRooms = useAuth((s) => s.updateRooms)
  const { tryBind, modal } = useLicenseBind()
  // 卡密平台模式：账号区显示卡密权益而不是旧的邮箱授权状态；直播间绑定照旧由主进程按权益放行
  const { enabled: cardMode, free: cardFree } = useCardAccess()
  const [s, setS] = useState<SettingsT | null>(null)
  const [busy, setBusy] = useState(false)
  const [newRoom, setNewRoom] = useState('')
  const [lic, setLic] = useState<EmailLicense | null>(null)
  // 绑定前验证：先读抖音主播昵称+头像 → 确认弹窗 → 才真正绑定
  const [lookup, setLookup] = useState<DouyinRoomLookup | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [themeMotion, setThemeMotionState] = useState(getThemeMotion)
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode)
  // 路径按游戏分开存（gamePaths[gid]），旧字段 gamePath 只兜底轮椅——
  // 以前这页固定读写 gamePath，当前游戏是 DS/图书馆时改了不生效
  const [games, setGames] = useState<GameItem[]>([])
  const [pathDraft, setPathDraft] = useState<string | null>(null)

  const changeTheme = (m: ThemeMode) => {
    setThemeMode(m)
    setTheme(m)
  }

  useEffect(() => {
    window.api.getSettings().then(({ settings }) => setS(settings))
    window.api.gamesList().then(setGames)
  }, [])

  // 邮箱账号的购买授权状态（已授权/未授权）——走全局缓存，不重复请求
  useEffect(() => {
    const email = user?.email
    if (!email || cardMode) {
      setLic(null)
      return
    }
    let alive = true
    ;(async () => {
      let a = getCachedAuth(email)
      if (a === undefined) a = await fetchAuth(email)
      if (alive) setLic(a)
    })()
    return () => {
      alive = false
    }
  }, [user?.email, cardMode])

  const rooms = user?.boundRooms ?? []

  // ① 验证直播间：读取主播昵称+头像，确认无误再绑
  const verifyRoom = async () => {
    const r = newRoom.trim()
    if (!r) return toast('请输入直播间号', 'error')
    setLookingUp(true)
    try {
      const res = await window.api.roomLookup(r, true)
      if (!res.ok) {
        toast(res.error ?? '无法验证直播间', 'error')
        return
      }
      setLookup(res)
    } catch {
      toast('验证直播间失败', 'error')
    } finally {
      setLookingUp(false)
    }
  }

  // ② 确认弹窗里点「确认绑定」→ 走授权门禁真正绑定；绑定成功顺手把主播头像存为账号头像
  const confirmBind = async () => {
    const r = newRoom.trim()
    const avatar = lookup?.avatar
    setLookup(null)
    const bound = await tryBind(r)
    if (bound) {
      setNewRoom('')
      if (avatar) {
        const u = await window.api.updateAvatar(avatar)
        if (u) useAuth.getState().setUser(u)
      }
    }
  }

  // 自由解绑：直接解除绑定，解绑记录上报服务器留痕（无需审批）
  const [unbindRoom, setUnbindRoom] = useState<string | null>(null)

  const doUnbind = async () => {
    if (!unbindRoom) return
    const room = unbindRoom
    setUnbindRoom(null)
    const res = await window.api.reportRoomUnbind(room)
    if (res.ok && res.boundRooms) updateRooms(res.boundRooms)
    toast(res.ok ? '已解绑' : res.error ?? '解绑失败', res.ok ? 'success' : 'error')
  }

  if (!s) return <Loading className="p-16" />

  const set = (patch: Partial<SettingsT>) => setS({ ...s, ...patch })

  // 内置绿幕抠图参数（动作上只存开关，参数是这一套；老配置没这项就按默认值显示）
  const chroma = { enabled: false, color: '#00ff00', similarity: 40, smoothness: 12, spill: 30, ...(s.chromaKey || {}) }

  const pickFile = async (
    key: keyof SettingsT,
    title: string,
    exts: string[]
  ) => {
    const res = await window.api.selectFile({
      title,
      filters: [{ name: title, extensions: exts }],
      properties: ['openFile']
    })
    if (res.ok && res.path) set({ [key]: res.path } as Partial<SettingsT>)
  }

  const pickDir = async (key: keyof SettingsT, title: string) => {
    const res = await window.api.selectFile({
      title,
      properties: ['openDirectory']
    })
    if (res.ok && res.path) set({ [key]: res.path } as Partial<SettingsT>)
  }

  // 当前游戏（bridge/mod 目录/启动全都跟它走）
  const gid = s?.currentGameId || '4wheel-challenge'
  const game = games.find((g) => g.id === gid)
  const gamePathNow = s ? s.gamePaths?.[gid] || (gid === '4wheel-challenge' ? s.gamePath : '') : ''
  const shownPath = pathDraft ?? gamePathNow

  const reloadAfterPath = async () => {
    const { settings } = await window.api.getSettings()
    setS(settings)
    setPathDraft(null)
    setGames(await window.api.gamesList())
  }

  // 交给主进程校验：选到启动器/崩溃处理器会被自动改到游戏本体（见 shared/gamePaths.ts）
  const applyGamePath = async (p: string) => {
    if (!p.trim()) return
    setBusy(true)
    try {
      const res = await window.api.setGamePath(gid, p)
      if (!res.ok) return toast(res.error || '这个路径用不了', 'error')
      await reloadAfterPath()
      toast(res.fixed ? `已改到游戏本体 ${baseName(res.path || '')}` : '游戏路径已保存', 'success')
    } finally {
      setBusy(false)
    }
  }

  const detect = async () => {
    setBusy(true)
    try {
      const res = await window.api.detectGamePath()
      if (res.ok && res.path) {
        await reloadAfterPath()
        toast('已找到游戏路径', 'success')
      } else {
        toast(res.error ?? '未找到游戏', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const pickGameExe = async () => {
    const res = await window.api.selectFile({
      title: '选择游戏 exe',
      properties: ['openFile'],
      filters: [{ name: '游戏程序', extensions: ['exe'] }]
    })
    if (res.ok && res.path) await applyGamePath(res.path)
  }

  const save = async () => {
    const res = await window.api.saveSettings(s)
    setS(res.settings)
    toast(res.outputWindowsNeedReopen ? '设置已保存，重新打开已开启的挂件后应用底色' : '设置已保存', 'success')
  }

  const row = (label: string, desc: string) => (
    <div className="mb-1.5">
      <div className="text-sm font-medium text-[var(--text)]">{label}</div>
      <div className="mt-0.5 text-xs text-[var(--text-3)]">{desc}</div>
    </div>
  )

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <PageHeader
          title="设置"
          desc="管理账号、游戏位置和窗口采集，修改后保存。"
          actions={<Btn onClick={save}><Save size={14}/>保存设置</Btn>}
        />
      </div>

      <div className="mb-6">
        <SelfCheckCard />
      </div>

      <div className="space-y-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-6">
        <section className="space-y-3">
          <h3 className="flex items-center justify-between border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            <span>{cardMode && !cardFree ? '账号与卡密授权' : '账号与直播间绑定'}</span>
            <span className="text-xs font-normal text-[var(--text-4)]">
              {cardFree ? '直播间绑定后在「直播连接器」里选择连接。' : cardMode ? '授权跟随账号；直播间绑定后在「直播连接器」里选择连接。' : '首次绑定即时生效，解绑后再次绑定需重新申请授权。'}
            </span>
          </h3>
          <div className="text-sm text-[var(--text-2)]">
            {user?.nickname}{' '}
            <span className="text-[var(--text-4)]">@{user?.username}</span>
          </div>
          {cardMode ? <CardAccountAccess /> : null}
          {cardMode ? (
            <>
              {/* 卡密模式：直播间名额 / 扫码绑定 / 改绑 / 解绑全在 RoomManager；旧的申请审批流程只留给 legacy */}
              <div className="border-t border-[var(--line)] pt-3 text-sm font-medium text-[var(--text)]">直播间绑定</div>
              <RoomManager />
            </>
          ) : null}
          {!cardMode && user?.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail size={14} className="text-[var(--text-3)]" />
              <span className="select-text text-[var(--text-2)]">{user.email}</span>
              {lic ? (
                lic.ok ? (
                  <Pill tone={lic.licensed === 1 ? 'ok' : 'muted'} dot>
                    {lic.licensed === 1 ? '已授权' : '未授权'}
                  </Pill>
                ) : (
                  <Pill tone="warn">授权查询失败</Pill>
                )
              ) : (
                <span className="text-xs text-[var(--text-4)]">查询中…</span>
              )}
            </div>
          )}
          {!cardMode && (<>
          <div className="space-y-2">
            {rooms.length === 0 && (
              <div className="text-xs text-[var(--text-3)]">
                还没有绑定直播间号。绑定后会显示在这里，可在连接器中选择。
              </div>
            )}
            {rooms.map((room) => (
              <div
                key={room}
                className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2"
              >
                <span className="select-text font-mono text-sm text-[var(--text)]">{room}</span>
                <button
                  onClick={() => setUnbindRoom(room)}
                  className="inline-flex items-center gap-1 text-xs text-[var(--text-3)] transition hover:text-[var(--danger)]"
                >
                  <X size={13} /> 解绑
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyRoom()}
              placeholder="抖音直播间号"
              aria-label="抖音直播间号"
              disabled={lookingUp}
            />
            <Btn
              variant="secondary"
              onClick={verifyRoom}
              disabled={lookingUp}
              className="shrink-0"
            >
              {lookingUp ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {lookingUp ? '验证中…' : '绑定'}
            </Btn>
          </div>
          <p className="text-xs text-[var(--text-4)]">首次绑定会打开抖音网页，请扫码登录；登录状态自动保存，下次可直接使用。</p>
          </>)}
        </section>

        <section className="space-y-3">
          <h3 className="border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            游戏
          </h3>
          <div>
            {row(
              `游戏 exe 路径（${game?.name || '当前游戏'}）`,
              '选到启动器会自动改成游戏本体。Mod 装哪、游戏在不在跑，都按这个路径算。'
            )}
            <div className="flex gap-2">
              <Input
                value={shownPath}
                onChange={(e) => setPathDraft(e.target.value)}
                onBlur={() => {
                  if (pathDraft !== null && pathDraft !== gamePathNow) void applyGamePath(pathDraft)
                  else setPathDraft(null)
                }}
                placeholder={gamePathSample(gid) || '游戏可执行文件'}
              />
              <Btn
                variant="secondary"
                onClick={detect}
                disabled={busy}
                className="shrink-0 px-3"
                title="在 Steam 库里自动找"
                aria-label="自动探测游戏路径"
              >
                <Crosshair size={15} />
              </Btn>
              <Btn
                variant="secondary"
                onClick={pickGameExe}
                disabled={busy}
                className="shrink-0 px-3"
                aria-label="浏览选择游戏 exe"
              >
                <FolderOpen size={15} />
              </Btn>
            </div>
            {game && !game.installed && game.pathError && (
              <p className="mt-1.5 text-xs text-[var(--warn)]">{game.pathError}</p>
            )}
          </div>

          <AdvancedSection title="自定义配置文件"><div>
            {row('Mod 配置文件 config.json', '参数编辑器读写的目标文件。')}
            <div className="flex gap-2">
              <Input
                value={s.modConfigPath}
                onChange={(e) => set({ modConfigPath: e.target.value })}
                placeholder="…\Mods\WheelLive\config.json（留空自动推测）"
              />
              <Btn
                variant="secondary"
                onClick={() => pickFile('modConfigPath', '选择 config.json', ['json'])}
                className="shrink-0 px-3"
                aria-label="浏览选择 config.json"
              >
                <FolderOpen size={15} />
              </Btn>
            </div>
          </div></AdvancedSection>

          <AdvancedSection title="自定义安装目录"><div>
            {row('Mod 安装目录', 'Mod 包解压安装的目标目录。')}
            <div className="flex gap-2">
              <Input
                value={s.modRootPath}
                onChange={(e) => set({ modRootPath: e.target.value })}
                placeholder="留空使用默认目录"
              />
              <Btn
                variant="secondary"
                onClick={() => pickDir('modRootPath', '选择 Mod 目录')}
                className="shrink-0 px-3"
                aria-label="浏览选择 Mod 目录"
              >
                <FolderOpen size={15} />
              </Btn>
            </div>
          </div></AdvancedSection>
        </section>

        <section className="space-y-3">
          <h3 className="border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            外观
          </h3>
          <div>
            {row('界面主题', '自动按时间段切换，也可固定一种。')}
            <label className="mb-3 flex items-center gap-2 text-xs text-[var(--text-2)]">
              <Toggle value={themeMotion} onChange={(on) => { setThemeMotion(on); setThemeMotionState(on) }} />
              主题动效<span className="text-[var(--text-3)]">控制标有「动态」的主题，关闭后保持静态外观</span>
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="界面主题">
              {THEME_MODES.map((m) => <Btn key={m} variant="secondary" onClick={() => changeTheme(m)}
                aria-label={`界面主题：${THEME_LABELS[m]}`} aria-pressed={theme === m}
                className={`theme-choice !block !p-2 !text-left ${theme === m ? '!border-[var(--accent)] !bg-[var(--accent-soft)]' : ''}`}>
                <span data-theme={m === 'auto' ? 'dark' : m} className="theme-preview" aria-hidden="true">
                  <i className="theme-preview-nav" /><i className="theme-preview-bar" /><i className="theme-preview-panel" /><i className="theme-preview-action" />
                </span>
                <span className="mt-2 flex items-center justify-between gap-1 text-xs"><span>{THEME_LABELS[m]}</span>
                  <span className="text-[10px] text-[var(--text-3)]">{theme === m ? '✓ ' : ''}{m === 'auto' ? '随时段' : MOTION_THEMES.includes(m) ? '动态' : '静态'}</span>
                </span>
                <span className="mt-1 block text-[10px] font-normal text-[var(--text-3)]">{THEME_NOTES[m]}</span>
              </Btn>)}
            </div>
          </div>
        </section>

        <AdvancedSection title="下载存储位置"><section className="space-y-3">
          <h3 className="border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            下载
          </h3>
          <div>
            {row('Mod 包下载缓存目录', '下载的安装包存放位置。')}
            <div className="flex gap-2">
              <Input
                value={s.downloadDir}
                onChange={(e) => set({ downloadDir: e.target.value })}
                placeholder="留空使用默认缓存目录"
              />
              <Btn
                variant="secondary"
                onClick={() => pickDir('downloadDir', '选择下载目录')}
                className="shrink-0 px-3"
                aria-label="浏览选择下载目录"
              >
                <FolderOpen size={15} />
              </Btn>
            </div>
          </div>
        </section></AdvancedSection>

        <section className="space-y-3">
          <h3 className="flex items-center justify-between border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            <span>素材目录</span>
            <span className="text-xs font-normal text-[var(--text-4)]">
              里面每个文件夹是一个项目（视频 + 同名 .脚本）
            </span>
          </h3>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                value={s.pinyouAssetRoot ?? ''}
                onChange={(e) => setS({ ...s, pinyouAssetRoot: e.target.value })}
                placeholder="例如 F:\\知了猴工作室\\视频"
                className="flex-1"
              />
              <Btn
                variant="secondary"
                onClick={async () => {
                  const r = await window.api.pinyouAssetRootPick()
                  if (r.ok && r.root) {
                    setS({ ...s, pinyouAssetRoot: r.root })
                    setProjectCount(r.projects?.length ?? 0)
                  }
                }}
                className="shrink-0 px-3"
                aria-label="浏览选择素材目录"
              >
                <FolderOpen size={15} />
              </Btn>
            </div>
            <p className="text-xs text-[var(--text-4)]">
              {projectCount === null
                ? '设置后，礼物规则的「触发项目（文件夹）」就能直接从这里选项目。'
                : `扫到 ${projectCount} 个项目。礼物规则的「触发项目（文件夹）」可以直接选。`}
            </p>
          </div>
        </section>

        <AnnounceSettings />

        <section className="space-y-3">
          <h3 className="border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">挂件窗口采集</h3>
          <CaptureBackgroundToggle mode={s.outputCaptureMode} onChange={(mode) => set({ outputCaptureMode: mode })} />
          <AdvancedSection title="采集兼容性与窗口行为">
          <Select aria-label="画面渲染方式" value={s.renderMode || 'balanced'} onChange={(e) => set({ renderMode: e.target.value as 'balanced' | 'compatible' | 'hardware' })}>
            <option value="balanced">显卡画 + 系统合成（推荐）</option>
            <option value="compatible">全部交给 CPU</option>
            <option value="hardware">全交给显卡（挂件可能采成黑屏）</option>
          </Select>
          <p className="text-xs leading-5 text-[var(--text-3)]">卡顿就选第一项。切换后保存并重启客户端生效。</p>
          <Select aria-label="进程模式" value={s.processMode || 'stable'} onChange={(e) => set({ processMode: e.target.value as 'lean' | 'stable' })}>
            <option value="stable">每个窗口独立进程（推荐）</option>
            <option value="lean">挂件共用一个进程（空闲省内存，礼物密集时反而更吃）</option>
          </Select>
          <p className="text-xs leading-5 text-[var(--text-3)]">独立进程：一个挂件出错不牵连别的，礼物密集时内存最稳。共用进程：只适合挂件开得多、礼物不密的直播，出错会一起重载，反复出错会自动切回独立进程。切换后保存并重启客户端生效。</p>
          <Field label="内存守卫" hint="电脑内存快用光时，先暂停新来的自动视频、清掉排队，保住整蛊台不被系统终止；内存回落自动恢复。手动操作不受影响">
            <Toggle value={s.memoryGuard !== false} onChange={(v) => set({ memoryGuard: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="吃紧线（MB）" hint="可用内存低于这个数就提示">
              <Input type="number" min={200} max={8000} value={String(s.memoryTightMb ?? 800)} onChange={(e) => set({ memoryTightMb: Math.min(8000, Math.max(200, Math.round(Number(e.target.value) || 800))) })} />
            </Field>
            <Field label="告急线（MB）" hint="低于这个数暂停新来的自动视频">
              <Input type="number" min={100} max={7950} value={String(s.memoryCriticalMb ?? 400)} onChange={(e) => set({ memoryCriticalMb: Math.min(7950, Math.max(100, Math.round(Number(e.target.value) || 400))) })} />
            </Field>
          </div>
          <Field label="素材自动瘦身" hint="礼物视频比窗口大很多时（比如 4K 素材播在小窗口里），后台压一份小副本再播：内存和 CPU 都省一大截，画面在窗口里看不出差别。第一次播某个视频先播原片，压好后再换">
            <Toggle value={s.mediaOptimize !== false} onChange={(v) => set({ mediaOptimize: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="副本最高分辨率" hint="绿幕窗口一般 640×360，720p 已经绰绰有余；全屏覆盖层用 1080p">
              <Select aria-label="副本最高分辨率" value={String(s.mediaOptimizeMaxHeight ?? 720)} onChange={(e) => set({ mediaOptimizeMaxHeight: Number(e.target.value) })}>
                <option value="480">480p</option>
                <option value="720">720p（推荐）</option>
                <option value="1080">1080p</option>
              </Select>
            </Field>
            <Field label="副本缓存上限（MB）" hint="超过按最久没用的删">
              <Input type="number" min={256} max={65536} value={String(s.mediaCacheMaxMb ?? 4096)} onChange={(e) => set({ mediaCacheMaxMb: Math.min(65536, Math.max(256, Math.round(Number(e.target.value) || 4096))) })} />
            </Field>
          </div>
          <Select aria-label="挂件采集模式" value={s.outputCaptureMode || 'green'} onChange={(e) => set({ outputCaptureMode: e.target.value as 'green' | 'transparent' })}>
            <option value="green">直播伴侣 · 绿幕采集（推荐）</option>
            <option value="transparent">原生透明 · 需采集软件支持</option>
          </Select>
          <p className="text-xs leading-5 text-[var(--text-3)]">换底色后重开挂件生效。直播伴侣里选窗口来源，绿底要开绿幕抠像并关掉「兼容性捕获」。</p>
          {s.outputCaptureMode === 'transparent' ? (
            <p className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-xs leading-5 text-[var(--warn)]">
              直播伴侣不支持窗口透明，透明的地方会显示成黑色。用直播伴侣请选「绿幕采集」。
            </p>
          ) : null}
          <p className="text-xs leading-5 text-[var(--text-4)]">底色只影响挂件窗口，视频和图片自带的背景不变。</p>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">主窗口防采集保护</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">开着时直播伴侣、录屏和远程桌面都采不到操作界面。用远程桌面管理这台电脑时请关掉。</p>
            </div>
            <Toggle label="主窗口防采集保护" value={s.mainContentProtection !== false} onChange={(on) => set({ mainContentProtection: on })} />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">关掉挂件后留着采集来源</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">关着时挂件关了窗口就没了，开哪个才有哪个；开着时关掉的挂件原地留一块绿底，直播伴侣里的来源不失效。</p>
            </div>
            <Toggle label="关掉挂件后留着采集来源" value={s.keepClosedSources === true} onChange={(on) => set({ keepClosedSources: on })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">播放时窗口跳到最前</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">关着时播视频、开挂件不会抢到最前面，不打断手上的事。</p>
            </div>
            <Toggle label="播放时窗口跳到最前" value={s.outputRaiseOnOpen === true} onChange={(on) => set({ outputRaiseOnOpen: on })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">画面自动收边</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-3)]">窗口收成画面本身的比例，竖屏视频两边不留黑边。手动调过窗口大小的按调完的算。</p>
            </div>
            <Toggle label="画面自动收边" value={s.outputFitMedia !== false} onChange={(on) => set({ outputFitMedia: on })} />
          </div>
          <Select aria-label="采集窗口名称" value={s.outputTitleStyle === 'legacy' ? 'legacy' : 'short'} onChange={(e) => set({ outputTitleStyle: e.target.value as 'short' | 'legacy' })}>
            <option value="short">短名称：倒计时 / 进场（推荐）</option>
            <option value="legacy">旧名称：知了猴倒计时 / 知了猴进场</option>
          </Select>
          <p className="text-xs leading-5 text-[var(--text-3)]">切换后直播伴侣里的来源要重新选一次窗口。</p>
          </AdvancedSection>
          <Field label="默认播放窗口" hint="规则里没指定窗口的视频先去这里；视频只在开着的绿幕窗口里排队，没开的窗口不会播">
            <Segmented size="sm" value={String(s.videoDefaultSlot || 1)} onChange={(v) => set({ videoDefaultSlot: Number(v) })} options={[{ value: '1', label: '绿幕 1' }, { value: '2', label: '绿幕 2' }, { value: '3', label: '绿幕 3' }, { value: '4', label: '绿幕 4' }]} />
          </Field>
          <Field advanced label="排队上限" hint="0 = 不限（默认）：粉丝连送一千个一万个都排着播。想限的话填个数，超过的不播并在日志里说明；「停止视频」随时清空排队">
            <Input type="number" min={0} max={100000} value={String(s.videoQueueLimit || 0)} onChange={(e) => set({ videoQueueLimit: Math.min(100000, Math.max(0, Math.round(Number(e.target.value) || 0))) })} />
          </Field>
        </section>

        <AdvancedSection title="绿幕抠图微调"><section className="space-y-3">
          <h3 className="border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">内置绿幕抠图</h3>
          <p className="text-xs leading-5 text-[var(--text-3)]">
            项目素材自带绿背景时，可以在奖项/动作里打开「绿幕抠图」，让客户端自己把绿扣成透明。配直播伴侣时请用「绿幕采集」模式：扣掉的地方露出窗口绿底，伴侣的绿幕抠像一起把它去掉；透明底模式下扣掉的地方在伴侣里会变黑。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="抠图颜色" hint="片子的绿幕偏青、偏黄就改这个">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="抠图颜色"
                  value={chroma.color}
                  onChange={(e) => set({ chromaKey: { ...chroma, color: e.target.value } })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                />
                <Input value={chroma.color} onChange={(e) => set({ chromaKey: { ...chroma, color: e.target.value } })} className="flex-1" />
              </div>
            </Field>
            {([
              ['similarity', '相似度', '越大越容易把接近这个颜色的像素扣掉'],
              ['smoothness', '边缘平滑', '太大人物边缘会发虚'],
              ['spill', '溢色抑制', '压掉人物边缘残留的绿边']
            ] as const).map(([key, label, hint]) => (
              <Field key={key} label={label} hint={hint}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={label}
                    value={chroma[key]}
                    onChange={(e) => set({ chromaKey: { ...chroma, [key]: Number(e.target.value) } })}
                    className="flex-1"
                  />
                  <span className="tnum w-10 text-right text-sm text-[var(--text-2)]">{chroma[key]}</span>
                </div>
              </Field>
            ))}
          </div>
        </section></AdvancedSection>

        <section className="space-y-3">
          <h3 className="flex items-center justify-between border-b border-[var(--line)] pb-2 text-sm font-semibold text-[var(--text)]">
            <span>关于</span>
            <span className="text-xs font-normal text-[var(--text-4)]">报障时把版本号一起发给客服</span>
          </h3>
          <div className="grid gap-1.5 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-3)]">当前版本</span>
              <span className="tnum select-text font-semibold text-[var(--text)]">
                {ver ? `v${ver.version}` : '读取中…'}
              </span>
              {ver && !ver.packaged ? <Pill tone="warn">开发模式</Pill> : null}
            </div>
            <div className="flex items-center gap-2 text-[var(--text-3)]">
              <span>运行环境</span>
              <span className="select-text text-[var(--text-2)]">
                {ver ? `Electron ${ver.electron} · Windows ${ver.osVersion}` : '—'}
              </span>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between border-t border-[var(--line)] pt-4">
          <Btn
            variant="secondary"
            onClick={() => window.api.getSettings().then(({ settings }) => setS(settings))}
          >
            <RefreshCw size={14} /> 还原
          </Btn>
          <Btn onClick={save}>
            <Save size={14} /> 保存设置
          </Btn>
        </div>
      </div>
      {modal}
      <Modal
        open={!!unbindRoom}
        onClose={() => setUnbindRoom(null)}
        title="解绑直播间"
        width={420}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setUnbindRoom(null)}>
              取消
            </Btn>
            <Btn variant="danger" onClick={doUnbind}>
              确认解绑
            </Btn>
          </>
        }
      >
        <p className="text-sm leading-6 text-[var(--text-2)]">
          解绑直播间{' '}
          <span className="select-text font-mono text-[var(--text)]">{unbindRoom}</span>？
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--text-3)]">
          {cardFree ? '解绑后可以随时再绑定。' : cardMode ? '解绑后可以再次绑定，绑定按当前账号的卡密授权放行。' : '解绑后再次绑定需重新申请授权。'}
        </p>
      </Modal>
      <Modal
        open={!!lookup}
        onClose={() => setLookup(null)}
        title="确认直播间"
        width={420}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setLookup(null)}>
              取消
            </Btn>
            <Btn onClick={confirmBind}>确认绑定</Btn>
          </>
        }
      >
        {lookup && (
          <div>
            <div className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
              {lookup.avatar ? (
                <img
                  src={lookup.avatar}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-2)] to-[var(--accent)] text-lg font-bold text-white">
                  {(lookup.nickname || '?')[0]}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text)]">
                  {lookup.nickname}
                </div>
                <div className="select-text mt-0.5 font-mono text-xs text-[var(--text-3)]">
                  直播间 {lookup.room}
                </div>
              </div>
            </div>
            {lookup.offline && (
              <p className="mt-3 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2 text-xs leading-5 text-[var(--warn)]">
                该直播间当前未开播，无法直接读取房主信息。以下为当前登录的抖音账号，请确认房号属于该账号。
              </p>
            )}
            <p className="mt-4 text-sm text-[var(--text-2)]">
              确认绑定该直播间？
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

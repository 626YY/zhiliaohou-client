import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Trash2, CheckCircle2, Package, Lock, Radio } from 'lucide-react'
import type { InstalledMod, ModManifest, ModsListResult, EmailLicense, ModInstallProgress } from '@shared/types'
import { useToast } from '../stores/ui'
import { getCachedAuth, fetchAuth } from '../lib/gameAuthCache'
import { Btn, Loading } from '../components/ui'
import { assetUrl } from '../utils/assetUrl'
import { compareVersion } from '../lib/version'
import { modStatusOf } from '@shared/modsCatalog'
import { ModCardAccess } from '../components/CardAccess'
import { useCardAccess } from '../lib/useCardAccess'

// 安装按钮上的阶段文案：轮椅 mod 安装包 200 多 MB，下载十几分钟不能让主播盯着「安装中…」干等
function progressText(p: ModInstallProgress | null): string {
  if (!p) return '准备中…'
  if (p.phase === 'download') return `下载中 ${p.percent}%`
  if (p.phase === 'cached') return '已有安装包，跳过下载'
  if (p.phase === 'verify') return '校验安装包…'
  if (p.phase === 'install') return p.detail ? `${p.detail}…` : '安装中…'
  return '收尾中…'
}

export default function ModDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast((s) => s.toast)
  const [data, setData] = useState<ModsListResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<ModInstallProgress | null>(null)
  useEffect(() => window.api.onModInstallProgress((p) => setProg(p)), [])
  const [email, setEmail] = useState('')
  const [auth, setAuth] = useState<EmailLicense | null>(null)
  const [applying, setApplying] = useState(false)
  // 卡密平台模式：授权看卡密权益，安装 / 更新 / 卸载照旧；安装被主进程门禁拦下时它会自己弹激活窗
  const { enabled: cardMode } = useCardAccess()

  const load = () => window.api.listMods().then(setData)
  useEffect(() => {
    load()
  }, [])

  // 授权在 mod 侧卡：登录邮箱后，对应游戏未授权 → 不让装 mod，给申请入口
  const loadAuth = async () => {
    const s = await window.api.session()
    const em = s?.email ?? ''
    setEmail(em)
    if (!em) {
      setAuth(null)
      return
    }
    let a = getCachedAuth(em)
    if (a === undefined) a = await fetchAuth(em)
    setAuth(a)
  }
  useEffect(() => {
    loadAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mod: ModManifest | undefined = data?.mods.find((m) => m.id === id)
  const installed: InstalledMod | undefined = data?.installed[id ?? '']

  // 门禁：mod 绑定了游戏 + 已登录 + 未授权 → 卡安装。未登录（卡密/离线）放行。
  const gid = mod?.gameId ?? ''
  const gated = !cardMode && !!(gid && auth && !auth.banned && !auth.games?.[gid])
  const banned = !cardMode && !!(gid && auth?.banned)
  const pending = !cardMode && !!(gid && auth?.pendingGames?.includes(gid))
  // 后台标了「待发售」：没装过的只看不装（申请授权也先别申请）；已装的照旧走重装/卸载
  const comingSoon = modStatusOf(mod) === 'coming_soon'

  const apply = async () => {
    if (!email || !gid) return
    setApplying(true)
    try {
      const r = await window.api.emailGameApply(email, gid)
      if (!r.ok) {
        toast(r.error ?? '申请提交失败，请稍后重试', 'error')
        return
      }
      if (r.status === 'granted') toast('已获得授权，可以安装了', 'success')
      else if (r.status === 'already') toast('该游戏已授权', 'success')
      else toast('申请已提交，后台审批通过后自动解锁', 'success')
      await fetchAuth(email, true)
      await loadAuth()
    } finally {
      setApplying(false)
    }
  }

  if (!data) return <Loading text="正在加载 Mod 详情…" />
  if (!mod) {
    return (
      <div className="p-8">
        <Btn variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-4">
          <ArrowLeft size={15} /> 返回
        </Btn>
        <div className="text-sm text-[var(--text-3)]">
          未找到该 Mod，可能已下架。返回游戏库查看可用 Mod。
        </div>
      </div>
    )
  }

  const doInstall = async () => {
    setBusy(true)
    try {
      setProg(null)
      const res = await window.api.installMod(mod.id)
      if (res.ok) {
        toast(`${mod.name} 安装成功。`, 'success')
      } else if ((res as { code?: string }).code === 'license_required') {
        // 主进程已广播「需要激活」，激活弹窗由 CardAccessHost 弹出，这里不再重复报错
      } else {
        toast(res.error ?? '安装失败，请检查游戏路径后重试。', 'error')
      }
    } finally {
      setBusy(false)
      load()
    }
  }

  const doUninstall = async () => {
    setBusy(true)
    try {
      const res = await window.api.uninstallMod(mod.id)
      if (res.ok) {
        toast(`${mod.name} 已卸载。`, 'info')
      } else {
        toast(res.error ?? '卸载失败，请稍后重试。', 'error')
      }
    } finally {
      setBusy(false)
      load()
    }
  }

  return (
    <div className="p-6">
      <Btn variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-4">
        <ArrowLeft size={15} /> 返回游戏库
      </Btn>

      <div
        className="relative overflow-hidden rounded-2xl border border-[var(--line)]"
        style={{
          background: `linear-gradient(135deg, ${mod.color}22, ${mod.color})`
        }}
      >
        {mod.cover && (
          <img
            src={assetUrl(mod.cover)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/20" />
        <div className="relative flex min-h-[200px] items-end gap-6 p-8">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/40 text-5xl font-black text-white shadow-inner backdrop-blur">
            {mod.cover ? (
              <img
                src={assetUrl(mod.cover)}
                alt={mod.name}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              mod.name.slice(0, 1)
            )}
          </div>
          <div className="min-w-0 pb-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                {mod.name}
              </h1>
              <span className="tnum rounded bg-black/45 px-2 py-0.5 text-xs text-white">
                v{mod.version}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/85 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
              {mod.tagline}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {mod.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-black/35 px-2.5 py-0.5 text-xs text-white/85"
                >
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_320px] gap-6">
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">简介</h3>
            <p className="text-sm leading-6 text-[var(--text-2)]">{mod.description}</p>
          </section>

          {mod.screenshots.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">截图</h3>
              <div className="grid grid-cols-2 gap-2">
                {mod.screenshots.map((src) => (
                  <a
                    key={src}
                    href={assetUrl(src)}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-xl border border-[var(--line)]"
                  >
                    <img
                      src={assetUrl(src)}
                      alt=""
                      className="aspect-video w-full object-cover transition hover:scale-[1.03]"
                    />
                  </a>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">功能特性</h3>
            <ul className="space-y-1.5">
              {mod.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-[var(--text-2)]"
                >
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--ok)]" />
                  {f}
                </li>
              ))}
            </ul>
          </section>

          {mod.changelog.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">更新日志</h3>
              <div className="space-y-3">
                {mod.changelog.map((c) => (
                  <div
                    key={c.version}
                    className="rounded-lg border border-[var(--line)] bg-[var(--bg-card)] p-3"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="tnum font-semibold text-[var(--accent-2)]">
                        v{c.version}
                      </span>
                      <span className="tnum text-xs text-[var(--text-4)]">{c.date}</span>
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--text-3)]">
                      {c.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="h-fit space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-card)] p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
          <div className="flex items-center gap-2 text-sm">
            <Package size={16} className="text-[var(--text-3)]" />
            <span className="text-[var(--text-3)]">目标游戏</span>
            <span className="ml-auto font-medium text-[var(--text)]">{mod.game}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-3)]">作者</span>
            <span className="ml-auto text-[var(--text)]">{mod.author}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-3)]">大小</span>
            <span className="tnum ml-auto text-[var(--text)]">
              {mod.download.size > 1024
                ? `${(mod.download.size / 1024 / 1024).toFixed(1)} MB`
                : `${mod.download.size} KB`}
            </span>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            {/* 卡密模式：授权状态 + 激活入口放在安装区上方，已安装管理按钮不受影响 */}
            <ModCardAccess gameId={gid} />
            {comingSoon && !installed ? (
              <div className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2.5 text-center text-xs font-medium text-[var(--warn)]">
                待发售 · 上架后即可安装
              </div>
            ) : installed ? (
              <>
                <div className="mb-3 rounded-lg bg-[var(--ok-soft)] px-3 py-2 text-center text-xs font-medium text-[var(--ok)]">
                  已安装{installed.version ? <> <span className="tnum">v{installed.version}</span></> : '（本机检测到）'}
                  <div className="mt-0.5 select-text text-[10px] font-normal text-[var(--text-3)]">
                    {installed.installPath}
                  </div>
                </div>
                {(() => {
                  const cmp = installed.version ? compareVersion(mod.version, installed.version) : 0
                  const label = busy ? progressText(prog) : cmp > 0 ? `更新到 v${mod.version}` : cmp < 0 ? `重装为 v${mod.version}（本机 v${installed.version} 更新）` : installed.version ? '重新安装' : `安装 v${mod.version}（覆盖本机这份）`
                  return (
                    <Btn size="lg" variant={cmp > 0 ? 'primary' : 'secondary'} onClick={doInstall} disabled={busy} className="w-full">
                      <Download size={15} /> {label}
                    </Btn>
                  )
                })()}
                <Btn
                  variant="danger"
                  size="lg"
                  onClick={doUninstall}
                  disabled={busy}
                  className="mt-2 w-full"
                >
                  <Trash2 size={15} /> 卸载
                </Btn>
              </>
            ) : banned ? (
              <div className="rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-center text-xs font-medium text-[var(--danger)]">
                账号已封禁，无法安装
              </div>
            ) : gated ? (
              pending ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] px-3 py-2.5 text-xs font-medium text-[var(--warn)]">
                  <Radio size={14} className="animate-pulse" /> 授权审批中，通过后自动解锁
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-elev)] px-3 py-2 text-xs text-[var(--text-3)]">
                    <Lock size={13} /> 该 Mod 需要 {mod.game} 授权
                  </div>
                  <Btn size="lg" onClick={apply} disabled={applying} className="w-full">
                    <Lock size={15} /> {applying ? '申请中…' : '申请授权'}
                  </Btn>
                </>
              )
            ) : (
              <Btn size="lg" onClick={doInstall} disabled={busy} className="w-full">
                <Download size={15} /> {busy ? progressText(prog) : '安装 Mod'}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

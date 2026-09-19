import { useEffect, useState } from 'react'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/ui'
import {
  loadCred,
  saveCred,
  clearCred,
  loadUserCred,
  clearUserCred
} from '../lib/cred'
import type { AuthAccount } from '@shared/types'
import { X } from 'lucide-react'
import { Btn, Input } from '../components/ui'
import { Modal } from '../components/Modal'
import { AuthLoading } from '../components/AuthLoading'
import { AuthBackdrop } from '../components/AuthBackdrop'
import { CicadaMark } from '../components/CicadaMark'
import { useCardModeProbe } from '../lib/useCardAccess'
import logo from '../assets/logo.png'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function Login() {
  const setUser = useAuth((s) => s.setUser)
  const toast = useToast((s) => s.toast)
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [accounts, setAccounts] = useState<AuthAccount[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [autoLogin, setAutoLogin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loggingIn, setLoggingIn] = useState<{ name: string; avatar?: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<AuthAccount | null>(null)
  // 卡密平台模式：正式平台（existing）复用原邮箱身份，注册 / 找回密码照旧要邮箱验证码；
  // 本机测试平台（local）邮箱 + 密码直接注册、不发验证码、忘记密码找平台管理员。
  // 平台元信息读不到时 requiresCode 为 true（保守），不会把本机那套表单放到线上。
  const card = useCardModeProbe()
  const cardMode = card.enabled
  const requiresCode = !cardMode || card.requiresCode
  const [switching, setSwitching] = useState(false)
  const [switched, setSwitched] = useState(false)

  // 安装包带了默认平台配置、但本机只有旧版本地账号：主播点这里才切到新账号系统（重启生效），不自动切
  const adoptDefault = async () => {
    if (switching) return
    setSwitching(true)
    try {
      const r = await window.api.cardAdoptDefault()
      if (r.ok) {
        setSwitched(true)
        toast('已切换到新账号系统，重新打开客户端后生效；旧账号和配置都还在', 'success')
      } else {
        toast(r.error || '切换失败，请稍后重试', 'error')
      }
    } finally {
      setSwitching(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      const list = await window.api.listAccounts()
      setAccounts(list)
      let remember = true
      const cred = await loadCred()
      if (cred) {
        setAccount(cred.username)
        setPassword(cred.password)
      } else if (list.length) {
        const saved = await loadUserCred(list[0].username)
        if (saved) {
          setAccount(list[0].username)
          setPassword(saved)
        } else {
          remember = false
        }
      } else {
        remember = false
      }
      const { settings } = await window.api.getSettings()
      setRememberMe(remember)
      setAutoLogin(settings.autoLogin)
    })()
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const sendCode = async () => {
    const email = account.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      toast('邮箱格式不正确，请检查后重试', 'error')
      return
    }
    setSending(true)
    try {
      const res = await window.api.emailSendCode(email)
      if (res.ok) {
        toast('验证码已发送，10 分钟内有效', 'success')
        setCountdown(60)
      } else {
        toast(res.error ?? '验证码发送失败，请稍后重试', 'error')
      }
    } finally {
      setSending(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (mode !== 'login') {
      if (password !== confirm) {
        toast('两次输入的密码不一致，请重新输入', 'error')
        return
      }
      if (requiresCode && !code.trim()) {
        toast('请填写邮箱收到的验证码', 'error')
        return
      }
      if (cardMode && password.length < 6) {
        toast('密码至少 6 位', 'error')
        return
      }
      if (!EMAIL_RE.test(account.trim())) {
        toast('邮箱格式不正确，请检查后重试', 'error')
        return
      }
    }
    setBusy(true)
    // 点登录立即切过渡屏（Steam 式）；失败在 finally 前清掉回表单
    if (mode === 'login') {
      const known = accounts.find(
        (a) => a.username.toLowerCase() === account.trim().toLowerCase()
      )
      setLoggingIn({
        name: known?.nickname || known?.username || account.trim(),
        avatar: known?.avatar
      })
    }
    try {
      const isEmail = EMAIL_RE.test(account.trim())
      if (mode === 'reset' && cardMode && !requiresCode) {
        // 本机测试平台没有自助重置接口，不调旧的邮箱重置 API
        toast('请联系平台管理员重置密码', 'info')
        return
      }
      if (mode === 'reset') {
        const res = await window.api.emailReset(
          account.trim(),
          code.trim(),
          password
        )
        if (res.ok && res.user) {
          // 正式卡密平台：重置成功即建立会话，直接进主界面（记住密码按当前勾选处理）
          if (rememberMe) {
            saveCred(account.trim(), password)
            window.api.saveSettings({ rememberMe: true, autoLogin })
          } else {
            clearCred()
            clearUserCred(account.trim())
            window.api.saveSettings({ rememberMe: false, autoLogin: false })
          }
          toast('密码已重置，已用新密码登录', 'success')
          setLoggingIn({ name: res.user.nickname || res.user.username, avatar: res.user.avatar })
          await new Promise((r) => setTimeout(r, 600))
          setUser(res.user)
        } else if (res.ok) {
          toast('密码已重置，请用新密码登录', 'success')
          setMode('login')
          setPassword('')
          setConfirm('')
          setCode('')
        } else {
          toast(res.error ?? '重置失败，请检查验证码后重试', 'error')
        }
        return
      }
      const res =
        mode === 'login'
          ? isEmail
            ? await window.api.emailLogin(account.trim(), password)
            : await window.api.login(account.trim(), password)
          : await window.api.emailRegister(
              account.trim(),
              requiresCode ? code.trim() : '',
              password,
              nickname
            )
      if (res.ok && res.user) {
        if (rememberMe) {
          saveCred(account.trim(), password)
          window.api.saveSettings({ rememberMe: true, autoLogin })
        } else {
          clearCred()
          clearUserCred(account.trim())
          window.api.saveSettings({ rememberMe: false, autoLogin: false })
        }
        // 登录成功再停留半秒过渡屏（Steam 式「正在登录…」），然后进主界面
        setLoggingIn({
          name: res.user.nickname || res.user.username,
          avatar: res.user.avatar
        })
        await new Promise((r) => setTimeout(r, 600))
        setUser(res.user)
      } else {
        setLoggingIn(null)
        toast(res.error ?? '操作失败，请稍后重试。', 'error')
      }
    } catch (e) {
      // IPC 本身 reject（主进程 handler 抛错）以前直接跳到 finally，过渡屏永远不消失、又没有返回按钮
      setLoggingIn(null)
      toast('操作失败：' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  const pickAccount = async (a: AuthAccount) => {
    setAccount(a.username)
    setPickerOpen(false)
    const saved = await loadUserCred(a.username)
    if (saved) {
      setPassword(saved)
      setRememberMe(true)
    } else {
      setPassword('')
    }
  }

  const confirmRemove = async () => {
    const a = pendingDelete
    if (!a) return
    const r = await window.api.deleteAccount(a.id)
    if (!r.ok) {
      toast(r.error || '删除失败，请稍后重试。', 'error')
      return
    }
    clearUserCred(a.username)
    setAccounts((prev) => prev.filter((x) => x.id !== a.id))
    if (account.trim().toLowerCase() === a.username.toLowerCase()) {
      setAccount('')
      setPassword('')
    }
    setPendingDelete(null)
    toast('本地账号已删除。', 'success')
  }

  const codeBtnText =
    countdown > 0 ? `${countdown}s 后可重发` : sending ? '发送中…' : '发送验证码'

  // 登录请求进行中/成功后的过渡屏（Steam 图2 风格）
  if (loggingIn) {
    return <AuthLoading name={loggingIn.name} avatar={loggingIn.avatar} />
  }

  return (
    <div className="drag-region relative flex h-full flex-col overflow-hidden">
      <AuthBackdrop />
      <button
        onClick={() => window.api.windowClose()}
        aria-label="关闭窗口"
        title="关闭"
        className="no-drag absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-4)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
      >
        <X size={18} />
      </button>

      {/* 顶部品牌横排（对应 Steam 的「← STEAM®」位置） */}
      <div className="relative flex items-center gap-3 px-7 pt-5">
        <img
          src={logo}
          alt="UMSTUDIO"
          className="h-9 w-9 rounded-xl object-contain"
          style={{ boxShadow: '0 6px 20px var(--accent-glow)' }}
        />
        <div className="leading-tight">
          <div className="text-lg font-bold tracking-[0.22em] text-[var(--text)]">
            UMSTUDIO<span className="align-super text-[9px] tracking-normal">®</span>
          </div>
          <div className="text-[10px] tracking-[0.08em] text-[var(--text-4)]">
            UNDERSTAND MONKEY · 知了猴整蛊台
          </div>
        </div>
      </div>

      {/* 表单区（Steam 裸表单：左表单 + 右蝉剪影动画，对应 Steam 二维码区的位置） */}
      <div className="login-form-area no-drag relative flex min-h-0 min-w-0 flex-1 items-start justify-center gap-14 overflow-x-hidden overflow-y-auto px-7 py-4">
        {/* 登录页外观与原版一致：不显示授权服务 / 平台连接状态，连不上时由登录结果的 toast 说明原因。
            data-* 只给回归脚本判断卡密模式已探测完，不渲染任何文字。 */}
        <div
          className="my-auto w-[400px] max-w-full shrink-0 pb-4"
          data-testid="login-panel"
          data-card-loaded={card.loaded ? '1' : '0'}
          data-card-mode={cardMode ? '1' : '0'}
          data-identity={card.identityMode || ''}
          data-requires-code={requiresCode ? '1' : '0'}
        >
          {card.legacyHold ? (
            <div className="mb-3 space-y-1.5 border-b border-[var(--line)] pb-2 text-xs" data-testid="card-legacy-hold">
              <div className="text-[var(--text-3)]">本机保留着旧版本地账号，仍按旧方式登录；账号和配置都不会丢。</div>
              <button
                type="button"
                onClick={adoptDefault}
                disabled={switching || switched}
                className="text-[var(--accent-2)] transition hover:underline disabled:opacity-60"
              >
                {switched ? '已切换，重新打开客户端后生效' : switching ? '正在切换…' : '有邮箱账号或想注册新账号？切换到新账号系统'}
              </button>
            </div>
          ) : null}
          {mode === 'login' ? (
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-xs font-medium text-[var(--accent-2)]">
                用账户名称登录
              </label>
              <div className="relative">
                <Input
                  className={`h-11 bg-[var(--bg-elev)] ${accounts.length ? 'pr-9' : ''}`}
                  placeholder="邮箱 / 用户名"
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value)
                    setPickerOpen(false)
                  }}
                  autoFocus
                />
                {accounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    title="选择已保存的账号"
                    aria-label="选择已保存的账号"
                    className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-xs text-[var(--text-3)] transition hover:text-[var(--text)]"
                  >
                    ▾
                  </button>
                )}
                {pickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setPickerOpen(false)}
                    />
                    <div className="zl-pop absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--bg-elev)]" style={{ boxShadow: 'var(--shadow-pop)' }}>
                      {accounts.map((a) => (
                        <div
                          key={a.id}
                          className="group flex items-center transition hover:bg-[var(--line-strong)]"
                        >
                          <button
                            type="button"
                            onClick={() => pickAccount(a)}
                            className="min-w-0 flex-1 px-3 py-2 text-left"
                          >
                            <div className="truncate text-sm text-[var(--text)]">
                              {a.nickname || a.username}
                            </div>
                            <div className="truncate text-xs text-[var(--text-4)]">
                              {a.username}
                              {a.email ? ' · 邮箱' : ''}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(a)}
                            title="删除该账号"
                            aria-label={`删除账号 ${a.nickname || a.username}`}
                            className="shrink-0 rounded px-1.5 text-sm text-[var(--text-4)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--danger)]"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <label className="block text-xs font-medium text-[var(--text-3)]">
                密码
              </label>
              <Input
                type="password"
                placeholder="密码"
                className="h-11 bg-[var(--bg-elev)]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex items-center gap-5 pb-1 text-xs">
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-[var(--text-3)]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => {
                      setRememberMe(e.target.checked)
                      if (!e.target.checked) setAutoLogin(false)
                    }}
                    className="accent-[var(--accent)]"
                  />
                  记住密码
                </label>
                <label
                  className={`flex cursor-pointer select-none items-center gap-1.5 ${
                    rememberMe ? 'text-[var(--text-3)]' : 'text-[var(--text-4)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={autoLogin}
                    disabled={!rememberMe}
                    onChange={(e) => setAutoLogin(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  自动登录
                </label>
              </div>
              <Btn
                type="submit"
                size="lg"
                disabled={busy}
                className="h-11 w-full text-[15px]"
                style={{ boxShadow: '0 6px 20px var(--accent-glow)' }}
              >
                {busy ? '处理中…' : '登录'}
              </Btn>
              <div className="flex items-center justify-between pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset')
                    setPickerOpen(false)
                  }}
                  className="text-[var(--text-3)] transition hover:text-[var(--accent-2)] hover:underline"
                >
                  忘记密码，无法登录？
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register')
                    setPickerOpen(false)
                  }}
                  className="text-[var(--text-3)] transition hover:text-[var(--accent-2)] hover:underline"
                >
                  没有账号？创建账号
                </button>
              </div>
            </form>
          ) : mode === 'register' ? (
            <form onSubmit={submit} className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs text-[var(--text-3)] transition hover:text-[var(--text)]"
                >
                  ← 返回登录
                </button>
                <span className="text-xs text-[var(--text-4)]">注册邮箱账号</span>
              </div>
              <Input
                placeholder="邮箱号"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoFocus
              />
              {requiresCode && (
                <div className="flex gap-2">
                  <Input
                    placeholder="邮箱验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <Btn
                    type="button"
                    variant="secondary"
                    onClick={sendCode}
                    disabled={sending || countdown > 0}
                    className="tnum w-32 shrink-0"
                  >
                    {codeBtnText}
                  </Btn>
                </div>
              )}
              <Input
                placeholder="昵称（留空用邮箱名）"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
              <Input
                type="password"
                placeholder="密码（至少 6 位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="确认密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Btn
                type="submit"
                size="lg"
                disabled={busy}
                className="w-full"
                style={{ boxShadow: '0 6px 20px var(--accent-glow)' }}
              >
                {busy ? '处理中…' : '注册'}
              </Btn>
            </form>
          ) : cardMode && !requiresCode ? (
            <div className="space-y-3" data-testid="card-reset-help">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs text-[var(--text-3)] transition hover:text-[var(--text)]"
                >
                  ← 返回登录
                </button>
                <span className="text-xs text-[var(--text-4)]">忘记密码</span>
              </div>
              <p className="text-sm leading-6 text-[var(--text-2)]">
                平台账号不支持自助重置密码。请联系平台管理员核对账号后重置，再用新密码登录。
              </p>
              <Btn type="button" size="lg" className="w-full" onClick={() => setMode('login')}>
                返回登录
              </Btn>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs text-[var(--text-3)] transition hover:text-[var(--text)]"
                >
                  ← 返回登录
                </button>
                <span className="text-xs text-[var(--text-4)]">重置密码</span>
              </div>
              <Input
                placeholder="邮箱号"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Input
                  placeholder="邮箱验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Btn
                  type="button"
                  variant="secondary"
                  onClick={sendCode}
                  disabled={sending || countdown > 0}
                  className="tnum w-32 shrink-0"
                >
                  {codeBtnText}
                </Btn>
              </div>
              <Input
                type="password"
                placeholder="新密码（至少 6 位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="确认新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Btn
                type="submit"
                size="lg"
                disabled={busy}
                className="w-full"
                style={{ boxShadow: '0 6px 20px var(--accent-glow)' }}
              >
                {busy ? '处理中…' : '重置密码'}
              </Btn>
            </form>
          )}
        </div>
        {/* 右栏：蝉剪影科技动画（Steam 二维码区的对应位）；px-8 容纳光环溢出 */}
        <div className="my-auto hidden shrink-0 items-center px-8 min-[820px]:flex">
          <CicadaMark size={140} />
        </div>
      </div>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="删除本地账号"
        width={400}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setPendingDelete(null)}>
              取消
            </Btn>
            <Btn variant="danger" onClick={confirmRemove}>
              删除账号
            </Btn>
          </>
        }
      >
        <p className="text-sm leading-6 text-[var(--text-2)]">
          确定删除本地账号「{pendingDelete?.nickname || pendingDelete?.username}
          」吗？删除后需重新输入账号密码登录，云端数据不受影响。
        </p>
      </Modal>
    </div>
  )
}

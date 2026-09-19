import { useEffect, useState, type ReactNode } from 'react'
import { TrendingUp, Radio, Gift, Trash2, Crown } from 'lucide-react'
import type { GiftLogState, LiveStatsResult } from '@shared/types'
import { Btn, Card, EmptyState, PageHeader, Pill } from '../components/ui'
import { Modal } from '../components/Modal'
import { useToast } from '../stores/ui'
import { mediaUrl } from '../utils/mediaUrl'

const METRICS = ['飞天', '干掉', '抓鸭', '送礼次数', '送礼分', '炸毁']
const WINDOWS = ['今日', '本周', '本月', '总', '本年']
const LOG_LIMIT = 200

function fmtDur(sec: number): string {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// 当天只给时分秒，跨天补上月日（礼物记录留 30 天，全给完整日期太占地方）
function fmtWhen(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  return sameDay ? hms : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms}`
}

export default function Stats() {
  const toast = useToast((s) => s.toast)
  const [res, setRes] = useState<LiveStatsResult | null>(null)
  const [log, setLog] = useState<GiftLogState | null>(null)
  const [now, setNow] = useState(Date.now())
  const [askClear, setAskClear] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await window.api.liveStats()
        if (alive) setRes(r)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e))
      }
    }
    tick()
    void window.api.giftLogState(LOG_LIMIT).then((s) => {
      if (alive) setLog(s)
    })
    // 礼物记录在主进程常驻记账，页面只收推送（页面关着也照样记）
    const off = window.api.onGiftLogChanged((next) => {
      if (alive) setLog(next)
    })
    const t = setInterval(tick, 3000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      off()
      clearInterval(t)
      clearInterval(clock)
    }
  }, [])

  const clearLog = async () => {
    setAskClear(false)
    const r = await window.api.giftLogClear()
    setLog(await window.api.giftLogState(LOG_LIMIT))
    toast(r.cleared ? `已清空 ${r.cleared} 条礼物记录` : '礼物记录本来就是空的', 'success')
  }

  const session = res?.session
  const cells = res?.board?.cells ?? []
  // 直播中实时刷新；已下播用确认的结束时间（外部连接器旧格式退回最后心跳）。
  const dur = session
    ? Math.max(0, ((session.running ? now : (session.endedAt || session.last || session.started) * 1000) - session.started * 1000) / 1000)
    : 0
  const cellAt = (metric: number, window: number) =>
    cells.find((c) => c.metric === metric && c.window === window)?.value
  const boardHasData = cells.some(
    (c) =>
      c.metric >= 0 &&
      c.metric < METRICS.length &&
      c.window >= 0 &&
      c.window < WINDOWS.length &&
      c.value > 0
  )
  const hasLog = !!log?.kept

  return (
    <div className="p-6">
      <div className="mb-5">
        <PageHeader
          icon={<TrendingUp size={20} className="text-[var(--accent-2)]" />}
          title="直播互动统计"
          desc="本场互动、礼物记录与累计榜单，每 3 秒刷新。"
        />
      </div>

      {!session && !hasLog ? (
        <EmptyState
          icon={<Radio size={40} />}
          title={loadError ? '读取统计失败' : '暂无本场数据'}
          desc={loadError ? loadError + '（3 秒后自动重试）' : '连上直播间就开始记礼物、点赞、关注和遥控整蛊。'}
        />
      ) : (
        <div className="space-y-5">
          {session && (
            <Card
              title={
                <>
                  本场直播
                  <span className="ml-2 text-xs font-normal text-[var(--text-4)]">
                    房间 <span className="select-text">{session.room || '—'}</span>
                  </span>
                </>
              }
              actions={
                <Pill tone={session.running ? 'ok' : 'muted'} dot pulse={!!session.running}>
                  {session.running ? '直播中' : '已下播'}
                </Pill>
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <Stat label="开播时长" value={session.durationUnknown ? '—' : fmtDur(dur)} />
                <Stat label="收到礼物" value={fmtNum(session.gifts)} />
                <Stat label="礼物抖币" value={fmtNum(session.coins)} />
                <Stat label="点赞" value={fmtNum(session.likes)} />
                <Stat label="关注" value={fmtNum(session.follows)} />
                <Stat label="遥控整蛊" value={fmtNum(res?.remotePranks ?? 0)} />
              </div>
              {session.durationUnknown && (
                <p className="mt-3 text-xs text-[var(--text-4)]">旧版未准确记录本场下播时间，时长暂不显示。礼物等统计已保留。</p>
              )}
            </Card>
          )}

          <Card
            title="礼物记录"
            actions={
              <div className="flex items-center gap-2">
                <Pill tone="accent" dot>
                  {fmtNum(log?.total ?? 0)} 个 · {fmtNum(log?.totalCoins ?? 0)} 抖币
                </Pill>
                <Btn size="sm" variant="secondary" disabled={!hasLog} onClick={() => setAskClear(true)}>
                  <Trash2 size={13} /> 清空
                </Btn>
              </div>
            }
          >
            {hasLog ? (
              <div className="zl-scroll max-h-[22rem] overflow-auto">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr>
                      <Th>时间</Th>
                      <Th>送礼人</Th>
                      <Th>礼物</Th>
                      <Th num>个数</Th>
                      <Th num>抖币</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(log?.rows ?? []).map((row, i) => (
                      <tr key={`${row.ts}-${i}`}>
                        <Td>
                          <span className="tnum text-xs text-[var(--text-3)]">{fmtWhen(row.ts)}</span>
                        </Td>
                        <Td>
                          <span className="select-text">{row.sender || <span className="text-[var(--text-4)]">未知观众</span>}</span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-2">
                            {row.image ? (
                              <img src={mediaUrl(row.image)} alt="" className="h-6 w-6 shrink-0 object-contain" />
                            ) : (
                              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent-2)]">
                                {row.gift.slice(0, 1)}
                              </span>
                            )}
                            <span className="truncate" title={row.gift}>
                              {row.gift}
                            </span>
                            {row.sim && (
                              <span className="shrink-0 rounded border border-[var(--line-strong)] px-1 text-[10px] leading-4 text-[var(--text-4)]">
                                模拟
                              </span>
                            )}
                          </span>
                        </Td>
                        <Td num>{fmtNum(row.count)}</Td>
                        <Td num>{row.coins ? fmtNum(row.coins) : <span className="text-[var(--text-4)]">—</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--text-4)]">
                暂无礼物记录。观众每送一次记一条：谁、送了什么、几个、多少抖币。页面关着也照样记，保留 30 天。模拟出来的礼物带「模拟」标记。
              </p>
            )}
          </Card>

          {hasLog && (
            <Card
              title="送礼榜"
              actions={
                <span className="text-xs text-[var(--text-4)]">按抖币从高到低，最多 50 人</span>
              }
            >
              <div className="zl-scroll max-h-[20rem] overflow-auto">
                <table className="w-full min-w-[400px]">
                  <thead>
                    <tr>
                      <Th>名次</Th>
                      <Th>昵称</Th>
                      <Th num>礼物个数</Th>
                      <Th num>抖币</Th>
                      <Th>最近一次</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(log?.senders ?? []).map((row, i) => (
                      <tr key={row.sender || `anon-${i}`}>
                        <Td>
                          <span className="tnum inline-flex items-center gap-1 text-[var(--text-3)]">
                            {i === 0 && <Crown size={13} className="text-[var(--accent)]" />}
                            {i + 1}
                          </span>
                        </Td>
                        <Td>
                          <span className="select-text">{row.sender || <span className="text-[var(--text-4)]">未知观众</span>}</span>
                        </Td>
                        <Td num>{fmtNum(row.gifts)}</Td>
                        <Td num>{fmtNum(row.coins)}</Td>
                        <Td>
                          <span className="tnum text-xs text-[var(--text-3)]">{fmtWhen(row.last)}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {session && (
            <Card title="累计互动">
              {boardHasData ? (
                <div className="zl-scroll overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead>
                      <tr>
                        <Th>维度</Th>
                        {WINDOWS.map((w) => (
                          <Th key={w} num>
                            {w}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m, mi) => (
                        <tr key={m}>
                          <th
                            scope="row"
                            className="py-2 pr-3 text-left text-sm font-normal text-[var(--text-2)]"
                          >
                            {m}
                          </th>
                          {WINDOWS.map((_, wi) => {
                            const v = cellAt(mi, wi)
                            return (
                              <Td key={wi} num>
                                {v != null ? (
                                  fmtNum(v)
                                ) : (
                                  <span className="text-[var(--text-4)]">—</span>
                                )}
                              </Td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--text-4)]">
                  暂无累计数据。mod 开播后会记录观众互动账（炸毁/飞天/抓鸭等），游戏崩了也不丢。
                </p>
              )}
            </Card>
          )}
        </div>
      )}

      <Modal
        open={askClear}
        onClose={() => setAskClear(false)}
        title="清空礼物记录"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setAskClear(false)}>
              取消
            </Btn>
            <Btn variant="danger" onClick={clearLog}>
              清空
            </Btn>
          </>
        }
      >
        <p className="text-sm leading-6 text-[var(--text-2)]">
          将删除本机保存的全部 {fmtNum(log?.kept ?? 0)} 条礼物记录，送礼榜也跟着清零。删了找不回来，本场直播的汇总数字不受影响。
        </p>
      </Modal>
    </div>
  )
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '0'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-3">
      <div className="text-[11px] text-[var(--text-4)]">{label}</div>
      <div className="tnum mt-1 text-2xl font-bold text-[var(--text)]">{value}</div>
    </div>
  )
}

function Th({ children, num }: { children: ReactNode; num?: boolean }) {
  return (
    <th
      scope="col"
      className={`pb-2 pr-3 text-xs font-medium text-[var(--text-4)] ${
        num ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, num }: { children: ReactNode; num?: boolean }) {
  return (
    <td
      className={`py-2 pr-3 text-sm text-[var(--text)] ${
        num ? 'tnum text-right' : ''
      }`}
    >
      {children}
    </td>
  )
}

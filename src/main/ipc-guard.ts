// IPC 集中注册：每个通道只注册一次、只接受主窗口主框架的请求、按「使用类」通道套卡密门禁。
//   - trusted：输出窗口（绿幕 / 挂件 / 视频）没有 preload，本来就发不了 IPC；这里再从主进程侧把关，
//     任何不是主窗口主框架发来的 invoke 一律回 {ok:false}，不执行。
//   - 门禁只在卡密模式（userData/license-provider.json 存在）生效；没有配置时所有通道和原来一模一样。
//   - 门禁位置在「真正执行前」：先向平台要签名租约，通过才调原实现；不通过回
//     {ok:false,code:'license_required',product} 并给主窗口发 CardLicenseRequired 让页面弹卡密入口。
import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import { getMainWindow } from './main-window-ref'
import { currentGameId } from './games'
import { listMods } from './mods'
import { NeedsLicense, cardModeEnabled, cardProductForGame, cardRequire, notifyLicenseRequired } from './card-auth'
import { licenseEnforced } from './license-policy'
import { CARD_PLATFORM_PRODUCT } from './license-connection'
import { Ipc } from '@shared/types'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown
type EventHandler = (event: IpcMainEvent, ...args: any[]) => void
/** 通道 → 需要哪个产品：'platform' = 娱乐助手卡；'game' = 当前游戏的卡；函数 = 按参数算（mod 安装按 mod 所属游戏） */
type Gate = 'platform' | 'game' | ((...args: any[]) => string)

const PLATFORM_GATED = [
  Ipc.EntertainmentSendKeys, Ipc.EntertainmentSystemAction, Ipc.EntertainmentRunScript, Ipc.EntertainmentMouse,
  Ipc.EntertainmentSendText, Ipc.EntertainmentCommand, Ipc.ConnectorSimulate,
  Ipc.DanmakuForwardStart, Ipc.DanmakuForwardPublish, Ipc.GreenScreenOpen,
  Ipc.TimeWidgetOpen, Ipc.TimeWidgetAdjust, Ipc.TimeWidgetClear, Ipc.TimeWidgetPause, Ipc.TimeWidgetShowGift,
  Ipc.TimeWidgetTestGift, Ipc.TimeWidgetTestEvent, Ipc.TimeLogOpen,
  Ipc.MarqueeOpen, Ipc.MarqueeSend,
  Ipc.ChallengeOpen, Ipc.ChallengeAdjust, Ipc.ChallengeApplyGift, Ipc.ChallengePause,
  Ipc.LotteryOpen, Ipc.LotterySpin, Ipc.AdvancedWheelOpen, Ipc.AdvancedWheelSpin,
  Ipc.ProgressOpen, Ipc.ProgressAdjust, Ipc.ProgressReset, Ipc.KeyboardOpen,
  Ipc.ObsConnect, Ipc.ObsSetFilter, Ipc.ObsSetScene, Ipc.ObsLaunch, Ipc.ObsEnableServer, Ipc.LiveCompanionLaunch,
  Ipc.ProtectWidgetOpen, Ipc.EffectsOpen, Ipc.EffectsFire, Ipc.EntranceOpen, Ipc.EntranceTest,
  Ipc.QueueOpen, Ipc.QueueSkip, Ipc.WishOpen, Ipc.WishReset, Ipc.VideoWidgetOpen,
  Ipc.PinyouProjectTest
] as const

const GAME_GATED = [Ipc.GameLaunch, Ipc.LiveSet, Ipc.LivePrank, Ipc.LiveCmd, Ipc.ConfigSave, Ipc.ConnectorStart, Ipc.ConnectorSend] as const

function modProduct(modId: unknown): string {
  const mod = listMods().mods.find((m) => m.id === String(modId ?? ''))
  return cardProductForGame(mod?.gameId || '')
}

export const USE_GATES: Record<string, Gate> = {
  ...Object.fromEntries(PLATFORM_GATED.map((c) => [c, 'platform' as const])),
  ...Object.fromEntries(GAME_GATED.map((c) => [c, 'game' as const])),
  [Ipc.ModsInstall]: (modId: unknown) => modProduct(modId),
  [Ipc.ModsRepair]: (gameId: unknown) => cardProductForGame(typeof gameId === 'string' && gameId ? gameId : currentGameId())
}

function productFor(gate: Gate, args: unknown[]): string {
  if (gate === 'platform') return CARD_PLATFORM_PRODUCT
  if (gate === 'game') return cardProductForGame(currentGameId())
  return gate(...args)
}

/** 只信主窗口的主框架：其它窗口、子框架、已销毁的窗口都不接受。 */
export function trustedMainWindow(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const main = getMainWindow()
  if (!main) return false
  const contents = main.webContents
  if(event.sender!==contents||!event.senderFrame||event.senderFrame!==contents.mainFrame)return false
  const expected=!app.isPackaged&&process.env.ELECTRON_RENDERER_URL?process.env.ELECTRON_RENDERER_URL:pathToFileURL(join(__dirname,'../renderer/index.html')).href
  const documentPath=(value:string)=>value.split('#')[0].split('?')[0].replace(/\/$/,'')
  return documentPath(event.senderFrame.url)===documentPath(expected)
}

const UNTRUSTED = { ok: false, error: '不接受此窗口的请求' }

export interface IpcRegistry {
  handle: (channel: string, fn: InvokeHandler) => void
  on: (channel: string, fn: EventHandler) => void
  channels: () => string[]
}

export function createIpcRegistry(): IpcRegistry {
  const registered = new Set<string>()
  const claim = (channel: string): void => {
    if (registered.has(channel)) throw new Error('IPC 通道重复注册：' + channel)
    registered.add(channel)
  }
  return {
    handle(channel, fn) {
      claim(channel)
      const gate = USE_GATES[channel]
      ipcMain.handle(channel, async (event, ...args) => {
        if (!trustedMainWindow(event)) return UNTRUSTED
        const cleanup=channel===Ipc.EntertainmentCommand&&['key-unlock','key-up','video-stop'].includes(String(args[0]))
        // 免检模式（license-policy enforce=false）：门禁整个跳过，任何通道都不会再回 license_required
        if (gate && !cleanup && cardModeEnabled() && licenseEnforced()) {
          const product = productFor(gate, args)
          try {
            await cardRequire(product)
          } catch (e) {
            if (e instanceof NeedsLicense) {
              notifyLicenseRequired(e.product)
              return { ok: false, code: 'license_required', product: e.product, error: e.message }
            }
            return { ok: false, error: e instanceof Error ? e.message : String(e) }
          }
        }
        return fn(event, ...args)
      })
    },
    on(channel, fn) {
      claim(channel)
      ipcMain.on(channel, (event, ...args) => {
        if (!trustedMainWindow(event)) return
        fn(event, ...args)
      })
    },
    channels: () => [...registered]
  }
}

/**
 * obs-ws-core.ts —— OBS 远程控制核心（obs-websocket 协议 v5，OBS 28+ 自带）
 *
 * 纯 Node 实现：只用 node:net / node:crypto，不 import electron，也不新增任何 npm 依赖。
 * 这样 tools/obs-smoke.mjs 可以单独把本文件编译成 CommonJS，在纯 Node 里对着假 OBS 做冒烟测试。
 * 主进程业务代码请统一从 ./obs-client.ts 引用（那是薄封装，只多挂了「应用退出前断开」）。
 *
 * 结构：
 *   MiniWebSocket —— 手写的最小 WebSocket 客户端（RFC 6455，只做明文 ws://）
 *                    HTTP Upgrade 握手 + Accept 校验、帧解析（分片/ping/pong/close、126/127 扩展长度）、
 *                    发送帧一律加掩码。
 *   ObsClient     —— obs-websocket v5 会话：Hello → Identify(鉴权) → Identified，
 *                    请求/应答按 requestId 配对 + 超时，事件派发，状态维护。
 *   默认单例 obsClient + 一组导出函数（obsConnect / obsRequest / obsToggleFilter ...）。
 *
 * 断线后只把 connected 置 false 并通知订阅者，不自动重连——重连策略交给上层决定。
 */
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'

// ==================== 对外类型 ====================

export interface ObsConnectOptions {
  host: string
  port: number
  password: string
  /** 事件订阅位掩码（见 ObsEventSubscription），默认 DEFAULT_EVENT_SUBSCRIPTIONS */
  eventSubscriptions?: number
  /** 整个连接流程（TCP → 握手 → Hello → Identified → GetVersion）的总超时，默认 10 秒 */
  timeoutMs?: number
}

export interface ObsFilterInfo {
  /** 滤镜所属的源（输入源 / 场景 / 分组）名 */
  source: string
  /** 滤镜名 */
  filter: string
  /** 滤镜类型 id，如 color_filter_v2 / chroma_key_filter_v2 */
  kind: string
  enabled: boolean
}

export interface ObsState {
  connected: boolean
  host: string
  port: number
  /** OBS 本体版本，如 "31.0.2"（连上后由 GetVersion 得到） */
  version?: string
  /** obs-websocket 插件版本，如 "5.5.4" */
  wsVersion?: string
  /** 最近一次错误（中文）；连接成功或主动断开后清空 */
  error?: string
  /** 最近一次收到 OBS 事件的时间戳（Date.now()） */
  lastEventAt?: number
}

export interface ObsConnectResult {
  ok: boolean
  error?: string
  /** OBS 本体版本 */
  version?: string
}

export type ObsEventHandler = (eventType: string, eventData: unknown) => void
export type ObsStateHandler = (state: ObsState) => void

/** OBS 相关错误统一用这个类型；message 为中文，code 为 obs-websocket 的 RequestStatus 状态码（若有） */
export class ObsError extends Error {
  readonly code?: number
  readonly requestType?: string
  constructor(message: string, code?: number, requestType?: string) {
    super(message)
    this.name = 'ObsError'
    this.code = code
    this.requestType = requestType
  }
}

// ==================== 协议常量 ====================

/** obs-websocket v5 的 EventSubscription 位掩码 */
export const ObsEventSubscription = {
  None: 0,
  General: 1 << 0,
  Config: 1 << 1,
  Scenes: 1 << 2,
  Inputs: 1 << 3,
  Transitions: 1 << 4,
  Filters: 1 << 5,
  Outputs: 1 << 6,
  SceneItems: 1 << 7,
  MediaInputs: 1 << 8,
  Vendors: 1 << 9,
  Ui: 1 << 10,
  /** 以上所有非高频事件 */
  All: (1 << 11) - 1,
  // 下面是高频事件，默认都不订阅
  InputVolumeMeters: 1 << 16,
  InputActiveStateChanged: 1 << 17,
  InputShowStateChanged: 1 << 18,
  SceneItemTransformChanged: 1 << 19
} as const

/** 默认订阅：General | Scenes | Inputs | Filters | SceneItems = 173 */
export const DEFAULT_EVENT_SUBSCRIPTIONS =
  ObsEventSubscription.General |
  ObsEventSubscription.Scenes |
  ObsEventSubscription.Inputs |
  ObsEventSubscription.Filters |
  ObsEventSubscription.SceneItems

export const DEFAULT_REQUEST_TIMEOUT_MS = 8000
export const DEFAULT_CONNECT_TIMEOUT_MS = 10000
/** 本客户端实现的 RPC 版本（obs-websocket 5.x 只有 1） */
export const OBS_RPC_VERSION = 1

/** obs-websocket 消息 OpCode */
const Op = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Reidentify: 3,
  Event: 5,
  Request: 6,
  RequestResponse: 7,
  RequestBatch: 8,
  RequestBatchResponse: 9
} as const

/** obs-websocket 自定义 close code（4xxx）与标准 close code 的中文说明 */
const CLOSE_CODE_ZH: Record<number, string> = {
  1000: 'OBS 正常关闭了连接',
  1001: 'OBS 正在退出',
  1005: '连接已关闭（无状态码）',
  1006: '连接意外中断',
  1009: '消息过大',
  4000: '未知原因',
  4002: 'OBS 无法解析消息',
  4003: '缺少必要字段',
  4004: '字段类型错误',
  4005: '字段值无效',
  4006: '未知的 OpCode',
  4007: '尚未完成身份验证',
  4008: '重复身份验证',
  4009: 'OBS 密码错误',
  4010: 'OBS 不支持本客户端的 RPC 版本',
  4011: '会话已失效（OBS 端 WebSocket 设置被修改）',
  4012: 'OBS 不支持的功能'
}

function describeCloseCode(code: number, reason: string): string {
  const base = CLOSE_CODE_ZH[code] ?? `code ${code}`
  return reason ? `${base}：${reason}` : base
}

/**
 * obs-websocket v5 鉴权字符串：
 *   secret = base64(sha256(password + salt))
 *   authentication = base64(sha256(secret + challenge))
 */
export function obsComputeAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64')
  return createHash('sha256').update(secret + challenge).digest('base64')
}

// ==================== 最小 WebSocket 客户端 ====================

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** 单条消息上限（GetSourceScreenshot 之类的响应可能有几 MB，给足余量） */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

const Opcode = {
  Continuation: 0x0,
  Text: 0x1,
  Binary: 0x2,
  Close: 0x8,
  Ping: 0x9,
  Pong: 0xa
} as const

interface MiniWsHandlers {
  /** HTTP Upgrade 成功、进入 WebSocket 帧模式 */
  onOpen: () => void
  /** 收到一条完整的 text 消息（分片已拼好） */
  onText: (text: string) => void
  /** TCP 已关闭；整个生命周期只触发一次，无论是谁先关的 */
  onClose: (code: number, reason: string) => void
  /** 出错（之后一定还会触发 onClose） */
  onError: (err: Error) => void
}

class MiniWebSocket {
  private socket: Socket | null = null
  private handshakeDone = false
  private headerBuf: Buffer = Buffer.alloc(0)
  private frameBuf: Buffer = Buffer.alloc(0)
  /** 正在拼接的分片消息的 opcode，-1 表示当前没有分片进行中 */
  private fragOpcode = -1
  private fragChunks: Buffer[] = []
  private fragBytes = 0
  private closeSent = false
  private finished = false
  private peerCloseCode: number | null = null
  private peerCloseReason = ''
  private lastError: Error | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  /** Sec-WebSocket-Key：随机 16 字节 base64 */
  private readonly key = randomBytes(16).toString('base64')

  constructor(private readonly handlers: MiniWsHandlers) {}

  get isOpen(): boolean {
    return this.handshakeDone && !this.finished && !this.closeSent
  }

  connect(host: string, port: number, path: string, timeoutMs: number): void {
    let socket: Socket
    try {
      socket = createConnection({ host, port })
    } catch (err) {
      // 端口越界之类的参数错误会同步抛出
      this.lastError = err instanceof Error ? err : new Error(String(err))
      this.finished = true
      queueMicrotask(() => this.handlers.onClose(1006, this.lastError?.message ?? ''))
      return
    }
    this.socket = socket
    socket.setNoDelay(true)
    this.connectTimer = setTimeout(() => this.fail(new Error(`连接超时（${timeoutMs}ms）`)), timeoutMs)
    socket.on('connect', () => {
      // IPv6 字面量要加方括号
      const hostHeader = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: ${hostHeader}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${this.key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n'
      )
    })
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('error', (err: Error) => {
      // 把带 code（ECONNREFUSED 等）的原始 Error 交给上层翻译成中文；'close' 紧随其后
      this.lastError = err
      if (!this.finished) this.handlers.onError(err)
    })
    socket.on('close', () => this.finish())
  }

  /** 发送 text 帧；未握手 / 已关闭时返回 false */
  sendText(text: string): boolean {
    if (!this.handshakeDone) return false
    return this.sendFrame(Opcode.Text, Buffer.from(text, 'utf8'))
  }

  /** 发 close 帧（RFC 6455 关闭握手），1 秒内对方不回就直接断 TCP */
  close(code = 1000, reason = ''): void {
    if (this.finished) return
    if (!this.handshakeDone) {
      // 还没升级成 WebSocket，直接断 TCP
      this.socket?.destroy()
      return
    }
    if (!this.closeSent) {
      this.closeSent = true
      const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 123)
      const payload = Buffer.alloc(2 + reasonBuf.length)
      payload.writeUInt16BE(code, 0)
      reasonBuf.copy(payload, 2)
      this.sendFrame(Opcode.Close, payload)
    }
    this.armCloseTimer()
  }

  /** 不做关闭握手，直接断 TCP */
  destroy(): void {
    this.socket?.destroy()
  }

  // ---------- 内部：连接生命周期 ----------

  private fail(err: Error): void {
    if (this.finished) return
    this.lastError = err
    this.handlers.onError(err)
    this.socket?.destroy()
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.connectTimer = null
    this.closeTimer = null
    const code = this.peerCloseCode ?? 1006
    const reason = this.peerCloseReason || this.lastError?.message || ''
    this.handlers.onClose(code, reason)
  }

  private armCloseTimer(): void {
    if (this.closeTimer) return
    this.closeTimer = setTimeout(() => this.socket?.destroy(), 1000)
    this.closeTimer.unref()
  }

  // ---------- 内部：HTTP Upgrade 握手 ----------

  private onData(chunk: Buffer): void {
    if (this.finished) return
    if (!this.handshakeDone) {
      this.headerBuf = this.headerBuf.length ? Buffer.concat([this.headerBuf, chunk]) : chunk
      const end = this.headerBuf.indexOf('\r\n\r\n')
      if (end === -1) {
        if (this.headerBuf.length > 64 * 1024) this.fail(new Error('WebSocket 握手失败：响应头过大'))
        return
      }
      const head = this.headerBuf.subarray(0, end).toString('latin1')
      // 响应头之后紧跟的字节已经是 WebSocket 帧（obs-websocket 一升级就立刻推 Hello）
      const rest = this.headerBuf.subarray(end + 4)
      this.headerBuf = Buffer.alloc(0)
      const err = this.checkHandshake(head)
      if (err) {
        this.fail(err)
        return
      }
      this.handshakeDone = true
      if (this.connectTimer) clearTimeout(this.connectTimer)
      this.connectTimer = null
      this.handlers.onOpen()
      if (rest.length) {
        this.frameBuf = Buffer.from(rest)
        this.parseFrames()
      }
      return
    }
    this.frameBuf = this.frameBuf.length ? Buffer.concat([this.frameBuf, chunk]) : chunk
    this.parseFrames()
  }

  private checkHandshake(head: string): Error | null {
    const lines = head.split('\r\n')
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? '')
    if (!status) return new Error('WebSocket 握手失败：对方不是 HTTP/WebSocket 服务')
    if (status[1] !== '101') {
      return new Error(`WebSocket 握手失败：HTTP ${status[1]}（该端口上可能不是 obs-websocket）`)
    }
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':')
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
    }
    if ((headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Error('WebSocket 握手失败：响应缺少 Upgrade: websocket')
    }
    // Accept = base64(sha1(key + GUID))
    const expected = createHash('sha1')
      .update(this.key + WS_GUID)
      .digest('base64')
    if (headers.get('sec-websocket-accept') !== expected) {
      return new Error('WebSocket 握手失败：Sec-WebSocket-Accept 校验不通过')
    }
    return null
  }

  // ---------- 内部：帧解析 ----------

  private parseFrames(): void {
    while (!this.finished) {
      const buf = this.frameBuf
      if (buf.length < 2) return
      const b0 = buf[0]
      const b1 = buf[1]
      const fin = (b0 & 0x80) !== 0
      const rsv = b0 & 0x70
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        const big = buf.readBigUInt64BE(2)
        if (big > BigInt(MAX_MESSAGE_BYTES)) {
          this.protocolError(1009, '收到过大的帧')
          return
        }
        len = Number(big)
        offset = 10
      }
      // 服务端发来的帧按规范不该有掩码，但真遇到了也照样解
      let mask: Buffer | null = null
      if (masked) {
        if (buf.length < offset + 4) return
        mask = buf.subarray(offset, offset + 4)
        offset += 4
      }
      if (buf.length < offset + len) return // 帧还没收全，等下一段数据
      let payload = buf.subarray(offset, offset + len)
      this.frameBuf = buf.subarray(offset + len)
      if (mask) {
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i] ^ mask[i & 3]
      }
      if (rsv !== 0) {
        this.protocolError(1002, '收到带 RSV 位的帧（未协商任何扩展）')
        return
      }
      if (opcode >= 0x8) {
        // 控制帧：不能分片、长度 ≤125，可以插在分片消息中间
        if (!fin || len > 125) {
          this.protocolError(1002, '控制帧不合法')
          return
        }
        if (opcode === Opcode.Close) {
          this.onPeerClose(payload)
          return
        }
        if (opcode === Opcode.Ping) {
          this.sendFrame(Opcode.Pong, payload)
          continue
        }
        if (opcode === Opcode.Pong) continue
        this.protocolError(1002, `未知控制帧 opcode=${opcode}`)
        return
      }
      if (opcode === Opcode.Text || opcode === Opcode.Binary) {
        if (this.fragOpcode !== -1) {
          this.protocolError(1002, '上一条分片消息尚未结束')
          return
        }
        if (fin) {
          this.deliver(opcode, payload)
          continue
        }
        // 分片消息的第一帧
        this.fragOpcode = opcode
        this.fragChunks = [Buffer.from(payload)]
        this.fragBytes = payload.length
        continue
      }
      if (opcode === Opcode.Continuation) {
        if (this.fragOpcode === -1) {
          this.protocolError(1002, '收到孤立的 continuation 帧')
          return
        }
        this.fragBytes += payload.length
        if (this.fragBytes > MAX_MESSAGE_BYTES) {
          this.protocolError(1009, '分片消息过大')
          return
        }
        this.fragChunks.push(Buffer.from(payload))
        if (fin) {
          const whole = Buffer.concat(this.fragChunks)
          const op = this.fragOpcode
          this.fragOpcode = -1
          this.fragChunks = []
          this.fragBytes = 0
          this.deliver(op, whole)
        }
        continue
      }
      this.protocolError(1002, `未知 opcode=${opcode}`)
      return
    }
  }

  private deliver(opcode: number, payload: Buffer): void {
    // obs-websocket 在默认的 JSON 模式下只发 text 帧；binary 只用于 msgpack 子协议，这里不会协商，直接忽略
    if (opcode === Opcode.Text) this.handlers.onText(payload.toString('utf8'))
  }

  private onPeerClose(payload: Buffer): void {
    if (payload.length >= 2) {
      this.peerCloseCode = payload.readUInt16BE(0)
      this.peerCloseReason = payload.subarray(2).toString('utf8')
    } else {
      this.peerCloseCode = 1005
    }
    if (!this.closeSent) {
      // 回一个同样状态码的 close 帧完成关闭握手
      this.closeSent = true
      this.sendFrame(Opcode.Close, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0))
    }
    this.socket?.end()
    this.armCloseTimer()
  }

  private protocolError(code: number, reason: string): void {
    this.lastError = new Error(`WebSocket 协议错误：${reason}`)
    this.close(code, reason)
  }

  /** 发一帧（客户端 → 服务端必须掩码，RFC 6455 §5.3）；总是 FIN=1，不分片发送 */
  private sendFrame(opcode: number, payload: Buffer): boolean {
    const socket = this.socket
    if (!socket || this.finished || socket.destroyed || !socket.writable) return false
    const len = payload.length
    const headerLen = len < 126 ? 6 : len < 65536 ? 8 : 14
    const frame = Buffer.allocUnsafe(headerLen + len)
    frame[0] = 0x80 | opcode
    if (len < 126) {
      frame[1] = 0x80 | len
    } else if (len < 65536) {
      frame[1] = 0x80 | 126
      frame.writeUInt16BE(len, 2)
    } else {
      frame[1] = 0x80 | 127
      frame.writeBigUInt64BE(BigInt(len), 2)
    }
    const mask = randomBytes(4)
    mask.copy(frame, headerLen - 4)
    for (let i = 0; i < len; i++) frame[headerLen + i] = payload[i] ^ mask[i & 3]
    socket.write(frame)
    return true
  }
}

// ==================== obs-websocket v5 会话 ====================

interface HelloData {
  obsWebSocketVersion?: string
  rpcVersion?: number
  authentication?: { challenge: string; salt: string }
}

interface EventData {
  eventType: string
  eventIntent?: number
  eventData?: unknown
}

interface ResponseData {
  requestType: string
  requestId: string
  requestStatus?: { result: boolean; code: number; comment?: string }
  responseData?: unknown
}

interface PendingRequest {
  type: string
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type Phase = 'idle' | 'connecting' | 'identified'

export class ObsClient {
  private ws: MiniWebSocket | null = null
  /** 每次 connect/disconnect 递增；旧 socket 的回调拿着旧代号就会被忽略 */
  private generation = 0
  private phase: Phase = 'idle'
  private state: ObsState = { connected: false, host: '', port: 0 }
  private options: ObsConnectOptions | null = null
  private pending = new Map<string, PendingRequest>()
  private nextRequestId = 1
  private eventHandlers = new Set<ObsEventHandler>()
  private stateHandlers = new Set<ObsStateHandler>()
  private connectSettle: ((result: ObsConnectResult) => void) | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** 连接阶段 socket 层的错误，用来把 ECONNREFUSED 之类翻译成中文 */
  private socketError: Error | null = null

  getState(): ObsState {
    return { ...this.state }
  }

  /** 连接并完成鉴权；从不 reject，失败以 { ok:false, error } 返回。已有连接会先断开再连。 */
  connect(opts: ObsConnectOptions): Promise<ObsConnectResult> {
    this.teardown()
    const gen = ++this.generation
    this.options = { ...opts }
    this.phase = 'connecting'
    this.socketError = null
    this.state = { connected: false, host: opts.host, port: opts.port }
    return new Promise<ObsConnectResult>((resolve) => {
      this.connectSettle = resolve
      const timeoutMs = opts.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
      this.connectTimer = setTimeout(() => {
        if (gen === this.generation) this.failConnect(`连接 OBS 超时（${timeoutMs}ms 内未完成握手）`)
      }, timeoutMs)
      const ws = new MiniWebSocket({
        onOpen: () => {
          /* 升级成功后什么都不用做，等 OBS 推 Hello */
        },
        onText: (text) => {
          if (gen === this.generation) this.onMessage(text)
        },
        onClose: (code, reason) => {
          if (gen === this.generation) this.onClosed(code, reason)
        },
        onError: (err) => {
          if (gen === this.generation) this.socketError = err
        }
      })
      this.ws = ws
      ws.connect(opts.host, opts.port, '/', timeoutMs)
    })
  }

  /** 主动断开：同步生效（state.connected 立刻为 false），未完成的请求全部 reject */
  disconnect(): void {
    this.teardown()
  }

  /** 发一个 obs-websocket 请求；未连接 / 超时 / OBS 返回 result=false 时 reject（ObsError，中文） */
  request<T = unknown>(type: string, data?: Record<string, unknown>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.phase !== 'identified' || !this.ws) {
      return Promise.reject(new ObsError('尚未连接到 OBS', undefined, type))
    }
    const ws = this.ws
    const requestId = `zl-${this.nextRequestId++}`
    const body: Record<string, unknown> = { requestType: type, requestId }
    if (data !== undefined) body.requestData = data
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new ObsError(`OBS 请求 ${type} 超时（${timeoutMs}ms 未响应）`, undefined, type))
        }
      }, timeoutMs)
      this.pending.set(requestId, { type, resolve: resolve as (value: unknown) => void, reject, timer })
      if (!ws.sendText(JSON.stringify({ op: Op.Request, d: body }))) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(new ObsError('向 OBS 发送请求失败：连接已关闭', undefined, type))
      }
    })
  }

  onEvent(handler: ObsEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => {
      this.eventHandlers.delete(handler)
    }
  }

  onStateChange(handler: ObsStateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  // ---------- 常用封装 ----------

  /** 场景列表（按 OBS 界面从上到下的顺序）+ 当前节目场景 */
  async listScenes(): Promise<{ current: string; scenes: string[] }> {
    const r = await this.request<{
      currentProgramSceneName?: string
      scenes?: Array<{ sceneName: string; sceneIndex?: number }>
    }>('GetSceneList')
    return { current: r.currentProgramSceneName ?? '', scenes: sortScenesLikeUi(r.scenes).map((s) => s.sceneName) }
  }

  /**
   * 汇总所有源（输入源 + 场景 + 分组）上的滤镜。
   * 某个源 GetSourceFilterList 失败（比如刚被删掉）就跳过它，不中断整体；
   * 只有输入源列表和场景列表都拿不到才算失败。
   */
  async listFilters(): Promise<ObsFilterInfo[]> {
    const names: string[] = []
    const seen = new Set<string>()
    const add = (name: unknown): void => {
      if (typeof name === 'string' && name && !seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
    const [inputs, scenes, groups] = await Promise.allSettled([
      this.request<{ inputs?: Array<{ inputName: string }> }>('GetInputList'),
      this.request<{ scenes?: Array<{ sceneName: string; sceneIndex?: number }> }>('GetSceneList'),
      this.request<{ groups?: string[] }>('GetGroupList')
    ])
    if (inputs.status === 'rejected' && scenes.status === 'rejected') throw inputs.reason
    if (inputs.status === 'fulfilled') for (const i of inputs.value.inputs ?? []) add(i.inputName)
    if (scenes.status === 'fulfilled') for (const s of sortScenesLikeUi(scenes.value.scenes)) add(s.sceneName)
    if (groups.status === 'fulfilled') for (const g of groups.value.groups ?? []) add(g)

    const results = await Promise.allSettled(
      names.map((name) =>
        this.request<{
          filters?: Array<{ filterName: string; filterKind: string; filterEnabled: boolean; filterIndex?: number }>
        }>('GetSourceFilterList', { sourceName: name })
      )
    )
    const out: ObsFilterInfo[] = []
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return // 这个源查不到滤镜，跳过
      const filters = [...(r.value.filters ?? [])].sort((a, b) => (a.filterIndex ?? 0) - (b.filterIndex ?? 0))
      for (const f of filters) {
        out.push({ source: names[i], filter: f.filterName, kind: f.filterKind, enabled: !!f.filterEnabled })
      }
    })
    return out
  }

  async setFilterEnabled(source: string, filter: string, enabled: boolean): Promise<void> {
    await this.request('SetSourceFilterEnabled', { sourceName: source, filterName: filter, filterEnabled: enabled })
  }

  /** 翻转滤镜开关，返回翻转后的状态 */
  async toggleFilter(source: string, filter: string): Promise<boolean> {
    const cur = await this.request<{ filterEnabled: boolean }>('GetSourceFilter', { sourceName: source, filterName: filter })
    const next = !cur.filterEnabled
    await this.setFilterEnabled(source, filter, next)
    return next
  }

  async setScene(scene: string): Promise<void> {
    await this.request('SetCurrentProgramScene', { sceneName: scene })
  }

  // ---------- 内部：消息处理 ----------

  private onMessage(text: string): void {
    let msg: { op?: number; d?: unknown }
    try {
      msg = JSON.parse(text)
    } catch {
      return // 解析不了的消息直接忽略
    }
    switch (msg.op) {
      case Op.Hello:
        this.onHello((msg.d ?? {}) as HelloData)
        break
      case Op.Identified:
        this.onIdentified()
        break
      case Op.Event:
        this.onEventMessage((msg.d ?? {}) as EventData)
        break
      case Op.RequestResponse:
        this.onResponse((msg.d ?? {}) as ResponseData)
        break
      default:
        // RequestBatchResponse 等本客户端没用到的消息忽略
        break
    }
  }

  private onHello(d: HelloData): void {
    if (this.phase !== 'connecting' || !this.options || !this.ws) return
    if (d.obsWebSocketVersion) this.state.wsVersion = d.obsWebSocketVersion
    const identify: Record<string, unknown> = {
      rpcVersion: OBS_RPC_VERSION,
      eventSubscriptions: this.options.eventSubscriptions ?? DEFAULT_EVENT_SUBSCRIPTIONS
    }
    if (d.authentication) {
      if (!this.options.password) {
        this.failConnect('OBS 已开启密码认证，请填写 WebSocket 服务器密码')
        return
      }
      identify.authentication = obsComputeAuth(this.options.password, d.authentication.salt, d.authentication.challenge)
    }
    this.ws.sendText(JSON.stringify({ op: Op.Identify, d: identify }))
  }

  private onIdentified(): void {
    if (this.phase !== 'connecting') return
    this.phase = 'identified'
    this.state.connected = true
    this.state.error = undefined
    const gen = this.generation
    // 顺手拿版本号给界面显示；拿不到也不影响「已连接」
    this.request<{ obsVersion?: string; obsWebSocketVersion?: string }>('GetVersion', undefined, 5000)
      .then((v) => {
        if (gen !== this.generation) return
        if (v.obsVersion) this.state.version = v.obsVersion
        if (v.obsWebSocketVersion) this.state.wsVersion = v.obsWebSocketVersion
      })
      .catch(() => {
        /* 忽略 */
      })
      .finally(() => {
        if (gen !== this.generation) return
        if (this.connectTimer) clearTimeout(this.connectTimer)
        this.connectTimer = null
        this.emitState()
        this.settleConnect({ ok: true, version: this.state.version })
      })
  }

  private onEventMessage(d: EventData): void {
    if (typeof d.eventType !== 'string') return
    this.state.lastEventAt = Date.now()
    for (const handler of this.eventHandlers) {
      try {
        handler(d.eventType, d.eventData)
      } catch {
        // 某个订阅者抛错不影响其它订阅者
      }
    }
  }

  private onResponse(d: ResponseData): void {
    const p = this.pending.get(d.requestId)
    if (!p) return
    this.pending.delete(d.requestId)
    clearTimeout(p.timer)
    const status = d.requestStatus
    if (status?.result) {
      p.resolve(d.responseData ?? {})
    } else {
      const comment = status?.comment || '未知错误'
      p.reject(new ObsError(`OBS 请求 ${d.requestType} 失败：${comment}（状态码 ${status?.code ?? '?'}）`, status?.code, d.requestType))
    }
  }

  // ---------- 内部：连接生命周期 ----------

  /** socket 关闭（仅当前代号会进来；主动 disconnect 已经换代号，不会走这里） */
  private onClosed(code: number, reason: string): void {
    if (this.phase === 'connecting') {
      this.failConnect(this.describeConnectFailure(code, reason))
      return
    }
    // 已连接后被动断开：OBS 退出 / 被踢 / 网络断
    this.generation++
    this.ws = null
    this.phase = 'idle'
    const message = `与 OBS 的连接已断开（${describeCloseCode(code, reason)}）`
    this.rejectAllPending(new ObsError(message))
    this.state.connected = false
    this.state.error = message
    this.settleConnect({ ok: false, error: message })
    this.emitState()
  }

  private describeConnectFailure(code: number, reason: string): string {
    if (code === 4009) return 'OBS 密码错误'
    if (code >= 4000 && CLOSE_CODE_ZH[code]) return describeCloseCode(code, reason)
    const err = this.socketError
    if (err) return translateSocketError(err, this.state.host, this.state.port)
    return `与 OBS 的连接在握手阶段断开（${describeCloseCode(code, reason)}）`
  }

  private failConnect(message: string): void {
    this.generation++
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
    const ws = this.ws
    this.ws = null
    this.phase = 'idle'
    ws?.destroy()
    this.rejectAllPending(new ObsError(message))
    this.state.connected = false
    this.state.error = message
    this.settleConnect({ ok: false, error: message })
    this.emitState()
  }

  private teardown(): void {
    const wasConnected = this.state.connected
    this.generation++
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
    const ws = this.ws
    this.ws = null
    this.phase = 'idle'
    this.rejectAllPending(new ObsError('已主动断开与 OBS 的连接'))
    this.settleConnect({ ok: false, error: '连接已取消' })
    this.state.connected = false
    this.state.error = undefined
    ws?.close(1000, 'client disconnect')
    if (wasConnected) this.emitState()
  }

  private settleConnect(result: ObsConnectResult): void {
    const settle = this.connectSettle
    this.connectSettle = null
    settle?.(result)
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private emitState(): void {
    const snapshot = this.getState()
    for (const handler of this.stateHandlers) {
      try {
        handler(snapshot)
      } catch {
        // 订阅者异常不影响其它订阅者
      }
    }
  }
}

/**
 * GetSceneList 返回的数组按 sceneIndex 升序，而 sceneIndex 0 是 OBS 界面最底下那个场景；
 * 这里翻成界面顺序（从上到下）。
 */
function sortScenesLikeUi<T extends { sceneIndex?: number }>(scenes: T[] | undefined): T[] {
  return [...(scenes ?? [])].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0))
}

function translateSocketError(err: Error, host: string, port: number): string {
  const code = (err as NodeJS.ErrnoException).code
  switch (code) {
    case 'ECONNREFUSED':
      return `无法连接 OBS（${host}:${port}）：连接被拒绝。请确认 OBS 已启动，且在「工具 → WebSocket 服务器设置」里启用了服务器`
    case 'ETIMEDOUT':
      return `连接 OBS（${host}:${port}）超时，请检查地址、端口和防火墙`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `无法解析主机名 ${host}`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `无法到达主机 ${host}`
    case 'ECONNRESET':
      return 'OBS 重置了连接'
    default:
      // 我们自己抛的错误（握手失败 / 连接超时）本来就是中文，原样返回
      return code ? `连接 OBS 失败：${err.message}` : err.message
  }
}

// ==================== 默认单例 + 导出函数 ====================

export const obsClient = new ObsClient()

export function obsConnect(opts: ObsConnectOptions): Promise<ObsConnectResult> {
  return obsClient.connect(opts)
}

export function obsDisconnect(): void {
  obsClient.disconnect()
}

export function obsState(): ObsState {
  return obsClient.getState()
}

export function obsRequest<T = unknown>(type: string, data?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  return obsClient.request<T>(type, data, timeoutMs)
}

export function obsListScenes(): Promise<{ current: string; scenes: string[] }> {
  return obsClient.listScenes()
}

export function obsListFilters(): Promise<ObsFilterInfo[]> {
  return obsClient.listFilters()
}

export function obsSetFilterEnabled(source: string, filter: string, enabled: boolean): Promise<void> {
  return obsClient.setFilterEnabled(source, filter, enabled)
}

export function obsToggleFilter(source: string, filter: string): Promise<boolean> {
  return obsClient.toggleFilter(source, filter)
}

export function obsSetScene(scene: string): Promise<void> {
  return obsClient.setScene(scene)
}

export function onObsEvent(handler: ObsEventHandler): () => void {
  return obsClient.onEvent(handler)
}

export function onObsStateChange(handler: ObsStateHandler): () => void {
  return obsClient.onStateChange(handler)
}

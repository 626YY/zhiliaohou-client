#!/usr/bin/env node
/**
 * tools/obs-mock-server.mjs —— 假 OBS：obs-websocket v5 协议的最小模拟服务端
 *
 * 用途：
 *   - tools/obs-smoke.mjs 在纯 Node 里对 src/main/obs-ws-core.ts 做冒烟测试（不需要真的开 OBS）
 *   - 也可以单独起来给客户端界面手测：node tools/obs-mock-server.mjs --port=4455 --password=123456
 *
 * 实现：node:http 处理 HTTP Upgrade，之后手写 WebSocket 帧编解码——服务端发帧不掩码，收帧必须解掩码，
 * 客户端发来未掩码的帧按 RFC 6455 §5.1 直接以 1002 断开（用来验证客户端「发送必须掩码」）。
 *
 * 协议：Hello(带 salt/challenge) → Identify 校验 → Identified；密码错回 close 4009 "Authentication failed."
 *   支持的请求：GetVersion / GetSceneList / GetInputList / GetGroupList / GetSourceFilterList / GetSourceFilter /
 *              SetSourceFilterEnabled / SetCurrentProgramScene
 *   折腾客户端用的假请求：MockNeverRespond(测超时) / MockEcho(测客户端发大帧) /
 *              MockBigEvent(测客户端收大帧) / MockDropConnection(测被动断线)
 *   GetSceneList 的响应默认拆成 3 个分片帧发送（测 continuation 拼包）；Identified 之后会主动 ping 一次（测 pong）。
 */
import crypto from 'node:crypto'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const CloseCode = {
  MessageDecodeError: 4002,
  MissingDataField: 4003,
  InvalidDataFieldType: 4004,
  InvalidDataFieldValue: 4005,
  UnknownOpCode: 4006,
  NotIdentified: 4007,
  AlreadyIdentified: 4008,
  AuthenticationFailed: 4009,
  UnsupportedRpcVersion: 4010
}

export const RequestStatus = {
  Success: 100,
  UnknownRequestType: 204,
  MissingRequestField: 300,
  InvalidRequestFieldType: 401,
  ResourceNotFound: 600,
  RequestProcessingFailed: 702
}

export const EventIntent = { General: 1, Scenes: 4, Inputs: 8, Filters: 32 }

/** 与客户端一致的鉴权算法：base64(sha256(base64(sha256(password+salt)) + challenge)) */
export function computeAuth(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64')
  return crypto.createHash('sha256').update(secret + challenge).digest('base64')
}

/** 一套小而全的假世界：3 个场景、3 个输入源、1 个分组；「坏源」查滤镜必定报 702 */
export function createMockWorld() {
  return {
    currentScene: '游戏场景',
    scenes: ['游戏场景', '休息场景', '整蛊场景'],
    inputs: [
      { name: '游戏采集', kind: 'game_capture' },
      { name: '麦克风', kind: 'wasapi_input_capture' },
      { name: '坏源', kind: 'ffmpeg_source' }
    ],
    groups: ['道具分组'],
    /** 源名 → 滤镜列表；值为 'ERROR' 表示 GetSourceFilterList 对它报 702；没有条目的已知源返回空列表 */
    filters: {
      游戏采集: [
        { name: '色度键', kind: 'chroma_key_filter_v2', enabled: true },
        { name: '颜色校正', kind: 'color_filter_v2', enabled: false }
      ],
      麦克风: [{ name: '噪声抑制', kind: 'noise_suppress_filter_v2', enabled: true }],
      整蛊场景: [{ name: '翻转整蛊', kind: 'gpu_delay', enabled: false }],
      坏源: 'ERROR'
    }
  }
}

function uuidFor(name) {
  const hex = crypto.createHash('md5').update(name).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class Session {
  constructor(server, socket) {
    this.server = server
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.frag = null
    this.identified = false
    this.subs = 0
    this.closeSent = false
    this.closed = false
    this.salt = crypto.randomBytes(32).toString('base64')
    this.challenge = crypto.randomBytes(32).toString('base64')
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('error', () => {})
    socket.on('close', () => {
      this.closed = true
      server.sessions.delete(this)
    })
  }

  // ---------- 帧编码：服务端 → 客户端不掩码 ----------

  sendFrame(opcode, payload, fin = true) {
    if (this.closed || this.socket.destroyed) return
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.from([(fin ? 0x80 : 0) | opcode, len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = (fin ? 0x80 : 0) | opcode
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = (fin ? 0x80 : 0) | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    this.socket.write(Buffer.concat([header, payload]))
  }

  /** 发一条 text 消息；fragments>1 时拆成 text + continuation 分片 */
  sendText(obj, fragments = 1) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8')
    if (fragments <= 1 || payload.length < fragments) {
      this.sendFrame(1, payload, true)
      return
    }
    const size = Math.ceil(payload.length / fragments)
    for (let i = 0, n = 0; i < payload.length; i += size, n++) {
      const chunk = payload.subarray(i, Math.min(i + size, payload.length))
      this.sendFrame(n === 0 ? 1 : 0, chunk, i + size >= payload.length)
    }
  }

  sendClose(code, reason = '') {
    if (this.closeSent) return
    this.closeSent = true
    const r = Buffer.from(reason, 'utf8').subarray(0, 123)
    const p = Buffer.alloc(2 + r.length)
    p.writeUInt16BE(code, 0)
    r.copy(p, 2)
    this.sendFrame(8, p)
    this.server.stats.closesSentByServer.push(code)
    setTimeout(() => this.socket.destroy(), 500).unref()
  }

  // ---------- 帧解码：客户端 → 服务端必须带掩码 ----------

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    for (;;) {
      const buf = this.buf
      if (buf.length < 2) return
      const fin = (buf[0] & 0x80) !== 0
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      let mask = null
      if (masked) {
        if (buf.length < off + 4) return
        mask = buf.subarray(off, off + 4)
        off += 4
      }
      if (buf.length < off + len) return
      const payload = Buffer.from(buf.subarray(off, off + len))
      this.buf = buf.subarray(off + len)
      this.server.stats.framesFromClient++
      if (!masked) {
        this.server.stats.unmaskedFrames++
        this.sendClose(1002, 'client frames must be masked')
        return
      }
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]

      if (opcode === 8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        this.server.stats.closeCodesFromClient.push(code)
        if (!this.closeSent) {
          this.closeSent = true
          this.sendFrame(8, payload.subarray(0, 2))
        }
        this.socket.end()
        return
      }
      if (opcode === 9) {
        this.sendFrame(10, payload)
        continue
      }
      if (opcode === 10) {
        this.server.stats.pongs.push(payload.toString('utf8'))
        continue
      }
      if (opcode === 1 || opcode === 2) {
        if (fin) this.onMessage(payload.toString('utf8'))
        else this.frag = [payload]
        continue
      }
      if (opcode === 0) {
        if (!this.frag) {
          this.sendClose(1002, 'unexpected continuation frame')
          return
        }
        this.frag.push(payload)
        if (fin) {
          const whole = Buffer.concat(this.frag)
          this.frag = null
          this.onMessage(whole.toString('utf8'))
        }
        continue
      }
      this.sendClose(1002, `unknown opcode ${opcode}`)
      return
    }
  }

  // ---------- obs-websocket 消息 ----------

  onMessage(text) {
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      this.sendClose(CloseCode.MessageDecodeError, 'Unable to decode message.')
      return
    }
    const d = msg.d ?? {}
    if (msg.op === 1) {
      this.onIdentify(d)
      return
    }
    if (!this.identified) {
      this.sendClose(CloseCode.NotIdentified, 'You must first identify.')
      return
    }
    if (msg.op === 6) {
      this.onRequest(d)
      return
    }
    if (msg.op === 3) {
      if (typeof d.eventSubscriptions === 'number') this.subs = d.eventSubscriptions
      return
    }
    this.sendClose(CloseCode.UnknownOpCode, `Unknown op ${msg.op}`)
  }

  onIdentify(d) {
    if (this.identified) {
      this.sendClose(CloseCode.AlreadyIdentified, 'Already identified.')
      return
    }
    if (d.rpcVersion !== 1) {
      this.sendClose(CloseCode.UnsupportedRpcVersion, 'Unsupported rpcVersion.')
      return
    }
    if (this.server.password) {
      if (typeof d.authentication !== 'string') {
        this.sendClose(CloseCode.MissingDataField, "Your payload's data is missing an `authentication` string.")
        return
      }
      if (d.authentication !== computeAuth(this.server.password, this.salt, this.challenge)) {
        this.server.stats.authFailures++
        this.sendClose(CloseCode.AuthenticationFailed, 'Authentication failed.')
        return
      }
    }
    this.identified = true
    this.subs = typeof d.eventSubscriptions === 'number' ? d.eventSubscriptions : 2047
    this.server.stats.identified++
    this.server.stats.lastEventSubscriptions = this.subs
    this.sendText({ op: 2, d: { negotiatedRpcVersion: 1 } })
    if (this.server.options.pingAfterIdentify) {
      this.sendFrame(9, Buffer.from(this.server.options.pingAfterIdentify, 'utf8'))
    }
  }

  onRequest(d) {
    const { requestType, requestId } = d
    const data = d.requestData ?? {}
    const world = this.server.world
    this.server.stats.requests.push(requestType)
    const ok = (responseData, fragments = 1) =>
      this.sendText(
        {
          op: 7,
          d: {
            requestType,
            requestId,
            requestStatus: { result: true, code: RequestStatus.Success },
            ...(responseData === undefined ? {} : { responseData })
          }
        },
        fragments
      )
    const fail = (code, comment) =>
      this.sendText({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code, comment } } })
    const need = (field, type) => {
      if (typeof data[field] === type) return true
      if (data[field] === undefined) fail(RequestStatus.MissingRequestField, `Your request is missing required field \`${field}\`.`)
      else fail(RequestStatus.InvalidRequestFieldType, `The field \`${field}\` must be a ${type}.`)
      return false
    }
    const knownSources = new Set([...world.inputs.map((i) => i.name), ...world.scenes, ...world.groups])
    const filtersOf = (name) => world.filters[name] ?? []

    switch (requestType) {
      case 'GetVersion':
        ok({
          obsVersion: '31.0.0-mock',
          obsWebSocketVersion: '5.5.0-mock',
          rpcVersion: 1,
          availableRequests: ['GetVersion', 'GetSceneList', 'GetInputList', 'GetGroupList', 'GetSourceFilterList', 'GetSourceFilter', 'SetSourceFilterEnabled', 'SetCurrentProgramScene'],
          supportedImageFormats: ['png', 'jpg'],
          platform: 'windows',
          platformDescription: 'Windows 10 (mock)'
        })
        return
      case 'GetSceneList': {
        // 与真 OBS 一致：数组按 sceneIndex 升序，sceneIndex 0 是界面最底下那个场景
        const scenes = world.scenes
          .map((name, i) => ({ sceneName: name, sceneUuid: uuidFor(name), sceneIndex: world.scenes.length - 1 - i }))
          .reverse()
        ok(
          {
            currentProgramSceneName: world.currentScene,
            currentProgramSceneUuid: uuidFor(world.currentScene),
            currentPreviewSceneName: null,
            currentPreviewSceneUuid: null,
            scenes
          },
          this.server.options.fragmentSceneList
        )
        return
      }
      case 'GetInputList':
        ok({
          inputs: world.inputs.map((i) => ({
            inputName: i.name,
            inputUuid: uuidFor(i.name),
            inputKind: i.kind,
            unversionedInputKind: i.kind.replace(/_v\d+$/, '')
          }))
        })
        return
      case 'GetGroupList':
        ok({ groups: [...world.groups] })
        return
      case 'GetSourceFilterList': {
        if (!need('sourceName', 'string')) return
        if (!knownSources.has(data.sourceName)) {
          fail(RequestStatus.ResourceNotFound, `No source was found by the name of \`${data.sourceName}\`.`)
          return
        }
        const list = filtersOf(data.sourceName)
        if (list === 'ERROR') {
          fail(RequestStatus.RequestProcessingFailed, 'Mock: this source always fails.')
          return
        }
        ok({
          filters: list.map((f, i) => ({ filterEnabled: f.enabled, filterIndex: i, filterKind: f.kind, filterName: f.name, filterSettings: {} }))
        })
        return
      }
      case 'GetSourceFilter': {
        if (!need('sourceName', 'string') || !need('filterName', 'string')) return
        const list = filtersOf(data.sourceName)
        const idx = Array.isArray(list) ? list.findIndex((f) => f.name === data.filterName) : -1
        if (idx === -1) {
          fail(RequestStatus.ResourceNotFound, `No filter was found in the source \`${data.sourceName}\` with the name \`${data.filterName}\`.`)
          return
        }
        const f = list[idx]
        ok({ filterEnabled: f.enabled, filterIndex: idx, filterKind: f.kind, filterSettings: {} })
        return
      }
      case 'SetSourceFilterEnabled': {
        if (!need('sourceName', 'string') || !need('filterName', 'string') || !need('filterEnabled', 'boolean')) return
        const list = filtersOf(data.sourceName)
        const f = Array.isArray(list) ? list.find((x) => x.name === data.filterName) : undefined
        if (!f) {
          fail(RequestStatus.ResourceNotFound, `No filter was found in the source \`${data.sourceName}\` with the name \`${data.filterName}\`.`)
          return
        }
        f.enabled = data.filterEnabled
        ok()
        this.server.emit('SourceFilterEnableStateChanged', { sourceName: data.sourceName, filterName: data.filterName, filterEnabled: f.enabled }, EventIntent.Filters)
        return
      }
      case 'SetCurrentProgramScene': {
        if (!need('sceneName', 'string')) return
        if (!world.scenes.includes(data.sceneName)) {
          fail(RequestStatus.ResourceNotFound, `No source was found by the name of \`${data.sceneName}\`.`)
          return
        }
        world.currentScene = data.sceneName
        ok()
        this.server.emit('CurrentProgramSceneChanged', { sceneName: data.sceneName, sceneUuid: uuidFor(data.sceneName) }, EventIntent.Scenes)
        return
      }
      // ---- 下面是折腾客户端用的假请求 ----
      case 'MockNeverRespond':
        return // 故意不回，测客户端超时
      case 'MockEcho': {
        const blob = String(data.blob ?? '')
        ok({ length: blob.length, sha256: crypto.createHash('sha256').update(blob).digest('hex') })
        return
      }
      case 'MockBigEvent': {
        const size = Number(data.size) || 1000
        this.server.emit('MockBig', { blob: 'x'.repeat(size) }, EventIntent.General)
        ok()
        return
      }
      case 'MockDropConnection':
        this.socket.destroy() // 不做关闭握手，直接掐 TCP
        return
      default:
        fail(RequestStatus.UnknownRequestType, 'Your request type is not valid.')
    }
  }
}

/**
 * 起一个假 OBS。options：
 *   host(默认 127.0.0.1) / port(默认 0=随机) / password(空=免鉴权)
 *   upgradeMode: 'ok' | 'badAccept'(故意回错的 Sec-WebSocket-Accept) | 'reject'(回 HTTP 400)
 *   fragmentSceneList: GetSceneList 响应拆成几个分片帧（默认 3，1=不拆）
 *   pingAfterIdentify: Identified 后发的 ping payload（默认 'mock-ping'，空=不发）
 *   world: 自定义假世界（默认 createMockWorld()）
 * 返回 { port, password, world, stats, sessions, emit(), close() }
 */
export function startMockObs(options = {}) {
  const opts = {
    host: '127.0.0.1',
    port: 0,
    password: '',
    upgradeMode: 'ok',
    fragmentSceneList: 3,
    pingAfterIdentify: 'mock-ping',
    ...options
  }
  const world = opts.world ?? createMockWorld()
  const stats = {
    connections: 0,
    identified: 0,
    authFailures: 0,
    framesFromClient: 0,
    unmaskedFrames: 0,
    pongs: [],
    closeCodesFromClient: [],
    closesSentByServer: [],
    requests: [],
    lastEventSubscriptions: null
  }
  const sessions = new Set()
  const httpServer = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket' })
    res.end('Upgrade Required')
  })
  const mock = {
    options: opts,
    password: opts.password,
    world,
    stats,
    sessions,
    port: 0,
    /** 向所有已鉴权且订阅了该 intent 的会话广播事件 */
    emit(eventType, eventData, eventIntent) {
      for (const s of sessions) {
        if (s.identified && (s.subs & eventIntent) !== 0) s.sendText({ op: 5, d: { eventType, eventIntent, eventData } })
      }
    },
    close() {
      for (const s of sessions) s.socket.destroy()
      sessions.clear()
      return new Promise((resolve) => httpServer.close(() => resolve()))
    }
  }

  httpServer.on('upgrade', (req, socket, head) => {
    stats.connections++
    const key = req.headers['sec-websocket-key']
    if (opts.upgradeMode === 'reject' || !key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    let accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
    if (opts.upgradeMode === 'badAccept') accept = crypto.createHash('sha1').update('wrong-key').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const session = new Session(mock, socket)
    sessions.add(session)
    // 升级完立刻推 Hello（真 OBS 也是这样，Hello 常常和 101 响应挤在同一个 TCP 包里）
    const hello = { obsWebSocketVersion: '5.5.0-mock', rpcVersion: 1 }
    if (opts.password) hello.authentication = { challenge: session.challenge, salt: session.salt }
    session.sendText({ op: 0, d: hello })
    if (head && head.length) session.onData(head)
  })

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port, opts.host, () => {
      mock.port = httpServer.address().port
      resolve(mock)
    })
  })
}

// ---------- 独立运行 ----------
const isMain = process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()
if (isMain) {
  const arg = (name, def) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : def
  }
  const port = Number(arg('port', '4455'))
  const password = arg('password', '')
  startMockObs({ port, password }).then((mock) => {
    console.log(`假 OBS 已启动：ws://127.0.0.1:${mock.port}  密码：${password || '（无，免鉴权）'}  Ctrl+C 退出`)
    process.on('SIGINT', () => mock.close().then(() => process.exit(0)))
  })
}

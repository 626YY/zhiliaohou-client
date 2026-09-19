import crypto from 'crypto'
import http from 'http'
import type net from 'net'
import { readJson, writeJson } from './db'
import type { ConnectorEvent, DanmakuForwardEvent, DanmakuForwardState } from '@shared/types'

const CONFIG_KEY = 'danmaku_forward'
const DEFAULT_PORT = 9001

interface ForwardConfig {
  port: number
}

let server: http.Server | null = null
let activePort = DEFAULT_PORT
let lastError = ''
const clients = new Set<net.Socket>()

function normalizePort(port: number): number | null {
  const value = Math.trunc(Number(port))
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null
}

function config(): ForwardConfig {
  const saved = readJson<Partial<ForwardConfig>>(CONFIG_KEY, {})
  return { port: normalizePort(saved.port ?? DEFAULT_PORT) ?? DEFAULT_PORT }
}

function saveConfig(port: number): void {
  writeJson<ForwardConfig>(CONFIG_KEY, { port })
}

function writeFrame(socket: net.Socket, text: string): void {
  const body = Buffer.from(text, 'utf8')
  let header: Buffer
  if (body.length < 126) {
    header = Buffer.from([0x81, body.length])
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(body.length), 2)
  }
  socket.write(Buffer.concat([header, body]))
}

function detach(socket: net.Socket): void {
  clients.delete(socket)
}

function closeServer(): void {
  for (const socket of clients) socket.destroy()
  clients.clear()
  if (server) {
    server.close()
    server = null
  }
}

function acceptUpgrade(req: http.IncomingMessage, socket: net.Socket): void {
  const key = req.headers['sec-websocket-key']
  const version = req.headers['sec-websocket-version']
  if (typeof key !== 'string' || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  socket.setNoDelay(true)
  clients.add(socket)
  socket.on('close', () => detach(socket))
  socket.on('end', () => detach(socket))
  socket.on('error', () => detach(socket))
}

export function danmakuForwardState(): DanmakuForwardState {
  return {
    running: !!server?.listening,
    port: server?.listening ? activePort : config().port,
    clients: clients.size,
    error: lastError || undefined
  }
}

export async function startDanmakuForward(port: number): Promise<{ ok: boolean; error?: string }> {
  const target = normalizePort(port)
  if (target == null) return { ok: false, error: '端口必须在 1 到 65535 之间' }
  if (server?.listening && activePort === target) return { ok: true }

  closeServer()
  lastError = ''
  const next = http.createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('请使用 WebSocket 连接')
  })
  next.on('upgrade', acceptUpgrade)
  server = next

  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      lastError = error.code === 'EADDRINUSE' ? `端口 ${target} 已被占用` : `启动转发失败：${error.message}`
      next.removeAllListeners()
      if (server === next) server = null
      resolve({ ok: false, error: lastError })
    }
    next.once('error', onError)
    next.listen(target, '127.0.0.1', () => {
      next.removeListener('error', onError)
      next.on('error', (error: NodeJS.ErrnoException) => {
        lastError = `弹幕转发服务异常：${error.message}`
        if (server === next) server = null
      })
      activePort = target
      saveConfig(target)
      resolve({ ok: true })
    })
  })
}

export function stopDanmakuForward(): { ok: boolean } {
  closeServer()
  lastError = ''
  return { ok: true }
}

export function publishDanmakuForward(event: DanmakuForwardEvent): { ok: boolean; error?: string } {
  if (!server?.listening) return { ok: false, error: '请先启动弹幕转发' }
  const payload = JSON.stringify({
    type: event.type,
    uid: event.uid || '',
    name: event.name || '',
    url: event.url || '',
    msg: event.msg || '',
    gift: event.gift || '',
    num: Math.max(0, Number(event.num) || 0)
  })
  for (const socket of [...clients]) {
    if (socket.destroyed || !socket.writable) {
      detach(socket)
      continue
    }
    try {
      writeFrame(socket, payload)
    } catch {
      socket.destroy()
      detach(socket)
    }
  }
  return { ok: true }
}

// 连接器当前以一行日志通知 UI；优先使用主进程已经解析好的结构化事件，
// 文本正则只保留给旧连接器/旧日志兼容。
export function publishConnectorLog(text: string, structured?: ConnectorEvent): void {
  const line = text.trim()
  let event: DanmakuForwardEvent | null = null

  if (structured) {
    const name = structured.sender || ''
    if (structured.type === 'gift' && structured.giftName) {
      event = { type: 'gift', uid: structured.uid || '', name, url: structured.avatar || '', msg: '', gift: structured.giftName, num: Math.max(0, Number(structured.count) || 1) }
    } else if (structured.type === 'comment') {
      event = { type: 'comment', uid: structured.uid || '', name, url: structured.avatar || '', msg: structured.text || '', gift: '', num: 0 }
    } else if (structured.type === 'member' || structured.type === 'badge') {
      event = { type: 'member', uid: structured.uid || '', name, url: structured.avatar || '', msg: '', gift: '', num: 0 }
    } else if (structured.type === 'follow') {
      event = { type: 'follow', uid: structured.uid || '', name, url: structured.avatar || '', msg: '', gift: '', num: 0 }
    } else if (structured.type === 'like') {
      event = { type: 'like', uid: structured.uid || '', name, url: structured.avatar || '', msg: '', gift: '', num: Math.max(0, Number(structured.count) || 0) }
    }
  }

  const chat = line.match(/^弹幕:\s*(\S+)\s+(.+)$/)
  if (!event && chat) {
    event = { type: 'comment', uid: '', name: chat[1], url: '', msg: chat[2], gift: '', num: 0 }
  }
  const gift = line.match(/^(?:模拟)?礼物:\s*(.+?)\s+x(\d+)(?:\s+by\s+(.+?))?(?:\s+\d+分\/个|\s+\(分值未知\))?$/)
  if (!event && gift) {
    event = { type: 'gift', uid: '', name: gift[3]?.trim() ?? '', url: '', msg: '', gift: gift[1].trim(), num: Number(gift[2]) }
  }
  const member = line.match(/^进场:\s*(.+)$/)
  if (!event && member) {
    event = { type: 'member', uid: '', name: member[1].trim(), url: '', msg: '', gift: '', num: 0 }
  }
  const follow = line.match(/^(?:模拟)?关注(?:\s+by)?\s*(.+)?$/)
  if (!event && follow) {
    event = { type: 'follow', uid: '', name: follow[1]?.trim() ?? '', url: '', msg: '', gift: '', num: 0 }
  }
  const like = line.match(/^点赞:\s*(\d+)(?:\s+by\s+(.+))?$/)
  if (!event && like) {
    event = { type: 'like', uid: '', name: like[2]?.trim() ?? '', url: '', msg: '', gift: '', num: Number(like[1]) }
  }
  if (event) publishDanmakuForward(event)
}

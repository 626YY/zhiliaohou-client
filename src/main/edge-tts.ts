// 微软 Edge「大声朗读」在线语音（和 edge-tts 同一个服务）：特色整蛊盲盒开奖时念「锁链加5」用。
// 只用 Node 自带的 tls / crypto 手写最小 WebSocket 客户端（主进程的 Node 20 没有全局 WebSocket，
// 这个服务又要自定义 Origin / User-Agent 请求头，浏览器端的 WebSocket 设不了）。
// 服务要求的 Sec-MS-GEC 是按时间（5 分钟一档）算的哈希，本机时钟不准时服务器回 403，按它回的 Date 校正一次再连。
// ★不依赖这个服务也能用：默认事件的配音随包带着（assets/special-games/box_voice），这里只给主播自己加的、随机到的数量现念。
import crypto from 'crypto'
import tls from 'tls'

const HOST = 'speech.platform.bing.com'
const PATH = '/consumer/speech/synthesize/readaloud/edge/v1'
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROMIUM_FULL = '143.0.3650.75'
const CHROMIUM_MAJOR = CHROMIUM_FULL.split('.')[0]
const WIN_EPOCH = 11644473600

let clockSkew = 0

function secMsGec(): string {
  const seconds = Math.floor(Date.now() / 1000 + clockSkew) + WIN_EPOCH
  const ticks = BigInt(seconds - (seconds % 300)) * 10_000_000n
  return crypto.createHash('sha256').update(`${ticks}${TOKEN}`, 'ascii').digest('hex').toUpperCase()
}

const hex = (n: number): string => crypto.randomBytes(n).toString('hex')

// JS 风格的时间串（服务端就认这个格式）
function stamp(): string {
  const d = new Date()
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const p = (v: number): string => String(v).padStart(2, '0')
  return `${day} ${mon} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** zh-CN-XiaoyiNeural → 服务端要的全名 */
function longVoiceName(voice: string): string {
  const m = /^([a-z]{2,3})-([A-Z]{2})-(.+)$/.exec(voice)
  if (!m) return voice
  let [, lang, region, name] = m
  // 带方言的：zh-CN-liaoning-XiaobeiNeural → (zh-CN-liaoning, XiaobeiNeural)
  const dash = name.indexOf('-')
  if (dash > 0) { region = `${region}-${name.slice(0, dash)}`; name = name.slice(dash + 1) }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`
}

// 客户端发出的帧必须加掩码
function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
  head[0] = 0x80 | opcode
  if (len < 126) head[1] = 0x80 | len
  else if (len < 65536) { head[1] = 0x80 | 126; head.writeUInt16BE(len, 2) }
  else { head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2) }
  const mask = crypto.randomBytes(4)
  const body = Buffer.alloc(len)
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3]
  return Buffer.concat([head, mask, body])
}

class HandshakeError extends Error {
  constructor(message: string, readonly status: number, readonly serverDate: string) { super(message) }
}

export interface EdgeTtsOptions {
  /** 声音，如 zh-CN-XiaoyiNeural */
  voice: string
  /** 语速，百分比（0 = 正常，-20 = 慢两成） */
  rate?: number
  /** 整体超时（毫秒） */
  timeoutMs?: number
}

function once(text: string, opts: EdgeTtsOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const rate = Math.round(Number(opts.rate) || 0)
    const query = `TrustedClientToken=${TOKEN}&ConnectionId=${hex(16)}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL}`
    const key = crypto.randomBytes(16).toString('base64')
    const request = [
      `GET ${PATH}?${query} HTTP/1.1`,
      `Host: ${HOST}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      'Pragma: no-cache',
      'Cache-Control: no-cache',
      'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
      'Accept-Language: en-US,en;q=0.9',
      `Cookie: muid=${hex(16).toUpperCase()};`,
      '',
      ''
    ].join('\r\n')
    const audio: Buffer[] = []
    let buf = Buffer.alloc(0)
    let upgraded = false
    let done = false
    let fragments: Buffer[] = []
    let fragOpcode = 0
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST })
    const finish = (err: Error | null, data?: Buffer): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* 已断 */ }
      if (err) reject(err)
      else resolve(data!)
    }
    const timer = setTimeout(() => finish(new Error('语音服务超时')), Math.max(1000, opts.timeoutMs ?? 8000))
    const send = (text: string): void => { socket.write(frame(0x1, Buffer.from(text, 'utf8'))) }
    const onMessage = (opcode: number, data: Buffer): void => {
      if (opcode === 0x1) {
        const text = data.toString('utf8')
        const path = /(?:^|\r\n)Path:([^\r\n]+)/.exec(text)?.[1]?.trim()
        if (path === 'turn.end') {
          if (!audio.length) finish(new Error('语音服务没返回声音'))
          else finish(null, Buffer.concat(audio))
        }
      } else if (opcode === 0x2) {
        if (data.length < 2) return
        const headLen = data.readUInt16BE(0)
        const head = data.subarray(2, 2 + headLen).toString('utf8')
        if (/(?:^|\r\n)Path:audio(?:\r\n|$)/.test(head)) {
          const body = data.subarray(2 + headLen)
          if (body.length) audio.push(body)
        }
      }
    }
    const parseFrames = (): void => {
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0
        const opcode = buf[0] & 0x0f
        const masked = (buf[1] & 0x80) !== 0
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        const maskKey = masked ? buf.subarray(off, off + 4) : null
        if (masked) off += 4
        if (buf.length < off + len) return
        let payload = buf.subarray(off, off + len)
        buf = buf.subarray(off + len)
        if (maskKey) { const p = Buffer.alloc(payload.length); for (let i = 0; i < p.length; i++) p[i] = payload[i] ^ maskKey[i & 3]; payload = p }
        if (opcode === 0x8) { finish(new Error('语音服务还没念完就断开了')); return }
        if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue }
        if (opcode === 0xa) continue
        if (opcode === 0x0) {
          fragments.push(Buffer.from(payload))
          if (fin) { onMessage(fragOpcode, Buffer.concat(fragments)); fragments = [] }
          continue
        }
        if (!fin) { fragOpcode = opcode; fragments = [Buffer.from(payload)]; continue }
        onMessage(opcode, Buffer.from(payload))
      }
    }
    socket.on('secureConnect', () => socket.write(request))
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n')
        if (end < 0) return
        const head = buf.subarray(0, end).toString('latin1')
        buf = buf.subarray(end + 4)
        const status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] || 0)
        if (status !== 101) {
          const date = /\r\ndate:\s*([^\r\n]+)/i.exec(head)?.[1] || ''
          finish(new HandshakeError(`语音服务拒绝连接（${status || '无响应'}）`, status, date))
          return
        }
        upgraded = true
        send(
          `X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
        )
        const ssml =
          "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
          `<voice name='${longVoiceName(opts.voice)}'><prosody pitch='+0Hz' rate='${rate >= 0 ? '+' : ''}${rate}%' volume='+0%'>` +
          `${escapeXml(text)}</prosody></voice></speak>`
        send(`X-RequestId:${hex(16)}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`)
      }
      parseFrames()
    })
    socket.on('error', (e) => finish(new Error(`连不上语音服务：${e.message}`)))
    // 念完（turn.end）之前断开 = 半截声音，不要
    socket.on('close', () => finish(new Error('语音服务还没念完就断开了')))
  })
}

/** 念一句，返回 mp3（24kHz 单声道）。本机时钟偏了被拒时按服务器时间校正一次再试。 */
export async function edgeTts(text: string, opts: EdgeTtsOptions): Promise<Buffer> {
  const line = String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim()
  if (!line) throw new Error('没有要念的字')
  try {
    return await once(line, opts)
  } catch (e) {
    if (e instanceof HandshakeError && e.status === 403 && e.serverDate) {
      const server = Date.parse(e.serverDate)
      if (Number.isFinite(server)) {
        clockSkew += (server - Date.now()) / 1000
        return once(line, opts)
      }
    }
    throw e
  }
}

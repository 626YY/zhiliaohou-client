// 通过 CDP 对 Electron 渲染页截图/执行 JS
// 用法: node tools/cdp-shot.js <wsUrl> <out.png> [--eval "<js>"]
const wsUrl = process.argv[2]
const out = process.argv[3]
const evalIdx = process.argv.indexOf('--eval')
const evalExpr = evalIdx >= 0 ? process.argv[evalIdx + 1] : null
const fs = require('fs')

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}

ws.onerror = (e) => {
  console.error('WS error', e.message || e)
  process.exit(1)
}

ws.onopen = async () => {
  try {
    await send('Page.enable')
    await send('Runtime.enable')
    if (evalExpr) {
      const r = await send('Runtime.evaluate', {
        expression: evalExpr,
        awaitPromise: true,
        returnByValue: true
      })
      console.log('EVAL:', JSON.stringify(r.result && r.result.value))
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('saved:', out)
  } catch (e) {
    console.error('CDP error:', e.message)
  }
  ws.close()
  process.exit(0)
}

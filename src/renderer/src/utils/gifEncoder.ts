// 最小 GIF89a 编码器（LZW，支持透明背景，256 色）
// 用于透明图合成「导出 GIF 动画」（复刻参考软件 GifFFmpeg/开始制作滚动图片）

export interface GifFrame {
  width: number
  height: number
  pixels: Uint8ClampedArray // RGBA
  delayMs?: number
}

function writeBytes(out: number[], b: number[] | Uint8Array) {
  for (const v of b) out.push(v & 0xff)
}

function lzwEncode(indexed: Uint8Array, minCodeSize: number): number[] {
  const out: number[] = []
  let codeSize = minCodeSize + 1
  let codeMask = (1 << codeSize) - 1
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let nextCode = endCode + 1
  const dict = new Map<string, number>()

  let bitBuf = 0
  let bitCnt = 0
  const emit = (code: number) => {
    bitBuf |= code << bitCnt
    bitCnt += codeSize
    while (bitCnt >= 8) {
      out.push(bitBuf & 0xff)
      bitBuf >>= 8
      bitCnt -= 8
    }
  }

  const resetDict = () => {
    dict.clear()
    for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i)
    nextCode = endCode + 1
    codeSize = minCodeSize + 1
    codeMask = (1 << codeSize) - 1
  }

  resetDict()
  emit(clearCode)

  let prefixKey = String.fromCharCode(indexed[0])
  for (let i = 1; i < indexed.length; i++) {
    const k = indexed[i]
    const key = prefixKey + String.fromCharCode(k)
    if (dict.has(key)) {
      prefixKey = key
    } else {
      emit(dict.get(prefixKey)!)
      if (nextCode <= codeMask) {
        dict.set(key, nextCode++)
        if (nextCode > codeMask) {
          codeSize++
          codeMask = (1 << codeSize) - 1
        }
      } else {
        emit(clearCode)
        resetDict()
      }
      prefixKey = String.fromCharCode(k)
    }
  }
  emit(dict.get(prefixKey)!)
  emit(endCode)
  if (bitCnt > 0) out.push(bitBuf & 0xff)
  return out
}

export function encodeGif(frames: GifFrame[]): Blob {
  if (frames.length === 0) throw new Error('无帧')
  const width = frames[0].width
  const height = frames[0].height

  // ===== 构建 256 色全局调色板（index 0..254 不透明，255 保留透明） =====
  const TRANSPARENT = 255
  const palette: number[][] = []
  const colorToIndex = new Map<number, number>()
  const addColor = (r: number, g: number, b: number): number => {
    const key = ((r << 16) | (g << 8) | b) >>> 0
    if (colorToIndex.has(key)) return colorToIndex.get(key)!
    const idx = palette.length
    if (idx >= TRANSPARENT) return colorToIndex.get((key) & 0xffffff) ?? 0 // 超 255 色取近似
    palette.push([r, g, b])
    colorToIndex.set(key, idx)
    return idx
  }
  addColor(0, 0, 0) // index 0 兜底

  // 调色板补齐到 2 的幂
  let tableSize = 1
  while (tableSize < Math.max(2, palette.length)) tableSize <<= 1
  const gctSizeBits = Math.round(Math.log2(tableSize)) - 1
  const gctBytes = new Uint8Array(tableSize * 3)
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? [0, 0, 0]
    gctBytes[i * 3] = c[0]
    gctBytes[i * 3 + 1] = c[1]
    gctBytes[i * 3 + 2] = c[2]
  }

  // 逐帧量化：把 RGBA 转成索引
  const indexedFrames = frames.map((f) => {
    const idx = new Uint8Array(width * height)
    for (let p = 0; p < f.pixels.length; p += 4) {
      const a = f.pixels[p + 3]
      if (a < 128) {
        idx[p / 4] = TRANSPARENT
      } else {
        idx[p / 4] = addColor(f.pixels[p], f.pixels[p + 1], f.pixels[p + 2])
      }
    }
    return idx
  })

  const minCodeSize = Math.max(2, gctSizeBits + 1)
  const lzwChunks = indexedFrames.map((idx) => lzwEncode(idx, minCodeSize))

  const out: number[] = []
  // Header
  writeBytes(out, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
  // Logical Screen Descriptor
  writeBytes(out, [width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff])
  out.push(0x80 | (0x07 << 4) | (gctSizeBits & 0x07)) // GCT flag + resolution + size
  out.push(0x00, 0x00)
  writeBytes(out, gctBytes)

  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi]
    const delay = Math.max(2, Math.round((f.delayMs ?? 100) / 10))
    // Graphic Control Extension（透明索引 255）
    writeBytes(out, [0x21, 0xf9, 0x04, 0x01, delay & 0xff, (delay >> 8) & 0xff, TRANSPARENT, 0x00])
    // Image Descriptor
    writeBytes(out, [0x2c, 0, 0, 0, 0, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x00])
    // LZW 分包写入
    const lzw = lzwChunks[fi]
    out.push(minCodeSize)
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.slice(i, i + 255)
      out.push(chunk.length)
      writeBytes(out, chunk)
    }
    out.push(0x00)
  }
  out.push(0x3b) // Trailer

  return new Blob([new Uint8Array(out)], { type: 'image/gif' })
}

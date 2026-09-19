// 虚拟键码 → 键帽显示文字，以及标准 ANSI 87 键(TKL)整键盘布局。
// 供「键盘显示」直播挂件用：简约样式只需 KEY_LABELS 把按下的键翻成文字；
// 「专业」样式用 KEYBOARD_ROWS 画出整块键盘、把按下的键高亮。
//
// 左右修饰键靠低级钩子直接给出的左右区分 vk：
//   VK_LSHIFT 0xA0 / VK_RSHIFT 0xA1 / VK_LCONTROL 0xA2 / VK_RCONTROL 0xA3 / VK_LMENU 0xA4 / VK_RMENU 0xA5
// 通用 vk（Shift 0x10 / Ctrl 0x11 / Alt 0x12）也一并映射，做兜底。

export const KEY_LABELS: Record<number, string> = {
  // ── 功能键区 ──
  0x1b: 'Esc',
  0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
  0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
  0x78: 'F9', 0x79: 'F10', 0x7a: 'F11', 0x7b: 'F12',
  // F13~F24：宏键盘/自动化注入常用（本项目自测也用 F13）
  0x7c: 'F13', 0x7d: 'F14', 0x7e: 'F15', 0x7f: 'F16', 0x80: 'F17', 0x81: 'F18',
  0x82: 'F19', 0x83: 'F20', 0x84: 'F21', 0x85: 'F22', 0x86: 'F23', 0x87: 'F24',
  0x2c: 'PrtSc', 0x91: 'ScrLk', 0x13: 'Pause',

  // ── 数字行 ──
  0xc0: '~',
  0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4', 0x35: '5',
  0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9', 0x30: '0',
  0xbd: '-', 0xbb: '=', 0x08: 'Backspace',

  // ── Tab 行 ──
  0x09: 'Tab',
  0x51: 'Q', 0x57: 'W', 0x45: 'E', 0x52: 'R', 0x54: 'T',
  0x59: 'Y', 0x55: 'U', 0x49: 'I', 0x4f: 'O', 0x50: 'P',
  0xdb: '[', 0xdd: ']', 0xdc: '\\',

  // ── Caps 行 ──
  0x14: 'Caps',
  0x41: 'A', 0x53: 'S', 0x44: 'D', 0x46: 'F', 0x47: 'G',
  0x48: 'H', 0x4a: 'J', 0x4b: 'K', 0x4c: 'L',
  0xba: ';', 0xde: "'", 0x0d: 'Enter',

  // ── Shift 行 ──
  0x10: 'Shift', 0xa0: 'Shift', 0xa1: 'Shift',
  0x5a: 'Z', 0x58: 'X', 0x43: 'C', 0x56: 'V', 0x42: 'B', 0x4e: 'N', 0x4d: 'M',
  0xbc: ',', 0xbe: '.', 0xbf: '/',

  // ── 底行修饰键 ──
  0x11: 'Ctrl', 0xa2: 'Ctrl', 0xa3: 'Ctrl',
  0x5b: 'Win', 0x5c: 'Win',
  0x12: 'Alt', 0xa4: 'Alt', 0xa5: 'Alt',
  0x20: 'Space',
  0x5d: 'Menu',

  // ── 方向键 ──
  0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓',

  // ── 编辑键区 ──
  0x2d: 'Insert', 0x2e: 'Delete', 0x24: 'Home', 0x23: 'End', 0x21: 'PgUp', 0x22: 'PgDn',

  // ── 小键盘 ──
  0x90: 'Num', 0x60: '0', 0x61: '1', 0x62: '2', 0x63: '3', 0x64: '4',
  0x65: '5', 0x66: '6', 0x67: '7', 0x68: '8', 0x69: '9',
  0x6e: '.', 0x6f: '/', 0x6a: '*', 0x6d: '-', 0x6b: '+'
}

// 兜底：钩子给到未收录的 vk 时，别显示空白
export function keyLabel(vk: number): string {
  return KEY_LABELS[vk] ?? ('#' + vk)
}

export interface KeyCap {
  /** 虚拟键码；vk <= 0 表示占位空隙(用于对齐编辑键区/方向键)，不渲染键帽 */
  vk: number
  /** 相对宽度，默认 1（1u = 一个标准字母键宽） */
  w?: number
  /** 覆盖显示文字；不填则用 KEY_LABELS[vk] */
  label?: string
}

export type KeyboardRow = KeyCap[]

// 占位空隙（主键区与编辑键区之间那道缝）
const GAP = (w: number): KeyCap => ({ vk: -1, w })

// 标准 ANSI 87 键(TKL) 布局：主键区(15u 宽) + 编辑键区(3 列) + 方向键。
// 每行主键区宽度合计约 15u；编辑键区/方向键靠前置 GAP 与主键区拉开。
export const KEYBOARD_ROWS: KeyboardRow[] = [
  // 功能键行
  [
    { vk: 0x1b }, GAP(1),
    { vk: 0x70 }, { vk: 0x71 }, { vk: 0x72 }, { vk: 0x73 }, GAP(0.5),
    { vk: 0x74 }, { vk: 0x75 }, { vk: 0x76 }, { vk: 0x77 }, GAP(0.5),
    { vk: 0x78 }, { vk: 0x79 }, { vk: 0x7a }, { vk: 0x7b }, GAP(0.5),
    { vk: 0x2c }, { vk: 0x91 }, { vk: 0x13 }
  ],
  // 数字行
  [
    { vk: 0xc0 },
    { vk: 0x31 }, { vk: 0x32 }, { vk: 0x33 }, { vk: 0x34 }, { vk: 0x35 },
    { vk: 0x36 }, { vk: 0x37 }, { vk: 0x38 }, { vk: 0x39 }, { vk: 0x30 },
    { vk: 0xbd }, { vk: 0xbb }, { vk: 0x08, w: 2, label: 'Bksp' }, GAP(0.5),
    { vk: 0x2d, label: 'Ins' }, { vk: 0x24 }, { vk: 0x21 }
  ],
  // Tab 行
  [
    { vk: 0x09, w: 1.5 },
    { vk: 0x51 }, { vk: 0x57 }, { vk: 0x45 }, { vk: 0x52 }, { vk: 0x54 },
    { vk: 0x59 }, { vk: 0x55 }, { vk: 0x49 }, { vk: 0x4f }, { vk: 0x50 },
    { vk: 0xdb }, { vk: 0xdd }, { vk: 0xdc, w: 1.5 }, GAP(0.5),
    { vk: 0x2e, label: 'Del' }, { vk: 0x23 }, { vk: 0x22 }
  ],
  // Caps 行
  [
    { vk: 0x14, w: 1.75 },
    { vk: 0x41 }, { vk: 0x53 }, { vk: 0x44 }, { vk: 0x46 }, { vk: 0x47 },
    { vk: 0x48 }, { vk: 0x4a }, { vk: 0x4b }, { vk: 0x4c },
    { vk: 0xba }, { vk: 0xde }, { vk: 0x0d, w: 2.25 }
  ],
  // Shift 行
  [
    { vk: 0xa0, w: 2.25, label: 'Shift' },
    { vk: 0x5a }, { vk: 0x58 }, { vk: 0x43 }, { vk: 0x56 }, { vk: 0x42 }, { vk: 0x4e }, { vk: 0x4d },
    { vk: 0xbc }, { vk: 0xbe }, { vk: 0xbf }, { vk: 0xa1, w: 2.75, label: 'Shift' }, GAP(1.5),
    { vk: 0x26 }
  ],
  // 控制行（底排）
  [
    { vk: 0xa2, w: 1.25, label: 'Ctrl' }, { vk: 0x5b, w: 1.25, label: 'Win' }, { vk: 0xa4, w: 1.25, label: 'Alt' },
    { vk: 0x20, w: 6.25 },
    { vk: 0xa5, w: 1.25, label: 'Alt' }, { vk: 0x5c, w: 1.25, label: 'Win' }, { vk: 0x5d, w: 1.25, label: 'Menu' }, { vk: 0xa3, w: 1.25, label: 'Ctrl' }, GAP(0.5),
    { vk: 0x25 }, { vk: 0x28 }, { vk: 0x27 }
  ]
]

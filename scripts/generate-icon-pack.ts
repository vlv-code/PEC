import fs from "fs";
import path from "path";
import zlib from "zlib";

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

class PngCanvas {
  width: number;
  height: number;
  buffer: Buffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    // Row format: 1 byte filter type (0) + width * 4 bytes RGBA
    const rowSize = 1 + width * 4;
    this.buffer = Buffer.alloc(height * rowSize, 0);
  }

  setPixel(x: number, y: number, color: Color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const rowSize = 1 + this.width * 4;
    const offset = y * rowSize + 1 + x * 4;

    const srcA = color.a / 255;
    if (srcA <= 0) return;
    if (srcA >= 1) {
      this.buffer[offset] = color.r;
      this.buffer[offset + 1] = color.g;
      this.buffer[offset + 2] = color.b;
      this.buffer[offset + 3] = 255;
      return;
    }

    const dstA = this.buffer[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;

    this.buffer[offset] = Math.round((color.r * srcA + this.buffer[offset] * dstA * (1 - srcA)) / outA);
    this.buffer[offset + 1] = Math.round((color.g * srcA + this.buffer[offset + 1] * dstA * (1 - srcA)) / outA);
    this.buffer[offset + 2] = Math.round((color.b * srcA + this.buffer[offset + 2] * dstA * (1 - srcA)) / outA);
    this.buffer[offset + 3] = Math.round(outA * 255);
  }

  fillCircle(cx: number, cy: number, r: number, color: Color) {
    const minX = Math.max(0, Math.floor(cx - r - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + r + 1));
    const minY = Math.max(0, Math.floor(cy - r - 1));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + r + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r - 0.5) {
          this.setPixel(x, y, color);
        } else if (d < r + 0.5) {
          const alpha = (r + 0.5 - d) * color.a;
          this.setPixel(x, y, { ...color, a: alpha });
        }
      }
    }
  }

  strokeCircle(cx: number, cy: number, r: number, width: number, color: Color) {
    const half = width / 2;
    const minX = Math.max(0, Math.floor(cx - r - half - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + r + half + 1));
    const minY = Math.max(0, Math.floor(cy - r - half - 1));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + r + half + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const distToRing = Math.abs(d - r);
        if (distToRing <= half - 0.5) {
          this.setPixel(x, y, color);
        } else if (distToRing < half + 0.5) {
          const alpha = (half + 0.5 - distToRing) * color.a;
          this.setPixel(x, y, { ...color, a: alpha });
        }
      }
    }
  }

  strokeEllipse(cx: number, cy: number, rx: number, ry: number, width: number, color: Color) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const val = Math.sqrt(nx * nx + ny * ny);
        const dist = Math.abs(val - 1.0) * ((rx + ry) / 2);
        if (dist <= width / 2) {
          this.setPixel(x, y, color);
        }
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color, rx = 0) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width - 1, Math.ceil(x + w));
    const y1 = Math.min(this.height - 1, Math.ceil(y + h));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (rx > 0) {
          const inLeft = px < x + rx;
          const inRight = px > x + w - rx;
          const inTop = py < y + rx;
          const inBottom = py > y + h - rx;

          if (inLeft && inTop) {
            if (Math.hypot(px - (x + rx), py - (y + rx)) > rx) continue;
          } else if (inRight && inTop) {
            if (Math.hypot(px - (x + w - rx), py - (y + rx)) > rx) continue;
          } else if (inLeft && inBottom) {
            if (Math.hypot(px - (x + rx), py - (y + h - rx)) > rx) continue;
          } else if (inRight && inBottom) {
            if (Math.hypot(px - (x + w - rx), py - (y + h - rx)) > rx) continue;
          }
        }
        this.setPixel(px, py, color);
      }
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, strokeWidth: number, color: Color, rx = 0) {
    this.fillRect(x, y, w, strokeWidth, color);
    this.fillRect(x, y + h - strokeWidth, w, strokeWidth, color);
    this.fillRect(x, y, strokeWidth, h, color);
    this.fillRect(x + w - strokeWidth, y, strokeWidth, h, color);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, width: number, color: Color) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return;
    const steps = Math.ceil(len * 2);
    const half = width / 2;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const curX = x1 + (x2 - x1) * t;
      const curY = y1 + (y2 - y1) * t;
      this.fillCircle(curX, curY, half, color);
    }
  }

  toPng(): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(this.buffer);

    function pngChunk(type: string, data: Buffer): Buffer {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, "ascii");
      const body = Buffer.concat([typeBuf, data]);

      let table = (globalThis as unknown as { _pecCrcTable?: Uint32Array })._pecCrcTable;
      if (!table) {
        table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          table[i] = c;
        }
        (globalThis as unknown as { _pecCrcTable?: Uint32Array })._pecCrcTable = table;
      }
      let crc = -1;
      for (let i = 0; i < body.length; i++) crc = (crc >>> 8) ^ table[(crc ^ body[i]) & 0xff];
      crc = (crc ^ -1) >>> 0;

      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(crc, 0);
      return Buffer.concat([len, body, crcBuf]);
    }

    return Buffer.concat([
      sig,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", idat),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const HEX_COLORS: Record<string, Color> = {
  primary: { r: 56, g: 189, b: 248, a: 255 },     // #38bdf8
  success: { r: 16, g: 185, b: 129, a: 255 },     // #10b981
  warning: { r: 245, g: 158, b: 11, a: 255 },     // #f59e0b
  danger: { r: 239, g: 68, b: 68, a: 255 },       // #ef4444
  purple: { r: 192, g: 132, b: 252, a: 255 },     // #c084fc
  white: { r: 255, g: 255, b: 255, a: 255 },
  whiteSoft: { r: 241, g: 245, b: 249, a: 230 },
  slate: { r: 148, g: 163, b: 184, a: 255 },      // #94a3b8
  dark: { r: 15, g: 23, b: 42, a: 255 },          // #0f172a
};

type IconRenderer = (cv: PngCanvas) => void;

const ICON_RENDERERS: Record<string, IconRenderer> = {
  shield: (cv) => {
    // Shield badge
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Outer shield contour
    for (let y = 3; y <= 29; y++) {
      for (let x = 3; x <= 29; x++) {
        const dx = Math.abs(x - 16);
        let inShield = false;
        if (y <= 14) inShield = dx <= 11;
        else inShield = dx <= 11 * (1 - (y - 14) / 16);
        if (inShield) {
          const edge = (y <= 5 || dx >= 10 || (y > 14 && dx >= 10 * (1 - (y - 14) / 16)));
          cv.setPixel(x, y, edge ? w : p);
        }
      }
    }
    // Checkmark inside shield
    cv.drawLine(10, 16, 14, 21, 2.5, w);
    cv.drawLine(14, 21, 22, 11, 2.5, w);
  },

  globe: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.whiteSoft;
    cv.strokeCircle(16, 16, 12, 2, p);
    cv.drawLine(4, 16, 28, 16, 1.8, w);
    cv.drawLine(6, 10, 26, 10, 1.5, p);
    cv.drawLine(6, 22, 26, 22, 1.5, p);
    cv.strokeEllipse(16, 16, 6, 12, 1.8, w);
  },

  server: (cv) => {
    const p = HEX_COLORS.primary;
    const g = HEX_COLORS.success;
    const w = HEX_COLORS.white;
    // 3 rack units
    for (let i = 0; i < 3; i++) {
      const y = 4 + i * 9;
      cv.strokeRect(4, y, 24, 7, 1.5, p, 2);
      cv.fillCircle(8, y + 3.5, 1.5, g);
      cv.drawLine(13, y + 3.5, 24, y + 3.5, 1.2, w);
    }
  },

  sync: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    cv.strokeCircle(16, 16, 10, 2.5, p);
    // Erase 2 gaps
    cv.fillRect(24, 14, 8, 8, { r: 0, g: 0, b: 0, a: 0 });
    cv.fillRect(0, 10, 8, 8, { r: 0, g: 0, b: 0, a: 0 });
    // Arrow heads
    cv.drawLine(22, 11, 27, 16, 2.5, w);
    cv.drawLine(27, 16, 22, 21, 2.5, w);
    cv.drawLine(10, 21, 5, 16, 2.5, w);
    cv.drawLine(5, 16, 10, 11, 2.5, w);
  },

  bolt: (cv) => {
    const yl = HEX_COLORS.warning;
    const w = HEX_COLORS.white;
    // Lightning bolt
    cv.drawLine(18, 3, 9, 16, 3, yl);
    cv.drawLine(9, 16, 16, 16, 3, yl);
    cv.drawLine(16, 16, 12, 29, 3, yl);
    cv.drawLine(12, 29, 23, 14, 3, w);
    cv.drawLine(23, 14, 16, 14, 3, w);
    cv.drawLine(16, 14, 18, 3, 3, w);
  },

  building: (cv) => {
    const s = HEX_COLORS.slate;
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Main building
    cv.fillRect(6, 6, 20, 23, s, 2);
    // Windows grid
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        cv.fillRect(9 + c * 5, 9 + r * 4, 3, 2.5, p);
      }
    }
    // Door
    cv.fillRect(13, 23, 6, 6, w);
  },

  folder: (cv) => {
    const p = HEX_COLORS.primary;
    const yl = HEX_COLORS.warning;
    // Folder tab
    cv.fillRect(4, 7, 10, 5, yl, 2);
    // Folder back
    cv.fillRect(4, 10, 24, 16, yl, 3);
    // Folder front slant
    cv.fillRect(4, 13, 24, 13, p, 2);
  },

  user: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Head
    cv.fillCircle(16, 9, 5.5, p);
    // Body / shoulders
    for (let y = 17; y <= 28; y++) {
      const halfW = 4 + (y - 17) * 0.9;
      cv.drawLine(16 - halfW, y, 16 + halfW, y, 1.5, w);
    }
  },

  ghost: (cv) => {
    const prp = HEX_COLORS.purple;
    const w = HEX_COLORS.white;
    const d = HEX_COLORS.dark;
    // Ghost dome
    cv.fillCircle(16, 12, 9, prp);
    cv.fillRect(7, 12, 18, 11, prp);
    // Wavy bottom skirt
    cv.fillCircle(10, 23, 3, prp);
    cv.fillCircle(16, 23, 3, prp);
    cv.fillCircle(22, 23, 3, prp);
    // Eyes
    cv.fillCircle(13, 12, 2.5, w);
    cv.fillCircle(19, 12, 2.5, w);
    cv.fillCircle(14, 12, 1.2, d);
    cv.fillCircle(20, 12, 1.2, d);
  },

  download: (cv) => {
    const g = HEX_COLORS.success;
    const w = HEX_COLORS.white;
    // Down arrow
    cv.drawLine(16, 4, 16, 18, 3, g);
    cv.drawLine(10, 13, 16, 19, 3, g);
    cv.drawLine(22, 13, 16, 19, 3, g);
    // Base tray
    cv.drawLine(6, 22, 6, 27, 2.5, w);
    cv.drawLine(6, 27, 26, 27, 2.5, w);
    cv.drawLine(26, 27, 26, 22, 2.5, w);
  },

  lock: (cv) => {
    const yl = HEX_COLORS.warning;
    const w = HEX_COLORS.white;
    // Shackle
    cv.strokeCircle(16, 11, 6, 2.5, w);
    // Lock body
    cv.fillRect(7, 13, 18, 14, yl, 3);
    // Keyhole
    cv.fillCircle(16, 19, 2.2, HEX_COLORS.dark);
    cv.drawLine(16, 19, 16, 23, 2, HEX_COLORS.dark);
  },

  key: (cv) => {
    const yl = HEX_COLORS.warning;
    const w = HEX_COLORS.white;
    // Key ring
    cv.strokeCircle(10, 16, 6, 2.5, yl);
    // Key shaft
    cv.drawLine(16, 16, 28, 16, 3, yl);
    // Teeth
    cv.drawLine(24, 16, 24, 21, 2.5, w);
    cv.drawLine(27, 16, 27, 20, 2.5, w);
  },

  plug: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Two prongs
    cv.drawLine(12, 4, 12, 11, 2.5, w);
    cv.drawLine(20, 4, 20, 11, 2.5, w);
    // Plug body
    cv.fillRect(8, 11, 16, 11, p, 3);
    // Cord
    cv.drawLine(16, 22, 16, 29, 3, w);
  },

  power: (cv) => {
    const g = HEX_COLORS.success;
    const w = HEX_COLORS.white;
    cv.strokeCircle(16, 17, 9, 2.5, g);
    // Cut top of circle
    cv.fillRect(12, 6, 8, 6, { r: 0, g: 0, b: 0, a: 0 });
    // Power vertical stroke
    cv.drawLine(16, 5, 16, 16, 3, w);
  },

  pause: (cv) => {
    const yl = HEX_COLORS.warning;
    cv.fillRect(9, 6, 4.5, 20, yl, 2);
    cv.fillRect(18.5, 6, 4.5, 20, yl, 2);
  },

  sun: (cv) => {
    const yl = HEX_COLORS.warning;
    cv.fillCircle(16, 16, 5.5, yl);
    for (let a = 0; a < 8; a++) {
      const rad = (a * Math.PI) / 4;
      const x1 = 16 + Math.cos(rad) * 8;
      const y1 = 16 + Math.sin(rad) * 8;
      const x2 = 16 + Math.cos(rad) * 12;
      const y2 = 16 + Math.sin(rad) * 12;
      cv.drawLine(x1, y1, x2, y2, 2, yl);
    }
  },

  moon: (cv) => {
    const p = HEX_COLORS.primary;
    cv.fillCircle(17, 15, 10, p);
    cv.fillCircle(13, 13, 8.5, { r: 0, g: 0, b: 0, a: 0 });
  },

  palette: (cv) => {
    const prp = HEX_COLORS.purple;
    cv.fillCircle(16, 16, 11, prp);
    // Thumb hole
    cv.fillCircle(20, 20, 3, { r: 0, g: 0, b: 0, a: 0 });
    // Color dots
    cv.fillCircle(11, 10, 2, HEX_COLORS.danger);
    cv.fillCircle(17, 8, 2, HEX_COLORS.warning);
    cv.fillCircle(22, 12, 2, HEX_COLORS.primary);
    cv.fillCircle(10, 16, 2, HEX_COLORS.success);
  },

  package: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Box contour
    cv.drawLine(16, 4, 27, 10, 2, p);
    cv.drawLine(27, 10, 27, 22, 2, p);
    cv.drawLine(27, 22, 16, 28, 2, p);
    cv.drawLine(16, 28, 5, 22, 2, p);
    cv.drawLine(5, 22, 5, 10, 2, p);
    cv.drawLine(5, 10, 16, 4, 2, p);
    // Center fold
    cv.drawLine(16, 4, 16, 16, 2, w);
    cv.drawLine(16, 16, 5, 10, 2, w);
    cv.drawLine(16, 16, 27, 10, 2, w);
    cv.drawLine(16, 16, 16, 28, 2, w);
  },

  edit: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Diagonal pencil
    cv.drawLine(7, 25, 22, 10, 4, p);
    cv.drawLine(22, 10, 25, 7, 4, w);
    cv.drawLine(4, 28, 7, 25, 2.5, HEX_COLORS.warning);
  },

  trash: (cv) => {
    const r = HEX_COLORS.danger;
    const w = HEX_COLORS.white;
    // Lid
    cv.drawLine(7, 8, 25, 8, 2.5, r);
    cv.drawLine(13, 5, 19, 5, 2, r);
    // Can body
    cv.drawLine(9, 10, 10, 26, 2, r);
    cv.drawLine(10, 26, 22, 26, 2, r);
    cv.drawLine(22, 26, 23, 10, 2, r);
    // Inner ribs
    cv.drawLine(13, 12, 13, 23, 1.5, w);
    cv.drawLine(16, 12, 16, 23, 1.5, w);
    cv.drawLine(19, 12, 19, 23, 1.5, w);
  },

  search: (cv) => {
    const p = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    cv.strokeCircle(13, 13, 7.5, 2.5, p);
    cv.drawLine(19, 19, 27, 27, 3.5, w);
  },

  check: (cv) => {
    const g = HEX_COLORS.success;
    const w = HEX_COLORS.white;
    cv.fillCircle(16, 16, 12, g);
    cv.drawLine(9, 16, 14, 21, 3, w);
    cv.drawLine(14, 21, 23, 10, 3, w);
  },

  cross: (cv) => {
    const r = HEX_COLORS.danger;
    const w = HEX_COLORS.white;
    cv.fillCircle(16, 16, 12, r);
    cv.drawLine(10, 10, 22, 22, 3, w);
    cv.drawLine(22, 10, 10, 22, 3, w);
  },

  warning: (cv) => {
    const yl = HEX_COLORS.warning;
    const d = HEX_COLORS.dark;
    // Triangle
    for (let y = 5; y <= 27; y++) {
      const halfW = (y - 5) * 0.55;
      cv.drawLine(16 - halfW, y, 16 + halfW, y, 1.5, yl);
    }
    // Exclamation mark
    cv.drawLine(16, 11, 16, 19, 2.5, d);
    cv.fillCircle(16, 23, 1.6, d);
  },

  docker: (cv) => {
    const b = HEX_COLORS.primary;
    const w = HEX_COLORS.white;
    // Container blocks
    cv.fillRect(8, 11, 4, 3, w);
    cv.fillRect(13, 11, 4, 3, w);
    cv.fillRect(13, 7, 4, 3, w);
    cv.fillRect(18, 11, 4, 3, w);
    // Whale body
    cv.fillCircle(15, 19, 10, b);
    cv.fillRect(5, 14, 20, 8, b);
    // Tail
    cv.fillCircle(25, 15, 4, b);
    // Eye
    cv.fillCircle(8, 18, 1.5, w);
  },

  linux: (cv) => {
    const w = HEX_COLORS.white;
    const yl = HEX_COLORS.warning;
    const d = HEX_COLORS.dark;
    // Penguin body
    cv.fillCircle(16, 13, 7, d);
    cv.fillCircle(16, 20, 9, d);
    // White belly
    cv.fillCircle(16, 20, 6, w);
    // Beak
    cv.drawLine(14, 13, 18, 13, 2, yl);
    cv.fillCircle(16, 15, 1.5, yl);
    // Feet
    cv.fillCircle(11, 27, 3, yl);
    cv.fillCircle(21, 27, 3, yl);
  },

  "status-green": (cv) => {
    const g = HEX_COLORS.success;
    const w = HEX_COLORS.white;
    cv.fillCircle(16, 16, 9, { ...g, a: 80 });
    cv.fillCircle(16, 16, 6, g);
    cv.fillCircle(14, 14, 2, w);
  },

  "status-yellow": (cv) => {
    const yl = HEX_COLORS.warning;
    const w = HEX_COLORS.white;
    cv.fillCircle(16, 16, 9, { ...yl, a: 80 });
    cv.fillCircle(16, 16, 6, yl);
    cv.fillCircle(14, 14, 2, w);
  },

  "status-red": (cv) => {
    const r = HEX_COLORS.danger;
    const w = HEX_COLORS.white;
    cv.fillCircle(16, 16, 9, { ...r, a: 80 });
    cv.fillCircle(16, 16, 6, r);
    cv.fillCircle(14, 14, 2, w);
  },
};

export function generateAllIcons(targetDirs: string[]) {
  for (const dir of targetDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  for (const [name, renderer] of Object.entries(ICON_RENDERERS)) {
    const canvas = new PngCanvas(32, 32);
    renderer(canvas);
    const png = canvas.toPng();

    for (const dir of targetDirs) {
      const outPath = path.join(dir, `${name}.png`);
      fs.writeFileSync(outPath, png);
    }
  }

  console.log(`Successfully generated ${Object.keys(ICON_RENDERERS).length} icons into:`, targetDirs);
}

if (process.argv[1] && process.argv[1].endsWith("generate-icon-pack.ts")) {
  generateAllIcons([
    path.resolve("public/icons"),
    path.resolve("extension/icons"),
    path.resolve("dist/unpacked/icons"),
  ]);
}

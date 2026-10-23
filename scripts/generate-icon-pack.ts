/**
 * Script to generate high-quality 32x32 transparent monochrome PNG icons
 * for PEC Dashboard and Extension UI.
 *
 * Style: Clean, crisp monochrome iOS/Telegram vector outline aesthetic (emoji.wivvi.net style).
 * Emits files to public/icons/ and extension/icons/
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const REPO_ROOT = process.cwd();
const PUBLIC_ICONS = path.join(REPO_ROOT, "public", "icons");
const EXTENSION_ICONS = path.join(REPO_ROOT, "extension", "icons");

fs.mkdirSync(PUBLIC_ICONS, { recursive: true });
fs.mkdirSync(EXTENSION_ICONS, { recursive: true });

function crc32(buf: Buffer): number {
  let table = (globalThis as unknown as { _crcTable?: Uint32Array })._crcTable;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    (globalThis as unknown as { _crcTable?: Uint32Array })._crcTable = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

class Canvas32 {
  width = 32;
  height = 32;
  pixels = Buffer.alloc(32 * 32 * 4); // RGBA

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= 32 || y < 0 || y >= 32 || a <= 0) return;
    const idx = (y * 32 + x) * 4;
    const bgA = this.pixels[idx + 3] / 255;
    const fgA = Math.min(1, Math.max(0, a / 255));
    const outA = fgA + bgA * (1 - fgA);
    if (outA <= 0) return;

    this.pixels[idx] = Math.round((r * fgA + this.pixels[idx] * bgA * (1 - fgA)) / outA);
    this.pixels[idx + 1] = Math.round((g * fgA + this.pixels[idx + 1] * bgA * (1 - fgA)) / outA);
    this.pixels[idx + 2] = Math.round((b * fgA + this.pixels[idx + 2] * bgA * (1 - fgA)) / outA);
    this.pixels[idx + 3] = Math.round(outA * 255);
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        this.setPixel(px, py, r, g, b, a);
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a = 255) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= r2) {
          const edgeDist = radius - Math.sqrt(d2);
          const alpha = edgeDist < 1 ? Math.round(a * Math.max(0, edgeDist)) : a;
          this.setPixel(x, y, r, g, b, alpha);
        }
      }
    }
  }

  strokeCircle(cx: number, cy: number, radius: number, thickness: number, r: number, g: number, b: number, a = 255) {
    const outer = radius + thickness / 2;
    const inner = Math.max(0, radius - thickness / 2);
    for (let y = Math.floor(cy - outer - 1); y <= Math.ceil(cy + outer + 1); y++) {
      for (let x = Math.floor(cx - outer - 1); x <= Math.ceil(cx + outer + 1); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= outer && d >= inner) {
          this.setPixel(x, y, r, g, b, a);
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, thickness: number, r: number, g: number, b: number, a = 255) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      this.fillCircle(x, y, thickness / 2, r, g, b, a);
    }
  }

  fillRoundRect(x: number, y: number, w: number, h: number, radius: number, r: number, g: number, b: number, a = 255) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        let inside = true;
        if (px < x + radius && py < y + radius) {
          inside = (px - (x + radius)) ** 2 + (py - (y + radius)) ** 2 <= radius ** 2;
        } else if (px > x + w - radius && py < y + radius) {
          inside = (px - (x + w - radius)) ** 2 + (py - (y + radius)) ** 2 <= radius ** 2;
        } else if (px < x + radius && py > y + h - radius) {
          inside = (px - (x + radius)) ** 2 + (py - (y + h - radius)) ** 2 <= radius ** 2;
        } else if (px > x + w - radius && py > y + h - radius) {
          inside = (px - (x + w - radius)) ** 2 + (py - (y + h - radius)) ** 2 <= radius ** 2;
        }
        if (inside) this.setPixel(px, py, r, g, b, a);
      }
    }
  }

  strokeRoundRect(x: number, y: number, w: number, h: number, radius: number, thickness: number, r: number, g: number, b: number, a = 255) {
    this.drawLine(x + radius, y, x + w - radius, y, thickness, r, g, b, a);
    this.drawLine(x + radius, y + h, x + w - radius, y + h, thickness, r, g, b, a);
    this.drawLine(x, y + radius, x, y + h - radius, thickness, r, g, b, a);
    this.drawLine(x + w, y + radius, x + w, y + h - radius, thickness, r, g, b, a);
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

    const rowSize = 1 + this.width * 4;
    const raw = Buffer.alloc(this.height * rowSize);
    for (let y = 0; y < this.height; y++) {
      raw[y * rowSize] = 0;
      for (let x = 0; x < this.width; x++) {
        const srcIdx = (y * this.width + x) * 4;
        const dstIdx = y * rowSize + 1 + x * 4;
        raw[dstIdx] = this.pixels[srcIdx];
        raw[dstIdx + 1] = this.pixels[srcIdx + 1];
        raw[dstIdx + 2] = this.pixels[srcIdx + 2];
        raw[dstIdx + 3] = this.pixels[srcIdx + 3];
      }
    }

    const idat = zlib.deflateSync(raw);
    return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
  }
}

// Crisp Monochrome Tone (242, 246, 252 - iOS white/silver vector line style)
const W = 242;
const G = 246;
const B = 252;
const MUTED_ALPHA = 160;

// Monochrome Icon Definitions
const icons: Record<string, (c: Canvas32) => void> = {
  // 1. Plug (Connection)
  "plug.png": (c) => {
    c.fillRect(10, 4, 3, 7, W, G, B, 240);
    c.fillRect(19, 4, 3, 7, W, G, B, 240);
    c.fillRoundRect(7, 10, 18, 12, 3, W, G, B, 240);
    c.drawLine(16, 22, 16, 29, 3, W, G, B, 240);
  },

  // 2. Sync (Refresh)
  "sync.png": (c) => {
    c.strokeCircle(16, 16, 9, 2.5, W, G, B, 240);
    c.fillRect(16, 5, 8, 5, 0, 0, 0, 0);
    c.fillRect(8, 22, 8, 5, 0, 0, 0, 0);
    c.drawLine(21, 6, 24, 11, 2.5, W, G, B, 240);
    c.drawLine(24, 11, 18, 12, 2.5, W, G, B, 240);
    c.drawLine(11, 26, 8, 21, 2.5, W, G, B, 240);
    c.drawLine(8, 21, 14, 20, 2.5, W, G, B, 240);
  },

  // 3. Power (Standby)
  "power.png": (c) => {
    c.strokeCircle(16, 17, 9, 2.5, W, G, B, 240);
    c.fillRect(13, 6, 6, 8, 0, 0, 0, 0);
    c.drawLine(16, 5, 16, 16, 2.5, W, G, B, 240);
  },

  // 4. Pause
  "pause.png": (c) => {
    c.fillRoundRect(9, 7, 4, 18, 2, W, G, B, 240);
    c.fillRoundRect(19, 7, 4, 18, 2, W, G, B, 240);
  },

  // 5. Sun (Light theme)
  "sun.png": (c) => {
    c.strokeCircle(16, 16, 6, 2, W, G, B, 240);
    const rays = [[16, 3], [16, 29], [3, 16], [29, 16], [7, 7], [25, 25], [7, 25], [25, 7]];
    for (const [rx, ry] of rays) {
      c.drawLine(16, 16, rx, ry, 2, W, G, B, 240);
    }
    c.fillCircle(16, 16, 5, 0, 0, 0, 0); // clear center hole
    c.strokeCircle(16, 16, 5, 1.8, W, G, B, 240);
  },

  // 6. Moon (Dark theme)
  "moon.png": (c) => {
    c.fillCircle(16, 16, 10, W, G, B, 240);
    c.fillCircle(20, 13, 8.5, 0, 0, 0, 0);
  },

  // 7. Bolt (Lightning)
  "bolt.png": (c) => {
    c.drawLine(18, 4, 11, 16, 2.5, W, G, B, 240);
    c.drawLine(11, 16, 18, 16, 2.5, W, G, B, 240);
    c.drawLine(18, 16, 13, 28, 2.5, W, G, B, 240);
  },

  // 8. Routing (Branching lines)
  "routing.png": (c) => {
    c.drawLine(5, 24, 14, 10, 2.5, W, G, B, 240);
    c.drawLine(14, 10, 24, 10, 2.5, W, G, B, 240);
    c.drawLine(5, 8, 14, 22, 2.5, W, G, B, 240);
    c.drawLine(14, 22, 24, 22, 2.5, W, G, B, 240);
    c.drawLine(21, 6, 26, 10, 2.5, W, G, B, 240);
    c.drawLine(21, 14, 26, 10, 2.5, W, G, B, 240);
    c.drawLine(21, 18, 26, 22, 2.5, W, G, B, 240);
    c.drawLine(21, 26, 26, 22, 2.5, W, G, B, 240);
  },

  // 9. Info / Diagnostics (Bar chart)
  "info.png": (c) => {
    c.fillRoundRect(6, 18, 4, 9, 1, W, G, B, 180);
    c.fillRoundRect(14, 12, 4, 15, 1, W, G, B, 220);
    c.fillRoundRect(22, 6, 4, 21, 1, W, G, B, 250);
  },

  // 10. Globe (World/IP)
  "globe.png": (c) => {
    c.strokeCircle(16, 16, 11, 2, W, G, B, 240);
    c.drawLine(5, 16, 27, 16, 1.8, W, G, B, 240);
    c.drawLine(16, 5, 16, 27, 1.8, W, G, B, 240);
    c.strokeCircle(16, 16, 6, 1.5, W, G, B, 200);
  },

  // 11. Clock (Latency / Ping)
  "clock.png": (c) => {
    c.strokeCircle(16, 16, 11, 2, W, G, B, 240);
    c.drawLine(16, 16, 16, 9, 2, W, G, B, 240);
    c.drawLine(16, 16, 22, 16, 2, W, G, B, 240);
  },

  // 12. Headset (Support)
  "headset.png": (c) => {
    c.strokeCircle(16, 15, 9, 2.5, W, G, B, 240);
    c.fillRect(6, 15, 20, 12, 0, 0, 0, 0);
    c.fillRoundRect(5, 13, 4, 8, 2, W, G, B, 240);
    c.fillRoundRect(23, 13, 4, 8, 2, W, G, B, 240);
    c.drawLine(23, 19, 18, 25, 2, W, G, B, 240);
    c.fillCircle(17, 25, 2, W, G, B, 240);
  },

  // 13. Copy (Clipboard)
  "copy.png": (c) => {
    c.strokeRoundRect(6, 6, 13, 16, 2, 2, W, G, B, 160);
    c.fillRoundRect(12, 10, 14, 16, 2, W, G, B, 240);
  },

  // 14. Trash (Delete / Clear)
  "trash.png": (c) => {
    c.drawLine(7, 9, 25, 9, 2, W, G, B, 240);
    c.fillRoundRect(13, 6, 6, 3, 1, W, G, B, 240);
    c.fillRoundRect(10, 11, 12, 16, 2, W, G, B, 240);
    c.drawLine(13, 14, 13, 23, 1.5, 10, 15, 25);
    c.drawLine(16, 14, 16, 23, 1.5, 10, 15, 25);
    c.drawLine(19, 14, 19, 23, 1.5, 10, 15, 25);
  },

  // 15. Check (Success)
  "check.png": (c) => {
    c.drawLine(8, 16, 14, 22, 3, W, G, B, 240);
    c.drawLine(14, 22, 25, 9, 3, W, G, B, 240);
  },

  // 16. Cross (Error/Remove)
  "cross.png": (c) => {
    c.drawLine(8, 8, 24, 24, 3, W, G, B, 240);
    c.drawLine(24, 8, 8, 24, 3, W, G, B, 240);
  },

  // 17. Warning (Triangle)
  "warning.png": (c) => {
    c.drawLine(16, 5, 5, 26, 2.5, W, G, B, 240);
    c.drawLine(5, 26, 27, 26, 2.5, W, G, B, 240);
    c.drawLine(27, 26, 16, 5, 2.5, W, G, B, 240);
    c.drawLine(16, 12, 16, 19, 2.5, W, G, B, 240);
    c.fillCircle(16, 23, 1.5, W, G, B, 240);
  },

  // 18. Shield (Security)
  "shield.png": (c) => {
    c.fillRoundRect(7, 5, 18, 14, 3, W, G, B, 240);
    for (let y = 16; y <= 27; y++) {
      const halfW = Math.max(1, Math.round(9 * (1 - (y - 16) / 12)));
      c.fillRect(16 - halfW, y, halfW * 2, 1, W, G, B, 240);
    }
    // Inner cutout
    c.drawLine(12, 14, 15, 18, 2.5, 10, 15, 25);
    c.drawLine(15, 18, 21, 11, 2.5, 10, 15, 25);
  },

  // 19. Server (Nodes / Stack)
  "server.png": (c) => {
    c.fillRoundRect(5, 5, 22, 6, 2, W, G, B, 240);
    c.fillRoundRect(5, 13, 22, 6, 2, W, G, B, 240);
    c.fillRoundRect(5, 21, 22, 6, 2, W, G, B, 240);
    c.fillCircle(9, 8, 1.5, 10, 15, 25);
    c.fillCircle(9, 16, 1.5, 10, 15, 25);
    c.fillCircle(9, 24, 1.5, 10, 15, 25);
  },

  // 20. Devices (Laptop)
  "devices.png": (c) => {
    c.fillRoundRect(7, 6, 18, 14, 2, W, G, B, 240);
    c.fillRoundRect(9, 8, 14, 10, 1, 10, 15, 25);
    c.fillRoundRect(4, 21, 24, 4, 2, W, G, B, 240);
  },

  // 21. Palette (Studio / Design)
  "palette.png": (c) => {
    c.strokeCircle(16, 16, 11, 2.2, W, G, B, 240);
    c.fillCircle(12, 12, 2, W, G, B, 240);
    c.fillCircle(18, 10, 2, W, G, B, 240);
    c.fillCircle(22, 15, 2, W, G, B, 240);
    c.fillCircle(13, 19, 2.5, W, G, B, 240);
  },

  // 22. Logs (Audit / Scroll)
  "logs.png": (c) => {
    c.strokeRoundRect(7, 5, 18, 22, 2, 2, W, G, B, 240);
    c.drawLine(11, 10, 21, 10, 1.8, W, G, B, 240);
    c.drawLine(11, 14, 19, 14, 1.8, W, G, B, 240);
    c.drawLine(11, 18, 21, 18, 1.8, W, G, B, 240);
    c.drawLine(11, 22, 16, 22, 1.8, W, G, B, 240);
  },

  // 23. Bot (AI)
  "bot.png": (c) => {
    c.drawLine(16, 3, 16, 7, 2, W, G, B, 240);
    c.fillCircle(16, 4, 1.5, W, G, B, 240);
    c.strokeRoundRect(6, 8, 20, 18, 4, 2, W, G, B, 240);
    c.fillCircle(12, 16, 2, W, G, B, 240);
    c.fillCircle(20, 16, 2, W, G, B, 240);
    c.drawLine(13, 21, 19, 21, 1.8, W, G, B, 240);
  },

  // 24. Building (Corporate)
  "building.png": (c) => {
    c.strokeRoundRect(7, 5, 18, 23, 2, 2, W, G, B, 240);
    for (let wy = 8; wy <= 18; wy += 5) {
      c.fillRect(10, wy, 3, 2, W, G, B, 240);
      c.fillRect(15, wy, 3, 2, W, G, B, 240);
      c.fillRect(20, wy, 3, 2, W, G, B, 240);
    }
    c.fillRect(14, 22, 4, 6, W, G, B, 240);
  },

  // 25. Flag RU (Geo Russia)
  "flag-ru.png": (c) => {
    c.strokeRoundRect(5, 7, 22, 18, 2, 1.8, W, G, B, 240);
    c.drawLine(5, 13, 27, 13, 1.5, W, G, B, MUTED_ALPHA);
    c.drawLine(5, 19, 27, 19, 1.5, W, G, B, MUTED_ALPHA);
  },

  // 26. Download
  "download.png": (c) => {
    c.drawLine(16, 6, 16, 20, 2.5, W, G, B, 240);
    c.drawLine(10, 15, 16, 21, 2.5, W, G, B, 240);
    c.drawLine(22, 15, 16, 21, 2.5, W, G, B, 240);
    c.drawLine(7, 26, 25, 26, 2.5, W, G, B, 240);
  },

  // 27. Upload
  "upload.png": (c) => {
    c.drawLine(16, 20, 16, 6, 2.5, W, G, B, 240);
    c.drawLine(10, 11, 16, 5, 2.5, W, G, B, 240);
    c.drawLine(22, 11, 16, 5, 2.5, W, G, B, 240);
    c.drawLine(7, 26, 25, 26, 2.5, W, G, B, 240);
  },

  // 28. Search (Inspector)
  "search.png": (c) => {
    c.strokeCircle(13, 13, 7, 2.5, W, G, B, 240);
    c.drawLine(18, 18, 26, 26, 3, W, G, B, 240);
  },

  // 29. Edit (Pencil)
  "edit.png": (c) => {
    c.drawLine(8, 24, 24, 8, 3, W, G, B, 240);
    c.fillCircle(6, 26, 1.8, W, G, B, 240);
    c.fillCircle(25, 7, 1.8, W, G, B, 240);
  },

  // 30. Status Green (Active)
  "status-green.png": (c) => {
    c.fillCircle(16, 16, 9, 16, 185, 129, 60);
    c.fillCircle(16, 16, 5, 16, 185, 129, 255);
  },

  // 31. Status Red (Error)
  "status-red.png": (c) => {
    c.fillCircle(16, 16, 9, 239, 68, 68, 60);
    c.fillCircle(16, 16, 5, 239, 68, 68, 255);
  },

  // 32. Status Yellow (Bypass/Warning)
  "status-yellow.png": (c) => {
    c.fillCircle(16, 16, 9, 245, 158, 11, 60);
    c.fillCircle(16, 16, 5, 245, 158, 11, 255);
  },

  // 33. Arrow Up
  "arrow-up.png": (c) => {
    c.drawLine(16, 8, 8, 18, 2.5, W, G, B, 240);
    c.drawLine(16, 8, 24, 18, 2.5, W, G, B, 240);
  },

  // 34. Arrow Down
  "arrow-down.png": (c) => {
    c.drawLine(8, 14, 16, 24, 2.5, W, G, B, 240);
    c.drawLine(24, 14, 16, 24, 2.5, W, G, B, 240);
  },

  // 35. Plus
  "plus.png": (c) => {
    c.drawLine(8, 16, 24, 16, 2.5, W, G, B, 240);
    c.drawLine(16, 8, 16, 24, 2.5, W, G, B, 240);
  },

  // 36. Lock
  "lock.png": (c) => {
    c.strokeCircle(16, 12, 5, 2, W, G, B, 240);
    c.fillRect(10, 12, 12, 5, 0, 0, 0, 0);
    c.fillRoundRect(8, 14, 16, 13, 2, W, G, B, 240);
    c.fillCircle(16, 19, 2, 10, 15, 25);
    c.drawLine(16, 19, 16, 23, 1.5, 10, 15, 25);
  },

  // 37. Key
  "key.png": (c) => {
    c.strokeCircle(10, 12, 5, 2, W, G, B, 240);
    c.drawLine(14, 14, 25, 25, 2.2, W, G, B, 240);
    c.drawLine(21, 21, 24, 18, 2, W, G, B, 240);
    c.drawLine(24, 24, 27, 21, 2, W, G, B, 240);
  },

  // 38. Docker (Whale / Container)
  "docker.png": (c) => {
    c.fillRoundRect(5, 14, 22, 10, 4, W, G, B, 240);
    c.drawLine(6, 17, 2, 12, 2.2, W, G, B, 240);
    c.strokeRoundRect(10, 8, 4, 4, 1, 1.2, W, G, B, 240);
    c.strokeRoundRect(15, 8, 4, 4, 1, 1.2, W, G, B, 240);
    c.strokeRoundRect(12, 4, 4, 4, 1, 1.2, W, G, B, 240);
  },

  // 39. Linux (Terminal prompt)
  "linux.png": (c) => {
    c.strokeRoundRect(4, 6, 24, 20, 2, 2, W, G, B, 240);
    c.drawLine(8, 12, 13, 16, 2, W, G, B, 240);
    c.drawLine(13, 16, 8, 20, 2, W, G, B, 240);
    c.drawLine(15, 20, 22, 20, 2, W, G, B, 240);
  },

  // 40. Ghost (Stealth)
  "ghost.png": (c) => {
    c.fillRoundRect(8, 6, 16, 18, 8, W, G, B, 240);
    c.fillCircle(12, 12, 1.8, 10, 15, 25);
    c.fillCircle(20, 12, 1.8, 10, 15, 25);
    c.fillRect(9, 22, 3, 4, W, G, B, 240);
    c.fillRect(14, 22, 4, 4, W, G, B, 240);
    c.fillRect(20, 22, 3, 4, W, G, B, 240);
  },

  // 41. User (Profile)
  "user.png": (c) => {
    c.fillCircle(16, 10, 5, W, G, B, 240);
    c.fillRoundRect(7, 18, 18, 9, 4, W, G, B, 240);
  },

  // 42. Folder
  "folder.png": (c) => {
    c.fillRoundRect(6, 7, 8, 5, 1, W, G, B, 240);
    c.fillRoundRect(6, 10, 20, 15, 2, W, G, B, 240);
    c.fillRect(8, 12, 16, 2, 10, 15, 25);
  }
};

let count = 0;
for (const [name, draw] of Object.entries(icons)) {
  const canvas = new Canvas32();
  draw(canvas);
  const png = canvas.toPng();
  fs.writeFileSync(path.join(PUBLIC_ICONS, name), png);
  fs.writeFileSync(path.join(EXTENSION_ICONS, name), png);
  count++;
}

console.log(`Successfully generated ${count} monochrome PNG icons in public/icons/ and extension/icons/`);

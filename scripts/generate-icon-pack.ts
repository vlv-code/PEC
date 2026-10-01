/**
 * Script to generate high-quality 32x32 transparent PNG icons
 * for PEC Dashboard and Extension UI.
 *
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

// Icon Definitions
const icons: Record<string, (c: Canvas32) => void> = {
  // 1. Plug (Connection)
  "plug.png": (c) => {
    // Two prongs
    c.fillRect(10, 4, 3, 7, 14, 165, 233);
    c.fillRect(19, 4, 3, 7, 14, 165, 233);
    // Plug body
    c.fillRoundRect(7, 10, 18, 12, 4, 14, 165, 233);
    // Cable
    c.drawLine(16, 22, 16, 29, 3, 14, 165, 233);
  },

  // 2. Sync (Refresh)
  "sync.png": (c) => {
    // Circular arc
    c.strokeCircle(16, 16, 9, 2.5, 56, 189, 248);
    // Open gap on top-right and bottom-left
    c.fillRect(16, 5, 8, 5, 0, 0, 0, 0);
    c.fillRect(8, 22, 8, 5, 0, 0, 0, 0);
    // Arrowheads
    c.drawLine(21, 6, 24, 11, 2.5, 56, 189, 248);
    c.drawLine(24, 11, 18, 12, 2.5, 56, 189, 248);
    c.drawLine(11, 26, 8, 21, 2.5, 56, 189, 248);
    c.drawLine(8, 21, 14, 20, 2.5, 56, 189, 248);
  },

  // 3. Power (Standby)
  "power.png": (c) => {
    // Circle arc
    c.strokeCircle(16, 17, 9, 2.5, 239, 68, 68);
    // Clear top
    c.fillRect(13, 6, 6, 8, 0, 0, 0, 0);
    // Top vertical power pin
    c.drawLine(16, 5, 16, 16, 2.5, 239, 68, 68);
  },

  // 4. Pause
  "pause.png": (c) => {
    c.fillRoundRect(9, 7, 4, 18, 2, 245, 158, 11);
    c.fillRoundRect(19, 7, 4, 18, 2, 245, 158, 11);
  },

  // 5. Sun (Light theme)
  "sun.png": (c) => {
    c.fillCircle(16, 16, 6, 251, 191, 36);
    // 8 rays
    const rays = [[16, 4], [16, 28], [4, 16], [28, 16], [7, 7], [25, 25], [7, 25], [25, 7]];
    for (const [rx, ry] of rays) {
      c.drawLine(16, 16, rx, ry, 2, 251, 191, 36);
    }
  },

  // 6. Moon (Dark theme)
  "moon.png": (c) => {
    c.fillCircle(16, 16, 10, 168, 85, 247);
    // Mask crescent
    c.fillCircle(20, 13, 8.5, 0, 0, 0, 0);
  },

  // 7. Bolt (Lightning)
  "bolt.png": (c) => {
    // Sharp lightning bolt
    c.drawLine(18, 4, 11, 16, 3, 234, 179, 8);
    c.drawLine(11, 16, 18, 16, 3, 234, 179, 8);
    c.drawLine(18, 16, 13, 28, 3, 234, 179, 8);
  },

  // 8. Routing (Branching arrows)
  "routing.png": (c) => {
    // Upper path
    c.drawLine(5, 24, 14, 10, 2.5, 59, 130, 246);
    c.drawLine(14, 10, 24, 10, 2.5, 59, 130, 246);
    // Lower path
    c.drawLine(5, 8, 14, 22, 2.5, 16, 185, 129);
    c.drawLine(14, 22, 24, 22, 2.5, 16, 185, 129);
    // Top arrowhead
    c.drawLine(21, 6, 26, 10, 2.5, 59, 130, 246);
    c.drawLine(21, 14, 26, 10, 2.5, 59, 130, 246);
    // Bottom arrowhead
    c.drawLine(21, 18, 26, 22, 2.5, 16, 185, 129);
    c.drawLine(21, 26, 26, 22, 2.5, 16, 185, 129);
  },

  // 9. Info / Diagnostics (Bar chart)
  "info.png": (c) => {
    c.fillRoundRect(6, 18, 4, 9, 1, 99, 102, 241);
    c.fillRoundRect(14, 12, 4, 15, 1, 139, 92, 246);
    c.fillRoundRect(22, 6, 4, 21, 1, 236, 72, 153);
  },

  // 10. Globe (World/IP)
  "globe.png": (c) => {
    c.strokeCircle(16, 16, 11, 2, 14, 165, 233);
    c.drawLine(5, 16, 27, 16, 2, 14, 165, 233);
    c.drawLine(16, 5, 16, 27, 2, 14, 165, 233);
    // Ellipse meridian
    c.strokeCircle(16, 16, 6, 1.5, 14, 165, 233);
  },

  // 11. Clock (Latency / Ping)
  "clock.png": (c) => {
    c.strokeCircle(16, 17, 10, 2, 20, 184, 166);
    c.drawLine(16, 3, 16, 7, 2, 20, 184, 166);
    c.drawLine(16, 17, 16, 11, 2, 20, 184, 166);
    c.drawLine(16, 17, 21, 17, 2, 20, 184, 166);
  },

  // 12. Headset (Support)
  "headset.png": (c) => {
    // Headband
    c.strokeCircle(16, 15, 9, 2.5, 168, 85, 247);
    c.fillRect(6, 15, 20, 12, 0, 0, 0, 0); // cut bottom
    // Ear pads
    c.fillRoundRect(5, 13, 4, 8, 2, 168, 85, 247);
    c.fillRoundRect(23, 13, 4, 8, 2, 168, 85, 247);
    // Mic stem & tip
    c.drawLine(23, 19, 18, 25, 2, 168, 85, 247);
    c.fillCircle(17, 25, 2, 168, 85, 247);
  },

  // 13. Copy (Clipboard)
  "copy.png": (c) => {
    // Back page
    c.fillRoundRect(6, 6, 13, 16, 2, 100, 116, 139);
    // Front page
    c.fillRoundRect(12, 10, 14, 17, 2, 226, 232, 240);
  },

  // 14. Trash (Delete / Clear)
  "trash.png": (c) => {
    // Lid
    c.drawLine(8, 9, 24, 9, 2, 239, 68, 68);
    c.fillRoundRect(13, 6, 6, 3, 1, 239, 68, 68);
    // Body
    c.fillRoundRect(10, 11, 12, 16, 2, 239, 68, 68);
    // Slits
    c.drawLine(13, 14, 13, 23, 1.5, 255, 255, 255);
    c.drawLine(16, 14, 16, 23, 1.5, 255, 255, 255);
    c.drawLine(19, 14, 19, 23, 1.5, 255, 255, 255);
  },

  // 15. Check (Success)
  "check.png": (c) => {
    c.fillCircle(16, 16, 12, 16, 185, 129);
    c.drawLine(10, 16, 14, 21, 3, 255, 255, 255);
    c.drawLine(14, 21, 23, 11, 3, 255, 255, 255);
  },

  // 16. Cross (Error/Remove)
  "cross.png": (c) => {
    c.fillCircle(16, 16, 12, 239, 68, 68);
    c.drawLine(11, 11, 21, 21, 3, 255, 255, 255);
    c.drawLine(21, 11, 11, 21, 3, 255, 255, 255);
  },

  // 17. Warning (Triangle)
  "warning.png": (c) => {
    // Triangle
    c.drawLine(16, 5, 6, 26, 3, 245, 158, 11);
    c.drawLine(6, 26, 26, 26, 3, 245, 158, 11);
    c.drawLine(26, 26, 16, 5, 3, 245, 158, 11);
    c.fillCircle(16, 15, 3, 245, 158, 11);
    // Exclamation mark
    c.drawLine(16, 12, 16, 18, 2, 255, 255, 255);
    c.fillCircle(16, 22, 1.5, 255, 255, 255);
  },

  // 18. Shield (Security)
  "shield.png": (c) => {
    // Outer shield
    c.fillRoundRect(7, 5, 18, 14, 4, 16, 185, 129);
    // Triangle bottom
    for (let y = 16; y <= 27; y++) {
      const halfW = Math.max(1, Math.round(9 * (1 - (y - 16) / 12)));
      c.fillRect(16 - halfW, y, halfW * 2, 1, 16, 185, 129);
    }
    // Inner checkmark
    c.drawLine(12, 14, 15, 18, 2.5, 255, 255, 255);
    c.drawLine(15, 18, 21, 11, 2.5, 255, 255, 255);
  },

  // 19. Server (Nodes / Stack)
  "server.png": (c) => {
    // 3 rack units
    c.fillRoundRect(5, 5, 22, 6, 2, 56, 189, 248);
    c.fillRoundRect(5, 13, 22, 6, 2, 56, 189, 248);
    c.fillRoundRect(5, 21, 22, 6, 2, 56, 189, 248);
    // Status LEDs
    c.fillCircle(9, 8, 1.5, 16, 185, 129);
    c.fillCircle(9, 16, 1.5, 16, 185, 129);
    c.fillCircle(9, 24, 1.5, 16, 185, 129);
  },

  // 20. Devices (Laptop)
  "devices.png": (c) => {
    // Screen
    c.fillRoundRect(7, 6, 18, 14, 2, 148, 163, 184);
    c.fillRoundRect(9, 8, 14, 10, 1, 15, 23, 42);
    // Base
    c.fillRoundRect(4, 21, 24, 4, 2, 148, 163, 184);
  },

  // 21. Palette (Studio / Design)
  "palette.png": (c) => {
    c.fillCircle(16, 16, 11, 244, 114, 182);
    // Thumb hole
    c.fillCircle(19, 19, 3, 0, 0, 0, 0);
    // Color dots
    c.fillCircle(11, 11, 2, 239, 68, 68);
    c.fillCircle(17, 9, 2, 234, 179, 8);
    c.fillCircle(22, 13, 2, 59, 130, 246);
    c.fillCircle(11, 17, 2, 16, 185, 129);
  },

  // 22. Logs (Audit / Scroll)
  "logs.png": (c) => {
    c.fillRoundRect(7, 5, 18, 22, 2, 203, 213, 225);
    // Text lines
    c.drawLine(10, 10, 22, 10, 1.5, 71, 85, 105);
    c.drawLine(10, 14, 20, 14, 1.5, 71, 85, 105);
    c.drawLine(10, 18, 22, 18, 1.5, 71, 85, 105);
    c.drawLine(10, 22, 16, 22, 1.5, 71, 85, 105);
  },

  // 23. Bot (AI)
  "bot.png": (c) => {
    // Antenna
    c.drawLine(16, 3, 16, 7, 2, 168, 85, 247);
    c.fillCircle(16, 4, 2, 168, 85, 247);
    // Head
    c.fillRoundRect(6, 8, 20, 18, 4, 168, 85, 247);
    // Eyes
    c.fillCircle(11, 16, 2.5, 255, 255, 255);
    c.fillCircle(21, 16, 2.5, 255, 255, 255);
    // Smile
    c.drawLine(12, 21, 20, 21, 1.5, 255, 255, 255);
  },

  // 24. Building (Corporate)
  "building.png": (c) => {
    c.fillRoundRect(7, 5, 18, 23, 2, 100, 116, 139);
    // Windows
    for (let wy = 8; wy <= 20; wy += 4) {
      c.fillRect(10, wy, 3, 2, 255, 255, 255);
      c.fillRect(15, wy, 3, 2, 255, 255, 255);
      c.fillRect(20, wy, 3, 2, 255, 255, 255);
    }
    // Door
    c.fillRect(14, 22, 4, 6, 203, 213, 225);
  },

  // 25. Flag RU (Geo Russia)
  "flag-ru.png": (c) => {
    c.fillRoundRect(5, 7, 22, 18, 3, 255, 255, 255);
    c.fillRect(5, 13, 22, 6, 0, 57, 166);
    c.fillRect(5, 19, 22, 6, 213, 43, 30);
  },

  // 26. Download
  "download.png": (c) => {
    c.drawLine(16, 6, 16, 20, 3, 59, 130, 246);
    c.drawLine(10, 15, 16, 21, 3, 59, 130, 246);
    c.drawLine(22, 15, 16, 21, 3, 59, 130, 246);
    c.drawLine(7, 26, 25, 26, 3, 59, 130, 246);
  },

  // 27. Upload
  "upload.png": (c) => {
    c.drawLine(16, 20, 16, 6, 3, 16, 185, 129);
    c.drawLine(10, 11, 16, 5, 3, 16, 185, 129);
    c.drawLine(22, 11, 16, 5, 3, 16, 185, 129);
    c.drawLine(7, 26, 25, 26, 3, 16, 185, 129);
  },

  // 28. Search (Inspector)
  "search.png": (c) => {
    c.strokeCircle(13, 13, 7, 2.5, 56, 189, 248);
    c.drawLine(18, 18, 26, 26, 3, 56, 189, 248);
  },

  // 29. Edit (Pencil)
  "edit.png": (c) => {
    c.drawLine(8, 24, 24, 8, 3.5, 245, 158, 11);
    c.fillCircle(6, 26, 2, 245, 158, 11);
    c.fillCircle(25, 7, 2, 245, 158, 11);
  },

  // 30. Status Green (Active)
  "status-green.png": (c) => {
    c.fillCircle(16, 16, 10, 16, 185, 129, 60);
    c.fillCircle(16, 16, 6, 16, 185, 129, 255);
  },

  // 31. Status Red (Error)
  "status-red.png": (c) => {
    c.fillCircle(16, 16, 10, 239, 68, 68, 60);
    c.fillCircle(16, 16, 6, 239, 68, 68, 255);
  },

  // 32. Status Yellow (Bypass/Warning)
  "status-yellow.png": (c) => {
    c.fillCircle(16, 16, 10, 245, 158, 11, 60);
    c.fillCircle(16, 16, 6, 245, 158, 11, 255);
  },

  // 33. Arrow Up
  "arrow-up.png": (c) => {
    c.drawLine(16, 8, 8, 18, 3, 226, 232, 240);
    c.drawLine(16, 8, 24, 18, 3, 226, 232, 240);
  },

  // 34. Arrow Down
  "arrow-down.png": (c) => {
    c.drawLine(8, 14, 16, 24, 3, 226, 232, 240);
    c.drawLine(24, 14, 16, 24, 3, 226, 232, 240);
  },

  // 35. Plus
  "plus.png": (c) => {
    c.fillCircle(16, 16, 12, 14, 165, 233);
    c.drawLine(10, 16, 22, 16, 2.5, 255, 255, 255);
    c.drawLine(16, 10, 16, 22, 2.5, 255, 255, 255);
  },

  // 36. Lock
  "lock.png": (c) => {
    // Shackle
    c.strokeCircle(16, 12, 5, 2, 245, 158, 11);
    c.fillRect(10, 12, 12, 5, 0, 0, 0, 0);
    // Body
    c.fillRoundRect(8, 14, 16, 13, 2, 245, 158, 11);
    // Keyhole
    c.fillCircle(16, 19, 2, 0, 0, 0);
    c.drawLine(16, 19, 16, 23, 1.5, 0, 0, 0);
  },

  // 37. Key
  "key.png": (c) => {
    // Ring
    c.strokeCircle(10, 12, 5, 2, 234, 179, 8);
    // Shaft
    c.drawLine(14, 14, 25, 25, 2.5, 234, 179, 8);
    // Teeth
    c.drawLine(21, 21, 24, 18, 2, 234, 179, 8);
    c.drawLine(24, 24, 27, 21, 2, 234, 179, 8);
  },

  // 38. Docker (Whale with containers)
  "docker.png": (c) => {
    // Whale body
    c.fillRoundRect(5, 14, 22, 10, 4, 14, 165, 233);
    // Tail
    c.drawLine(6, 17, 2, 12, 2.5, 14, 165, 233);
    // Containers
    c.fillRect(10, 8, 4, 4, 56, 189, 248);
    c.fillRect(15, 8, 4, 4, 56, 189, 248);
    c.fillRect(12, 4, 4, 4, 56, 189, 248);
  },

  // 39. Linux (Penguin)
  "linux.png": (c) => {
    // Body
    c.fillRoundRect(9, 7, 14, 19, 6, 226, 232, 240);
    // Outer black
    c.strokeCircle(16, 16, 9, 2, 15, 23, 42);
    // Beak & Feet
    c.fillCircle(16, 12, 2, 245, 158, 11);
    c.fillRect(11, 25, 4, 2, 245, 158, 11);
    c.fillRect(17, 25, 4, 2, 245, 158, 11);
  },

  // 40. Ghost (Stealth)
  "ghost.png": (c) => {
    // Head & Body
    c.fillRoundRect(8, 6, 16, 18, 8, 203, 213, 225);
    // Eyes
    c.fillCircle(12, 12, 1.5, 15, 23, 42);
    c.fillCircle(20, 12, 1.5, 15, 23, 42);
    // Skirt waves
    c.fillRect(9, 22, 3, 4, 203, 213, 225);
    c.fillRect(14, 22, 4, 4, 203, 213, 225);
    c.fillRect(20, 22, 3, 4, 203, 213, 225);
  },

  // 41. User (Profile)
  "user.png": (c) => {
    // Head
    c.fillCircle(16, 10, 5, 148, 163, 184);
    // Shoulders
    c.fillRoundRect(7, 18, 18, 9, 4, 148, 163, 184);
  },

  // 42. Folder
  "folder.png": (c) => {
    // Tab
    c.fillRoundRect(6, 7, 8, 5, 1, 245, 158, 11);
    // Body
    c.fillRoundRect(6, 10, 20, 15, 2, 245, 158, 11);
    // Inner fold
    c.fillRect(8, 12, 16, 2, 251, 191, 36);
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

console.log(`Successfully generated ${count} PNG icons in public/icons/ and extension/icons/`);

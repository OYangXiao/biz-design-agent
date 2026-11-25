// 纯 Node.js（node:zlib）8-bit RGB/RGBA PNG 解码、编码与像素级视觉对图引擎（零 Pillow / 零原生编译）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from './zip.mjs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('不是有效的 PNG 图片');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) break;

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`暂仅支持 8-bit 非交错 RGB/RGBA PNG（收到 bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}）`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const inRow = y * (stride + 1);
    const filter = inflated[inRow];
    const outRow = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inRow + 1 + x];
      const left = x >= bpp ? recon[outRow + x - bpp] : 0;
      const up = y > 0 ? recon[outRow - stride + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? recon[outRow - stride + x - bpp] : 0;
      let val = raw;
      if (filter === 1) val = (raw + left) & 0xFF;
      else if (filter === 2) val = (raw + up) & 0xFF;
      else if (filter === 3) val = (raw + ((left + up) >> 1)) & 0xFF;
      else if (filter === 4) val = (raw + paeth(left, up, upLeft)) & 0xFF;
      recon[outRow + x] = val;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  if (bpp === 4) {
    recon.copy(rgba);
  } else {
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i];
      rgba[j + 1] = recon[i + 1];
      rgba[j + 2] = recon[i + 2];
      rgba[j + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/**
 * 视觉还原对图：严格校验尺寸一致（不强拉伸），支持动态区域遮罩（masks: [{x,y,w,h,reason}]），输出差异热力图。
 */
export function visualDiffPng({ baselinePath, actualPath, outDiffPath = null, threshold = 8, masks = [] }) {
  const base = decodePng(fs.readFileSync(path.resolve(baselinePath)));
  const act = decodePng(fs.readFileSync(path.resolve(actualPath)));

  if (base.width !== act.width || base.height !== act.height) {
    return {
      ok: false,
      dimensionMismatch: true,
      baseline: { width: base.width, height: base.height },
      actual: { width: act.width, height: act.height },
      error: `尺寸不一致（基准 ${base.width}×${base.height}，实测 ${act.width}×${act.height}），按规范不强行拉伸`,
    };
  }

  const { width, height } = base;
  const totalPixels = width * height;
  const diffRgba = Buffer.alloc(totalPixels * 4);
  let diffPixels = 0;
  let maskedPixels = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;

  const inMask = (x, y) => masks.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (masks.length && inMask(x, y)) {
        maskedPixels++;
        diffRgba[idx] = 203; diffRgba[idx + 1] = 213; diffRgba[idx + 2] = 225; diffRgba[idx + 3] = 255;
        continue;
      }
      const dr = Math.abs(base.rgba[idx] - act.rgba[idx]);
      const dg = Math.abs(base.rgba[idx + 1] - act.rgba[idx + 1]);
      const db = Math.abs(base.rgba[idx + 2] - act.rgba[idx + 2]);
      const da = Math.abs(base.rgba[idx + 3] - act.rgba[idx + 3]);
      if (Math.max(dr, dg, db, da) > threshold) {
        diffPixels++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        diffRgba[idx] = 225; diffRgba[idx + 1] = 29; diffRgba[idx + 2] = 72; diffRgba[idx + 3] = 255;
      } else {
        // 淡化背景便于定位热区
        diffRgba[idx] = Math.round(act.rgba[idx] * 0.25 + 190);
        diffRgba[idx + 1] = Math.round(act.rgba[idx + 1] * 0.25 + 190);
        diffRgba[idx + 2] = Math.round(act.rgba[idx + 2] * 0.25 + 190);
        diffRgba[idx + 3] = 255;
      }
    }
  }

  let writtenDiff = null;
  if (outDiffPath) {
    const absOut = path.resolve(outDiffPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, encodePng(width, height, diffRgba));
    writtenDiff = absOut;
  }

  const comparedPixels = Math.max(1, totalPixels - maskedPixels);
  return {
    ok: true,
    dimensionMismatch: false,
    width,
    height,
    threshold,
    totalPixels,
    maskedPixels,
    diffPixels,
    diffRatio: Number((diffPixels / comparedPixels).toFixed(6)),
    diffBoundingBox: diffPixels > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    diffPath: writtenDiff,
  };
}

// 纯 Node.js 内置模块（node:zlib）实现的轻量 ZIP 读写器，用于零依赖读写 .docx（OOXML）
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 读取 ZIP Buffer，返回 Map<entryName, Buffer>
 * 通过 Central Directory 读取压缩大小，兼容带 Data Descriptor（bit 3）的 Word / Pages .docx。
 */
export function readZip(buf) {
  const minEocd = 22;
  if (!Buffer.isBuffer(buf) || buf.length < minEocd) {
    throw new Error('无效的 ZIP/DOCX 数据：文件过小');
  }

  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - minEocd; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('无效的 ZIP/DOCX 数据：未找到中央目录结束标记（EOCD）');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const files = new Map();

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏');
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP 本地文件头损坏：${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compBuf = buf.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      files.set(name, Buffer.from(compBuf));
    } else if (method === 8) {
      files.set(name, zlib.inflateRawSync(compBuf));
    } else {
      throw new Error(`不支持的 ZIP 压缩算法（method=${method}）：${name}`);
    }
  }
  return files;
}

/**
 * 将 [{ name, data }] 打包为标准 ZIP Buffer（UTF-8 文件名标记）
 */
export function writeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name), 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), 'utf8');

    const crc = crc32(rawBuf);
    const deflated = rawBuf.length > 64 ? zlib.deflateRawSync(rawBuf) : rawBuf;
    const useDeflate = deflated.length < rawBuf.length;
    const method = useDeflate ? 8 : 0;
    const bodyBuf = useDeflate ? deflated : rawBuf;

    // Local File Header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);          // version needed: 2.0
    lfh.writeUInt16LE(0x0800, 6);      // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0x0000, 10);     // mod time
    lfh.writeUInt16LE(0x5979, 12);     // mod date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(bodyBuf.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBuf, bodyBuf);

    // Central Directory Header (46 bytes + name)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);          // version made by
    cdh.writeUInt16LE(20, 6);          // version needed
    cdh.writeUInt16LE(0x0800, 8);      // UTF-8 flag
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0x0000, 12);
    cdh.writeUInt16LE(0x5979, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(bodyBuf.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBuf);
    offset += 30 + nameBuf.length + bodyBuf.length;
  }

  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

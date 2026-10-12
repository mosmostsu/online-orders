// เติมแถวข้อมูลลงในไฟล์เทมเพลต xlsx ที่มีอยู่ — ไม่ใช้ไลบรารีนอก (อ่านด้วย DecompressionStream · เขียนแบบไม่บีบอัด)
// แก้เฉพาะ xl/worksheets/sheet1.xml (เขียนกลับแบบ deflate) ส่วนอื่น (สไตล์ ตัวตรวจค่า ฯลฯ) คัดลอกไบต์เดิมทุกอย่าง
// แนวเดียวกับ extensions/mvp-stock/xlsx.js (Shopee รับไฟล์ที่เขียนแบบนี้แล้ว 2026-10-09)
// ใช้ได้ทั้ง Node 18+ และเบราว์เซอร์ (ทดสอบในเบราว์เซอร์ได้)

const dec = new TextDecoder();
const enc = new TextEncoder();

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[k] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ไม่ใช่ไฟล์ xlsx (หา end-of-central-directory ไม่เจอ)');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const nl = dv.getUint16(p + 28, true);
    const el = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const e = {
      method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true),
      date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      off: dv.getUint32(p + 42, true),
      nameB: buf.slice(p + 46, p + 46 + nl),
    };
    e.name = dec.decode(e.nameB);
    entries.push(e);
    p += 46 + nl + el + cl;
  }
  const raw = (e) => {
    const lnl = dv.getUint16(e.off + 26, true);
    const lel = dv.getUint16(e.off + 28, true);
    const start = e.off + 30 + lnl + lel;
    return buf.slice(start, start + e.csize);
  };
  const text = async (e) => {
    const r = raw(e);
    if (e.method === 0) return dec.decode(r);
    const s = new Blob([r]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return dec.decode(new Uint8Array(await new Response(s).arrayBuffer()));
  };
  return { entries, raw, text };
}

function writeZip(parts) {
  // parts: [{ nameB, method, time, date, crc, csize, usize, data }]
  const chunks = [];
  const central = [];
  let off = 0;
  const u16 = (v) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);
  const u32 = (v) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
  const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let q = 0; for (const x of a) { o.set(x, q); q += x.length; } return o; };
  for (const e of parts) {
    const local = cat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(e.method), u16(e.time), u16(e.date),   // 0x0800 = ชื่อไฟล์เป็น UTF-8
      u32(e.crc), u32(e.csize), u32(e.usize), u16(e.nameB.length), u16(0), e.nameB,
    );
    chunks.push(local, e.data);
    central.push(cat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(e.method), u16(e.time), u16(e.date),
      u32(e.crc), u32(e.csize), u32(e.usize), u16(e.nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), e.nameB,
    ));
    off += local.length + e.data.length;
  }
  const cd = cat(...central);
  chunks.push(cd, cat(u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length), u32(cd.length), u32(off), u16(0)));
  return cat(...chunks);
}

// บีบอัด (deflate-raw) — URL รูปซ้ำทุกแถว ไฟล์ไม่บีบอัด ~2.5 MB บีบแล้วเหลือหลักร้อย KB (ตอบผ่าน API ได้)
async function deflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const esc = (s) => String(s)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colName(i) {   // 0 → A
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// เติมแถวข้อมูล (array ของ array) ต่อท้ายชีตแรก เริ่มที่แถว startRow — คืนไบต์ xlsx ใหม่
export async function appendRows(templateBytes, rows, { startRow = 5, sheetPath = 'xl/worksheets/sheet1.xml' } = {}) {
  const zip = readZip(templateBytes);
  const sheet = zip.entries.find((e) => e.name === sheetPath);
  if (!sheet) throw new Error(`ไม่พบ ${sheetPath} ในเทมเพลต`);
  let xml = await zip.text(sheet);

  const body = rows.map((cells, i) => {
    const r = startRow + i;
    const cs = cells.map((v, c) => {
      if (v === '' || v === null || v === undefined) return '';
      const ref = `${colName(c)}${r}`;
      return typeof v === 'number'
        ? `<c r="${ref}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${cs}</row>`;
  }).join('');

  if (!xml.includes('</sheetData>')) throw new Error('โครงสร้างชีตของเทมเพลตไม่ตรงที่คาดไว้ (ไม่มี </sheetData>)');
  xml = xml.replace('</sheetData>', `${body}</sheetData>`);
  const lastRow = startRow + rows.length - 1;
  xml = xml.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:${colName(23)}${Math.max(lastRow, startRow)}"/>`);

  const newSheet = enc.encode(xml);
  const packed = await deflateRaw(newSheet);
  const parts = zip.entries.map((e) => (e.name === sheetPath
    ? { nameB: e.nameB, method: 8, time: e.time, date: e.date, crc: crc32(newSheet), csize: packed.length, usize: newSheet.length, data: packed }
    : { nameB: e.nameB, method: e.method, time: e.time, date: e.date, crc: e.crc, csize: e.csize, usize: e.usize, data: zip.raw(e) }));
  return writeZip(parts);
}

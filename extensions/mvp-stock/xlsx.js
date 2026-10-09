// อ่าน/เขียนไฟล์ xlsx แบบพอใช้ — ไม่ใช้ไลบรารีนอก (ฉีดเข้าหน้า Seller Center ด้วย chrome.scripting)
// xlsx คือ zip ของไฟล์ XML: อ่านด้วย DecompressionStream แล้วเขียนกลับแบบไม่บีบอัด (stored)
// ทดสอบแล้ว Shopee รับไฟล์ที่เขียนแบบนี้ (2026-10-09 สำเร็จ 119/119)
globalThis.MVPXLSX = (() => {
  const dec = new TextDecoder();

  function readZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = buf.length - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('ไฟล์ที่ได้ไม่ใช่ xlsx');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const nameB = buf.slice(p + 46, p + 46 + nl);
      entries.push({ name: dec.decode(nameB), nameB, method, csize, off });
      p += 46 + nl + el + cl;
    }
    async function data(e) {
      const lnl = dv.getUint16(e.off + 26, true), lel = dv.getUint16(e.off + 28, true);
      const start = e.off + 30 + lnl + lel;
      const raw = buf.slice(start, start + e.csize);
      if (e.method === 0) return raw;
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return { entries, data, text: async (name) => {
      const e = entries.find((x) => x.name === name);
      return e ? dec.decode(await data(e)) : '';
    } };
  }

  const crcTable = new Uint32Array(256).map((_, k) => {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(d) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // files = [{ nameB: Uint8Array, data: Uint8Array }]
  function writeZipStored(files) {
    const parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const c = crc32(f.data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
      h.setUint32(14, c, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true);
      h.setUint16(26, f.nameB.length, true);
      parts.push(new Uint8Array(h.buffer), f.nameB, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint32(16, c, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
      ch.setUint16(28, f.nameB.length, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), f.nameB);
      off += 30 + f.nameB.length + f.data.length;
    }
    const cenSize = cen.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cenSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(e.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  // แถวของ sheet → [{ r: เลขแถว, c: { A: 'ค่า', ... } }]
  function parseSheet(sheetXml, sharedXml) {
    const strs = [...(sharedXml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
    return [...sheetXml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map((m) => ({
      r: Number(m[1]),
      c: Object.fromEntries([...m[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const shared = /t="s"/.test(c[2]);
        const v = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/);
        const is = (c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/);
        return [c[1], shared && v ? strs[Number(v[1])] : v ? unesc(v[1]) : is ? unesc(is[1]) : ''];
      })),
    }));
  }

  // เขียนตัวเลขใหม่ลงคอลัมน์ col ของแถวที่กำหนด — คงสไตล์เดิม (s=) ตัดชนิด (t=) ออกให้เป็นตัวเลข
  function setNumbers(sheetXml, col, valuesByRow) {
    let n = 0;
    const re = new RegExp(`<c r="${col}(\\d+)"([^>]*?)(\\/>|>[\\s\\S]*?<\\/c>)`, 'g');
    const xml = sheetXml.replace(re, (m, row, attrs) => {
      if (!(row in valuesByRow)) return m;
      n++;
      return `<c r="${col}${row}"${attrs.replace(/\s+t="[^"]*"/, '')}><v>${valuesByRow[row]}</v></c>`;
    });
    return { xml, n };
  }

  return { readZip, writeZipStored, parseSheet, setNumbers };
})();

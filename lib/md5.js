// MD5 ของไฟล์ทั้งก้อนในเบราว์เซอร์ (Web Crypto ไม่มี MD5) — ใช้ตอนอัปโหลดวิดีโอ Shopee (init_video_upload ต้องมี file_md5)
// ไม่มี import ใช้ได้ทั้งฝั่งเบราว์เซอร์และ node · ไฟล์ 30MB ใช้เวลาไม่ถึงวินาที
const SH = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
const M = new Int32Array(16);

function block(h, b, o) {
  for (let j = 0; j < 16; j += 1) { const p = o + j * 4; M[j] = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); }
  let a = h[0], x = h[1], c = h[2], d = h[3];
  for (let i = 0; i < 64; i += 1) {
    let f, g;
    if (i < 16) { f = (x & c) | (~x & d); g = i; }
    else if (i < 32) { f = (d & x) | (~d & c); g = (5 * i + 1) & 15; }
    else if (i < 48) { f = x ^ c ^ d; g = (3 * i + 5) & 15; }
    else { f = c ^ (x | ~d); g = (7 * i) & 15; }
    const t = d; d = c; c = x;
    const s = (a + f + K[i] + M[g]) | 0;
    x = (x + ((s << SH[i]) | (s >>> (32 - SH[i])))) | 0;
    a = t;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + x) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
}

export function md5(bytes) {
  const h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  const n = bytes.length;
  const full = n - (n % 64);
  for (let o = 0; o < full; o += 64) block(h, bytes, o);
  // ท้ายไฟล์: 0x80 + ศูนย์ + ความยาวเป็นบิต 64 บิต little-endian
  const tail = new Uint8Array(n % 64 < 56 ? 64 : 128);
  tail.set(bytes.subarray(full));
  tail[n - full] = 0x80;
  const lo = (n * 8) >>> 0, hi = Math.floor(n / 0x20000000);
  for (let i = 0; i < 4; i += 1) { tail[tail.length - 8 + i] = (lo >>> (8 * i)) & 255; tail[tail.length - 4 + i] = (hi >>> (8 * i)) & 255; }
  for (let o = 0; o < tail.length; o += 64) block(h, tail, o);
  let out = '';
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) out += ((h[i] >>> (8 * j)) & 255).toString(16).padStart(2, '0');
  return out;
}

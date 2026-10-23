// ตัวตั้งเวลาของ Netlify — เปิดหน้า /discount กับ /discount/compare ล่วงหน้าทุก 5 นาที ให้ที่จำไว้ (unstable_cache) อุ่นอยู่เสมอ
// หน้าสองหน้านี้ดึงโปรสดจาก Shopee/TikTok ตอนเปิด: ที่จำหมด/เพิ่ง deploy = รอ 5–10 วินาที (ดัชนีโปรของ compare จำไว้ 10 นาที, หน้า /discount 2 นาที)
// มีรอบนี้คอยเปิดแทน คนเปิดจริงเจอแต่ของที่จำไว้แล้ว — ไม่มีการเขียนอะไรตรงๆ แค่ GET หน้าเดิม
// (แต่ GET หน้า compare ที่ก้อนเก่าเกิน SNAP_MAX_MS จะสั่งสร้างก้อนใหม่ — จึงรันเฉพาะเวลาทำงาน ดู netlify.toml)
const SHOPS = ['shopee:REAL', 'shopee:SOLID', 'tiktok:SOLID', 'lazada:SOLID', 'tiktok:MVP'];
const COMPARE_GROUPS = ['X:all', 'X:main', 'SOLID', 'REAL', 'MVP'];

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) return new Response('ยังไม่ได้ตั้ง URL', { status: 400 });
  const paths = [
    ...SHOPS.map((s) => `/discount?s=${encodeURIComponent(s)}`),
    ...COMPARE_GROUPS.map((g) => `/discount/compare?g=${encodeURIComponent(g)}`),
  ];
  // ยิงพร้อมกันทั้งหมด — เกิน 25 วิ ปล่อยให้เซิร์ฟเวอร์วิ่งต่อเอง (ผลลงที่จำไว้เหมือนเดิม)
  const out = await Promise.all(paths.map(async (p) => {
    const t = Date.now();
    try {
      const res = await fetch(base + p, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'warm-discount', 'x-sync-key': process.env.SYNC_SECRET || '' } });
      await res.arrayBuffer();
      return `${p} ${res.status} ${Date.now() - t}ms`;
    } catch (e) {
      return `${p} ปล่อยให้วิ่งต่อ — ${e.name}`;
    }
  }));
  console.log('warm-discount:\n' + out.join('\n'));
  return new Response('ok', { status: 200 });
};

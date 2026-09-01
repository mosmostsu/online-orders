// ตัวตั้งเวลาของ Netlify — เคาะ /api/sync/settlement วันละครั้ง
// ยอดเงินนิ่งอยู่แล้ว ไม่ต้องถามบ่อย และ Finance API ต้องยิงทีละใบ ยิ่งถี่ยิ่งเปลืองโควต้า
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ยิงหลายรอบต่อกัน — รอบละ 40 ใบ (เพดานของ route) จะได้ไล่ใบที่ค้างสะสมได้เร็วขึ้น
  const out = [];
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${base}/api/sync/settlement?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      console.log('sync-settlement:', res.status, text.slice(0, 300));
      out.push(String(res.status));
      // ไม่มีใบให้ถามแล้วก็หยุด ไม่ต้องยิงรอบที่เหลือ
      if (/"asked":0/.test(text)) break;
    } catch (e) {
      console.log('sync-settlement: ปล่อยให้วิ่งต่อ —', e.name);
      out.push('กำลังทำงาน');
      break;
    }
  }
  return new Response(out.join(' · '), { status: 200 });
};

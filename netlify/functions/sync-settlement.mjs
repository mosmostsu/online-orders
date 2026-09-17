// ตัวตั้งเวลาของ Netlify — เคาะ /api/sync/settlement ทุกชั่วโมง
//
// ทำไมรายชั่วโมง ทั้งที่ใบสรุปออกวันละใบ: หนึ่งรอบดึงได้ ~1,000 รายการก่อนหมดเวลา
// ช่วงแรกมีของค้างทั้งเดือน (~15,000 รายการ) ต้องทยอยหลายรอบ
// พอไล่ทันแล้ว รอบที่ไม่มีงานจะจบในวินาทีเดียว (ถามรายการใบสรุปครั้งเดียวแล้วเลิก)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ตัดฝั่งนี้ที่ 25 วินาที — ถ้ายังไม่จบก็ปล่อยให้ route วิ่งต่อจนหยุดเองตามงบเวลา
  try {
    const res = await fetch(`${base}/api/sync/settlement?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    console.log('sync-settlement:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-settlement: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

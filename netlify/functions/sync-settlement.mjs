// ตัวตั้งเวลาของ Netlify — เคาะ /api/sync/settlement (TikTok) กับ /api/sync/settlement-shopee ทุก 3 ชั่วโมง
//
// ทำไมทุก 3 ชั่วโมง ทั้งที่ใบสรุปออกวันละใบ: หนึ่งรอบดึงได้ ~1,000 รายการก่อนหมดเวลา
// ช่วงแรกมีของค้างทั้งเดือน (~15,000 รายการ) ต้องทยอยหลายรอบ
// พอไล่ทันแล้ว รอบที่ไม่มีงานจะจบในวินาทีเดียว (ถามรายการใบสรุปครั้งเดียวแล้วเลิก)
// ไม่แยก schedule ให้ Shopee ต่างหาก — ยิงต่อกันในรอบเดียวกัน กันเพิ่ม cron ใหม่โดยไม่จำเป็น
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ตัดฝั่งนี้ที่ 25 วินาที — ถ้ายังไม่จบก็ปล่อยให้ route วิ่งต่อจนหยุดเองตามงบเวลา
  const hit = async (path) => {
    try {
      const res = await fetch(`${base}${path}?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      console.log(`sync-settlement ${path}:`, res.status, text.slice(0, 300));
      return `${path}: ${res.status}`;
    } catch (e) {
      console.log(`sync-settlement ${path}: ปล่อยให้วิ่งต่อ —`, e.name);
      return `${path}: กำลังทำงาน`;
    }
  };

  // ยิงพร้อมกัน ไม่ใช่ต่อกัน — แต่ละอันมี timeout ของตัวเองอยู่แล้ว ยิงต่อกันจะเสี่ยงเกินงบเวลาของ wrapper นี้เอง
  const out = await Promise.all([hit('/api/sync/settlement'), hit('/api/sync/settlement-shopee')]);
  return new Response(out.join(' · '), { status: 200 });
};

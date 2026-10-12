// ตัวตั้งเวลาของ Netlify — ดึงรายการสินค้า Lazada SOLID ทุก 10 นาที (ดู sync-products.mjs สำหรับร้านอื่น)
// Lazada ไล่ทีละหน้าตามตัวชี้ รอบละ ~40 ตะกร้า ทั้งร้าน ~350 ตะกร้า → ครบรอบราว 1.5 ชั่วโมง
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  const q = new URLSearchParams({ key, platform: 'lazada', shop: 'SOLID' });
  try {
    const res = await fetch(`${base}/api/sync/products?${q}`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    console.log('sync-products lazada:SOLID:', res.status, text.slice(0, 300));
    return new Response(`lazada:SOLID ${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-products lazada:SOLID: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('lazada:SOLID กำลังทำงาน', { status: 200 });
  }
};

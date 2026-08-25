// ตัวตั้งเวลาของ Netlify — หน้าที่เดียวคือเคาะ /api/sync/tiktok ตามรอบ
// ตั้งเวลาไว้ที่ netlify.toml (ทุก 5 นาที)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ตัดที่ 25 วินาที — ถ้ารอบนี้ยังไม่จบก็ปล่อยให้มันวิ่งต่อฝั่งเซิร์ฟเวอร์
  // ไม่งั้น Netlify จะคิดว่าเราค้างแล้วยิงซ้ำ จน TikTok เตะเรื่องยิงถี่เกิน
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${base}/api/sync/tiktok?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    const text = await res.text();
    console.log('sync-orders:', res.status, text.slice(0, 400));
    return new Response(text, { status: res.status });
  } catch (e) {
    console.log('sync-orders: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('started', { status: 202 });
  } finally {
    clearTimeout(timer);
  }
};

// ดึงออเดอร์ ThisShop — แยกจากรอบหลักเพราะต้องยิงทีละใบและมีออเดอร์วันละไม่กี่ใบ
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${base}/api/sync/thisshop?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    const text = await res.text();
    console.log('sync-thisshop:', res.status, text.slice(0, 300));
    return new Response(text, { status: res.status });
  } catch (e) {
    console.log('sync-thisshop: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('started', { status: 202 });
  } finally {
    clearTimeout(timer);
  }
};

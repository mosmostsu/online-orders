// ตัวตั้งเวลาของ Netlify — หน้าที่เดียวคือเคาะ /api/sync/tiktok ตามรอบ
// ตั้งเวลาไว้ที่ netlify.toml (ทุก 5 นาที)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ตัดที่ 25 วินาที — ถ้ารอบนี้ยังไม่จบก็ปล่อยให้มันวิ่งต่อฝั่งเซิร์ฟเวอร์
  // ไม่งั้น Netlify จะคิดว่าเราค้างแล้วยิงซ้ำ จนแพลตฟอร์มเตะเรื่องยิงถี่เกิน
  const hit = async (platform) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${base}/api/sync/${platform}${platform.includes('?') ? '' : '?'}key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
      const text = await res.text();
      console.log(`sync-orders/${platform}:`, res.status, text.slice(0, 300));
      return `${platform}: ${res.status}`;
    } catch (e) {
      console.log(`sync-orders/${platform}: ปล่อยให้วิ่งต่อ —`, e.name);
      return `${platform}: กำลังทำงาน`;
    } finally {
      clearTimeout(timer);
    }
  };

  // ยิงพร้อมกันทั้งสองแพลตฟอร์ม — ร้านที่ยังไม่ได้ผูกจะตอบกลับมาเองว่ายังไม่มีร้าน
  // ThisShop ไม่รวมในรอบนี้ — ออเดอร์วันละไม่กี่ใบ และต้องยิงทีละใบซึ่งกินเวลา
  // แยกไปรอบ 30 นาทีของตัวเอง (sync-thisshop) จะได้ไม่ถ่วงรอบหลัก
  // ช้อปปี้มีหลายร้าน ดึงพร้อมกันมักไม่ทันเวลา จึงสลับร้านตามรอบ (รอบคู่ SOLID รอบคี่ REAL)
  const shopeeShop = new Date().getMinutes() % 10 < 5 ? 'SOLID' : 'REAL';
  const out = await Promise.all([hit('tiktok'), hit(`shopee?shop=${shopeeShop}&`)]);

  // แวะปลุกเซิร์ฟเวอร์ด้วยหน้าเบาๆ ไม่ให้หลับ
  // เคยยิงหน้ารายการซึ่งต้องถามฐานข้อมูล กลายเป็นเพิ่มภาระแทนที่จะช่วย
  try {
    await fetch(`${base}/api/ping`, { signal: AbortSignal.timeout(8000) });
  } catch { /* ปลุกไม่ทันก็ไม่เป็นไร */ }

  return new Response(out.join(' · '), { status: 200 });
};

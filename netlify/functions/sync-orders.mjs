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
      const res = await fetch(`${base}/api/sync/${platform}?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
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
  const out = await Promise.all([hit('tiktok'), hit('shopee'), hit('thisshop')]);
  return new Response(out.join(' · '), { status: 200 });
};

// ตัวตั้งเวลาของ Netlify — ล้างข้อมูลเก่าวันละครั้ง (os_cleanup ดูกติกาใน supabase/065)
// เดิมพึ่ง pg_cron ในฐานข้อมูล (supabase/005) แต่โปรเจกต์นี้ไม่ได้เปิด → ไม่เคยรันเลย จนฐานข้อมูลเกือบเต็มโควต้าฟรี
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/cleanup?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    console.log('cleanup:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('cleanup: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

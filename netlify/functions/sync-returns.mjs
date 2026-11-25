// ตัวตั้งเวลาของ Netlify — เติมตารางของคืน (หน้า /returns) ทุกชั่วโมง นาทีที่ 40
// ดึงคำขอคืนใหม่ + ใบตีกลับ + ถามสถานะขนส่งขากลับทีละไม่กี่ใบ (ดู lib/returnsSync.js)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/sync/returns?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    console.log('sync-returns:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-returns: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

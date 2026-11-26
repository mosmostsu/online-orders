// ตัวตั้งเวลาของ Netlify — ไล่ถาม tracking ออเดอร์ "กำลังส่ง" ว่ากำลังตีกลับไหม (ขั้น probed ใน lib/returnsSync.js)
// ออเดอร์กำลังส่งมี ~400 ใบ รอบละ ~90 ใบ — รอบใหญ่ทุกชั่วโมง (sync-returns นาทีที่ 40) ไม่ทัน
// เลยแยกมาวิ่งเฉพาะขั้นนี้ทุก 15 นาที ใบที่เพิ่งเริ่มตีกลับขึ้นหน้า /returns ภายใน ~1 ชั่วโมง (เดิม 5–6 ชั่วโมง)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/sync/returns?key=${encodeURIComponent(key)}&only=probed&check=120`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    console.log('sync-returns-probe:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-returns-probe: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

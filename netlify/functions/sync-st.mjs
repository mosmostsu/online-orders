// ตัวตั้งเวลาของ Netlify — ดึงไฟล์ ST กลาง (สต็อก Seniorsoft) มาเก็บใน os_st ให้หน้า /allsite ทุกชั่วโมง
// ไฟล์ไม่เปลี่ยน route จะเช็ค metadata แล้วจบในวินาทีเดียว
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/sync/st?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    console.log('sync-st:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-st: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

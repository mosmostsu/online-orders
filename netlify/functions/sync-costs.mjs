// ตัวตั้งเวลาของ Netlify — ดึงต้นทุนล่าสุดจากบิลรับของ Seniorsoft วันละครั้ง
// บิลใหม่เข้าไฟล์รายเดือนของ samchai invoice ไม่บ่อย วันละรอบพอ ตั้งเวลาไว้ที่ netlify.toml
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/sync/costs?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    console.log('sync-costs:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-costs: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

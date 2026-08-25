// รอบสองของสรุปใบค้าง (17:00 เวลาไทย) — เนื้อในเหมือน notify-packed ทุกอย่าง
// แยกไฟล์เพราะ Netlify ตั้งได้เวลาเดียวต่อหนึ่ง function
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  const res = await fetch(`${base}/api/notify/packed?key=${encodeURIComponent(key)}`);
  const text = await res.text();
  console.log('notify-packed-late:', res.status, text.slice(0, 300));
  return new Response(text, { status: res.status });
};

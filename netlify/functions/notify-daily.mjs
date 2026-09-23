// ตัวตั้งเวลาของ Netlify — สรุปรอบเย็นรวมข้อความเดียว (17:30 เวลาไทย)
// แทนของเดิมที่แยกเป็นสองรอบ 16:30 กับ 17:00
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  const res = await fetch(`${base}/api/notify/daily?key=${encodeURIComponent(key)}`);
  const text = await res.text();
  console.log('notify-daily:', res.status, text.slice(0, 300));
  return new Response(text, { status: res.status });
};

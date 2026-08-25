// สรุปใบที่ค้างในกองเข้า LINE — ตั้งเวลาไว้ที่ netlify.toml (16:30 กับ 17:00 เวลาไทย)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  const res = await fetch(`${base}/api/notify/packed?key=${encodeURIComponent(key)}`);
  const text = await res.text();
  console.log('notify-packed:', res.status, text.slice(0, 300));
  return new Response(text, { status: res.status });
};

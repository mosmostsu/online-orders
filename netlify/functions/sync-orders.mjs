// ตัวตั้งเวลาของ Netlify — หน้าที่เดียวคือเคาะ /api/sync/tiktok ตามรอบ
// ตั้งเวลาไว้ที่ netlify.toml (ทุก 5 นาที)
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  const res = await fetch(`${base}/api/sync/tiktok?key=${encodeURIComponent(key)}`);
  const text = await res.text();
  console.log('sync-orders:', res.status, text.slice(0, 500));
  return new Response(text, { status: res.status });
};

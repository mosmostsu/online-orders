// ตัวตั้งเวลาของ Netlify — ดึงคลิป TikTok (Display API) ของช่อง Solid/Meta ลง os_videos วันละ 2 รอบ
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  try {
    const res = await fetch(`${base}/api/sync/tiktok-display?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    console.log('sync-tiktok-display:', res.status, text.slice(0, 300));
    return new Response(`${res.status}`, { status: 200 });
  } catch (e) {
    console.log('sync-tiktok-display: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

// ตัวตั้งเวลาของ Netlify — ดึงคลิป TikTok (Display API) ของช่อง Solid/Meta ลง os_videos วันละ 2 รอบ
// route ทำงานทีละช่วงสั้นๆ (ไม่ให้เกินเวลาของฟังก์ชัน) จึงเรียกซ้ำจนผลบอก done:true หรือใกล้หมดเวลาของตัวตั้งเวลา
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });
  const t0 = Date.now();
  try {
    for (let i = 0; i < 4 && Date.now() - t0 < 14000; i++) {
      const res = await fetch(`${base}/api/sync/tiktok-display?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(12000) });
      const text = await res.text();
      console.log('sync-tiktok-display:', res.status, text.slice(0, 300));
      let done = true;
      try { done = JSON.parse(text).done !== false; } catch (_) { /* ไม่ใช่ JSON = หยุด */ }
      if (done) break;
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.log('sync-tiktok-display: ปล่อยให้วิ่งต่อ —', e.name);
    return new Response('กำลังทำงาน', { status: 200 });
  }
};

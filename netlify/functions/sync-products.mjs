// ตัวตั้งเวลาของ Netlify — ดึงรายการสินค้าทั้งร้าน (ราคา/ราคาพิเศษ/คลัง) ให้หน้า /product ทุกชั่วโมง
// ยิงแยกทีละร้านพร้อมกัน — ร้านละงบเวลาของตัวเอง ร้านที่ของเยอะไม่กินเวลาร้านอื่น
// ThisShop ได้ ~100 ตะกร้าต่อรอบ วนครบทั้งร้าน (~1,250) ราว 12 ชั่วโมงถ้าพึ่ง cron อย่างเดียว
// อยากได้ตัวเลขสดกว่านั้นกดปุ่ม "ดึงสินค้า" ในหน้า
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const key = process.env.SYNC_SECRET;
  if (!base || !key) return new Response('ยังไม่ได้ตั้ง URL / SYNC_SECRET', { status: 400 });

  // ร้านที่ผูกไว้ใน os_shop_tokens — MVP ยังไม่ได้ผูก ผูกแล้วค่อยเพิ่มตรงนี้
  const shops = [
    ['shopee', 'SOLID'], ['shopee', 'REAL'], ['tiktok', 'SOLID'], ['thisshop', 'THISSHOP'],
  ];
  const hit = async ([platform, shop]) => {
    const q = new URLSearchParams({ key, platform, shop });
    try {
      const res = await fetch(`${base}/api/sync/products?${q}`, { signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      console.log(`sync-products ${platform}:${shop}:`, res.status, text.slice(0, 300));
      return `${platform}:${shop} ${res.status}`;
    } catch (e) {
      console.log(`sync-products ${platform}:${shop}: ปล่อยให้วิ่งต่อ —`, e.name);
      return `${platform}:${shop} กำลังทำงาน`;
    }
  };
  const out = await Promise.all(shops.map(hit));
  return new Response(out.join(' · '), { status: 200 });
};

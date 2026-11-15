// Studio — วางแผนคลิป: แผนสัปดาห์ · คิวตัด (Claude อ่านคิวไปตัด) · งานถ่ายฟุต · วันนี้โพสต์
// ต้องใส่รหัส SALES_PIN ก่อน (กันบอท) · ฟุตเทจนับสดจาก Google Drive (lib/studioDrive.js)
// ตะกร้า + รูปปกอ่านจาก os_listings ของร้านนั้น — ไม่คัดลอกรูปมาเก็บ
import Nav from '../Nav';
import PinBox from '../PinBox';
import { db } from '@/lib/supabase';
import { salesUnlocked } from '@/lib/pin';
import { SHOPS, basketCandidates, todayBkk, addDays } from '@/lib/studio';
import { footageFromDrive } from '@/lib/studioDrive';
import Studio from './Studio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio — order-sync' };

const MISSING = '42P01';

async function load() {
  const today = todayBkk();
  const since = addDays(today, -21);
  const [clips, shoots, meta, tokens, drive] = await Promise.all([
    db().from('os_studio_clips').select('*').or(`date.gte.${since},status.in.(queued,cut,approved)`).order('date').limit(500),
    db().from('os_studio_shoots').select('*').order('due', { nullsFirst: false }).limit(300),
    db().from('os_studio_folders').select('*'),
    db().from('os_shop_tokens').select('platform, shop, shop_id'),
    footageFromDrive(),
  ]);
  for (const r of [clips, shoots, meta]) {
    if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
  }

  // ตะกร้าของร้านที่มีในระบบ (TikTok SOLID, Shopee REAL/MVP) — ดึงแค่ชื่อ/รูป/รหัส
  const listingShops = SHOPS.filter((s) => s.platform);
  const listRes = await Promise.all(listingShops.map((s) => db().from('os_listings')
    .select('platform, shop, product_id, title, thumb_url')
    .eq('platform', s.platform).eq('shop', s.shop).limit(3000)));
  const listingsByShop = {};
  listingShops.forEach((s, i) => { listingsByShop[s.key] = listRes[i].data || []; });

  // โฟลเดอร์: Drive เป็นหลัก · ข้อมูลเสริม (ร้าน/ตะกร้า) จาก os_studio_folders · Drive อ่านไม่ได้ = ใช้ตัวเลขสำรอง
  const metaBy = Object.fromEntries((meta.data || []).map((m) => [m.key, m]));
  const base = drive.folders || (meta.data || []).map((m) => {
    const [cat, ...rest] = m.key.split('/');
    return { key: m.key, cat, sub: rest.join('/'), n: m.n, latest: null, drive_url: m.drive_url };
  });
  const folders = base.map((f) => ({ ...f, shops: metaBy[f.key]?.shops || [], baskets: metaBy[f.key]?.baskets || {} }));

  // ตัวเลือกตะกร้า (สูงสุด 8 ต่อร้าน) + ตะกร้าที่ผูกไว้แล้ว — ส่งไปเบราว์เซอร์เท่าที่ใช้
  const listings = {};
  const add = (l) => { listings[`${l.platform}:${l.shop}:${l.product_id}`] = l; };
  const cands = {};
  for (const f of folders) {
    cands[f.key] = {};
    for (const s of listingShops) {
      const c = basketCandidates(f.key, listingsByShop[s.key]);
      cands[f.key][s.key] = c.map((l) => { add(l); return `${l.platform}:${l.shop}:${l.product_id}`; });
      const b = f.baskets?.[s.key];
      if (b?.id) { const l = listingsByShop[s.key].find((x) => x.product_id === b.id); if (l) add(l); }
    }
  }
  const shopIds = Object.fromEntries((tokens.data || []).map((t) => [`${t.platform}:${t.shop}`, t.shop_id]));
  return { clips: clips.data || [], shoots: shoots.data || [], folders, listings, cands, shopIds, driveError: drive.error, today };
}

export default async function StudioPage({ searchParams }) {
  const sp = await searchParams;
  if (!(await salesUnlocked())) {
    return (
      <>
        <Nav active="studio" />
        <div className="row"><div><h1>Studio</h1><div className="sub">วางแผนคลิป · ต้องใส่รหัสก่อน</div></div></div>
        <div className="pcard"><PinBox unlocked={false} back="/studio" wrong={sp?.pin === 'wrong'} label="เข้า Studio" /></div>
      </>
    );
  }
  let data = null, err = null;
  try { data = await load(); } catch (e) {
    err = e.code === MISSING ? 'ยังไม่ได้รัน supabase/067_studio.sql ใน Supabase' : String(e.message || e);
  }
  return (
    <>
      <Nav active="studio" />
      {err ? <div className="pcard"><b>เปิด Studio ไม่ได้</b><div className="sub" style={{ margin: '6px 0 0' }}>{err}</div></div> : <Studio {...data} />}
    </>
  );
}

// รับเข้าครั้งล่าสุดของแต่ละ SKU — จากเอกสารรับ R04.201 ที่อัปผ่าน sc2004stock/status.html
// ไฟล์บน Firebase: central/ap_index.json (JSON ธรรมดา รายชื่อเดือน) + central/ap_<พ.ศ.-เดือน>.json (dataGz แบบ ST)
// ข้อมูลเริ่ม 2568-01 → SKU ที่ไม่มีในนี้ = ไม่ได้รับเข้าตั้งแต่ต้นปี 68 (หรือรหัสใน R04 เป็นบาร์โค้ด EAN ไม่ตรงกับ ST)
// SCANCODE ใน R04 = รหัสเดียวกับ cf_itemid ใน ST (สุ่มเทียบแล้ว 73/80 ตรง ที่ไม่ตรงเป็น EAN 885...)
import { unstable_cache } from 'next/cache';
import { CENTRAL_BUCKET, fetchCentralMeta, fetchCentralRows } from './central';

async function fetchCentralJson(key) {
  const m = await fetchCentralMeta(key);
  const url = `https://firebasestorage.googleapis.com/v0/b/${CENTRAL_BUCKET}/o/central%2F${key}.json?alt=media&token=${m.token}`;
  return (await fetch(url, { cache: 'no-store' })).json();
}

// { from: วันแรกที่มีข้อมูล, last: { lower(sku): 'YYYY-MM-DD' } } — ก้อน ~0.5MB (unstable_cache จำได้ไม่เกิน 2MB)
// จำไว้ 1 ชม. — อัป R04 ใหม่แล้วอย่างช้าชั่วโมงหนึ่งถึงเห็น
export const lastReceived = unstable_cache(async () => {
  const index = await fetchCentralJson('ap_index');
  const months = Object.entries(index?.months || {});
  const last = {};
  const files = await Promise.all(months.map(([k]) => fetchCentralRows(`ap_${k}`).catch(() => [])));
  for (const rows of files) {
    for (const r of rows) {
      const k = String(r.scancode || '').trim().toLowerCase();
      if (k && r.date && !(last[k] >= r.date)) last[k] = r.date;
    }
  }
  const from = months.map(([, m]) => m.minDate).filter(Boolean).sort()[0] || null;
  return { from, last };
}, ['ap-last-received-v1'], { revalidate: 3600 });

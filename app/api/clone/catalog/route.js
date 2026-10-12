// หมวดและแบรนด์ของ ThisShop ไว้ให้ตัวจับคู่หมวดในหน้ารายงาน
//   ?parent=0        → หมวดลูกของหมวดนั้น ('0' = ยอดสุด) เฉพาะหมวดที่ร้านได้สิทธิ์ขาย
//   ?brands=<รหัส>   → แบรนด์ที่ใช้ได้ในหมวดระดับ 3 นั้น
import { NextResponse } from 'next/server';
import * as thisshop from '@/lib/thisshop';

export const dynamic = 'force-dynamic';

// หมวดไม่เปลี่ยนบ่อย — จำไว้ 10 นาทีต่อเครื่อง ไม่ต้องขอโทเคนทุกครั้งที่กดเปลี่ยนช่อง
const cache = new Map();
const TTL = 10 * 60000;

export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  const parent = sp.get('parent');
  const brands = sp.get('brands');
  const key = brands ? `b:${brands}` : `c:${parent}`;
  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ok: true, items: hit.items });
    if (!/^[0-9]*$/.test(String(brands ?? parent ?? ''))) return NextResponse.json({ ok: false, error: 'รหัสไม่ถูกต้อง' }, { status: 400 });
    if (brands === null && parent === null) return NextResponse.json({ ok: false, error: 'ต้องระบุ parent หรือ brands' }, { status: 400 });
    const token = await thisshop.getToken();
    const items = brands ? await thisshop.categoryBrands(token, brands) : await thisshop.categoryChildren(token, parent);
    cache.set(key, { at: Date.now(), items });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

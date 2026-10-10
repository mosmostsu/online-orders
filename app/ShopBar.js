// แถบเลือกร้าน จัดกลุ่ม SOLID / REAL / MVP (ThisShop อยู่ REAL) หรือตามแพลตฟอร์ม — ใช้ร่วมกันทุกหน้า
//   items: [{ platform, shop, href, on, count? }]   all: { href, on, label } (ปุ่ม "ทุกช่องทาง" ถ้ามี)
//   prefetch: ส่งต่อให้ Link — หน้าที่ข้อมูลแต่ละร้านจำไว้ฝั่งเซิร์ฟเวอร์แล้วโหลดร้านอื่นรอไว้ได้ (เช่น /product)
//
// ส่วนนี้อ่านคุกกี้ตอนโหลดหน้าเพื่อรู้ว่าจัดกลุ่มแบบไหน แล้วส่งให้ ShopBarView (client) วาด
// สวิตช์สลับกลุ่มเป็นการจัดเรียงใหม่ในเบราว์เซอร์ทันที ไม่ขอหน้าใหม่จากเซิร์ฟเวอร์ (ดู ShopBarView.js)
import { cookies } from 'next/headers';
import { GROUP_COOKIE } from '@/lib/shopGroups';
import ShopBarView from './ShopBarView';

export default async function ShopBar({ items, all = null, prefetch = false }) {
  if (!items?.length) return null;
  const mode = (await cookies()).get(GROUP_COOKIE)?.value === 'platform' ? 'platform' : 'shop';
  return <ShopBarView items={items} all={all} prefetch={prefetch} initialMode={mode} />;
}

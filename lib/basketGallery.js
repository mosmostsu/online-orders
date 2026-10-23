// รูปสินค้าทุกรูป (ตามลำดับ รูปแรก = ปก) ของตะกร้าร้านอื่นที่ขายตัวเดียวกัน — หน้าสร้างปกใหม่ (app/product/CoverMaker.js)
// ใช้รูปคนใส่ / รูปมุมอื่นของร้านพี่น้องมาจัดปกใหม่ให้ไม่ซ้ำ · ตะกร้าพี่น้องมาจาก plan.sibItems (lib/basket.js withSiblings)
// อ่านอย่างเดียว · ร้านที่ไม่มี API (Thaimart / ThisShop / Shopee MVP) ไม่รองรับ
import * as shopee from './shopee.js';
import * as tiktok from './tiktok.js';
import * as lazada from './lazada.js';
import { shopeeAuth } from './discounts.js';
import { ttAuth } from './basketTiktok.js';
import { lzAuth } from './basketLazada.js';
import { BasketError } from './basket.js';

export async function itemGallery(platform, shop, itemId) {
  if (platform === 'shopee') {
    const auth = await shopeeAuth(shop);
    const [base] = await shopee.getItemBaseInfo({ ...auth, itemIds: [String(itemId)] });
    if (!base) throw new BasketError('ไม่พบตะกร้านี้ใน Shopee');
    return (base.image?.image_url_list || []).filter(Boolean);
  }
  if (platform === 'tiktok') {
    const p = await tiktok.getProduct({ ...(await ttAuth(shop)), productId: String(itemId) });
    return (p?.main_images || []).map((m) => (m.urls || m.thumb_urls || [])[0]).filter(Boolean);
  }
  if (platform === 'lazada') {
    const it = await lazada.getProductItem({ ...(await lzAuth(shop)), itemId: String(itemId) });
    return (it?.images || []).filter(Boolean);
  }
  throw new BasketError('แพลตฟอร์มนี้ดึงรูปไม่ได้');
}

// ส่องว่า API โปรของ TikTok / Lazada เปิดสิทธิ์ให้แอปเราหรือยัง — อ่านอย่างเดียว ไม่แก้อะไรในร้าน
//
//   /api/debug/promo-probe?key=SYNC_SECRET&platform=tiktok&shop=SOLID
//   /api/debug/promo-probe?key=SYNC_SECRET&platform=tiktok&shop=SOLID&activity=<id>   (โปรเดียว)
//   /api/debug/promo-probe?key=SYNC_SECRET&platform=lazada&shop=SOLID
//
// ยิงหลาย endpoint แยกกัน แต่ละตัวคืนก้อนดิบหรือ error ของตัวเอง (ตัวหนึ่งพังไม่ลากตัวอื่น)
import { NextResponse } from 'next/server';
import * as tiktok from '@/lib/tiktok';
import * as lazada from '@/lib/lazada';
import { listShops, storedToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const trim = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Array.isArray(v) && v.length > 3 ? [...v.slice(0, 3), `…+${v.length - 3}`] : v)));

async function probe(name, fn) {
  try { return { name, ok: true, data: trim(await fn()) }; } catch (e) { return { name, ok: false, error: String(e.message || e), payload: e.payload || null }; }
}

export async function GET(req) {
  const url = new URL(req.url);
  if (!process.env.SYNC_SECRET || url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const platform = url.searchParams.get('platform');
  const shops = await listShops(platform);
  const row = shops.find((s) => s.shop === (url.searchParams.get('shop') || s.shop));
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน', shops: shops.map((s) => s.shop) }, { status: 404 });
  const tok = storedToken(row);
  const out = [];

  if (platform === 'tiktok') {
    const auth = { accessToken: tok.access_token, shopCipher: tok.shop_cipher };
    // &activity=<id> → ก้อนดิบของโปรเดียว (ส่องชื่อฟิลด์สินค้าในโปร)
    const act = url.searchParams.get('activity');
    if (act) {
      out.push(await probe(`activities/${act}`, () => tiktok.getActivity({ ...auth, activityId: act })));
      return NextResponse.json({ ok: true, platform, shop: row.shop, probes: out });
    }
    out.push(await probe('activities/search (ONGOING)', () => tiktok.call('/promotion/202309/activities/search', {
      ...auth, method: 'POST', query: { version: '202309' }, body: { status: 'ONGOING', page_size: 20 },
    })));
    out.push(await probe('activities/search (ทุกสถานะ)', () => tiktok.call('/promotion/202309/activities/search', {
      ...auth, method: 'POST', query: { version: '202309' }, body: { page_size: 20 },
    })));
  } else if (platform === 'lazada') {
    const auth = { accessToken: tok.access_token };
    out.push(await probe('vouchers (COLLECTIBLE)', () => lazada.call('/promotion/vouchers/get', {
      ...auth, params: { cur_page: '1', page_size: '10', voucher_type: 'COLLECTIBLE_VOUCHER' },
    })));
    out.push(await probe('flexicombo/list', () => lazada.call('/promotion/flexicombo/list', {
      ...auth, params: { cur_page: '1', page_size: '10' },
    })));
    // ราคาพิเศษราย SKU (special_price) อยู่ในก้อนสินค้า — ดูตัวอย่าง 2 ตะกร้า
    out.push(await probe('products/get (special_price)', async () => {
      const j = await lazada.call('/products/get', { ...auth, params: { filter: 'live', limit: '2', offset: '0' } });
      return (j.data?.products || []).map((p) => ({
        item_id: p.item_id, skus: (p.skus || []).slice(0, 3).map((s) => ({
          SellerSku: s.SellerSku, price: s.price, special_price: s.special_price, special_from_time: s.special_from_time, special_to_time: s.special_to_time, special_from_date: s.special_from_date, special_to_date: s.special_to_date,
        })),
      }));
    }));
  } else {
    return NextResponse.json({ ok: false, error: 'platform ต้องเป็น tiktok หรือ lazada' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, platform, shop: row.shop, probes: out });
}

// SKU ที่ ThisShop ขาดเทียบกับ Shopee REAL (Shopee = main) ของแถวหนึ่งในหน้า /compare — อ่านอย่างเดียว
//   GET ?s=<เลขตะกร้า Shopee REAL ,คั่น>&t=<เลขตะกร้า ThisShop ,คั่น>
// คืน missing = SKU ที่ Shopee มีแต่ตะกร้า ThisShop เหล่านั้นไม่มี (พร้อมรหัสตัวพิมพ์จริง ชื่อตัวเลือก ราคาป้ายเต็ม สต็อก ST)
//     extra   = SKU ที่ ThisShop มีแต่ Shopee ไม่มี (ข้อมูลประกอบ ไม่ใช่สิ่งที่ต้องเติม)
// รหัสใน ThisShop แยกตัวพิมพ์ จึงคืนตัวพิมพ์ตามที่ Shopee เก็บไว้ ไม่ใช่ตัวเล็กที่หน้า compare ใช้เทียบ
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ids = (v) => String(v || '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).slice(0, 20);
const low = (s) => String(s || '').trim().toLowerCase();

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const s = ids(sp.get('s'));
    const t = ids(sp.get('t'));
    if (!s.length) return NextResponse.json({ ok: false, error: 'ไม่มีตะกร้า Shopee' }, { status: 400 });
    const sb = db();

    const [shopee, thisshop] = await Promise.all([
      sb.from('os_listing_skus').select('product_id, seller_sku, variant, price, stock, sort')
        .eq('platform', 'shopee').eq('shop', 'REAL').in('product_id', s).order('sort'),
      t.length
        ? sb.from('os_listing_skus').select('product_id, seller_sku, variant')
          .eq('platform', 'thisshop').in('product_id', t)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (shopee.error) throw new Error(shopee.error.message);
    if (thisshop.error) throw new Error(thisshop.error.message);

    const have = new Set((thisshop.data || []).map((r) => low(r.seller_sku)).filter(Boolean));
    const src = new Map();
    for (const r of shopee.data || []) {
      const k = low(r.seller_sku);
      if (k && !src.has(k)) src.set(k, r);
    }
    const missing = [...src.entries()].filter(([k]) => !have.has(k)).map(([, r]) => r);
    const extra = (thisshop.data || []).filter((r) => low(r.seller_sku) && !src.has(low(r.seller_sku)));

    // สต็อกจริงจาก Seniorsoft (ถ้ารหัสนั้นไม่อยู่ใน ST ใช้เลขที่ตั้งไว้บน Shopee)
    const forms = [...new Set(missing.map((r) => String(r.seller_sku).trim()))];
    const stByLow = new Map();
    if (forms.length) {
      const { data, error } = await sb.from('os_st').select('sku, qty').in('sku', forms);
      if (error) throw new Error(error.message);
      for (const r of data || []) stByLow.set(low(r.sku), Number(r.qty) || 0);
    }

    return NextResponse.json({
      ok: true,
      missing: missing.map((r) => ({
        sku: String(r.seller_sku).trim(),
        variant: r.variant || null,
        price: r.price === null || r.price === undefined ? null : Number(r.price),
        stock: stByLow.has(low(r.seller_sku)) ? stByLow.get(low(r.seller_sku)) : (r.stock ?? null),
        fromST: stByLow.has(low(r.seller_sku)),
      })),
      extra: extra.map((r) => ({ sku: String(r.seller_sku).trim(), variant: r.variant || null })),
      shopeeN: src.size,
      thisshopN: have.size,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

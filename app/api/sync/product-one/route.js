// รีเฟรชตะกร้าเฉพาะใบที่ระบุ จากแพลตฟอร์มโดยตรง — ปุ่ม ↻ ท้ายแถวในหน้า /compare
//
// POST { items: [{ platform, shop, id }, ...] }  (ไม่เกิน 12 ใบต่อคำขอ)
// ได้ { ok, results: [{ platform, shop, id, ok, skus } | { ..., skipped } | { ..., error }] }
//
// ใช้ตัวแปลงเดียวกับรอบดึงสินค้า (app/api/sync/products) แล้วบันทึกทับตะกร้านั้นด้วย saveListings
// ร้านที่ไม่มี API (Shopee MVP, ThisShop, Thaimart) ข้ามพร้อมบอกเหตุผล ไม่ถือเป็นข้อผิดพลาด
// Lazada ไม่มีคำขอ "ตะกร้าเดียว" ในแบบเดียวกับตอนดึงทั้งร้าน — ถามด้วย sku_seller_list ของตะกร้านั้นแทน
//
// ThisShop: ไม่มีคำขอรายตะกร้าตาม id แต่ thisshop.item.list.get ค้นด้วยรหัส SKU (qrcodes) ได้
// → เอา SKU ของทุกตะกร้าในแถว (ที่เก็บไว้) ไปถาม ThisShop ได้ตะกร้าที่ตรง แล้วบันทึกทับ
// เจอทั้งตะกร้าที่เพิ่งสร้าง/แก้สถานะ/แก้รหัสในหลังบ้านโดยไม่ต้องรอรอบดึงทั้งร้าน
// body.thisshop = true ให้ถาม ThisShop ด้วยแม้แถวนั้นยังไม่มีตะกร้า ThisShop (เช่นเพิ่งสร้างใหม่)
// body.compare = false (ปุ่ม ↻ หน้า /product) ไม่รอสร้างก้อน /compare ใหม่ (~4-6 วินาที) แค่ทำให้เก่า
// หน้า /compare จะใช้ก้อนเดิมไปก่อนแล้วสร้างใหม่เบื้องหลังเอง (lib/compareSnap.js)
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as shopee from '@/lib/shopee';
import * as tiktok from '@/lib/tiktok';
import * as lazada from '@/lib/lazada';
import * as thisshop from '@/lib/thisshop';
import { saveListings } from '@/lib/listings';
import { listShops, usableToken } from '@/lib/tokens';
import { db } from '@/lib/supabase';
import { shopGroup } from '@/lib/shopGroups';
import { markCompareStale } from '@/lib/compareSnap';
import { applyTiktokPromoPrices } from '@/lib/discounts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API_PLATFORMS = ['shopee', 'tiktok', 'lazada'];
const MAX_ITEMS = 12;
const THIS_MAX_FORMS = 120;   // รหัสทั้งหมดที่ถาม ThisShop ต่อแถว (ดิบ + เข้ารหัสอย่างละตัวต่อ SKU)
const THIS_CODES = 10;        // ⚠ ThisShop รับ qrcodes ได้ไม่เกิน 10 รหัสต่อคำขอ (11 ขึ้นไป: 30001 "Barcode request parameters cannot exceed 10")
const THIS_PAGE = 3;          // ThisShop ช้าตามจำนวนตัวเลือก ถามทีละ 3 ตะกร้า
const THIS_MAX_PAGES = 4;     // ต่อชุดรหัส

// SKU ของทุกตะกร้าในแถว (จากที่เก็บไว้) → ถาม ThisShop ด้วย qrcodes → บันทึกทับตะกร้าที่ตรง
async function refreshThisshopBySkus(items) {
  const sb = db();
  const skus = new Set();
  for (const it of items) {
    const { data, error } = await sb.from('os_listing_skus').select('seller_sku')
      .eq('platform', it.platform).eq('shop', it.shop).eq('product_id', it.id);
    if (error) throw new Error(error.message);
    for (const r of data || []) if (r.seller_sku && String(r.seller_sku).trim()) skus.add(String(r.seller_sku).trim());
  }
  // qrcodes ของ ThisShop: ต้องตรงตัวพิมพ์เป๊ะ (ทดสอบแล้ว "gw3777-4" ไม่เจอ "GW3777-4")
  // สินค้าที่ลงในหลังบ้านเก็บรหัสดิบมีขีด · ที่เราโคลนไปเก็บแบบเข้ารหัส (ขีด→sizee) จึงถามทั้งสองแบบ
  const forms = [...new Set([...skus].flatMap((s) => [s, thisshop.encodeSku(s)]))].slice(0, THIS_MAX_FORMS);
  if (!forms.length) return [];
  const token = await thisshop.getToken();
  const found = new Map();
  const seen = new Set();   // รหัสที่เจอแล้วในตะกร้าที่ได้มา — ชุดรหัสที่เจอครบแล้วข้ามได้ (ตะกร้าใหญ่ตะกร้าเดียวมักครอบคลุมทั้งแถว)
  for (let i = 0; i < forms.length; i += THIS_CODES) {
    const batch = forms.slice(i, i + THIS_CODES);
    if (batch.every((c) => seen.has(c))) continue;
    for (let page = 1; page <= THIS_MAX_PAGES; page += 1) {
      const r = await thisshop.call(token, 'thisshop.item.list.get',
        { qrcodes: batch.join(','), pageNum: page, pageSize: THIS_PAGE }, String(900 + i / THIS_CODES * 10 + page).padStart(6, '0'), 30000);
      const spus = r.result || [];
      for (const s of spus) {
        found.set(String(s.spuId), s);
        for (const it of s.itemList || []) if (it.qrcode) seen.add(String(it.qrcode));
      }
      if (spus.length < THIS_PAGE) break;
    }
  }
  const out = [...found.values()].map((spu) => thisshop.normalizeListing(spu, 'THISSHOP'));
  if (out.length) await saveListings(out);
  return out.map((x) => ({ id: x.listing.product_id, skus: x.skus.length, status: x.listing.status }));
}

async function refreshShopee(row, id) {
  const auth = { accessToken: row.access_token, shopId: row.shop_id, partner: row };
  const bases = await shopee.getItemBaseInfo({ ...auth, itemIds: [id] });
  const b = bases.find((x) => String(x.item_id) === id);
  if (!b) throw new Error('Shopee ไม่พบตะกร้านี้ (ถูกลบหรือถูกระงับ)');
  const models = b.has_model ? await shopee.getModelList({ ...auth, itemId: b.item_id }) : null;
  const item = shopee.normalizeListing(b, models, row.shop);
  // ยอดขายสะสม (หน้า /summary) — พังก็ไม่ให้การรีเฟรชพัง
  const sales = await shopee.getItemSales({ ...auth, itemIds: [id] }).catch(() => new Map());
  if (sales.has(id)) item.listing.sold_total = sales.get(id);
  await saveListings([item]);
  return item.skus.length;
}

async function refreshTiktok(row, id) {
  const auth = { accessToken: row.access_token, shopCipher: row.shop_cipher };
  const item = tiktok.normalizeListing(await tiktok.getProduct({ ...auth, productId: id }), row.shop);
  await saveListings([item]);
  // ราคาโปรจากโปรที่กำลังดำเนินการ (Product API ไม่มี) — ไม่มีสิทธิ์ Promotion (MVP) / พัง ก็แค่ไม่มีราคาโปร
  await applyTiktokPromoPrices(row.shop, [id]).catch(() => null);
  return item.skus.length;
}

async function refreshLazada(row, id) {
  // SKU ที่เก็บไว้ของตะกร้านี้ — ใช้ถามกลับว่าตะกร้าที่มี SKU เหล่านี้ตอนนี้หน้าตาเป็นยังไง
  const { data: stored, error } = await db().from('os_listing_skus')
    .select('seller_sku').eq('platform', 'lazada').eq('shop', row.shop).eq('product_id', id);
  if (error) throw new Error(error.message);
  const sellerSkus = [...new Set((stored || []).map((s) => s.seller_sku).filter(Boolean))].slice(0, 20);
  if (!sellerSkus.length) throw new Error('ตะกร้านี้ไม่มี SKU ในระบบ ใช้ถาม Lazada ไม่ได้');
  const { data: l } = await db().from('os_listings')
    .select('status').eq('platform', 'lazada').eq('shop', row.shop).eq('product_id', id).maybeSingle();
  const j = await lazada.call('/products/get', {
    accessToken: row.access_token,
    params: { filter: 'all', sku_seller_list: JSON.stringify(sellerSkus), limit: '10', offset: '0' },
  });
  const p = (j.data?.products || []).find((x) => String(x.item_id) === id);
  if (!p) throw new Error('Lazada ไม่พบตะกร้านี้ (ถูกลบแล้ว หรือ SKU ถูกเปลี่ยนทั้งหมด) — ลองซิงค์ทั้งกลุ่ม');
  // สถานะ: คำขอนี้ไม่บอกสถานะ ใช้ของเดิมที่เก็บไว้ (ซิงค์ทั้งกลุ่มจะอัปเดตให้ถูกเอง)
  const item = lazada.normalizeListing(p, row.shop, l?.status || 'NORMAL');
  await saveListings([item]);
  return item.skus.length;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => ({ platform: String(x?.platform || ''), shop: String(x?.shop || ''), id: String(x?.id || '') }))
    .filter((x) => x.platform && x.shop && x.id)
    .slice(0, MAX_ITEMS);
  if (!items.length) return NextResponse.json({ ok: false, error: 'ไม่มีตะกร้าให้รีเฟรช' }, { status: 400 });

  // ThisShop แยกออกมาทำด้วยรหัส SKU (ดูด้านบน) — ไม่ผ่านรายตัวตาม id
  const thisItems = items.filter((x) => x.platform === 'thisshop');
  const results = [];
  const doThis = thisItems.length > 0 || body.thisshop === true;
  const thisJob = doThis ? (async () => {
    try {
      const found = await refreshThisshopBySkus(items);
      if (found.length) {
        for (const f of found) results.push({ platform: 'thisshop', shop: 'THISSHOP', id: f.id, ok: true, skus: f.skus });
      } else {
        results.push({ platform: 'thisshop', shop: 'THISSHOP', id: '-', skipped: 'ThisShop ไม่พบตะกร้าที่มีรหัส SKU เหล่านี้' });
      }
    } catch (e) {
      results.push({ platform: 'thisshop', shop: 'THISSHOP', id: '-', error: String(e.message || e) });
    }
  })() : null;

  // ร้านเดียวกันทำทีละใบ (กันต่ออายุโทเคนซ้อนกัน) ต่างร้านทำพร้อมกัน
  const byShop = new Map();
  for (const it of items.filter((x) => x.platform !== 'thisshop')) {
    const k = `${it.platform}:${it.shop}`;
    if (!byShop.has(k)) byShop.set(k, []);
    byShop.get(k).push(it);
  }

  await Promise.all([thisJob, ...[...byShop.values()].map(async (group) => {
    const { platform, shop } = group[0];
    if (!API_PLATFORMS.includes(platform)) {
      for (const it of group) results.push({ ...it, skipped: 'ร้านนี้ไม่มี API ให้ดึงรายตะกร้า' });
      return;
    }
    let row;
    try {
      const rows = await listShops(platform);
      const found = rows.find((r) => r.shop === shop);
      if (!found) {
        for (const it of group) results.push({ ...it, skipped: 'ไม่พบโทเคนของร้านนี้ (ไม่มี API)' });
        return;
      }
      row = await usableToken(found);
    } catch (e) {
      for (const it of group) results.push({ ...it, error: String(e.message || e) });
      return;
    }
    for (const it of group) {
      try {
        const skus = platform === 'shopee' ? await refreshShopee(row, it.id)
          : platform === 'tiktok' ? await refreshTiktok(row, it.id)
            : await refreshLazada(row, it.id);
        results.push({ ...it, ok: true, skus });
      } catch (e) {
        results.push({ ...it, error: String(e.message || e) });
      }
    }
  })]);

  // ล้างที่จำไว้ของหน้า /compare, /product, /allsite — ให้หน้าถัดไปเห็นของใหม่
  if (results.some((r) => r.ok)) {
    revalidateTag('listings');
    revalidateTag('allsite');
    // ผลสำเร็จรูปของหน้า /compare (supabase/053) — เฉพาะกลุ่มที่แถวนี้อยู่ (ไม่ใช่ทุกกลุ่ม)
    // 1) ชุดอื่น (เกณฑ์ทับ 40/80, ไม่ซ่อน SKU/ตะกร้า) ทำให้เก่า → คนเปิดได้ก้อนเดิมทันที แล้วสร้างใหม่เบื้องหลัง
    // 2) ชุดค่าเริ่มต้น (thr 60 ซ่อนทั้งคู่) สร้างใหม่ "ให้เสร็จก่อนตอบ" — ไม่ลบทิ้งแล้วไปสร้างเบื้องหลัง
    //    เพราะหน้าจอสั่งโหลดใหม่ทันทีที่เราตอบ ถ้าก้อนยังไม่เสร็จหน้าจะได้ของเก่า/ต้องรอสร้างเองหลายวินาที
    //    (เคยเป็น: กดรีเฟรชแถว ขึ้น "สำเร็จ" แต่แถวไม่ขยับ ต้องเปลี่ยนหน้าแล้วกลับมา)
    // ถ้าสร้างใหม่ไม่สำเร็จ (ชนเพดานเวลาคิวรี) → ทำก้อนเดิมให้เก่า ไม่ลบทิ้ง
    //    (เคยลบ → ไม่มีก้อนเลย /compare ต้องสร้างเองแล้วก็ชนเพดานอีก ขึ้น "กำลังเตรียมข้อมูลของกลุ่ม…" ค้าง)
    //    ก้อนเก่า = หน้าใช้ของเดิมไปก่อน แล้วสร้างใหม่เบื้องหลัง (loadSnap ใน app/compare/page.js)
    // built_at ใหม่ทุกครั้ง (สุ่มมิลลิวินาที) เพราะที่จำร่วมของก้อนใช้ built_at เป็นกุญแจ — ดู lib/compareSnap.js
    const staleAt = () => new Date(Date.now() - 86400000 - Math.floor(Math.random() * 1000)).toISOString();
    const groups = [...new Set(results.filter((r) => r.ok).map((r) => shopGroup(r.platform, r.shop)).filter(Boolean))];
    if (body.compare === false) {
      for (const g of groups) await markCompareStale(g);
      return NextResponse.json({ ok: true, results });
    }
    // มุมมองแพลตฟอร์ม (P:shopee ฯลฯ — supabase/056): กลุ่มที่หน้าเปิดอยู่ สร้างใหม่ก่อนตอบด้วย · กลุ่มแพลตฟอร์มอื่นทำให้เก่า
    if (/^(P:[a-z]+|X:main)$/.test(String(body.group || ''))) groups.push(body.group);
    try {
      await db().from('os_compare_snap').update({ built_at: staleAt() })
        .or('grp.like.P:*,grp.like.X:*').neq('grp', String(body.group || ''));
    } catch { /* ยังไม่มีตาราง — ข้าม */ }
    for (const g of groups) {
      try {
        await db().from('os_compare_snap').update({ built_at: staleAt() }).eq('grp', g)
          .or('thr.neq.60,hide_skus.eq.false,hide_rows.eq.false');
        const { error } = await db().rpc('os_compare_build', { p_group: g, p_thr: 60, p_hide_skus: true, p_hide_rows: true });
        if (error) throw new Error(error.message);
      } catch {
        try { await db().from('os_compare_snap').update({ built_at: staleAt() }).eq('grp', g); } catch { /* ยังไม่มีตาราง — ข้าม */ }
      }
    }
  }
  return NextResponse.json({ ok: true, results });
}

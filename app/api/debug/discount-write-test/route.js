// ทดสอบคำสั่งแก้โปรส่วนลด Shopee แบบครบวงจร กับสินค้าทดสอบเท่านั้น — ห้ามใช้กับตะกร้าจริง
//
//   POST ?key=SYNC_SECRET  { shop: 'SOLID', itemId: '<ตะกร้า [TEST] ที่ซ่อนอยู่>' }
//
// ขั้นตอน (ทุกขั้นดึงกลับจาก Shopee มาเช็คว่าเปลี่ยนจริง):
//   0 เปิดขายตะกร้าทดสอบชั่วคราว (คลังต้องเป็น 0 — ตะกร้าที่ซ่อนอยู่เข้าโปรไม่ได้) · 6 ซ่อนกลับตอนจบเสมอ
//   1 สร้างโปร "[TEST] ลบได้ …" เริ่มอีก 2 ชั่วโมง (ยังไม่เริ่ม = ลบทิ้งได้ ไม่มีผลกับลูกค้า)
//   2 ใส่ตะกร้าทดสอบเข้าโปร ลด 10%   3 แก้เป็นลด 20%   4 เอาตัวเลือกแรกออก   5 ลบโปรทิ้ง
// กันพลาด: ตะกร้าต้องชื่อขึ้นต้น [TEST] และซ่อนอยู่ (UNLIST) · ลบได้เฉพาะโปรที่ชื่อขึ้นต้น [TEST] ที่สร้างในรอบนี้
import { NextResponse } from 'next/server';
import * as shopee from '@/lib/shopee';
import { listShops, storedToken } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  const url = new URL(req.url);
  if (!process.env.SYNC_SECRET || url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const shop = String(b.shop || 'SOLID');
  const itemId = String(b.itemId || '');
  if (!/^\d+$/.test(itemId)) return NextResponse.json({ ok: false, error: 'ต้องมี itemId' }, { status: 400 });

  const row = (await listShops('shopee')).find((r) => r.shop === shop);
  if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบร้าน' }, { status: 404 });
  const tok = storedToken(row);
  const auth = { accessToken: tok.access_token, shopId: tok.shop_id, partner: tok };
  const log = [];
  const step = (name, data) => log.push({ step: name, ...data });

  // ── กันพลาด: ต้องเป็นสินค้าทดสอบเท่านั้น ──
  const [it] = await shopee.getItemBaseInfo({ ...auth, itemIds: [itemId] });
  if (!it) return NextResponse.json({ ok: false, error: 'ไม่พบตะกร้านี้' }, { status: 404 });
  if (!String(it.item_name || '').startsWith('[TEST]') || it.item_status !== 'UNLIST') {
    return NextResponse.json({ ok: false, error: `ไม่ใช่สินค้าทดสอบ ([TEST] + ซ่อน) — ไม่ทำ (ชื่อ "${it.item_name}", สถานะ ${it.item_status})` }, { status: 400 });
  }
  const models = it.has_model ? ((await shopee.getModelList({ ...auth, itemId })).model || []) : [];
  const baseModels = models.length
    ? models.map((m) => ({ model_id: String(m.model_id), price: Number(m.price_info?.[0]?.original_price ?? 0) }))
    : [{ model_id: '0', price: Number(it.price_info?.[0]?.original_price ?? 0) }];
  step('ตะกร้าทดสอบ', { item_id: itemId, name: it.item_name, models: baseModels.length, prices: baseModels.slice(0, 3) });

  const read = async (discountId) => {
    const d = await retry(() => shopee.getDiscount({ ...auth, discountId }));
    return shopee.discountRows(d).map((r) => ({ sku_id: r.sku_id, price: r.price, promo: r.promo }));
  };
  const at = (pct) => baseModels.map((m) => ({ model_id: m.model_id, price: Math.round(m.price * (1 - pct / 100)) }));

  // Shopee ไม่ยอมให้ตะกร้าที่ซ่อนอยู่เข้าโปร (discount.item_status_invalid) → เปิดขายชั่วคราวระหว่างทดสอบ
  // ยอมเปิดเฉพาะเมื่อคลังทุกตัวเลือกเป็น 0 (ลูกค้าเห็นเป็นสินค้าหมด สั่งไม่ได้) · ซ่อนกลับใน finally เสมอ
  const stockOf = (x) => {
    const s = x.stock_info_v2?.summary_info?.total_available_stock;
    if (s !== undefined && s !== null) return Number(s);
    return (x.stock_info_v2?.seller_stock || []).reduce((n, y) => n + Number(y.stock || 0), 0);
  };
  const totalStock = models.length ? models.reduce((n, m) => n + stockOf(m), 0) : stockOf(it);
  if (totalStock !== 0) {
    return NextResponse.json({ ok: false, error: `ตะกร้าทดสอบมีคลัง ${totalStock} — ไม่เปิดขาย (ต้องเป็น 0 ลูกค้าจะได้สั่งไม่ได้)`, log }, { status: 400 });
  }
  // Shopee อัปเดตไม่ทันทีหลังเปิดขาย/สร้างโปร (เจอ common.error_not_found, error_server) → รอแล้วลองใหม่
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const retry = async (fn, tries = 4) => {
    for (let i = 1; ; i += 1) {
      try { return await fn(); } catch (e) {
        if (i >= tries || !/not_found|error_server|error_busy|Something wrong/i.test(String(e.message))) throw e;
        await sleep(2500 * i);
      }
    }
  };
  let listed = false;
  let discountId = null;
  try {
    await shopee.setUnlisted({ ...auth, itemId, unlist: false });
    listed = true;
    step('0 เปิดขายชั่วคราว (คลัง 0)', { ok: true });
    await sleep(4000);
    const now = Math.floor(Date.now() / 1000);
    discountId = await shopee.addDiscount({ ...auth, name: `[TEST] ลบได้ ${new Date().toISOString().slice(0, 16)}`, startTime: now + 2 * 3600, endTime: now + 26 * 3600 });
    step('1 สร้างโปรทดสอบ', { discount_id: discountId });

    const add = await retry(() => shopee.addDiscountItems({ ...auth, discountId, items: [{ item_id: itemId, models: at(10) }] }));
    step('2 ใส่เข้าโปร ลด 10%', { sent: at(10).slice(0, 3), errors: add.errors, readBack: (await read(discountId)).slice(0, 3) });

    const upd = await retry(() => shopee.updateDiscountItems({ ...auth, discountId, items: [{ item_id: itemId, models: at(20) }] }));
    step('3 แก้เป็นลด 20%', { sent: at(20).slice(0, 3), errors: upd.errors, readBack: (await read(discountId)).slice(0, 3) });

    const first = baseModels[0];
    const del = await retry(() => shopee.deleteDiscountItem({ ...auth, discountId, itemId, modelId: first.model_id }));
    const after = await read(discountId);
    step('4 เอาตัวเลือกแรกออก', { model_id: first.model_id, errors: del.errors, left: after.length, stillThere: after.some((r) => r.sku_id === (Number(first.model_id) ? first.model_id : itemId)) });
  } catch (e) {
    step('พัง', { error: String(e.message || e), payload: e.payload || null });
  } finally {
    if (discountId) {
      try {
        // discountId ได้จาก addDiscount ในคำขอนี้เท่านั้น = โปร [TEST] ที่เราสร้างเอง ลบได้เลย
        await retry(() => shopee.deleteDiscount({ ...auth, discountId }));
        step('5 ลบโปรทดสอบ', { discount_id: discountId, ok: true });
      } catch (e) {
        step('5 ลบโปรทดสอบไม่สำเร็จ — ต้องลบเองในหลังร้าน', { discount_id: discountId, error: String(e.message || e) });
      }
    }
    if (listed) {
      try {
        await retry(() => shopee.setUnlisted({ ...auth, itemId, unlist: true }));
        await sleep(3000);   // อ่านทันทีได้สถานะเก่า (เคยเห็น NORMAL ทั้งที่ซ่อนแล้ว)
        const [now] = await shopee.getItemBaseInfo({ ...auth, itemIds: [itemId] });
        step('6 ซ่อนตะกร้าทดสอบกลับ', { status: now?.item_status });
      } catch (e) {
        step('6 ซ่อนกลับไม่สำเร็จ — ต้องซ่อนเองในหลังร้าน!', { error: String(e.message || e) });
      }
    }
  }
  return NextResponse.json({ ok: !log.some((x) => x.step.startsWith('พัง')), log });
}

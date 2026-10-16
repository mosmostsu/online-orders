// คลังที่จะลงร้าน Shopee MVP — ส่วนขยาย Chrome (extensions/mvp-stock) ส่งรายการ SKU มา ได้จำนวนกลับไป
//
// MVP ผูก API ของ Shopee ไม่ได้ (ต้องเป็น Managed/Mall) จึงอัปเดตคลังผ่านไฟล์ Mass Update ของ Seller Center
// ส่วนขยายทำงานในเบราว์เซอร์ที่ล็อกอินร้านไว้ หน้าที่ของเว็บเราคือคิดตัวเลขให้อย่างเดียว
//
// สูตร: ST − ออเดอร์ที่สั่ง "หลัง" ไฟล์ ST ทุกสถานะที่กินของ (ติดลบ = 0)
//   os_st ไม่ใช่ ST ดิบ — Colab หักออเดอร์รอส่ง (ณ ตอนที่รัน) และบังคับ 0 ตามรายการของหมด
//   ก่อนส่ง central/ST.json ขึ้น Firebase แล้ว (ดู step อัปโหลด ST ใน sync_stock_all_platforms_v12)
//   ถ้าหักออเดอร์รอส่งทั้งหมดอีกรอบจะหักซ้ำ (เจอจริงรอบแรก 2026-10-09: ลดคลังเกินจริงหลายร้อยตัว)
//   จึงหักเฉพาะใบที่สั่งหลังเวลาไฟล์ ST — ระหว่างวันยังกันขายเกินได้ โดยไม่ซ้ำกับที่ Colab หักไปแล้ว
//   ไฟล์ ST เป็นภาพ ณ เวลาเดียว ใบที่สั่งหลังไฟล์จึงยังไม่ถูกตัดใน ST ไม่ว่าตอนนี้จะสถานะอะไร
//   (รอส่ง / แพ็คแล้ว / ส่งแล้ว / สำเร็จ) — เดิมนับแค่ to_ship ใบที่กดจัดส่งไปแล้วเลยไม่ถูกหัก คลังเกินจริง
//   ไม่นับ: ยังไม่จ่ายเงิน · ยกเลิกจบแล้ว — Shopee IN_CANCEL (ลูกค้าขอยกเลิก ร้านยังไม่อนุมัติ) ยังนับ
//   ตรรกะเดียวกับ consumes() ใน lib/autoZero.js (PR #120) — ถ้า merge แล้วให้ย้ายมาใช้ตัวเดียวกัน
// ไม่กันชิ้นสุดท้าย (≤2 → 0) — ผู้ใช้เลือกเอง 2026-10-09 ให้ของที่เหลือ 1-2 ชิ้นยังขายบน MVP ได้
// SKU ที่ไม่มีใน ST ตอบ null — ส่วนขยายคงค่าเดิมไว้และรายงานให้คนดู (อาจเป็นรหัสพิมพ์ผิดบน Shopee
// ถ้าตั้งเป็น 0 ทั้งหมด ตะกร้าที่ลงรหัสผิดจะหายจากหน้าร้านเงียบๆ)
//
// ป้องกันด้วย header x-key = MVP_STOCK_KEY (กุญแจแยกเฉพาะงานนี้ ทำได้แค่อ่านตัวเลขคลัง)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;


function authed(req) {
  const key = process.env.MVP_STOCK_KEY;
  return key && req.headers.get('x-key') === key;
}

// ใบนี้กินของในคลังไหม (ดูคอมเมนต์สูตรด้านบน)
const consumes = (o) => o.status !== 'unpaid' && !(o.status === 'cancelled' && o.raw_status !== 'IN_CANCEL');

// ออเดอร์ทุกร้านที่สั่งหลัง since และกินของ รวมเป็นจำนวนต่อ SKU (ไม่สนตัวพิมพ์เล็กใหญ่)
async function toShipBySku(sb, since) {
  const out = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('os_orders')
      .select('order_id, status, raw_status, os_order_items(sku, qty)')
      .gt('ordered_at', since)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error('อ่านออเดอร์ไม่สำเร็จ: ' + error.message);
    for (const o of data || []) {
      if (!consumes(o)) continue;
      for (const it of o.os_order_items || []) {
        const k = String(it.sku || '').trim().toLowerCase();
        if (k) out.set(k, (out.get(k) || 0) + (Number(it.qty) || 0));
      }
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function POST(req) {
  if (!process.env.MVP_STOCK_KEY) {
    return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง MVP_STOCK_KEY ที่ Netlify' }, { status: 503 });
  }
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const skus = [...new Set((body.skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!skus.length) return NextResponse.json({ ok: false, error: 'ไม่มี SKU' }, { status: 400 });
  if (skus.length > 20000) return NextResponse.json({ ok: false, error: 'SKU เยอะเกิน' }, { status: 400 });

  const sb = db();
  try {
    const st = new Map();
    for (let i = 0; i < skus.length; i += 300) {
      const { data, error } = await sb.from('os_st').select('sku, qty').in('sku', skus.slice(i, i + 300));
      if (error) throw new Error('อ่าน ST ไม่สำเร็จ: ' + error.message);
      for (const r of data || []) st.set(r.sku, Number(r.qty) || 0);
    }
    // เวลาไฟล์ ST (ก่อน Colab ส่งขึ้นไม่กี่นาที) — ใช้ตัวที่เก่ากว่าเผื่อไว้ ออเดอร์ช่วงรอยต่อหักซ้ำได้นิดหน่อยดีกว่าขายเกิน
    const { data: meta } = await sb.from('os_st_meta').select('file_modified, synced_at').eq('id', 1).maybeSingle();
    if (!meta?.file_modified) throw new Error('ไม่รู้เวลาของไฟล์ ST (os_st_meta ว่าง)');
    const toship = await toShipBySku(sb, meta.file_modified);

    const qty = {};
    let inSt = 0, lowered = 0;
    for (const s of skus) {
      if (!st.has(s)) { qty[s] = null; continue; }
      inSt++;
      const ship = toship.get(s.toLowerCase()) || 0;
      let n = Math.floor(st.get(s)) - ship;
      if (ship) lowered++;
      if (n < 0) n = 0;
      qty[s] = n;
    }
    return NextResponse.json({
      ok: true,
      st_file_at: meta?.file_modified || null,
      counts: { asked: skus.length, in_st: inSt, minus_toship: lowered },
      qty,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

// ไฟล์นำเข้า Seniorsoft จากของคืนที่รับแล้ว — "รหัส<TAB>จำนวน<TAB>ทุนล่าสุด" (ดู lib/returns seniorsoftLines)
// ทุนล่าสุด = ราคาต่อชิ้นในบิลรับของ (R04.201 / samchai-invoice) ใบล่าสุดของรหัสนั้นตรงๆ — os_costs.unit_cost (lib/costs)
//   ไม่ประมาณจากรหัสใกล้เคียง ไม่ใช้กฎ SCS ×70% ของหน้ากำไร · บิลไม่มีรหัสนี้ = ช่องว่าง
// แยกไฟล์ตามประเภท: ยกเลิกก่อนขนส่งรับ → "ยกเลิก-…" · ตีกลับ/ลูกค้าคืน → "ตีคืน-…" (lib/returns ssPrefix)
//   GET                            กล่องที่รับแล้วแต่ยังไม่เคยส่งไฟล์ (ss_at ว่าง) → { boxes, files:[{ prefix, ids, rows, pieces, noSku, text }] }
//   POST { ids }                   ทำไฟล์จากกล่องที่ติ๊ก/ยิงเลือก (ส่งไปแล้วก็ทำซ้ำได้ เผื่อไฟล์หาย)
//   POST { ids, mark:true }        จดว่าส่งแล้ว — หน้าเว็บเรียกหลังบันทึกไฟล์ลงโฟลเดอร์สำเร็จ
// ใบยกเลิกจัดการที่หน้าออเดอร์ ("หยิบของออกแล้ว") — ก่อนทำไฟล์ ดึงสถานะล่าสุดจากหน้าออเดอร์ก่อน (refreshCancelled)
//   ใบที่ยังไม่ได้หยิบ = ยังไม่รับ ไม่เข้าไฟล์
// ต้องรัน supabase/070_returns_seniorsoft.sql ก่อน (คอลัมน์ ss_at)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { seniorsoftLines, toSeniorsoft, ssPrefix } from '@/lib/returns';
import { refreshCancelled } from '@/lib/returnsSync';

export const dynamic = 'force-dynamic';

const COLS = 'id, order_id, kind, items, missing, recv, received_at, received_by';

function fail(e) {
  const msg = String(e?.message || e);
  if (/ss_at/.test(msg)) {
    return NextResponse.json({ ok: false, needSql: true, error: 'ต้องรัน supabase/070_returns_seniorsoft.sql ใน Supabase ก่อน' });
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

// { [sku ตัวเล็ก]: { c, date, bill } } จากบิลรับของล่าสุดของรหัสนั้น
async function billCosts(skus) {
  const want = [...new Set(skus.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < want.length; i += 200) {
    const { data, error } = await db().from('os_costs').select('sku_key, unit_cost, bill_date, tranno').in('sku_key', want.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const x of data || []) if (Number(x.unit_cost) > 0) out[x.sku_key] = { c: Number(x.unit_cost), date: x.bill_date, bill: x.tranno };
  }
  return out;
}

async function pack(boxes) {
  const groups = new Map();
  for (const b of boxes) {
    const p = ssPrefix(b.kind);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(b);
  }
  const parts = [...groups].map(([prefix, list]) => [prefix, list, seniorsoftLines(list)]);
  const costs = await billCosts(parts.flatMap(([, , x]) => x.rows.map((r) => r.sku)));
  const files = parts.map(([prefix, list, { rows: plain, noSku }]) => {
    const rows = plain.map((r) => {
      const c = costs[r.sku.toLowerCase()];
      return { ...r, cost: c?.c ?? null, billDate: c?.date || null, bill: c?.bill || null };
    });
    return {
      prefix, ids: list.map((b) => b.id), boxes: list.length, rows, noSku,
      pieces: rows.reduce((s, r) => s + r.qty, 0), noCost: rows.filter((r) => !r.cost).length, text: toSeniorsoft(rows),
    };
  }).filter((f) => f.rows.length || f.noSku);
  return { ok: true, boxes: files.reduce((s, f) => s + f.boxes, 0), files };
}

export async function GET() {
  try {
    await refreshCancelled(db());
    const { data, error } = await db().from('os_returns').select(COLS)
      .not('recv', 'is', null).is('ss_at', null)
      .order('received_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return NextResponse.json(await pack(data || []));
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 1000);
    if (!ids.length) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุกล่อง' }, { status: 400 });
    const sb = db();
    const now = new Date().toISOString();

    if (body.mark) {
      // ใบยกเลิกที่ยิง/ติ๊กเลือกก็จด แม้หน้าออเดอร์ยังไม่กดหยิบ (กันส่งซ้ำ)
      const { error } = await sb.from('os_returns').update({ ss_at: now }).in('id', ids).or('recv.not.is.null,kind.eq.cancel');
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, marked: ids.length });
    }

    await refreshCancelled(sb);
    const { data, error } = await sb.from('os_returns').select(COLS).in('id', ids);
    if (error) throw new Error(error.message);
    // ใบยกเลิกที่ยิง/ติ๊กเลือก เข้าไฟล์เต็มจำนวน แม้หน้าออเดอร์ยังไม่กดหยิบ
    const boxes = (data || []).map((b) => (b.kind === 'cancel' && !b.recv ? { ...b, recv: 'full' } : b)).filter((b) => b.recv);
    return NextResponse.json(await pack(boxes));
  } catch (e) { return fail(e); }
}

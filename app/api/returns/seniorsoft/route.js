// ไฟล์นำเข้า Seniorsoft จากของคืนที่รับแล้ว — "รหัส<TAB>จำนวน<TAB>ทุน" (ดู lib/returns seniorsoftLines)
// ทุน = ทุนต่อชิ้นตามบิลรับล่าสุด (os_costs จากไฟล์ R04.201) · รหัสที่ไม่เคยมีบิลเว้นว่าง
// แยกไฟล์ตามประเภท: ยกเลิกก่อนขนส่งรับ → "ยกเลิก-…" · ตีกลับ/ลูกค้าคืน → "ตีคืน-…" (lib/returns ssPrefix)
//   GET                            กล่องที่รับแล้วแต่ยังไม่เคยส่งไฟล์ (ss_at ว่าง) → { boxes, files:[{ prefix, ids, rows, pieces, noSku, text }] }
//   POST { ids }                   ทำไฟล์จากกล่องที่ติ๊ก/ยิงเลือก (ส่งไปแล้วก็ทำซ้ำได้ เผื่อไฟล์หาย)
//   POST { ids, mark:true }        จดว่าส่งแล้ว — หน้าเว็บเรียกหลังบันทึกไฟล์ลงโฟลเดอร์สำเร็จ
//   POST { ids, skip:'เหตุผล' }     ⛔ ไม่เข้า Seniorsoft (เคลม/ของผิด) — จด ss_at + ต้นหมายเหตุ ไม่มาในไฟล์อีก
//   POST { ids, unskip:true }      เอากลับเข้าไฟล์
// ใบยกเลิกจัดการที่หน้าออเดอร์ ("หยิบของออกแล้ว") — ก่อนทำไฟล์ ดึงสถานะล่าสุดจากหน้าออเดอร์ก่อน (refreshCancelled)
//   ใบที่ยังไม่ได้หยิบ = ยังไม่รับ ไม่เข้าไฟล์
// ต้องรัน supabase/070_returns_seniorsoft.sql ก่อน (คอลัมน์ ss_at)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { seniorsoftLines, toSeniorsoft, ssPrefix, withCosts, isSsSkip, ssSkipNote, ssUnskipNote } from '@/lib/returns';
import { refreshCancelled } from '@/lib/returnsSync';

export const dynamic = 'force-dynamic';

const COLS = 'id, order_id, kind, items, missing, recv, received_at, received_by, receive_note';

function fail(e) {
  const msg = String(e?.message || e);
  if (/ss_at/.test(msg)) {
    return NextResponse.json({ ok: false, needSql: true, error: 'ต้องรัน supabase/070_returns_seniorsoft.sql ใน Supabase ก่อน' });
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

// ทุนตามบิลรับล่าสุดต่อรหัส → { [รหัสตัวเล็ก]: ทุน }
async function billCosts(sb, skus) {
  const want = [...new Set(skus.map((s) => s.toLowerCase()))];
  const out = {};
  for (let i = 0; i < want.length; i += 200) {
    const { data, error } = await sb.from('os_costs').select('sku_key, unit_cost').in('sku_key', want.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const x of data || []) out[x.sku_key] = Number(x.unit_cost);
  }
  return out;
}

async function pack(sb, boxes) {
  const groups = new Map();
  for (const b of boxes) {
    const p = ssPrefix(b.kind);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(b);
  }
  const lines = [...groups].map(([prefix, list]) => ({ prefix, list, ...seniorsoftLines(list) }));
  const costs = await billCosts(sb, lines.flatMap((f) => f.rows.map((r) => r.sku)));
  const files = lines.map(({ prefix, list, noSku, ...f }) => {
    const rows = withCosts(f.rows, costs);
    return {
      prefix, ids: list.map((b) => b.id), boxes: list.length, rows, noSku,
      pieces: rows.reduce((s, r) => s + r.qty, 0),
      noCost: rows.filter((r) => !r.cost).length,
      text: toSeniorsoft(rows),
    };
  }).filter((f) => f.rows.length || f.noSku);
  return { ok: true, boxes: files.reduce((s, f) => s + f.boxes, 0), files };
}

export async function GET() {
  try {
    const sb = db();
    await refreshCancelled(sb);
    const { data, error } = await sb.from('os_returns').select(COLS)
      .not('recv', 'is', null).is('ss_at', null)
      .order('received_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return NextResponse.json(await pack(sb, data || []));
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

    if (body.skip !== undefined || body.unskip) {
      const { data, error } = await sb.from('os_returns').select('id, recv, receive_note, ss_at').in('id', ids);
      if (error) throw new Error(error.message);
      let n = 0;
      for (const b of data || []) {
        let patch;
        if (body.unskip) {
          if (!isSsSkip(b.receive_note)) continue;
          patch = { ss_at: null, receive_note: ssUnskipNote(b.receive_note) };
        } else {
          if (!b.recv) continue;                                 // ยังไม่รับ ไม่ต้องกัน (ไม่เข้าไฟล์อยู่แล้ว)
          if (b.ss_at && !isSsSkip(b.receive_note)) continue;    // ส่งไฟล์ไปแล้ว กันย้อนหลังไม่ได้
          patch = { ss_at: b.ss_at || now, receive_note: ssSkipNote(body.skip, b.receive_note) };
        }
        const { error: e2 } = await sb.from('os_returns').update({ ...patch, updated_at: now }).eq('id', b.id);
        if (e2) throw new Error(e2.message);
        n += 1;
      }
      return NextResponse.json({ ok: true, changed: n });
    }

    await refreshCancelled(sb);
    const { data, error } = await sb.from('os_returns').select(COLS).in('id', ids);
    if (error) throw new Error(error.message);
    // ใบยกเลิกที่ยิง/ติ๊กเลือก เข้าไฟล์เต็มจำนวน แม้หน้าออเดอร์ยังไม่กดหยิบ · กล่อง ⛔ ไม่เข้า Seniorsoft ไม่เข้าไฟล์แม้ติ๊ก
    const boxes = (data || []).filter((b) => !isSsSkip(b.receive_note))
      .map((b) => (b.kind === 'cancel' && !b.recv ? { ...b, recv: 'full' } : b)).filter((b) => b.recv);
    return NextResponse.json(await pack(sb, boxes));
  } catch (e) { return fail(e); }
}

// ไฟล์นำเข้า Seniorsoft จากของคืนที่รับแล้ว — "รหัส<TAB>จำนวน" (ดู lib/returns seniorsoftLines)
// แยกไฟล์ตามประเภท: ยกเลิกก่อนขนส่งรับ → "ยกเลิก-…" · ตีกลับ/ลูกค้าคืน → "ตีคืน-…" (lib/returns ssPrefix)
//   GET                            กล่องที่รับแล้วแต่ยังไม่เคยส่งไฟล์ (ss_at ว่าง) → { boxes, files:[{ prefix, ids, rows, pieces, noSku, text }] }
//   POST { ids }                   ทำไฟล์จากกล่องที่ติ๊กเลือก (ส่งไปแล้วก็ทำซ้ำได้ เผื่อไฟล์หาย)
//                                  ใบยกเลิกที่ติ๊กแต่ยังไม่ได้รับ นับว่าครบ (ของอยู่ที่ร้าน ไม่ต้องยิงก่อน)
//   POST { ids, mark:true, by }    จดว่าส่งแล้ว — หน้าเว็บเรียกหลังบันทึกไฟล์ลงโฟลเดอร์สำเร็จ
//                                  ใบยกเลิกที่ยังไม่ได้รับ จดรับครบให้ + "หยิบของออกแล้ว" ในหน้าออเดอร์
// ต้องรัน supabase/070_returns_seniorsoft.sql ก่อน (คอลัมน์ ss_at)
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { seniorsoftLines, toSeniorsoft, ssPrefix } from '@/lib/returns';

export const dynamic = 'force-dynamic';

const COLS = 'id, order_id, kind, items, missing, recv, received_at, received_by';

function fail(e) {
  const msg = String(e?.message || e);
  if (/ss_at/.test(msg)) {
    return NextResponse.json({ ok: false, needSql: true, error: 'ต้องรัน supabase/070_returns_seniorsoft.sql ใน Supabase ก่อน' });
  }
  return NextResponse.json({ ok: false, error: msg }, { status: 500 });
}

function pack(boxes) {
  const groups = new Map();
  for (const b of boxes) {
    const p = ssPrefix(b.kind);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(b);
  }
  const files = [...groups].map(([prefix, list]) => {
    const { rows, noSku } = seniorsoftLines(list);
    return {
      prefix, ids: list.map((b) => b.id), boxes: list.length, rows, noSku,
      pieces: rows.reduce((s, r) => s + r.qty, 0), text: toSeniorsoft(rows),
    };
  }).filter((f) => f.rows.length || f.noSku);
  return { ok: true, boxes: files.reduce((s, f) => s + f.boxes, 0), files };
}

export async function GET() {
  try {
    const { data, error } = await db().from('os_returns').select(COLS)
      .not('recv', 'is', null).is('ss_at', null)
      .order('received_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return NextResponse.json(pack(data || []));
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
      const by = String(body.by || '').trim().slice(0, 60) || 'ส่งไฟล์ Seniorsoft';
      // ใบยกเลิกที่ติ๊กส่งออกโดยไม่ได้ยิงรับ = รับครบ
      const { data: got, error: e1 } = await sb.from('os_returns')
        .update({ recv: 'full', received_at: now, received_by: by, updated_at: now })
        .in('id', ids).eq('kind', 'cancel').is('recv', null).select('order_id');
      if (e1) throw new Error(e1.message);
      if (got?.length) {
        await sb.from('os_orders').update({ pulled_at: now, pulled_by: by, pull_note: 'แพ็คแล้ว + หยิบของออกแล้ว' })
          .in('order_id', got.map((r) => r.order_id)).is('pulled_at', null);
      }
      const { error } = await sb.from('os_returns').update({ ss_at: now }).in('id', ids).not('recv', 'is', null);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, marked: ids.length });
    }

    const { data, error } = await sb.from('os_returns').select(COLS).in('id', ids);
    if (error) throw new Error(error.message);
    const boxes = (data || [])
      .map((b) => (b.kind === 'cancel' && !b.recv ? { ...b, recv: 'full' } : b))
      .filter((b) => b.recv);
    return NextResponse.json(pack(boxes));
  } catch (e) { return fail(e); }
}

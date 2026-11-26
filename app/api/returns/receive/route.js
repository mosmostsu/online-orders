// รับของคืน — พนักงานยิงบาร์โค้ดกล่อง / กดปุ่ม "รับ" บนหน้า /returns
// POST JSON:
//   { code, peek:true }              ยิงบาร์โค้ด → หากล่องให้ดูก่อน ยังไม่บันทึก (หน้า /returns ใช้แบบนี้ แล้วกด "ตกลง")
//   { ids:[…], by }                  ตกลงรับครบทีละหลายกล่อง
//   { code, by }                     ยิงบาร์โค้ด → หาทุกกล่องที่ตรง แล้วจดว่ารับครบทันที
//   { id, by }                       กดรับทีละแถว (บาร์โค้ดอ่านไม่ออก)
//   { id, by, missing:[{sku,qty}], note }   เปิดกล่องแล้วของไม่ครบ → รับไม่ครบ (แก้ทับได้แม้รับไปแล้ว)
//   { id | ids, undo:true }          ยกเลิกการรับ (ยิงผิดใบ)
// ใบ "ยกเลิกก่อนขนส่งรับ" (kind cancel) จัดการที่หน้าออเดอร์เท่านั้น (ปุ่ม "หยิบของออกแล้ว") — ที่นี่ไม่รับ/ไม่ยกเลิกให้
//   ยิงเจอ ตอบกลับไปให้หน้าเว็บบอกพนักงาน (peek) แต่ไม่บันทึก
// ไม่แตะอะไรบนแพลตฟอร์ม · ไม่ตัด/เพิ่มสต็อก
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { normCode, SS_SKIP } from '@/lib/returns';
import { failedBox, saveBoxes } from '@/lib/returnsSync';

export const dynamic = 'force-dynamic';

const COLS = 'id, platform, shop, order_id, kind, return_id, tracking_no, items, reason, state, arrived_at, recv, received_at, received_by, receive_note, missing';

// หากล่องจากโค้ดที่ยิง — เลขพัสดุก่อน แล้วค่อยเลขออเดอร์ / เลขคำขอคืน
async function findByCode(sb, code) {
  const { data: byTrack, error } = await sb.from('os_returns').select(COLS).ilike('tracking_no', code);
  if (error) throw new Error(error.message);
  if (byTrack?.length) return byTrack;
  const { data: byId, error: e2 } = await sb.from('os_returns').select(COLS).or(`order_id.eq.${code},return_id.eq.${code}`);
  if (e2) throw new Error(e2.message);
  if (byId?.length) return byId;

  // ยังไม่มีในตาราง (รอบดึงยังไม่มาถึง) — ถ้าเป็นออเดอร์ตีกลับ สร้างกล่องให้เลย ไม่ต้องรอ
  const { data: ords } = await sb.from('os_orders')
    .select('order_id, platform, shop, status, collected_at, raw_status, tracking_no, carrier, cancel_reason, cancelled_at, platform_updated_at,' +
      ' os_order_items(sku, product_name, qty, image_url)')
    .or(`order_id.eq.${code},tracking_no.ilike.${code}*`)
    .limit(5);
  const boxes = (ords || []).filter((o) => o.status === 'cancelled' && o.collected_at).map(failedBox).filter(Boolean);
  if (!boxes.length) return [];
  await saveBoxes(sb, boxes);
  const { data: made } = await sb.from('os_returns').select(COLS).in('ret_key', boxes.map((b) => b.ret_key));
  return made || [];
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sb = db();
    const by = String(body.by || '').trim().slice(0, 60);
    const note = String(body.note || '').trim().slice(0, 500) || null;
    const missing = Array.isArray(body.missing)
      ? body.missing.filter((m) => m?.sku).map((m) => ({ sku: String(m.sku), qty: Math.max(1, Number(m.qty) || 1) }))
      : [];

    // กล่องที่ระบุมาตรง ๆ (ปุ่มในตาราง / ปุ่มตกลงในช่องยิง ส่งมาทีเดียวหลายกล่องได้)
    const ids = (Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []).map(Number).filter(Boolean).slice(0, 200);

    if (body.undo) {
      if (!ids.length) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุกล่อง' }, { status: 400 });
      // กล่องที่กด ⛔ ไม่เข้า Seniorsoft ไว้ — ล้าง ss_at ด้วย รับใหม่แล้วจะได้เข้าไฟล์ได้ (กล่องที่ส่งไฟล์จริงแล้วคง ss_at ไว้ กันส่งซ้ำ)
      const { error: e1 } = await sb.from('os_returns').update({ ss_at: null })
        .in('id', ids).neq('kind', 'cancel').like('receive_note', `${SS_SKIP}%`);
      if (e1) throw new Error(e1.message);
      const { data, error } = await sb.from('os_returns')
        .update({ recv: null, received_at: null, received_by: null, receive_note: null, missing: null, updated_at: new Date().toISOString() })
        .in('id', ids).neq('kind', 'cancel').select(COLS);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, undone: true, rows: data || [] });
    }

    if (!by && !body.peek) return NextResponse.json({ ok: false, error: 'ใส่ชื่อคนรับก่อน' }, { status: 400 });

    let rows;
    if (ids.length) {
      const { data, error } = await sb.from('os_returns').select(COLS).in('id', ids);
      if (error) throw new Error(error.message);
      rows = data || [];
    } else {
      const code = normCode(body.code);
      if (!code) return NextResponse.json({ ok: false, error: 'ไม่มีเลขที่ยิงมา' }, { status: 400 });
      // ตัดตัวอักษรแปลก ๆ ทิ้ง กันใส่เงื่อนไขค้นหาแทรกมาในโค้ด
      if (!/^[A-Z0-9-]+$/.test(code)) return NextResponse.json({ ok: true, notFound: true, code, rows: [] });
      rows = await findByCode(sb, code);
      if (!rows.length) return NextResponse.json({ ok: true, notFound: true, code, rows: [] });
    }

    // ยิงแล้วยังไม่บันทึก — ให้พนักงานเปิดกล่องเช็คของก่อน แล้วกด "ตกลง" (ส่ง ids กลับมา)
    if (body.peek) return NextResponse.json({ ok: true, rows: rows.map((r) => ({ ...r, already: !!r.recv })) });

    const now = new Date().toISOString();
    rows = rows.filter((r) => r.kind !== 'cancel');   // ใบยกเลิก จัดการที่หน้าออเดอร์
    const editMissing = ids.length > 0 && (missing.length || note);   // แก้เป็นรับไม่ครบ/ใส่หมายเหตุ ทับของเดิมได้
    const out = [];
    for (const r of rows) {
      if (r.recv && !editMissing) { out.push({ ...r, already: true }); continue; }
      const patch = {
        recv: missing.length ? 'partial' : 'full',
        received_at: r.received_at || now,
        received_by: r.received_by || by,
        receive_note: note ?? r.receive_note ?? null,
        missing: missing.length ? missing : null,
        state: 'arrived',
        arrived_at: r.arrived_at || now,
        updated_at: now,
      };
      const { data, error } = await sb.from('os_returns').update(patch).eq('id', r.id).select(COLS).single();
      if (error) throw new Error(error.message);
      out.push({ ...data, already: false });
    }
    return NextResponse.json({ ok: true, rows: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

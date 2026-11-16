// บันทึก/ลบข้อมูลหน้า Studio — คลิป, งานถ่าย, ข้อมูลเสริมโฟลเดอร์ฟุต
// ต้องปลดล็อก SALES_PIN (middleware: needsPin) · รับเฉพาะคอลัมน์ที่อนุญาต ไม่แตะตารางอื่น
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { isStatus, isShop } from '@/lib/studio';

export const dynamic = 'force-dynamic';

const str = (v, max = 2000) => (v == null || v === '' ? null : String(v).slice(0, max));
const int = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const url = (v) => (/^https?:\/\//i.test(String(v || '')) ? String(v).slice(0, 1000) : null);
const arr = (v, max = 40) => (Array.isArray(v) ? v.slice(0, max).map((x) => String(x).slice(0, 300)) : []);

const KINDS = {
  clip: {
    table: 'os_studio_clips', pk: 'id',
    clean(r) {
      const d = date(r.date);
      if (!d) throw new Error('ต้องมีวันที่');
      if (!str(r.product)) throw new Error('ต้องมีชื่อสินค้า');
      const status = r.status || 'idea';
      if (!isStatus(status)) throw new Error('สถานะไม่ถูกต้อง');
      const shop = r.shop || 'SOLID';
      if (!isShop(shop)) throw new Error('ร้านไม่ถูกต้อง');
      return {
        date: d, slot: int(r.slot) || 0, shop, status,
        product: str(r.product, 200), folder: str(r.folder, 200), angle: str(r.angle, 300), length_s: int(r.length_s),
        caption: str(r.caption, 2200), hashtags: arr(r.hashtags, 30), basket_url: url(r.basket_url),
        file: str(r.file, 300), note: str(r.note, 2000), posted_url: url(r.posted_url),
        // video_url มีหลังรัน 068 — ส่งเฉพาะตอนมีคีย์นี้ กันบันทึกพังถ้ายังไม่ได้รัน
        ...('video_url' in r ? { video_url: url(r.video_url) } : {}),
      };
    },
  },
  shoot: {
    table: 'os_studio_shoots', pk: 'id',
    clean(r) {
      if (!str(r.product)) throw new Error('ต้องมีชื่อสินค้า');
      const shots = arr(r.shots, 40);
      return {
        product: str(r.product, 200), folder: str(r.folder, 200), due: date(r.due), done: Boolean(r.done),
        shots, got: shots.map((_, i) => Boolean((r.got || [])[i])),
      };
    },
  },
  folder: {
    table: 'os_studio_folders', pk: 'key',
    clean(r) {
      const baskets = {};
      for (const [k, v] of Object.entries(r.baskets || {})) {
        if (!isShop(k) || !v) continue;
        if (v.url) { const u = url(v.url); if (u) baskets[k] = { url: u }; }
        else if (v.id && /^\d{1,30}$/.test(String(v.id))) baskets[k] = { platform: v.platform === 'shopee' ? 'shopee' : 'tiktok', id: String(v.id) };
      }
      return { shops: arr(r.shops, 4).filter(isShop), baskets };
    },
  },
};

export async function POST(req) {
  try {
    const { kind, op, row } = await req.json();
    const K = KINDS[kind];
    if (!K || !row) return NextResponse.json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, { status: 400 });
    const id = row[K.pk];
    if (op === 'delete') {
      if (!id) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุรายการ' }, { status: 400 });
      const { error } = await db().from(K.table).delete().eq(K.pk, id);
      if (error) throw new Error(error.message);
    } else if (op === 'upsert') {
      let data;
      try { data = K.clean(row); } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
      if (kind === 'folder') { if (!id) return NextResponse.json({ ok: false, error: 'ไม่ได้ระบุโฟลเดอร์' }, { status: 400 }); data.key = String(id).slice(0, 200); }
      else if (id) data.id = id;
      data.updated_at = new Date().toISOString();
      const { data: saved, error } = await db().from(K.table).upsert(data, { onConflict: K.pk }).select().single();
      if (error) throw new Error(error.message);
      revalidatePath('/studio');
      return NextResponse.json({ ok: true, row: saved });
    } else {
      return NextResponse.json({ ok: false, error: 'คำสั่งไม่ถูกต้อง' }, { status: 400 });
    }
    revalidatePath('/studio');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

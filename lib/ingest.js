// เก็บออเดอร์ลง DB — ใช้ร่วมกันทุกแพลตฟอร์ม (รับรูปแบบกลางจาก normalizeOrder ของแต่ละตัว)
import { db } from './supabase.js';

export async function upsertOrders(records) {
  if (!records.length) return { upserted: 0 };
  const sb = db();

  const { data: rows, error } = await sb
    .from('os_orders')
    .upsert(records.map((r) => r.order), { onConflict: 'platform,shop,order_id' })
    .select('id, platform, shop, order_id');
  if (error) throw new Error('บันทึกออเดอร์ไม่สำเร็จ: ' + error.message);

  const idOf = new Map(rows.map((r) => [`${r.platform}|${r.shop}|${r.order_id}`, r.id]));
  const items = [];
  for (const r of records) {
    const ref = idOf.get(`${r.order.platform}|${r.order.shop}|${r.order.order_id}`);
    if (!ref) continue;
    for (const it of r.items) items.push({ ...it, order_ref: ref });
  }

  if (items.length) {
    const { error: e2 } = await sb.from('os_order_items').upsert(items, { onConflict: 'order_ref,line_id' });
    if (e2) throw new Error('บันทึกรายการสินค้าไม่สำเร็จ: ' + e2.message);
  }
  return { upserted: rows.length, items: items.length };
}

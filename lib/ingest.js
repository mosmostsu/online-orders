// เก็บออเดอร์ลง DB — ใช้ร่วมกันทุกแพลตฟอร์ม (รับรูปแบบกลางจาก normalizeOrder ของแต่ละตัว)
import { db } from './supabase.js';

// เวลากดจัดส่งที่เคยบันทึกไว้แล้ว ห้ามถูกเขียนทับ
//   - เป็นว่าง: บางแพลตฟอร์มล้างค่านี้ทิ้งตอนยกเลิก ถ้าปล่อยให้ว่าง ระบบจะเข้าใจว่ายังไม่กดจัดส่ง
//     (คืนคลังให้ของที่แพ็คไปแล้ว — ดู lib/autoZero.js)
//   - เป็นเวลาใหม่: Shopee/Lazada ไม่มีเวลากดส่งจริง ใช้ "เวลาที่ออเดอร์ขยับล่าสุด" แทน
//     ถ้าไม่ล็อกไว้ พอขนส่งรับ/ของถึงมือ เวลากดส่งจะเลื่อนตาม แล้วหน้ารอบจัดส่ง (app/round) จับรอบผิด
// แก้ค่าใน records ตรงๆ ให้คนที่ใช้ records ต่อเห็นค่าเดิมด้วย
async function keepRtsAt(sb, records) {
  for (let i = 0; i < records.length; i += 200) {
    const part = records.slice(i, i + 200);
    const { data, error } = await sb.from('os_orders')
      .select('platform, shop, order_id, rts_at')
      .in('order_id', part.map((r) => r.order.order_id))
      .not('rts_at', 'is', null);
    if (error) throw new Error('อ่านเวลากดจัดส่งเดิมไม่สำเร็จ: ' + error.message);
    const old = new Map((data || []).map((o) => [`${o.platform}|${o.shop}|${o.order_id}`, o.rts_at]));
    for (const r of part) {
      const prev = old.get(`${r.order.platform}|${r.order.shop}|${r.order.order_id}`);
      if (prev) r.order.rts_at = prev;
    }
  }
}

export async function upsertOrders(records) {
  if (!records.length) return { upserted: 0 };
  const sb = db();
  await keepRtsAt(sb, records);

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

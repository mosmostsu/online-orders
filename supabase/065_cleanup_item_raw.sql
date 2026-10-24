-- ตัวล้างข้อมูลอัตโนมัติ (ทับของ 014) — รันต่อจาก 064 · รันซ้ำได้
--
-- เพิ่ม: ล้างก้อนดิบ (raw) ของ os_order_items เมื่อใบเก่าเกิน 7 วัน เหมือน os_orders
-- ก่อนหน้านี้ล้างแค่ของ os_orders — ของรายการสินค้าค้างไว้ทุกแถว (~22 MB, 2026-10-23) ทั้งที่ไม่มีหน้าไหนอ่าน
-- เปลี่ยน: raw ของ os_orders เก่าเกิน 7 วัน ตัดให้เหลือแค่ที่อยู่/พัสดุ/ขนส่ง แทนการทิ้งทั้งก้อน (หน้ารายละเอียดใบยังโชว์ได้)
-- เปลี่ยน: ออเดอร์ที่จบแล้ว (ส่งถึง/สำเร็จ) เก็บ 90 วัน เท่าออเดอร์ยกเลิก (เดิม 30) — ร้านขอเก็บไว้ดูย้อนหลัง 3 เดือน
--
-- ⚠️ pg_cron ไม่ได้เปิดในโปรเจกต์นี้ (cron.job ไม่มี) → schedule ใน 005 ไม่เคยติด
-- ตัวนี้จึงไม่เคยรันเลยตั้งแต่ ก.พ. 2026 จนฐานข้อมูลโตถึง 436/500 MB
-- ตอนนี้เรียกวันละครั้งจาก Netlify (netlify/functions/cleanup.mjs → /api/cleanup)
--
-- รอบแรกมีของค้างหลายเดือน — รันเองใน SQL Editor ก่อน (ไม่ติดเพดานเวลาของ API):
--   select os_cleanup();
--   vacuum full os_orders; vacuum full os_order_items; vacuum full os_order_events; vacuum full os_sync_log;
-- (ลบแถวอย่างเดียวพื้นที่ไม่คืน ต้อง vacuum full · ล็อกตารางชั่วครู่ ทำตอนไม่มีคนใช้)

create or replace function os_cleanup() returns text as $$
declare
  items_cleared int;
  cleared int;
  removed int;
  events_removed int;
  money_removed int;
begin
  update os_order_items i set raw = null
    from os_orders o
   where o.id = i.order_ref and i.raw is not null and o.ordered_at < now() - interval '7 days';
  get diagnostics items_cleared = row_count;

  -- ไม่ทิ้งทั้งก้อน: หน้า /orders/[id] ยังอ่าน ชื่อ/โทร/ที่อยู่/เลขพัสดุ/ขนส่ง จากก้อนนี้ (ร้านย้อนดูใบเก่าบ้าง เช่น ตีคืน/เคลม)
  -- เหลือไว้แค่ 3 คีย์ที่หน้านั้นใช้ ตัดที่เหลือ (ส่วนใหญ่ของก้อน) · ใบที่ตัดแล้วไม่โดนซ้ำ
  update os_orders
     set raw = jsonb_strip_nulls(jsonb_build_object(
           'recipient_address', raw->'recipient_address',
           'packages', raw->'packages',
           'delivery_option_name', raw->'delivery_option_name'))
   where raw is not null and ordered_at < now() - interval '7 days'
     and raw - array['recipient_address', 'packages', 'delivery_option_name'] <> '{}'::jsonb;
  get diagnostics cleared = row_count;

  delete from os_orders
   where pulled_at is null
     and (
       status in ('done', 'delivered', 'cancelled') and ordered_at < now() - interval '90 days'
     );
  get diagnostics removed = row_count;

  delete from os_order_events where at < now() - interval '90 days';
  get diagnostics events_removed = row_count;

  delete from os_money_tx where statement_at < now() - interval '60 days';
  get diagnostics money_removed = row_count;

  delete from os_sync_log where started_at < now() - interval '14 days';

  return format('ล้าง raw %s ใบ / %s รายการ · ลบออเดอร์ %s ใบ · ลบประวัติ %s แถว · ลบรายการเงิน %s แถว',
                cleared, items_cleared, removed, events_removed, money_removed);
end;
$$ language plpgsql;

-- เวลาขนส่งรับของ (collected_at) ได้มาแล้วห้ามหาย
--
-- ปัญหา: Lazada ไม่บอกเวลาขนส่งรับ — lib/lazada.js ใส่ collected_at เฉพาะตอนสถานะ "ส่งแล้ว" ขึ้นไป
-- พอส่งไม่สำเร็จ/ลูกค้าปฏิเสธ แล้ว Lazada เปลี่ยนเป็นยกเลิก sync รอบถัดไปส่ง collected_at = null มาทับ
-- ออเดอร์ที่ของอยู่กับขนส่งแล้ว (กำลังตีกลับ) เลยไปโผล่ในกอง "ยกเลิกก่อนขนส่งเข้ารับ" ผิดๆ
--
-- แก้ที่ชั้น DB ให้ครอบทุกทางที่เขียนเข้ามา (sync / webhook / ปุ่มดึง):
--   1) ค่าเดิมมีแล้ว ห้ามถูกล้างเป็นว่าง
--   2) ยกเลิกจากสถานะที่ขนส่งรับไปแล้ว (shipped/delivered/done) แต่ไม่มีเวลารับ → ใช้เวลาสถานะขยับล่าสุดก่อนยกเลิก
create or replace function os_keep_collected_at() returns trigger as $$
begin
  new.collected_at := coalesce(new.collected_at, old.collected_at);
  if new.collected_at is null
     and new.status = 'cancelled'
     and (old.status in ('shipped', 'delivered', 'done') or new.cancelled_from in ('shipped', 'delivered', 'done')) then
    new.collected_at := coalesce(old.platform_updated_at, old.rts_at, now());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists os_orders_z_keep_collected on os_orders;
-- ชื่อขึ้นต้น "os_orders_z" ให้ทำงานหลัง os_orders_cancel_source (trigger ชนิดเดียวกันเรียงตามชื่อ) จะได้เห็น cancelled_from แล้ว
create trigger os_orders_z_keep_collected
  before update on os_orders
  for each row execute function os_keep_collected_at();

-- ซ่อมของเก่า: ใบยกเลิกที่ไม่มีเวลารับ แต่ประวัติบอกว่าเคยถึงขั้นขนส่งรับแล้ว
update os_orders o
   set collected_at = coalesce(
         (select min(e.at) from os_order_events e
           where e.order_ref = o.id and e.to_status in ('shipped', 'delivered', 'done')),
         o.cancelled_at, o.rts_at)
 where o.status = 'cancelled'
   and o.collected_at is null
   and (o.cancelled_from in ('shipped', 'delivered', 'done')
        or exists (select 1 from os_order_events e
                    where e.order_ref = o.id and e.to_status in ('shipped', 'delivered', 'done')));

-- Lazada ที่ sync ไม่เคยเห็นขั้น "ส่งแล้ว" (ข้ามไปยกเลิกเลย) — ดูจากเหตุผลว่าขนส่งไปส่งแล้ว (ตรงกับ DELIVERY_FAILED ใน lib/lazada.js)
update os_orders
   set collected_at = coalesce(cancelled_at, rts_at)
 where platform = 'lazada'
   and status = 'cancelled'
   and collected_at is null
   and (lower(raw_status) in ('failed', 'failed_delivery', 'returned', 'shipped_back', 'shipped_back_success',
                              'shipped_back_failed', 'lost_by_3pl', 'damaged_by_3pl', 'package_scrapped')
        or cancel_reason ~* '(ติดต่อลูกค้า|ปฏิเสธ(การ)?รับ|ส่งไม่สำเร็จ|ตีกลับ|ขนส่งทำ|สูญหาย|failed.?delivery|delivery.?fail|refus|unreachable|lost)');

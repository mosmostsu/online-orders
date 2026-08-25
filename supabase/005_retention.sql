-- ล้างของเก่าอัตโนมัติ ไม่ให้พื้นที่เต็ม — รันต่อจาก 004
--
-- ร้านนี้ออก ~1,500 ใบ/วัน = ~9 MB/วัน ถ้าเก็บทุกอย่างไว้ตลอด โควต้าฟรี 500 MB เต็มใน 2 เดือน
-- ข้อมูลตัวจริงอยู่ที่ TikTok อยู่แล้ว เราแค่ยืมมาใช้ทำงานประจำวัน จึงไม่ต้องเก็บถาวร
--
-- กติกา:
--   ก้อนข้อมูลดิบ (raw)  เก็บ 7 วัน   — ไว้ขุดฟิลด์เพิ่มตอนพัฒนา พ้นจากนั้นไม่ได้ใช้
--   ออเดอร์ที่จบแล้ว     เก็บ 30 วัน  — ส่งถึงมือ/สำเร็จแล้ว ไม่มีงานค้าง
--   ออเดอร์ยกเลิก        เก็บ 90 วัน  — ไว้ดูสถิติว่าเสียหายเดือนละเท่าไหร่
--   ใบที่ยังไม่จัดการ    ไม่ลบ       — งานค้างต้องอยู่จนกว่าจะมีคนกดปิด

create or replace function os_cleanup() returns text as $$
declare
  cleared int;
  removed int;
  events_removed int;
begin
  -- ทิ้งก้อนดิบของใบเก่า (กินพื้นที่ ~70% แต่ใช้จริงแค่ตอนพัฒนา)
  update os_orders set raw = null
   where raw is not null and ordered_at < now() - interval '7 days';
  get diagnostics cleared = row_count;

  -- ลบใบที่จบแล้วและไม่มีงานค้าง
  delete from os_orders
   where pulled_at is null
     and (
       (status in ('done', 'delivered') and ordered_at < now() - interval '30 days')
       or (status = 'cancelled' and ordered_at < now() - interval '90 days')
     );
  get diagnostics removed = row_count;

  -- ประวัติการเปลี่ยนสถานะที่เก่ามาก
  delete from os_order_events where at < now() - interval '90 days';
  get diagnostics events_removed = row_count;

  delete from os_sync_log where started_at < now() - interval '14 days';

  return format('ล้าง raw %s แถว · ลบออเดอร์ %s ใบ · ลบประวัติ %s แถว', cleared, removed, events_removed);
end;
$$ language plpgsql;

-- ให้ฐานข้อมูลรันเองทุกวันตี 3 (เวลาไทย = 20:00 UTC)
-- ถ้า pg_cron ไม่ได้เปิดในโปรเจกต์นี้ บรรทัดนี้จะข้ามไป แล้วค่อยเรียก /api/cleanup แทน
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('os_cleanup_daily') where exists (select 1 from cron.job where jobname = 'os_cleanup_daily');
  perform cron.schedule('os_cleanup_daily', '0 20 * * *', 'select os_cleanup()');
  raise notice 'ตั้งให้ล้างเองทุกวันตี 3 แล้ว';
exception when others then
  raise notice 'เปิด pg_cron ไม่ได้ (%) — ใช้ /api/cleanup แทน', sqlerrm;
end $$;

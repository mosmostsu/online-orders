-- นับทุกกองในครั้งเดียว — รันต่อจาก 008
-- เดิมหน้าเว็บยิงนับทีละกอง สิบกว่าครั้งต่อการโหลดหนึ่งครั้ง ยิ่งเพิ่มช่องทางขายยิ่งช้า
-- ฟังก์ชันนี้กวาดตารางรอบเดียวแล้วคืนทุกตัวเลขที่หน้าเว็บต้องใช้

create or replace function os_counts(p_platform text default null, p_shop text default null)
returns json language sql stable as $$
  with base as (
    select * from os_orders
    where (p_platform is null or platform = p_platform)
      and (p_shop is null or shop = p_shop)
  )
  select json_build_object(
    'total',      (select count(*) from base),
    'by_status',  (select coalesce(json_object_agg(status, n), '{}'::json)
                     from (select status, count(*) n from base group by status) t),
    -- ยกเลิกตอนของยังอยู่ที่ร้าน: กดส่งแล้วแต่ขนส่งยังไม่มารับ
    'risky',      (select count(*) from base
                    where status = 'cancelled' and collected_at is null
                      and (rts_at is not null or cancelled_from = 'packed')),
    'risky_done', (select count(*) from base
                    where status = 'cancelled' and collected_at is null
                      and (rts_at is not null or cancelled_from = 'packed')
                      and pulled_at is not null),
    -- ส่งออกไปแล้วค่อยยกเลิก = ของกำลังเดินทางกลับ
    'returning',  (select count(*) from base
                    where status = 'cancelled' and collected_at is not null),
    'last_change',(select max(synced_at) from base)
  );
$$;

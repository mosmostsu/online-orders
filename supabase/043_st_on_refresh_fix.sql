-- แก้ os_st_on_refresh เรียกจากเว็บไม่ได้ — รันต่อจาก 042
--
-- Supabase เปิด pg-safeupdate ไว้กับคำขอที่มาทาง API: "delete from ตาราง" แบบไม่มี where ถูกปฏิเสธ
-- (DELETE requires a WHERE clause) ตอนรันใน SQL Editor ไม่มีตัวกันนี้เลยผ่าน แต่ตัวดึงสินค้าเรียกทาง API
-- พังเงียบทุกรอบ รายการ "SKU ไหนลงร้านไหน" ของหน้า /allsite เลยค้างที่ตอนรัน 036
-- ใส่ where ที่เป็นจริงทุกแถวไว้ — ผลเหมือนเดิมทุกอย่าง

create or replace function os_st_on_refresh(p_min_age int default 0) returns int
language plpgsql as $$
declare
  v_last timestamptz;
  n int;
begin
  select on_refreshed_at into v_last from os_st_meta where id = 1;
  if p_min_age > 0 and v_last is not null and v_last > now() - make_interval(secs => p_min_age) then
    return -1;
  end if;
  delete from os_st_on where lsku is not null;   -- ทุกแถว (lsku เป็น not null) — ต้องมี where เพราะ pg-safeupdate
  insert into os_st_on (lsku, platform, shop)
  select distinct lower(trim(seller_sku)), platform, shop
    from os_listing_skus where coalesce(trim(seller_sku), '') <> '';
  get diagnostics n = row_count;
  insert into os_st_meta (id, on_refreshed_at) values (1, now())
    on conflict (id) do update set on_refreshed_at = excluded.on_refreshed_at;
  return n;
end;
$$;

select os_st_on_refresh();

-- ตัด/คืนคลังอัตโนมัติ: กัน webhook ซ้อนกันยิงซ้ำ — รันต่อจาก 062 · รันซ้ำได้
--
-- ปัญหา: แพลตฟอร์มยิง webhook ของออเดอร์เดียวกันมาพร้อมกัน 2 ตัว (เช่น TikTok แจ้งหลายเหตุการณ์ต่อใบ)
--   ทั้งคู่เช็ค "ตัดไปแล้วหรือยัง" ก่อนอีกตัวบันทึกทัน → ยิงตั้งคลังซ้ำ + แจ้ง Telegram ซ้ำ
-- แก้: จองแถวใน os_auto_zero ก่อนยิง (ok = null = กำลังยิง) ผ่าน unique index — ตัวที่จองไม่ได้ข้ามไป
--   ยิงเสร็จค่อยเติม ok/error · ยิงพลาด (ok = false) หลุดจาก index ตัวถัดไปลองใหม่ได้

alter table os_auto_zero alter column ok drop not null;

-- แถวที่ซ้ำอยู่แล้ว (ก่อนแก้) เก็บตัวแรกไว้ ตัวหลังปิดเป็นพลาด ไม่งั้นสร้าง unique index ไม่ได้
update os_auto_zero z set ok = false, error = 'ซ้ำ (webhook ซ้อนกัน ก่อนแก้ 063)'
 where z.restored_at is null and z.ok is true
   and exists (
     select 1 from os_auto_zero o
      where o.platform = z.platform and o.shop = z.shop and o.sku_id = z.sku_id
        and o.st_file_at = z.st_file_at and o.dry_run = z.dry_run
        and o.restored_at is null and o.ok is true and o.id < z.id);

-- ตัวเลือกเดิม + ไฟล์ ST รอบเดียวกัน ตัดอยู่ (หรือกำลังตัด) ได้แถวเดียว
create unique index if not exists os_auto_zero_active_uq
  on os_auto_zero (platform, shop, sku_id, st_file_at, dry_run)
  where restored_at is null and ok is not false;

-- จองตัวเลือกที่จะตัด คืนเฉพาะแถวที่จองได้ (ตัวที่ตัดอยู่แล้ว/มีคนกำลังตัดไม่คืน)
create or replace function os_auto_zero_claim(p_rows jsonb)
returns setof os_auto_zero
language plpgsql as $$
begin
  -- จองค้าง (ยิงไม่จบ เช่น ฟังก์ชันหมดเวลา) เกิน 5 นาที ปล่อยให้ลองใหม่
  update os_auto_zero set ok = false, error = 'ค้าง — ยิงไม่จบ'
   where ok is null and created_at < now() - interval '5 minutes';

  return query
  insert into os_auto_zero (sku, platform, shop, product_id, sku_id, variant, st_file_at,
                            st_qty, to_ship, remaining, from_order, dry_run, ok)
  select x.sku, x.platform, x.shop, x.product_id, x.sku_id, x.variant, x.st_file_at,
         x.st_qty, x.to_ship, x.remaining, x.from_order, x.dry_run, null
    from jsonb_to_recordset(p_rows) as x(sku text, platform text, shop text, product_id text, sku_id text,
         variant text, st_file_at timestamptz, st_qty int, to_ship int, remaining int, from_order text, dry_run boolean)
  on conflict (platform, shop, sku_id, st_file_at, dry_run) where restored_at is null and ok is not false
  do nothing
  returning *;
end;
$$;

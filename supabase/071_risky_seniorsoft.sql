-- ออเดอร์ "ยกเลิกก่อนขนส่งเข้ารับ" ที่หยิบของออกจากกองแล้ว: จำว่าส่งเป็นไฟล์ Seniorsoft (คืนสต็อก) ไปแล้ว — กันนำเข้าซ้ำ
-- รันต่อจาก 070 · รันซ้ำได้ · ปุ่ม "💾 ไฟล์ Seniorsoft" ในแท็บ ⚠️ ของหน้า /orders จดเวลาลงตรงนี้
alter table os_orders add column if not exists ss_at timestamptz;

-- ใบที่หยิบออกไปก่อนมีปุ่มนี้ ถือว่าคืนสต็อกใน Seniorsoft ไปแล้ว ไม่ต้องส่งซ้ำ
update os_orders set ss_at = coalesce(pulled_at, now())
 where status = 'cancelled' and pulled_at is not null and ss_at is null;

create index if not exists os_orders_risky_ss_pending on os_orders (pulled_at)
  where status = 'cancelled' and pulled_at is not null and ss_at is null;

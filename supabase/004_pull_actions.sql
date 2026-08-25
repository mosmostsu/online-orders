-- งาน "ตามดึงของออกจากกอง" — รันต่อจาก 003
-- ออเดอร์ที่ยกเลิกหลังร้านกดจัดส่ง = ของอยู่ในกองรอขนส่งแล้ว ต้องมีคนไปหยิบออกจริง
-- แล้วยืนยันพร้อมรูปถ่าย จะได้รู้ว่าใครทำ ทำเมื่อไหร่ ไม่ใช่แค่ "น่าจะมีคนทำแล้วมั้ง"

alter table os_orders add column if not exists pulled_at   timestamptz;  -- หยิบออกแล้วเมื่อไหร่
alter table os_orders add column if not exists pulled_by   text;         -- ใครเป็นคนหยิบ
alter table os_orders add column if not exists pull_note   text;         -- หมายเหตุ เช่น หาไม่เจอ/ส่งไปแล้ว
alter table os_orders add column if not exists pull_photo  text;         -- path รูปหลักฐานใน storage

-- คิวงานที่ยังไม่มีใครจัดการ
create index if not exists os_orders_pull_todo_idx
  on os_orders (cancelled_at desc)
  where status = 'cancelled' and pulled_at is null;

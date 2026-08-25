-- คอมเมนต์ต่อออเดอร์ — รันต่อจาก 005
-- ใบที่ค้างในสถานะ "แพ็คแล้ว รอขนส่งรับ" นานๆ มักมาจาก 2 เรื่อง:
--   1. ของหมด (ยังหาของไม่ได้ เลยยังไม่ได้ให้ขนส่ง)
--   2. ขนส่งลืมยิง (ของออกไปแล้วแต่สถานะไม่ขยับ)
-- คนละเรื่องกันโดยสิ้นเชิง ต้องให้คนที่รู้บันทึกไว้ ไม่งั้นวันรุ่งขึ้นไม่มีใครจำได้

alter table os_orders add column if not exists note    text;
alter table os_orders add column if not exists note_by text;
alter table os_orders add column if not exists note_at timestamptz;

create index if not exists os_orders_note_idx on os_orders (note_at desc) where note is not null;

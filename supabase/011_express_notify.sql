-- กันแจ้งซ้ำสำหรับออเดอร์ส่งด่วน — รันต่อจาก 010
-- ออเดอร์ส่งด่วนของช้อปปี้บังคับแพ็คภายใน 2 ชั่วโมง ถ้าไม่มีใครเห็นตอนเข้ามาก็เลยกำหนด
-- แต่รอบกวาดเจอใบเดิมทุกรอบ ต้องจำว่าแจ้งไปแล้ว

alter table os_orders add column if not exists express_notified_at timestamptz;

create index if not exists os_orders_express_todo_idx
  on os_orders (ordered_at desc)
  where is_express = true and express_notified_at is null;

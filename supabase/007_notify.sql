-- กันแจ้งเตือนซ้ำ — รันต่อจาก 006
-- webhook อาจยิงซ้ำได้ และรอบกวาดก็เจอใบเดิมทุกรอบ ถ้าไม่จำว่าแจ้งไปแล้วจะสแปมทั้งวัน

alter table os_orders add column if not exists notified_at timestamptz;   -- แจ้ง LINE เรื่องยกเลิกไปแล้วเมื่อไหร่

create index if not exists os_orders_notify_todo_idx
  on os_orders (cancelled_at desc)
  where status = 'cancelled' and notified_at is null;

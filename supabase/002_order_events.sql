-- บันทึกการเปลี่ยนสถานะ + จำว่า "ยกเลิกมาจากสถานะอะไร" — รันต่อจาก schema.sql
-- os_orders ยังเก็บแถวเดียวต่อออเดอร์ (สถานะล่าสุด) เหมือนเดิม ตารางนี้เก็บประวัติแยก

-- ยกเลิกมาจากสถานะอะไร — เก็บไว้ในแถวหลักด้วย จะได้กรองเร็วโดยไม่ต้อง join
alter table os_orders add column if not exists cancelled_from text;
create index if not exists os_orders_cancel_idx on os_orders (cancelled_from) where status = 'cancelled';

create table if not exists os_order_events (
  id          bigserial primary key,
  order_ref   bigint not null references os_orders(id) on delete cascade,
  from_status text,                 -- null = เพิ่งเห็นครั้งแรก (ไม่รู้ว่าก่อนหน้าเป็นอะไร)
  to_status   text not null,
  raw_status  text,
  at          timestamptz not null default now(),
  notified_at timestamptz           -- ส่ง LINE ไปแล้วเมื่อไหร่ (กันแจ้งซ้ำ)
);

create index if not exists os_order_events_order_idx on os_order_events (order_ref, at desc);
create index if not exists os_order_events_to_idx    on os_order_events (to_status, at desc);
create index if not exists os_order_events_todo_idx  on os_order_events (at desc) where notified_at is null;

alter table os_order_events enable row level security;

-- ก่อนเขียนทับ: ถ้าเพิ่งกลายเป็นยกเลิก ให้จำสถานะเดิมไว้ก่อนที่มันจะหายไป
create or replace function os_mark_cancel_source() returns trigger as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_from := old.status;
    new.cancelled_at   := coalesce(new.cancelled_at, now());
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists os_orders_cancel_source on os_orders;
create trigger os_orders_cancel_source
  before update on os_orders
  for each row execute function os_mark_cancel_source();

-- บันทึกทุกครั้งที่สถานะเปลี่ยน — ทำที่ชั้น DB จะได้ไม่มีทางลืมบันทึก ไม่ว่าเขียนเข้ามาทางไหน
create or replace function os_log_status_change() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into os_order_events (order_ref, from_status, to_status, raw_status)
    values (new.id, null, new.status, new.raw_status);
  elsif new.status is distinct from old.status then
    insert into os_order_events (order_ref, from_status, to_status, raw_status)
    values (new.id, old.status, new.status, new.raw_status);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists os_orders_status_log on os_orders;
create trigger os_orders_status_log
  after insert or update on os_orders
  for each row execute function os_log_status_change();

-- ประวัติการแก้โปรส่วนลดจากเว็บ (lib/discounts.js writeLog) — รันต่อจาก 060 · รันซ้ำได้
-- หนึ่งแถว = หนึ่งตัวเลือกที่กดบันทึก: ราคาเดิม → ใหม่, จำกัดการซื้อเดิม → ใหม่, สำเร็จไหม
-- ใช้ย้อนดูว่าใครตั้งราคาผิด/เมื่อไร แล้วแก้กลับ · "ใคร" ยังเก็บไม่ได้ (ไม่มีล็อกอิน ใช้ PIN เดียวทั้งร้าน) เก็บ IP + เบราว์เซอร์แทน
-- บันทึกไม่ได้ (ยังไม่รันไฟล์นี้) ไม่ทำให้การแก้โปรล้ม — แค่ไม่มีประวัติ

create table if not exists os_discount_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  platform      text not null,                -- shopee
  shop          text not null,
  discount_id   text not null,
  discount_name text,
  item_id       text not null,
  model_id      text not null,                -- 0 = ตะกร้าไม่มีตัวเลือก
  action        text not null,                -- update | add | remove
  old_price     numeric(12,2),                -- ราคาโปรก่อนแก้ (null = ยังไม่อยู่ในโปร)
  new_price     numeric(12,2),                -- null = เอาออก
  old_limit     int,                          -- จำกัดการซื้อก่อนแก้ (null = ยังไม่อยู่ในโปร)
  new_limit     int,
  ok            boolean not null,
  error         text,
  ip            text,
  user_agent    text
);

create index if not exists os_discount_log_at_idx   on os_discount_log (at desc);
create index if not exists os_discount_log_item_idx on os_discount_log (platform, shop, item_id, at desc);

alter table os_discount_log enable row level security;

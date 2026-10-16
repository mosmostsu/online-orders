-- ตัดคลังอัตโนมัติ (lib/autoZero.js) — รันต่อจาก 057
-- บันทึกทุกตัวเลือกที่ตั้งคลังเป็น 0 (หรือ "จะตั้ง" ในโหมดทดลอง) ไว้ตรวจย้อนหลัง
-- และกันยิงซ้ำ: ตัวเลือกเดิม + ไฟล์ ST รอบเดียวกัน ตัดสำเร็จแล้วไม่ตัดอีก

create table if not exists os_auto_zero (
  id          bigserial primary key,
  sku         text not null,           -- รหัสตาม os_st
  platform    text not null,
  shop        text not null,
  product_id  text not null,
  sku_id      text not null,           -- Shopee: model_id (ไม่มีตัวเลือก = item_id) · TikTok: sku id
  st_file_at  timestamptz not null,    -- เวลาไฟล์ ST ที่ใช้คิด
  st_qty      int,
  to_ship     int,                     -- ออเดอร์รอส่งที่เข้ามาหลังไฟล์ ST
  remaining   int,
  from_order  text,                    -- ออเดอร์ที่ทำให้เช็ค
  dry_run     boolean not null default false,
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists os_auto_zero_dedupe_idx on os_auto_zero (platform, shop, sku_id, st_file_at);
create index if not exists os_auto_zero_created_idx on os_auto_zero (created_at desc);

alter table os_auto_zero enable row level security;

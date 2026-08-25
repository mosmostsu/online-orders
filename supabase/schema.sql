-- order-sync — สคีมาเฟส 1 (ดึงออเดอร์มาดูรวมทุกร้าน)
-- รันไฟล์นี้ใน Supabase SQL Editor ของ project ใหม่

-- ── โทเคนของแต่ละหน้าร้าน ─────────────────────────────────────────────
-- ได้มาจากการกดอนุญาต (OAuth) ครั้งแรก แล้วโค้ดจะ refresh ให้เองเมื่อใกล้หมดอายุ
create table if not exists os_shop_tokens (
  id            bigserial primary key,
  platform      text not null,                    -- tiktok | shopee | lazada
  shop          text not null,                    -- SOLID | REAL | MVP
  shop_id       text,                             -- id ร้านฝั่งแพลตฟอร์ม
  shop_cipher   text,                             -- TikTok ใช้ต่อ request
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,                      -- access_token หมดอายุเมื่อไหร่
  refresh_expires_at timestamptz,
  extra         jsonb default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (platform, shop)
);

-- ── ออเดอร์ ───────────────────────────────────────────────────────────
-- status = สถานะกลางของเรา (ดู lib/status.js) · raw_status = คำของแพลตฟอร์มตรงๆ
create table if not exists os_orders (
  id           bigserial primary key,
  platform     text not null,
  shop         text not null,
  order_id     text not null,
  status       text not null,                     -- unpaid|to_ship|shipped|delivered|done|cancelled|unknown
  raw_status   text,
  buyer        text,
  total        numeric(12,2),
  currency     text,
  item_count   int not null default 0,
  ordered_at   timestamptz,                       -- เวลาลูกค้าสั่ง (ใช้เทียบรอบตัดในเฟสถัดไป)
  platform_updated_at timestamptz,
  cancelled_at timestamptz,
  raw          jsonb,                             -- เก็บก้อนดิบไว้ เผื่อต้องขุดฟิลด์เพิ่มทีหลัง
  first_seen_at timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  unique (platform, shop, order_id)
);

create index if not exists os_orders_status_idx    on os_orders (status, ordered_at desc);
create index if not exists os_orders_ordered_idx   on os_orders (ordered_at desc);
create index if not exists os_orders_shop_idx      on os_orders (platform, shop, ordered_at desc);

-- ── รายการสินค้าในออเดอร์ ─────────────────────────────────────────────
-- sku = seller sku ที่ร้านลงไว้ ควรตรงกับ cf_itemid ของ Seniorsoft (เฟส 2 ใช้ตัวนี้ทำบัญชีจอง)
create table if not exists os_order_items (
  id           bigserial primary key,
  order_ref    bigint not null references os_orders(id) on delete cascade,
  line_id      text,                              -- id รายการฝั่งแพลตฟอร์ม (กันซ้ำตอน upsert)
  sku          text,
  platform_sku_id text,
  product_name text,
  qty          int not null default 1,
  price        numeric(12,2),
  raw          jsonb,
  unique (order_ref, line_id)
);

create index if not exists os_order_items_sku_idx on os_order_items (sku);

-- ── บันทึกรอบดึงข้อมูล (ไว้ดูว่าดึงล่าสุดเมื่อไหร่ พังตรงไหน) ─────────
create table if not exists os_sync_log (
  id          bigserial primary key,
  platform    text not null,
  shop        text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  fetched     int default 0,
  upserted    int default 0,
  ok          boolean,
  error       text
);

-- ปิดประตูฝั่ง client ทั้งหมด — เข้าถึงผ่าน service_role (server) เท่านั้น
alter table os_shop_tokens enable row level security;
alter table os_orders      enable row level security;
alter table os_order_items enable row level security;
alter table os_sync_log    enable row level security;

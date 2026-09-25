-- สินค้าที่ลงขายอยู่ของแต่ละร้าน (หน้า /product) — รันต่อจาก 029
--
-- ต่างจาก os_products (019) ที่เก็บแค่รูปปก/ชื่อของตะกร้าที่ "เคยขายได้" ไว้ประกอบหน้าเงินเข้า
-- ตารางนี้คือรายการสินค้าทั้งร้านตามที่หลังร้านโชว์ — ทุกตะกร้า ทุกตัวเลือกสี/ไซส์ พร้อมราคา ราคาพิเศษ คลัง
-- แยกตามร้าน (Shopee มี SOLID/REAL/MVP คนละร้าน คนละรหัสตะกร้า)
--
-- ⚠️ "คลัง" ตรงนี้คือตัวเลขที่ตั้งไว้บนแพลตฟอร์ม ไม่ใช่สต็อกจริง — สต็อกจริงอยู่ที่ Seniorsoft (ดู CLAUDE.md)
-- เก็บไว้ดูอย่างเดียว ไม่เอาไปบวกลบเอง

create table if not exists os_listings (
  platform     text not null,
  shop         text not null,
  product_id   text not null,          -- Shopee: item_id · TikTok: product id
  title        text,
  thumb_url    text,
  status       text,                   -- ค่าดิบของแพลตฟอร์ม (NORMAL/UNLIST/ACTIVATE/...)
  item_sku     text,                   -- Parent SKU
  sku_n        int  not null default 0,
  price_min    numeric,
  price_max    numeric,
  promo_min    numeric,                -- ราคาพิเศษต่ำสุด (ถ้ามีตัวเลือกไหนติดโปร)
  promo_max    numeric,
  stock        int,                    -- รวมทุกตัวเลือก
  remote_updated_at timestamptz,       -- เวลาแก้ไขล่าสุดฝั่งแพลตฟอร์ม — ใช้ตัดสินว่าต้องดึงใหม่ไหม
  remote_created_at timestamptz,
  synced_at    timestamptz not null default now(),
  primary key (platform, shop, product_id)
);

create table if not exists os_listing_skus (
  platform     text not null,
  shop         text not null,
  product_id   text not null,
  sku_id       text not null,          -- Shopee: model_id (ไม่มีตัวเลือก = item_id) · TikTok: sku id
  seller_sku   text,
  variant      text,                   -- "กรม / XL"
  price        numeric,
  promo_price  numeric,                -- null = ไม่ติดโปร
  stock        int,
  image_url    text,
  sort         int  not null default 0,
  primary key (platform, shop, sku_id)
);

create index if not exists os_listing_skus_product_idx on os_listing_skus (platform, shop, product_id);
create index if not exists os_listing_skus_sku_idx on os_listing_skus (seller_sku);

-- ThisShop ไม่มีเวลาแก้ไขให้เทียบ และขอได้ทีละ 10 ตะกร้าแบบช้ามาก ต้องไล่ทีละหน้าแล้วจำว่าถึงหน้าไหน
-- ครบรอบแล้ว ตะกร้าที่ไม่ถูกแตะตั้งแต่ pass_started_at = ถูกลบออกจากร้านแล้ว
create table if not exists os_listing_cursor (
  platform        text not null,
  shop            text not null,
  next_page       int  not null default 1,
  pass_started_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (platform, shop)
);

alter table os_listing_cursor enable row level security;
alter table os_listings     enable row level security;
alter table os_listing_skus enable row level security;

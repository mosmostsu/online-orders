-- โคลนสินค้า Shopee REAL → ThisShop (หน้า /allsite/report ปุ่ม "โคลนไป ThisShop") — รันต่อจาก 050
--
-- os_clone_map  จำว่าหมวดของ Shopee ตรงกับหมวดไหนของ ThisShop (จับคู่ครั้งเดียวต่อหมวด)
-- os_clone_log  ประวัติการโคลน — กันสร้างสินค้าซ้ำ (ThisShop ดึงรายการกลับมาช้า ไม่เห็นของที่เพิ่งสร้างทันที)

create table if not exists os_clone_map (
  shopee_cat       text primary key,          -- category_id ของ Shopee
  shopee_cat_name  text,
  thisshop_cat     text not null,             -- categoryId ระดับ 3 ของ ThisShop
  thisshop_cat_name text,
  updated_at       timestamptz not null default now()
);

create table if not exists os_clone_log (
  id                 bigserial primary key,
  shopee_shop        text not null,
  shopee_product_id  text not null,           -- item_id ของ Shopee
  thisshop_spu_id    text,
  title              text,
  sku_n              int,
  status             text not null,           -- ok | failed
  error              text,
  created_at         timestamptz not null default now()
);

create index if not exists os_clone_log_item_idx on os_clone_log (shopee_shop, shopee_product_id, status);

alter table os_clone_map enable row level security;
alter table os_clone_log enable row level security;

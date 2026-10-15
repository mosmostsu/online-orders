-- ดัชนีเร่งความเร็วหน้า /product (os_product_page, supabase/034) — รันใน Supabase SQL editor ครั้งเดียว ปลอดภัย รันซ้ำได้
--
-- 1) ช่องค้นหา: ilike '%คำ%' กับชื่อ / Parent SKU / SKU ตัวเลือก ต้องไล่ทุกแถว → ใช้ดัชนี trigram (pg_trgm)
-- 2) os_order_items.order_ref (FK ไป os_orders) ยังไม่มีดัชนี — join ยอดขาย 30 วันในหน้ารายละเอียดตะกร้าใช้
--    (os_order_items.platform_sku_id กับ .sku มีดัชนีแล้วใน 030/031)
create extension if not exists pg_trgm;

create index if not exists os_listings_title_trgm on os_listings using gin (title gin_trgm_ops);
create index if not exists os_listings_item_sku_trgm on os_listings using gin (item_sku gin_trgm_ops);
create index if not exists os_listing_skus_seller_sku_trgm on os_listing_skus using gin (seller_sku gin_trgm_ops);
create index if not exists os_order_items_order_ref_idx on os_order_items (order_ref);

analyze os_listings;
analyze os_listing_skus;
analyze os_order_items;

-- ยอดขาย (จำนวนชิ้น) ต่อตะกร้าในหน้า /summary — รันต่อจาก 032 (ต้องรันก่อน deploy โค้ดที่ใช้)
--
-- แต่ละเจ้าใช้ข้อมูลคนละแหล่ง:
--   Shopee ทั้งหมด  = ยอดขายสะสมที่ Shopee นับให้เอง (get_item_extra_info.sale) เก็บที่ sold_total
--   Shopee/ThisShop 1 เดือน = นับจากออเดอร์ในระบบเรา (ฟังก์ชันข้างล่าง)
--             ออเดอร์ที่จบแล้วถูกล้างหลัง 30 วัน (ดู 005) จึงย้อนได้ไม่เกิน 30 วัน
--   TikTok   = ถาม Analytics API ตอนเปิดหน้า (lib/tiktok.js productSales) ย้อนได้ 180 วัน ไม่ใช้ไฟล์นี้

alter table os_listings add column if not exists sold_total int;

-- ขายไปกี่ชิ้นต่อตัวเลือก ใน p_days วันล่าสุด (ไม่นับยกเลิก/ยังไม่จ่าย)
-- จับคู่ด้วยรหัสตัวเลือกของแพลตฟอร์ม (Shopee model_id · TikTok sku_id · ThisShop skuId)
-- ตะกร้าที่ไม่มีตัวเลือก (Shopee model_id = 0 → platform_sku_id ว่าง) ใช้ SKU ของร้านแทน
create or replace function os_listing_sales(p_platform text, p_shop text, p_days int default 30)
returns table (product_id text, sku_id text, qty bigint)
language sql stable as $$
  with items as (
    select i.platform_sku_id, i.sku, i.qty
      from os_order_items i
      join os_orders o on o.id = i.order_ref
     where o.platform = p_platform and o.shop = p_shop
       and o.status not in ('cancelled', 'unpaid')
       and o.ordered_at >= now() - make_interval(days => p_days)
  ), matched as (
    select ls.product_id, ls.sku_id, it.qty
      from items it
      join os_listing_skus ls
        on ls.platform = p_platform and ls.shop = p_shop and ls.sku_id = it.platform_sku_id
    union all
    select ls.product_id, ls.sku_id, it.qty
      from items it
      join os_listing_skus ls
        on ls.platform = p_platform and ls.shop = p_shop and ls.seller_sku = it.sku
     where it.platform_sku_id is null
  )
  select product_id, sku_id, sum(qty)::bigint from matched group by 1, 2;
$$;

create index if not exists os_order_items_platform_sku_idx on os_order_items (platform_sku_id);

-- คลังต่ำสุดของตัวเลือกในตะกร้า — รันต่อจาก 030 (ต้องรันก่อน deploy โค้ดที่เขียนคอลัมน์นี้)
--
-- หน้า /product ต้องรู้ว่าตะกร้าไหน "เหลือ ≤2" (บางไซส์เหลือชิ้นเดียวแม้คลังรวมเยอะ)
-- เดิมไล่อ่านคลังทุกตัวเลือกของร้านตอนเปิดหน้า — REAL มี ~23,000 ตัวเลือก ช้า และโดนเพดาน
-- 1,000 แถวต่อคำขอของ Supabase ตัดจนนับผิด ตอนนี้คิดไว้ตอนบันทึก (lib/listings.js saveListings)

alter table os_listings add column if not exists min_stock int;

update os_listings l
   set min_stock = s.m
  from (
    select platform, shop, product_id, min(stock) as m
      from os_listing_skus
     group by 1, 2, 3
  ) s
 where s.platform = l.platform and s.shop = l.shop and s.product_id = l.product_id;

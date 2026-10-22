-- ให้ anon อ่าน "รหัสสินค้า -> url รูป" จาก os_listing_skus ได้ — รันต่อจาก 063 · รันซ้ำได้
--
-- แอปเช็คสต็อกหน้าร้าน (sc2004stock.netlify.app/scan/) ขอรูปราย SKU ผ่าน /api/sku-images
-- เดิมฟังก์ชันนั้นต้องใช้ service key ของที่นี่ = ต้องเอาคีย์สิทธิ์เต็มไปวางใน Netlify
-- ของอีกโปรเจกต์ ถ้ารั่วก็หลุดทั้งฐานข้อมูล order-sync
-- เปลี่ยนเป็น anon key + RLS: อ่านได้แค่ตารางนี้ แค่ 4 คอลัมน์ แค่แถวที่มีรูปจริง
--
-- ⚠️ ห้ามเพิ่ม price / promo_price / stock เข้า grant ด้านล่าง — anon key ถือเป็นคีย์เปิด
-- (ตั้งใจให้แปะในเบราว์เซอร์ได้) ถ้าให้อ่าน ราคาและคลังของทุกร้านจะกลายเป็นข้อมูลสาธารณะ
--
-- ที่นี่ไม่มีใครใช้ anon เลย — lib/supabase.js ต่อด้วย service_role ฝั่ง server ล้วน และก่อนไฟล์นี้
-- ยังไม่มี policy ตัวไหนในระบบ (RLS เปิดแต่ไม่มี policy = anon อ่านไม่ได้อยู่แล้ว)
-- revoke ก่อนแล้วค่อย grant เฉพาะคอลัมน์จึงไม่กระทบของเดิม

alter table os_listing_skus enable row level security;

revoke all on os_listing_skus from anon;
grant select (platform, shop, seller_sku, image_url) on os_listing_skus to anon;

drop policy if exists os_listing_skus_anon_read on os_listing_skus;
create policy os_listing_skus_anon_read on os_listing_skus
  for select
  to anon
  using (image_url is not null and seller_sku is not null);

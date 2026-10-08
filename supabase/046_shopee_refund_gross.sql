-- Shopee: ออเดอร์ที่ลูกค้าคืนเงินเต็มจำนวน ไม่นับเป็น "ราคาป้าย" — รันใน Supabase ครั้งเดียว
--
-- เดิม gross/ร้านลด ของออเดอร์ที่ถูกคืนเงินยังถูกนับเต็ม แล้วไปหักกลับในช่อง adjustment (ที่หน้าเว็บไม่แสดง)
-- ผลคือ "เหลือ %" ของวันนั้นต่ำกว่าจริง (เช่น 50% แทน ~60%) เพราะตัวหารพองจากของที่ขายไม่สำเร็จ
-- ตอนนี้: ยอดขายของออเดอร์ที่ถูกหักกลับทั้งหมด = 0 เหลือแต่ค่าส่งไปกลับ (shipping) เป็นต้นทุน
-- โค้ดฝั่งดึงยอด (lib/shopee.js) ทำแบบเดียวกันกับแถวใหม่แล้ว ไฟล์นี้ปรับแถวเก่าให้ตรงกัน
--
-- ปลอดภัย: ไม่แตะ settlement / fee / shipping — สมการ revenue + fee + shipping + adjustment = settlement ยังตรง
-- รันซ้ำได้ (แถวที่ปรับแล้ว revenue = 0 จะไม่ถูกเลือกซ้ำ)

update os_money_tx
   set gross = 0,
       seller_discount = 0,
       revenue = 0,
       adjustment = round((settlement - fee - shipping)::numeric, 2)
 where platform = 'shopee'
   and revenue > 0
   and adjustment <= -(revenue - 1);

-- ตรวจผล: ต้องไม่มีแถวที่สมการเพี้ยน (ควรได้ 0)
-- select count(*) from os_money_tx
--  where platform = 'shopee' and abs(revenue + fee + shipping + adjustment - settlement) > 0.05;

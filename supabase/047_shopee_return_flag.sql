-- Shopee: ติดธง "ตีคืน" ให้ออเดอร์ที่ถูกคืนเงินเต็มจำนวน — รันต่อจาก 046 ใน Supabase ครั้งเดียว
--
-- ทำไม: หน้ารายสินค้า (/money?view=sku) ตัดออเดอร์ที่มีธง is_return ออกจากยอดขาย แล้วโชว์แยกในถัง "ตีคืน"
-- แต่ is_return ของ os_money_tx คำนวณจากคีย์ rev.refund_subtotal_before_discount_amount ซึ่งมีแค่ฝั่ง TikTok
-- ออเดอร์ Shopee ที่ถูกคืนเงินจึงยังถูกนับเป็นของที่ขายได้ (จำนวนชิ้น/จำนวนออเดอร์พอง)
--
-- วิธี: ใส่คีย์คืนเงินลง breakdown (เหมือนที่ lib/shopee.js ทำกับแถวใหม่แล้ว)
-- → is_return เปลี่ยนเป็น true เอง → trigger แตกรายสินค้าใหม่และติดธงให้ os_money_items ให้
-- เลือกเฉพาะแถวที่ 046 ตัดยอดขายเป็น 0 แล้ว (gross = 0 แต่ breakdown ยังมีราคาป้ายเดิม)
-- รันซ้ำได้ (แถวที่ติดธงแล้วถูกข้าม)

update os_money_tx
   set breakdown = breakdown
         || jsonb_build_object('rev.refund_subtotal_before_discount_amount', -((breakdown->>'rev.subtotal')::numeric))
         || case when jsonb_exists(breakdown, 'rev.seller_discount')
                 then jsonb_build_object('rev.seller_discount_refund_amount', -((breakdown->>'rev.seller_discount')::numeric))
                 else '{}'::jsonb end
 where platform = 'shopee'
   and gross = 0 and revenue = 0
   and jsonb_exists(breakdown, 'rev.subtotal')
   and not jsonb_exists(breakdown, 'rev.refund_subtotal_before_discount_amount');

-- ตรวจผล: จำนวนออเดอร์ Shopee ที่ติดธงตีคืน (ควรเท่ากับจำนวนที่ 046 ปรับ)
-- select count(*) from os_money_tx where platform = 'shopee' and is_return;

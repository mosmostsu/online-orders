-- ตะกร้าที่ติดการละเมิด — รันต่อจาก 031 (ต้องรันก่อน deploy โค้ดที่เขียนคอลัมน์นี้)
--
-- แท็บ "การละเมิด" ของหลังร้าน Shopee ไม่ได้มีแค่ตะกร้าที่ถูกแบน (item_status = BANNED)
-- แต่รวมตะกร้าที่ยังขายอยู่แต่ "ถูกลดการมองเห็น" ด้วย — get_item_base_info บอกด้วยฟิลด์ deboost
-- เหตุผล/คำแนะนำมาจาก get_item_violation_info ถามเฉพาะตะกร้าที่ติด (มีไม่กี่ตัว)

alter table os_listings add column if not exists deboost   boolean;
alter table os_listings add column if not exists violation jsonb;   -- [{type, reason, suggestion}] จาก Shopee

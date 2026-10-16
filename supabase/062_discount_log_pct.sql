-- ประวัติแก้โปร TikTok แบบ % ลด (lib/discounts.js ttLog) — รันต่อจาก 061_discount_log · รันซ้ำได้
-- โปร TikTok ส่วนลดสินค้าเก็บเป็น % ไม่ใช่ราคา: old_price/new_price = ราคาที่คิดจากราคาปกติตอนแก้ ส่วน % จริงเก็บที่นี่
-- ยังไม่รัน → ประวัติ TikTok ยังบันทึก (ไม่มีคอลัมน์ %) การแก้ไม่ล้ม

alter table os_discount_log add column if not exists old_pct numeric(5,2);   -- % ลดก่อนแก้ (null = ไม่ใช่โปรแบบ % / ยังไม่อยู่ในโปร)
alter table os_discount_log add column if not exists new_pct numeric(5,2);   -- % ลดใหม่ (null = เอาออก)

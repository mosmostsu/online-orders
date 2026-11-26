-- ของคืน: เพิ่มประเภท 'cancel' = ยกเลิกก่อนขนส่งเข้ารับ (แพ็คแล้ว ยิงออก Seniorsoft แล้ว ลูกค้ายกเลิกก่อนรถมารับ)
-- ของยังอยู่ที่ร้าน ต้องหยิบออกจากกองแล้วคืนสต็อก — ยิงรับ / ติ๊กเลือก แล้วส่งไฟล์ "ยกเลิก-….txt" เหมือนของตีคืน
-- ret_key = 'cancel:' + เลขออเดอร์ (ไม่ชนกล่องตีกลับที่ใช้เลขออเดอร์ตรง ๆ) · รันต่อจาก 070 · รันซ้ำได้
alter table os_returns drop constraint if exists os_returns_kind_check;
alter table os_returns add constraint os_returns_kind_check check (kind in ('failed', 'buyer', 'cancel'));

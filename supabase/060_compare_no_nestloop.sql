-- หน้า /compare: os_compare_page ของกลุ่ม SOLID ช้า ~17-19 วินาที (ชนเพดาน statement_timeout 20 วิของ service_role) — รันต่อจาก 057
--
-- สาเหตุ (ดูจาก EXPLAIN ANALYZE): ทุกขั้นเป็น CTE ที่ Postgres ไม่มีสถิติ เลยเดาว่ามีแค่ ~200-300 แถว
--   (ของจริงหลายหมื่น) แล้วเลือก Nested Loop + Index Scan ทีละแถว เช่น
--   sk_all → os_listing_skus ทีละตะกร้า, ckb → os_st (lower(trim(sku))) ทีละ SKU, cs/rep/... วนซ้อนกัน
--   ยิ่งข้อมูลเยอะยิ่งช้าแบบทวีคูณ: MVP 1 วิ · REAL 1-2 วิ · SOLID 17 วิ
-- ทางแก้: ปิด nested loop เฉพาะตอนรันฟังก์ชันนี้ → ใช้ Hash Join แทน (สแกนตารางรอบเดียว)
--   SOLID เหลือ ~1 วินาที · ผลลัพธ์ตรงกับเดิมทุกไบต์ (เทียบ md5 ทุกกลุ่ม SOLID/REAL/MVP/X:main/P:*)
--   ไม่ได้แก้เนื้อฟังก์ชันเลย (ยี่ห้อต่อแถว 'brand' ยังอยู่ครบ) · ถ้าจำเป็นต้องวนจริง Postgres ยังใช้ nested loop ได้ แค่ให้เป็นทางเลือกสุดท้าย
--
-- ⚠️ ถ้าไฟล์ต่อไป create or replace os_compare_page ใหม่ทั้งฟังก์ชัน ค่านี้จะหายไป
--    ต้องใส่ `set enable_nestloop = off` ไว้ในคำสั่ง create (ก่อน `as $$`) หรือรันบรรทัดข้างล่างซ้ำ

alter function os_compare_page(text, int, text, text, int, int, boolean, boolean, text)
  set enable_nestloop = off;

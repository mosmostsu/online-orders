-- คำขอ "ดึงออเดอร์ Shopee MVP/PACE" จากหน้า /round เครื่องไหนก็ได้ · รันต่อจาก 069 · รันซ้ำได้
-- ร้านพวกนี้ไม่มี API — ดึงได้เฉพาะ Chrome ที่ล็อกอิน Seller Center ร้านนั้น + ติดตั้งส่วนขยาย mvp-stock (1.4+)
-- หน้าเว็บฝากคำขอไว้ (requested_at) → ส่วนขยายเช็คทุก 2 นาที (seen_at) → ดึงแล้วบันทึกผล (done_at, ok, message)
-- ขนาด: 1 แถวต่อร้าน

create table if not exists os_mvp_pull (
  shop          text primary key,          -- MVP | PACE (SHOPEE_NO_API ใน lib/shopGroups.js)
  requested_at  timestamptz,               -- มีคนกดขอดึงล่าสุด
  started_at    timestamptz,               -- ส่วนขยายรับคำขอไปแล้ว
  done_at       timestamptz,               -- ดึงเสร็จล่าสุด (สำเร็จหรือไม่ก็ได้ ดู ok)
  ok            boolean,
  message       text,                      -- ผลสั้นๆ / สาเหตุที่ดึงไม่ได้ (เช่น หลุดล็อกอิน)
  seen_at       timestamptz                -- ส่วนขยายมาเช็คคำขอล่าสุด = Chrome เครื่องนั้นเปิดอยู่
);

alter table os_mvp_pull enable row level security;

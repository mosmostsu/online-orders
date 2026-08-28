-- แยกใบส่งด่วนออกจากส่งปกติ — รันต่อจาก 009
-- ส่งด่วน (Instant / Express) คนขับมารับภายในไม่กี่สิบนาที ต่างจากส่งปกติที่รอรถรอบเย็น
-- ใบส่งด่วนที่ลูกค้ายกเลิก ต้องวิ่งไปดึงของทันที ไม่งั้นของออกไปแล้ว

alter table os_orders add column if not exists is_express boolean default false;

-- ไล่หาใบด่วนที่ยังไม่ออกจากร้าน
create index if not exists os_orders_express_idx on os_orders (is_express, status)
  where is_express = true;

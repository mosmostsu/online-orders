-- เวลาสำคัญของแต่ละออเดอร์ + รูปสินค้า — รันต่อจาก 002
-- ทั้งหมดนี้ TikTok ส่งมาให้อยู่แล้วในก้อน raw แค่ดึงขึ้นมาเป็นคอลัมน์ให้ค้นง่าย

alter table os_orders add column if not exists paid_at      timestamptz;  -- จ่ายเงิน
alter table os_orders add column if not exists rts_at       timestamptz;  -- ร้านกดจัดส่ง (พร้อมส่ง)
alter table os_orders add column if not exists collected_at timestamptz;  -- ขนส่งมารับของจริง
alter table os_orders add column if not exists cancel_reason text;
alter table os_orders add column if not exists cancel_by     text;        -- BUYER / SELLER / SYSTEM
alter table os_orders add column if not exists tracking_no   text;
alter table os_orders add column if not exists carrier       text;

create index if not exists os_orders_rts_idx    on os_orders (rts_at desc);
create index if not exists os_orders_cancel_time_idx on os_orders (cancelled_at desc) where status = 'cancelled';

alter table os_order_items add column if not exists image_url text;
alter table os_order_items add column if not exists variant   text;  -- ชื่อตัวเลือก เช่น สี/ไซส์

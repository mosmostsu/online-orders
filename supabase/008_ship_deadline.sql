-- เส้นตายจัดส่ง + เก็บเงินปลายทาง — รันต่อจาก 007
-- ทั้งสองแพลตฟอร์มบอกมาอยู่แล้วว่าออเดอร์นี้ต้องส่งภายในเมื่อไหร่
-- ใบที่แพ็คแล้วค้างในกองจนใกล้เลยกำหนด = ใบที่ต้องรีบที่สุด

alter table os_orders add column if not exists ship_by  timestamptz;  -- ต้องส่งภายในเมื่อไหร่
alter table os_orders add column if not exists is_cod   boolean;      -- เก็บเงินปลายทาง

-- ไล่หาใบที่ใกล้เลยกำหนดส่ง
create index if not exists os_orders_shipby_idx on os_orders (ship_by)
  where status in ('to_ship', 'packed');

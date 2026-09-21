-- เร่งคิวรีทุน — รันต่อจาก 022
--
-- os_costs_for ใช้เวลา 3.7 วินาที เพราะหาทุนแทนด้วย sku_key like 'prefix%'
-- ซึ่งกวาดทั้งตาราง 13,000 แถวต่อรหัสที่หาไม่เจอ ดัชนีปกติของ primary key
-- ใช้กับ like ไม่ได้ ถ้าฐานข้อมูลไม่ได้ตั้ง collation แบบ C
create index if not exists os_costs_key_pattern_idx on os_costs (sku_key text_pattern_ops);

-- ตอนหาว่ามีรหัสอะไรขายบ้างในช่วงเวลา จะได้ไม่ต้องอ่านทั้งตาราง
create index if not exists os_money_items_sold_idx on os_money_items (platform, statement_at) where matched;

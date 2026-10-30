-- หน้ารอบจัดส่ง (/round) แท็บหมายเหตุ: งานที่ต้องทำกับออเดอร์ก่อนแพ็ค (เช่น เขียนบิล, เปลี่ยนของ) + ติ๊กว่าทำแล้ว · รันซ้ำได้
-- แยกจาก note (คอมเมนต์ใบค้างในหน้าออเดอร์ ดู 006) — เขียนผ่าน /api/orders/pack-note
alter table os_orders add column if not exists pack_note    text;
alter table os_orders add column if not exists pack_note_by text;
alter table os_orders add column if not exists pack_note_at timestamptz;
alter table os_orders add column if not exists pack_done_at timestamptz;   -- null = ยังไม่ได้ทำ
alter table os_orders add column if not exists pack_done_by text;

-- ของคืน (หน้า /returns) — แทนหน้า "การคืนสินค้า Stock-In" ของ BigSeller · รันต่อจาก 068 · รันซ้ำได้
-- 1 แถว = 1 กล่องที่จะกลับร้าน
--   kind 'failed' = ส่งไม่สำเร็จ/ตีกลับ (ทั้งออเดอร์ · ret_key = เลขออเดอร์)
--   kind 'buyer'  = ลูกค้าขอคืนหลังได้ของ (หนึ่งคำขอคืน · ret_key = return_id ของแพลตฟอร์ม)
-- เติมโดย /api/sync/returns (ทุกชั่วโมง) · พนักงานยิงรับผ่าน /api/returns/receive
-- ขนาด: ~400 กล่อง/เดือน แถวละไม่ถึง 1 KB

create table if not exists os_returns (
  id              bigserial primary key,
  platform        text not null,
  shop            text not null,
  order_id        text not null,
  kind            text not null check (kind in ('failed','buyer')),
  return_id       text,
  ret_key         text not null,
  tracking_no     text,                  -- เลขบนกล่องตอนกลับมา (ตีกลับ = เลขขาไป · ลูกค้าคืน = เลขขากลับ)
  carrier         text,
  items           jsonb not null default '[]',   -- [{sku, name, qty, image}]
  reason          text,
  -- สถานะการคืน (ชื่อตาม BigSeller): รอคืนสินค้า · อยู่ระหว่างคืนสินค้า · คืนสินค้าแล้ว · การคืนสินค้าล้มเหลว · สูญหาย · ไม่ต้องส่งคืน
  state           text not null default 'transit'
                  check (state in ('waiting','transit','arrived','failed','lost','not_needed')),
  platform_status text,
  started_at      timestamptz,           -- เริ่มเดินทางกลับ / ยื่นคำขอคืน
  arrived_at      timestamptz,           -- ขนส่งบอกว่าถึงร้าน (หรือเวลายิงรับ ถ้าแพลตฟอร์มไม่บอก)
  -- สถานะรับ (แทน Stock-In): null = ยังไม่รับ · full = รับครบ · partial = รับไม่ครบ
  recv            text check (recv in ('full','partial')),
  received_at     timestamptz,
  received_by     text,
  receive_note    text,
  missing         jsonb,                 -- [{sku, qty}] ที่ขาดตอนเปิดกล่อง
  checked_at      timestamptz,           -- ถามสถานะขนส่งล่าสุดเมื่อไหร่ (หมุนเวียนถาม เก่าสุดก่อน)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (platform, shop, ret_key)
);

create index if not exists os_returns_tracking_idx on os_returns (upper(tracking_no));
create index if not exists os_returns_order_idx    on os_returns (order_id);
create index if not exists os_returns_recv_idx     on os_returns (recv, state);
create index if not exists os_returns_started_idx  on os_returns (started_at);

-- อ่าน/เขียนผ่านเซิร์ฟเวอร์ (service role) เท่านั้น เหมือนตารางอื่น
alter table os_returns enable row level security;

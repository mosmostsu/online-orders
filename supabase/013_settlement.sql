-- เงินที่ได้รับจริงต่อออเดอร์ — รันต่อจาก 012
--
-- os_orders.total = ยอดที่ "ลูกค้าจ่าย" ไม่ใช่เงินที่เข้ากระเป๋าเรา
-- ระหว่างทางโดนหักค่าคอม ค่าธรรมเนียมชำระเงิน ค่าโปรฯ ที่ร้านออกเอง ส่วนต่างค่าส่ง ฯลฯ
-- ตัวเลขชุดนี้อยู่คนละ API กับ API ออเดอร์ และจะนิ่งก็ต่อเมื่อของถึงมือลูกค้าแล้ว
-- จึงแยกเป็นตารางของตัวเอง ดึงคนละรอบ ไม่ไปถ่วงรอบดึงออเดอร์ทุก 5 นาที

create table if not exists os_settlements (
  order_ref      bigint primary key references os_orders(id) on delete cascade,
  platform       text not null,
  shop           text not null,
  order_id       text not null,
  currency       text,

  -- ── ตัวเลขที่หน้าเว็บใช้ ────────────────────────────────────────────
  customer_paid  numeric(12,2),   -- ลูกค้าจ่ายเท่าไร (รวมค่าส่งที่ลูกค้าออก)
  revenue        numeric(12,2),   -- รายรับก่อนหักค่าธรรมเนียม (รวมส่วนที่แพลตฟอร์มช่วยจ่าย)
  fee_total      numeric(12,2),   -- ค่าธรรมเนียมรวม เก็บเป็นเลขบวก = ถูกหักไปเท่านี้
  adjustment     numeric(12,2),   -- ปรับปรุงรายการ (ชดเชย/เรียกคืน)
  net            numeric(12,2),   -- ★ เงินเข้าเราจริง
  fee_breakdown  jsonb,           -- แยกว่าหักอะไรไปบ้าง อย่างละเท่าไร

  -- ── สถานะการปิดยอด ─────────────────────────────────────────────────
  -- แพลตฟอร์มปิดยอดเป็นรอบ (statement) หลังของถึงมือ + พ้นเวลาคืนสินค้า
  -- ก่อนหน้านั้นถามไปก็ยังไม่มีตัวเลข ต้องจำไว้ว่าถามแล้ว จะได้ไม่ถามซ้ำทุกรอบ
  settled        boolean not null default false,
  statement_id   text,
  statement_at   timestamptz,
  tried_at       timestamptz not null default now(),  -- ถามครั้งล่าสุดเมื่อไหร่
  error          text,                                 -- ถามแล้วพัง เก็บไว้ดูว่าเพราะอะไร
  raw            jsonb,
  updated_at     timestamptz not null default now()
);

create index if not exists os_settlements_shop_idx  on os_settlements (platform, shop);
create index if not exists os_settlements_todo_idx  on os_settlements (tried_at) where settled = false;

alter table os_settlements enable row level security;

-- ── คิวงาน: ใบไหนควรไปถามยอดต่อ ──────────────────────────────────────
-- เงื่อนไข: ส่งของออกไปแล้ว (ก่อนหน้านั้นยังไม่มียอดแน่นอน) และยังไม่ปิดยอด
-- ใบที่เพิ่งถามไปไม่นานให้ข้ามก่อน — แพลตฟอร์มจำกัดจำนวนครั้งที่ยิงได้ต่อวัน
-- ชื่อคอลัมน์ที่คืนออกไปต้องไม่ซ้ำกับชื่อคอลัมน์ในตาราง (order_id, shop)
-- ไม่งั้น Postgres จะงงว่าหมายถึงตัวไหน แล้วฟ้อง "column reference is ambiguous"
create or replace function os_settlement_todo(
  p_platform text,
  p_shop     text default null,
  p_limit    int  default 100,
  p_cooldown interval default interval '12 hours'
) returns table (ref bigint, oid text, shop_name text) language sql stable as $$
  select o.id, o.order_id, o.shop
    from os_orders o
    left join os_settlements s on s.order_ref = o.id
   where o.platform = p_platform
     and (p_shop is null or o.shop = p_shop)
     and o.status in ('shipped', 'delivered', 'done')
     and coalesce(s.settled, false) = false
     and (s.tried_at is null or s.tried_at < now() - p_cooldown)
   order by o.ordered_at desc
   limit p_limit;
$$;

-- ── สรุปยอดตามช่วงเวลา (ให้ฐานข้อมูลรวมให้ ไม่ต้องลากทุกแถวมาบวกที่เว็บ) ──
create or replace function os_money_summary(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_shop     text default null
) returns json language sql stable as $$
  with base as (
    select o.total as paid, s.net, s.fee_total, s.settled
      from os_orders o
      left join os_settlements s on s.order_ref = o.id
     where o.ordered_at >= p_from and o.ordered_at < p_to
       and o.status <> 'cancelled'
       and (p_platform is null or o.platform = p_platform)
       and (p_shop is null or o.shop = p_shop)
  )
  select json_build_object(
    'orders',       (select count(*) from base),
    'paid',         (select coalesce(sum(paid), 0) from base),
    -- นับเฉพาะใบที่ปิดยอดแล้ว ไม่งั้นเอาใบที่ยังไม่มีตัวเลขมาหารเฉลี่ยจะเพี้ยน
    'settled_n',    (select count(*) from base where settled),
    'settled_paid', (select coalesce(sum(paid), 0) from base where settled),
    'net',          (select coalesce(sum(net), 0) from base where settled),
    'fee',          (select coalesce(sum(fee_total), 0) from base where settled)
  );
$$;

-- ── ปรับตัวล้างข้อมูลอัตโนมัติ (ทับของเดิมใน 005) ─────────────────────
--
-- ของเดิมลบออเดอร์ที่จบแล้วทิ้งเมื่อครบ 30 วัน ซึ่งจะลากประวัติเงินเข้าหายไปด้วย
-- (os_settlements ผูกกับ os_orders แบบ cascade)
-- แต่ประวัติเงินคือของที่ต้องย้อนดูข้ามเดือน ไม่ใช่งานค้างรายวัน
--
-- กติกาใหม่:
--   ใบที่ปิดยอดแล้ว   เก็บ 180 วัน — ไว้เทียบเดือนต่อเดือนว่าโดนหักหนักขึ้นไหม
--   ก้อนดิบของยอดเงิน เก็บ 30 วัน  — ใช้แค่ตอนตรวจว่าตัวแปลงอ่านฟิลด์ครบ
--   ที่เหลือเหมือนเดิม
create or replace function os_cleanup() returns text as $$
declare
  cleared int;
  removed int;
  events_removed int;
begin
  update os_orders set raw = null
   where raw is not null and ordered_at < now() - interval '7 days';
  get diagnostics cleared = row_count;

  -- ก้อนดิบของยอดเงิน กินที่มากแต่ใช้แค่ตอนตรวจฟิลด์ — ตัวเลขที่แปลงแล้วยังอยู่ครบ
  update os_settlements set raw = null
   where raw is not null and updated_at < now() - interval '30 days';

  delete from os_orders o
   where o.pulled_at is null
     and (
       (o.status in ('done', 'delivered') and o.ordered_at < now() - interval '30 days')
       or (o.status = 'cancelled' and o.ordered_at < now() - interval '90 days')
     )
     -- ใบที่ "ปิดยอดแล้ว" เท่านั้นที่ได้อยู่ต่อจนครบ 180 วัน
     -- (ใบที่แค่ถามแล้วยังไม่ปิดยอด ไม่มีตัวเลขให้เก็บ ปล่อยลบตามกติกาเดิม)
     and not exists (
       select 1 from os_settlements s
        where s.order_ref = o.id
          and s.settled
          and o.ordered_at >= now() - interval '180 days'
     );
  get diagnostics removed = row_count;

  delete from os_order_events where at < now() - interval '90 days';
  get diagnostics events_removed = row_count;

  delete from os_sync_log where started_at < now() - interval '14 days';

  return format('ล้าง raw %s แถว · ลบออเดอร์ %s ใบ · ลบประวัติ %s แถว', cleared, removed, events_removed);
end;
$$ language plpgsql;

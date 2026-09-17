-- เงินเข้าจริง เวอร์ชันดึงตามใบสรุปรายวัน — รันต่อจาก 013 (แทนที่ของ 013 ทั้งหมด)
--
-- ทำไมรื้อของ 013:
--   013 ถามยอดทีละออเดอร์ ร้านนี้ปิดยอดวันละ ~500 ใบ แต่ Netlify ให้เวลาแค่ ~26 วินาที
--   ต่อรอบ ได้แค่ ~40 ใบ ไม่มีวันไล่ทัน และทุกรอบโดนตัดกลางทางก่อนบันทึก → ได้ศูนย์ใบทุกรอบ
--   เปลี่ยนไปดึงตาม "ใบสรุปรายวัน" ของ TikTok ได้ครั้งละ 100 ใบ วันละ ~5 ครั้งก็ครบ
--
-- และไม่ผูกกับ os_orders แล้ว เพราะ:
--   • ยอดมักปิดหลังสั่ง 10-20 วัน ออเดอร์เก่าบางใบถูกล้างไปก่อน (ล้างที่ 30 วัน) ผูกไม่ติด
--   • ออเดอร์หนึ่งใบอาจโผล่หลายใบสรุป เช่นปิดยอดไปแล้ว ต่อมาลูกค้าตีคืน → มีรายการหักตามมาอีกรอบ

-- ── ของเดิมจาก 013 (ยังไม่เคยมีข้อมูลเข้าเลย ลบได้ปลอดภัย) ──────────────
drop function if exists os_settlement_todo(text, text, int, interval);
drop function if exists os_money_summary(timestamptz, timestamptz, text, text);
drop table if exists os_settlements;

-- ── ใบสรุปรายวัน = หนึ่งก้อนที่โอนเข้าบัญชี ─────────────────────────────
create table if not exists os_statements (
  platform       text not null,
  shop           text not null,
  statement_id   text not null,
  statement_at   timestamptz not null,
  currency       text,
  revenue        numeric(14,2),
  fee            numeric(14,2),     -- ติดลบ = ถูกหัก (รวมค่าส่งที่ร้านออกแล้ว)
  adjustment     numeric(14,2),
  settlement     numeric(14,2),     -- ยอดที่โอนเข้าบัญชีจริงของวันนั้น
  payment_status text,
  payment_at     timestamptz,

  -- ดึงรายการข้างในไปถึงไหนแล้ว — รอบถูกตัดกลางทางก็ทำต่อจากตรงนี้ได้ ไม่ต้องเริ่มใหม่
  tx_total       int,
  tx_synced      int not null default 0,
  cursor         text,
  done           boolean not null default false,
  synced_at      timestamptz not null default now(),
  primary key (platform, shop, statement_id)
);

create index if not exists os_statements_time_idx on os_statements (statement_at desc);
create index if not exists os_statements_todo_idx on os_statements (statement_at) where done = false;
alter table os_statements enable row level security;

-- ── รายการในใบสรุป = เงินของออเดอร์หนึ่งใบในรอบนั้น ────────────────────
-- เครื่องหมายตามแพลตฟอร์ม: เข้า = บวก, ถูกหัก = ลบ
-- สมการ: revenue + fee + shipping + adjustment = settlement (ตรวจกับของจริงแล้ว)
create table if not exists os_money_tx (
  platform         text not null,
  shop             text not null,
  tx_id            text not null,
  statement_id     text not null,
  statement_at     timestamptz not null,
  type             text,               -- ORDER / ADJUSTMENT ฯลฯ
  order_id         text,
  order_created_at timestamptz,
  gross            numeric(12,2),      -- ราคาป้ายก่อนลด (หักส่วนที่คืนแล้ว)
  seller_discount  numeric(12,2),      -- ส่วนลดที่ร้านออกเอง
  customer_paid    numeric(12,2),
  revenue          numeric(12,2),
  fee              numeric(12,2),      -- ค่าคอม ค่าธรรมเนียม ภาษี
  shipping         numeric(12,2),      -- ค่าส่งที่ร้านออก (ปกติแพลตฟอร์มช่วยจนเป็นศูนย์ ยกเว้นตีคืน)
  adjustment       numeric(12,2),
  settlement       numeric(12,2),      -- ★ เงินเข้าจริง
  breakdown        jsonb,              -- รายการย่อยที่ไม่เป็นศูนย์ เช่น fee.transaction_fee_amount
  primary key (platform, tx_id)
);

create index if not exists os_money_tx_time_idx  on os_money_tx (statement_at desc);
create index if not exists os_money_tx_order_idx on os_money_tx (platform, order_id);
alter table os_money_tx enable row level security;

-- ── สรุปยอดตามช่วงเวลา (ใช้วันที่ปิดยอด ไม่ใช่วันที่สั่ง = ตรงกับเงินเข้าบัญชี) ──
create or replace function os_money_totals(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_shop     text default null
) returns json language sql stable as $$
  with t as (
    select * from os_money_tx
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and (p_shop is null or shop = p_shop)
  ), s as (
    select * from os_statements
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and (p_shop is null or shop = p_shop)
  )
  select json_build_object(
    'rows',            (select count(*) from t),
    'gross',           (select coalesce(sum(gross), 0) from t),
    'seller_discount', (select coalesce(sum(seller_discount), 0) from t),
    'customer_paid',   (select coalesce(sum(customer_paid), 0) from t),
    'fee',             (select coalesce(sum(fee), 0) from t),
    'shipping',        (select coalesce(sum(shipping), 0) from t),
    'adjustment',      (select coalesce(sum(adjustment), 0) from t),
    'settlement',      (select coalesce(sum(settlement), 0) from t),
    -- ออเดอร์ที่ทำให้เสียเงิน (ส่วนใหญ่คือตีคืน โดนค่าส่งไป-กลับ)
    'loss_n',          (select count(*) from t where settlement < 0),
    'loss',            (select coalesce(sum(settlement), 0) from t where settlement < 0),
    -- ยอดตามใบสรุปของแพลตฟอร์ม ไว้เทียบว่าดึงรายการมาครบหรือยัง
    'stmt_n',          (select count(*) from s),
    'stmt_settlement', (select coalesce(sum(settlement), 0) from s),
    'stmt_pending',    (select count(*) from s where not done)
  );
$$;

-- ── ตัวล้างข้อมูลอัตโนมัติ (ทับของ 013) ─────────────────────────────────
-- os_orders กลับไปใช้กติกาเดิมของ 005 เพราะยอดเงินไม่ผูกกับตารางนี้แล้ว
-- รายการเงินรายออเดอร์เก็บ 60 วัน (วันละ ~500 แถว กินที่พอสมควร)
-- ใบสรุปรายวันเก็บตลอด — วันละแถวเดียว ไว้ดูย้อนหลังข้ามปีได้
create or replace function os_cleanup() returns text as $$
declare
  cleared int;
  removed int;
  events_removed int;
  money_removed int;
begin
  update os_orders set raw = null
   where raw is not null and ordered_at < now() - interval '7 days';
  get diagnostics cleared = row_count;

  delete from os_orders
   where pulled_at is null
     and (
       (status in ('done', 'delivered') and ordered_at < now() - interval '30 days')
       or (status = 'cancelled' and ordered_at < now() - interval '90 days')
     );
  get diagnostics removed = row_count;

  delete from os_order_events where at < now() - interval '90 days';
  get diagnostics events_removed = row_count;

  delete from os_money_tx where statement_at < now() - interval '60 days';
  get diagnostics money_removed = row_count;

  delete from os_sync_log where started_at < now() - interval '14 days';

  return format('ล้าง raw %s แถว · ลบออเดอร์ %s ใบ · ลบประวัติ %s แถว · ลบรายการเงิน %s แถว',
                cleared, removed, events_removed, money_removed);
end;
$$ language plpgsql;

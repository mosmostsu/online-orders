-- เงินเข้าจริงของ Shopee — รันต่อจาก 022
--
-- Shopee ไม่มี "ใบสรุปรายวัน" ให้ถามเป็นก้อนแบบ TikTok (ดู lib/shopee.js get_escrow_list/get_escrow_detail_batch)
-- มีแค่ระดับออเดอร์ที่ escrow ปล่อยแล้ว เราจึงต้องสร้างแถว os_statements (ที่หน้า /money ใช้ขับตารางรายวัน
-- ดู os_money_daily ใน 015 — เอาวันจาก os_statements แล้ว left join os_money_tx) เองจากยอดที่บันทึกไปแล้ว
-- แทนที่จะเดายอดจาก escrow_list ล่วงหน้า

create or replace function os_rebuild_statements(
  p_platform text, p_shop text, p_from timestamptz, p_to timestamptz
) returns int language plpgsql as $$
declare
  n int;
begin
  with agg as (
    select date_trunc('day', statement_at) as d,
           count(*)        as cnt,
           sum(revenue)    as revenue,
           sum(fee) + sum(shipping) as fee,   -- ระดับใบสรุปรวมค่าส่งเข้ากับค่าธรรมเนียม เหมือนที่ TikTok ทำ (ดู lib/tiktok.js normalizeStatement)
           sum(adjustment) as adjustment,
           sum(settlement) as settlement
      from os_money_tx
     where platform = p_platform and shop = p_shop
       and statement_at >= p_from and statement_at < p_to
     group by 1
  )
  insert into os_statements (platform, shop, statement_id, statement_at, currency,
                             revenue, fee, adjustment, settlement, payment_status, payment_at,
                             tx_total, tx_synced, done, synced_at)
  select p_platform, p_shop, to_char(d, 'YYYY-MM-DD'), d, 'THB',
         revenue, fee, adjustment, settlement, 'SETTLED', d,
         cnt, cnt, true, now()   -- tx_synced เป็น not null — ใส่ cnt แทน null (ข้อมูลรวมครบจากที่บันทึกแล้วเสมอ ไม่มีสถานะ "ดึงค้าง" แบบ TikTok)
    from agg
  on conflict (platform, shop, statement_id) do update set
    statement_at = excluded.statement_at,
    revenue      = excluded.revenue,
    fee          = excluded.fee,
    adjustment   = excluded.adjustment,
    settlement   = excluded.settlement,
    payment_status = excluded.payment_status,
    payment_at   = excluded.payment_at,
    tx_total     = excluded.tx_total,
    tx_synced    = excluded.tx_synced,
    done         = true,
    synced_at    = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

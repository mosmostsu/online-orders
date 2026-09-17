-- เงินเข้าแยกรายวัน — รันต่อจาก 014
--
-- นับวันตาม "วันที่ปิดยอด" ไม่ใช่วันที่ลูกค้าสั่ง:
--   • ตรงกับเงินที่โอนเข้าบัญชีจริงของวันนั้น เอาไปเทียบกับสมุดบัญชีได้
--   • ออเดอร์ปิดยอดหลังสั่ง 10-20 วัน ถ้านับตามวันสั่ง ช่วงสองสัปดาห์ล่าสุดจะยังไม่ครบ
--     ตัวเลขดูตกฮวบทั้งที่แค่ยังไม่ถึงรอบ — ชวนตัดสินใจผิด
--
-- ใบสรุปของ TikTok ตัดรอบที่ 00:00 UTC (07:00 เวลาไทย) วันที่ตามเวลา UTC จึงตรงกับวันไทยของใบนั้น
-- คืนเป็น json แทนตาราง — ชื่อคอลัมน์ขาออกจะได้ไม่ชนกับชื่อคอลัมน์ในตาราง (gross, fee ฯลฯ)
create or replace function os_money_daily(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_shop     text default null
) returns json language sql stable as $$
  with s as (
    select date_trunc('day', statement_at) as d,
           sum(settlement) as stmt_settlement,
           bool_and(done)  as synced
      from os_statements
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and (p_shop is null or shop = p_shop)
     group by 1
  ), t as (
    select date_trunc('day', statement_at) as d,
           count(*)             as n,
           sum(gross)           as gross,
           sum(seller_discount) as seller_discount,
           sum(fee)             as fee,
           sum(shipping)        as shipping,
           sum(adjustment)      as adjustment,
           sum(settlement)      as settlement,
           count(*) filter (where settlement < 0)                  as loss_n,
           coalesce(sum(settlement) filter (where settlement < 0), 0) as loss
      from os_money_tx
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and (p_shop is null or shop = p_shop)
     group by 1
  )
  select coalesce(json_agg(json_build_object(
           'day',             s.d,
           'rows',            coalesce(t.n, 0),
           'gross',           coalesce(t.gross, 0),
           'seller_discount', coalesce(t.seller_discount, 0),
           'fee',             coalesce(t.fee, 0),
           'shipping',        coalesce(t.shipping, 0),
           'adjustment',      coalesce(t.adjustment, 0),
           'settlement',      coalesce(t.settlement, 0),
           'loss_n',          coalesce(t.loss_n, 0),
           'loss',            coalesce(t.loss, 0),
           'stmt_settlement', s.stmt_settlement,
           'synced',          s.synced
         ) order by s.d desc), '[]'::json)
    from s left join t on t.d = s.d;
$$;

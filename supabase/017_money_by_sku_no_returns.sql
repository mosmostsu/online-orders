-- รายสินค้า: แยกออเดอร์ตีคืนออก + เรียงตามส่วนลด — รันต่อจาก 016
--
-- หน้านี้มีไว้ตอบว่า "ตั้งส่วนลดเยอะไปไหม" ออเดอร์ที่ตีคืนทำให้ตัวเลขเพี้ยน:
-- ไม่ได้เงินค่าสินค้า แต่ยังโดนค่าส่งไป-กลับ % ที่เหลือเลยดูแย่ทั้งที่ไม่เกี่ยวกับส่วนลด
-- จึงไม่นับออเดอร์เหล่านี้ในตัวเลขหลัก แล้วแยกบอกจำนวนไว้ต่างหาก
--
-- นับเป็นตีคืนทั้งออเดอร์ ถ้ามีรายการคืนเงินค่าสินค้าในใบสรุปใบไหนก็ตาม
-- เพราะการคืนมักมาในใบสรุปคนละวันกับตอนขาย ถ้าดูแค่รายการเดียวจะตัดได้แค่ครึ่งเดียว
create or replace function os_money_by_sku(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'disc',
  p_min_qty  int  default 5,
  p_limit    int  default 100
) returns json language sql stable as $$
  with returned as (
    select distinct platform, order_id
      from os_money_tx
     where order_id is not null
       and breakdown ? 'rev.refund_subtotal_before_discount_amount'
  ), base as (
    select i.*, (r.order_id is not null) as is_return
      from os_money_items i
      left join returned r on r.platform = i.platform and r.order_id = i.order_id
     where i.statement_at >= p_from and i.statement_at < p_to
       and (p_platform is null or i.platform = p_platform)
  ), g as (
    select sku,
           max(product_name) as product_name,
           max(image_url)    as image_url,
           coalesce(sum(qty) filter (where not is_return), 0)             as qty,
           count(distinct order_id) filter (where not is_return)          as orders,
           coalesce(sum(gross) filter (where not is_return), 0)           as gross,
           coalesce(sum(seller_discount) filter (where not is_return), 0) as seller_discount,
           coalesce(sum(charges) filter (where not is_return), 0)         as charges,
           coalesce(sum(settlement) filter (where not is_return), 0)      as settlement,
           count(distinct order_id) filter (where is_return)              as ret_orders,
           coalesce(sum(settlement) filter (where is_return), 0)          as ret_settlement
      from base
     where matched
     group by sku
    having coalesce(sum(qty) filter (where not is_return), 0) >= p_min_qty
  ), ranked as (
    select *,
           case when gross > 0 then settlement / gross end        as keep,
           case when gross > 0 then -seller_discount / gross end  as disc
      from g
  ), kept as (
    select * from base where matched and not is_return
  )
  select json_build_object(
    'skus', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(r) from (
        select * from ranked
         order by
           case when p_sort = 'disc' then disc end desc nulls last,
           case when p_sort = 'low'  then keep end asc nulls last,
           case when p_sort = 'net'  then settlement end desc,
           case when p_sort = 'qty'  then qty end desc,
           settlement desc
         limit p_limit
      ) r), '[]'::json),
    -- ยอดรวมแบบเดียวกับตาราง (ไม่นับตีคืน ทุกสินค้า ไม่ตัดตามจำนวนชิ้น) ไว้ขึ้นการ์ดด้านบน
    'tot_gross',           (select coalesce(sum(gross), 0) from kept),
    'tot_seller_discount', (select coalesce(sum(seller_discount), 0) from kept),
    'tot_charges',         (select coalesce(sum(charges), 0) from kept),
    'tot_settlement',      (select coalesce(sum(settlement), 0) from kept),
    'tot_qty',             (select coalesce(sum(qty), 0) from kept),
    'returns_n',  (select count(distinct order_id) from base where matched and is_return),
    'returns',    (select coalesce(sum(settlement), 0) from base where matched and is_return),
    'unmatched_n', (select count(*) from base where not matched),
    'unmatched',   (select coalesce(sum(settlement), 0) from base where not matched)
  );
$$;

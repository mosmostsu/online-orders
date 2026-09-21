-- เก็บ "ออเดอร์นี้ตีคืนไหม" เป็นคอลัมน์จริง — รันต่อจาก 024
--
-- หน้ารายสินค้าใช้เวลา 8 วินาทีจนชนเพดานเวลาของฐานข้อมูล (statement timeout) แล้วคืนค่าว่าง
-- ต้นเหตุ: ทุกครั้งที่เปิดหน้า os_money_by_product ต้องไล่เปิดก้อน JSON ของ os_money_tx
-- ทั้ง 14,000 แถว เพื่อหาว่าใบไหนมีรายการคืนเงิน (breakdown ? 'rev.refund_...') ซึ่งทำดัชนีไม่ได้
--
-- เปลี่ยนเป็นคอลัมน์จริงทั้งสองตาราง แล้วหน้าเว็บอ่านคอลัมน์ตรงๆ

-- ── ฝั่งใบสรุป: คำนวณจากก้อน JSON ให้อัตโนมัติ ──────────────────────────
alter table os_money_tx
  add column if not exists is_return boolean
  generated always as (jsonb_exists(breakdown, 'rev.refund_subtotal_before_discount_amount')) stored;

create index if not exists os_money_tx_return_idx on os_money_tx (platform, order_id) where is_return;

-- ── ฝั่งรายสินค้า: ติดธงไว้ที่แถวเลย จะได้ไม่ต้อง join ตอนเปิดหน้า ──────
alter table os_money_items add column if not exists is_return boolean not null default false;
create index if not exists os_money_items_ret_idx on os_money_items (platform, statement_at) where matched and not is_return;

-- การคืนเงินมักมาคนละใบสรุปกับตอนขาย พอใบคืนเงินเข้ามา ต้องย้อนไปติดธงให้ทุกแถวของออเดอร์นั้น
create or replace function os_money_mark_return() returns trigger language plpgsql as $$
begin
  if new.is_return and new.order_id is not null then
    update os_money_items
       set is_return = true
     where platform = new.platform and order_id = new.order_id and not is_return;
  end if;
  return new;
end;
$$;

drop trigger if exists os_money_tx_mark_return on os_money_tx;
create trigger os_money_tx_mark_return
  after insert or update on os_money_tx
  for each row execute function os_money_mark_return();

-- ติดธงย้อนหลังให้ของที่มีอยู่
update os_money_items i
   set is_return = true
  from os_money_tx t
 where t.platform = i.platform and t.order_id = i.order_id
   and t.is_return and not i.is_return;

-- ── สรุปตามตะกร้า (ทับของ 018) — ใช้ธงแทนการไล่เปิด JSON ────────────────
create or replace function os_money_by_product(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'disc',
  p_min_qty  int  default 5,
  p_limit    int  default 100
) returns json language sql stable as $$
  with base as (
    select i.*, coalesce(i.product_id, 'sku:' || coalesce(i.sku, '')) as pkey
      from os_money_items i
     where i.statement_at >= p_from and i.statement_at < p_to
       and (p_platform is null or i.platform = p_platform)
       and i.matched
  ), p as (
    select pkey,
           max(product_id)   as product_id,
           max(product_name) as product_name,
           max(image_url)    as image_url,
           count(distinct sku) as variants_n,
           coalesce(sum(qty) filter (where not is_return), 0)             as qty,
           count(distinct order_id) filter (where not is_return)          as orders,
           coalesce(sum(gross) filter (where not is_return), 0)           as gross,
           coalesce(sum(seller_discount) filter (where not is_return), 0) as seller_discount,
           coalesce(sum(charges) filter (where not is_return), 0)         as charges,
           coalesce(sum(settlement) filter (where not is_return), 0)      as settlement,
           count(distinct order_id) filter (where is_return)              as ret_orders,
           coalesce(sum(settlement) filter (where is_return), 0)          as ret_settlement
      from base
     group by pkey
    having coalesce(sum(qty) filter (where not is_return), 0) >= p_min_qty
  ), ranked as (
    select *,
           case when gross > 0 then settlement / gross end       as keep,
           case when gross > 0 then -seller_discount / gross end as disc
      from p
  ), top as (
    select *,
           row_number() over (order by
             case when p_sort = 'disc' then disc end desc nulls last,
             case when p_sort = 'low'  then keep end asc nulls last,
             case when p_sort = 'net'  then settlement end desc,
             case when p_sort = 'qty'  then qty end desc,
             settlement desc) as rn
      from ranked
  ), v as (
    -- ตัวเลือกข้างในของตะกร้าที่ติดอันดับ — หน้าเว็บใช้คิดทุน/กำไรฝั่งเซิร์ฟเวอร์
    -- (ไม่ได้ส่งต่อไปถึงเบราว์เซอร์ หน้าเว็บโหลดตอนกดกางผ่าน /api/money/variants)
    select b.pkey, b.sku,
           max(b.variant) as variant,
           coalesce(sum(b.qty) filter (where not b.is_return), 0)             as qty,
           coalesce(sum(b.gross) filter (where not b.is_return), 0)           as gross,
           coalesce(sum(b.seller_discount) filter (where not b.is_return), 0) as seller_discount,
           coalesce(sum(b.charges) filter (where not b.is_return), 0)         as charges,
           coalesce(sum(b.settlement) filter (where not b.is_return), 0)      as settlement,
           count(distinct b.order_id) filter (where b.is_return)              as ret_orders
      from base b
     where b.pkey in (select pkey from top where rn <= p_limit)
     group by b.pkey, b.sku
  ), kept as (
    select * from base where not is_return
  )
  select json_build_object(
    'products', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(json_build_object(
               'pkey', t.pkey, 'product_id', t.product_id, 'product_name', t.product_name,
               'image_url', t.image_url, 'variants_n', t.variants_n, 'qty', t.qty, 'orders', t.orders,
               'gross', t.gross, 'seller_discount', t.seller_discount, 'charges', t.charges,
               'settlement', t.settlement, 'keep', t.keep, 'disc', t.disc,
               'ret_orders', t.ret_orders, 'ret_settlement', t.ret_settlement,
               'variants', (
                 select coalesce(json_agg(json_build_object(
                          'sku', v.sku, 'variant', v.variant, 'qty', v.qty, 'gross', v.gross,
                          'seller_discount', v.seller_discount, 'charges', v.charges,
                          'settlement', v.settlement, 'ret_orders', v.ret_orders
                        ) order by v.qty desc, v.sku), '[]'::json)
                   from v where v.pkey = t.pkey)
             ) order by t.rn)
        from top t
       where t.rn <= p_limit
    ), '[]'::json),
    'tot_gross',           (select coalesce(sum(gross), 0) from kept),
    'tot_seller_discount', (select coalesce(sum(seller_discount), 0) from kept),
    'tot_charges',         (select coalesce(sum(charges), 0) from kept),
    'tot_settlement',      (select coalesce(sum(settlement), 0) from kept),
    'tot_qty',             (select coalesce(sum(qty), 0) from kept),
    'returns_n', (select count(distinct order_id) from base where is_return),
    'returns',   (select coalesce(sum(settlement), 0) from base where is_return),
    'unmatched_n', (select count(*) from os_money_items
                     where not matched and statement_at >= p_from and statement_at < p_to
                       and (p_platform is null or platform = p_platform)),
    'unmatched',   (select coalesce(sum(settlement), 0) from os_money_items
                     where not matched and statement_at >= p_from and statement_at < p_to
                       and (p_platform is null or platform = p_platform))
  );
$$;

-- ── สรุปรายรหัส (ทับของ 017) — ใช้ธงเหมือนกัน ──────────────────────────
create or replace function os_money_by_sku(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'disc',
  p_min_qty  int  default 5,
  p_limit    int  default 100
) returns json language sql stable as $$
  with base as (
    select * from os_money_items
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
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
           case when gross > 0 then settlement / gross end       as keep,
           case when gross > 0 then -seller_discount / gross end as disc
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
    'tot_gross',           (select coalesce(sum(gross), 0) from kept),
    'tot_seller_discount', (select coalesce(sum(seller_discount), 0) from kept),
    'tot_charges',         (select coalesce(sum(charges), 0) from kept),
    'tot_settlement',      (select coalesce(sum(settlement), 0) from kept),
    'tot_qty',             (select coalesce(sum(qty), 0) from kept),
    'returns_n', (select count(distinct order_id) from base where matched and is_return),
    'returns',   (select coalesce(sum(settlement), 0) from base where matched and is_return),
    'unmatched_n', (select count(*) from base where not matched),
    'unmatched',   (select coalesce(sum(settlement), 0) from base where not matched)
  );
$$;

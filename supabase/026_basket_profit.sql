-- ให้ฐานข้อมูลคิดทุน/กำไรมาเลย — รันต่อจาก 025
--
-- os_money_by_product แกว่งอยู่ที่ 2-8 วินาที และบางครั้งชนเพดานเวลาจนคืนค่าว่าง
-- งานหนักที่สุดคือการรวม "ตัวเลือกสี/ไซส์" ของทุกตะกร้าส่งกลับไปให้หน้าเว็บ
-- ซึ่งหน้าเว็บเอาไปใช้อย่างเดียวคือคูณกับทุนเพื่อหากำไร (ตัวเลือกที่โชว์จริงโหลดตอนกดกาง)
--
-- ตอนนี้ทุนอยู่ในตาราง os_sku_cost แล้ว (ดู 024) จึงคิดกำไรในฐานข้อมูลได้เลย
-- แล้วเลิกส่งตัวเลือกกลับไป — งานหายไปก้อนใหญ่ และข้อมูลที่ส่งเล็กลง ~4 เท่า
--
-- นับเฉพาะชิ้นที่มีทุน: cov_qty/cov_gross/cov_settlement คือส่วนที่มีทุน
-- ตะกร้าที่บางรหัสไม่มีบิล จะได้กำไรของเฉพาะชิ้นที่รู้ทุน ไม่ใช่เอายอดทั้งตะกร้ามาลบทุนบางส่วน

create index if not exists os_money_items_pkey_idx on os_money_items (platform, product_id, statement_at);

create or replace function os_money_by_product(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'disc',
  p_min_qty  int  default 5,
  p_limit    int  default 100
) returns json language sql stable as $$
  with base as (
    select i.platform, i.sku, i.product_id, i.product_name, i.image_url, i.order_id,
           i.qty, i.gross, i.seller_discount, i.charges, i.settlement, i.is_return,
           coalesce(i.product_id, 'sku:' || coalesce(i.sku, '')) as pkey,
           c.cost, c.est, c.off_bill
      from os_money_items i
      left join os_sku_cost c on c.platform = i.platform and c.sku = i.sku
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
           coalesce(sum(settlement) filter (where is_return), 0)          as ret_settlement,
           -- เฉพาะชิ้นที่รู้ทุน
           coalesce(sum(qty * cost) filter (where not is_return and cost is not null), 0)  as cost,
           coalesce(sum(qty) filter (where not is_return and cost is not null), 0)         as cov_qty,
           coalesce(sum(gross) filter (where not is_return and cost is not null), 0)       as cov_gross,
           coalesce(sum(settlement) filter (where not is_return and cost is not null), 0)  as cov_settlement,
           bool_or(est) filter (where not is_return and cost is not null)      as cost_est,
           bool_or(off_bill) filter (where not is_return and cost is not null) as cost_off
      from base
     group by pkey
    having coalesce(sum(qty) filter (where not is_return), 0) >= p_min_qty
  ), ranked as (
    select *,
           case when gross > 0 then settlement / gross end          as keep,
           case when gross > 0 then -seller_discount / gross end    as disc,
           case when cov_qty > 0 then cov_settlement - cost end     as profit,
           case when cov_qty > 0 and cov_gross > 0
                then (cov_settlement - cost) / cov_gross end        as margin
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
  ), kept as (
    select * from base where not is_return
  )
  select json_build_object(
    'products', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(to_jsonb(t) - 'rn' order by t.rn) from top t where t.rn <= p_limit
    ), '[]'::json),
    'tot_gross',           (select coalesce(sum(gross), 0) from kept),
    'tot_seller_discount', (select coalesce(sum(seller_discount), 0) from kept),
    'tot_charges',         (select coalesce(sum(charges), 0) from kept),
    'tot_settlement',      (select coalesce(sum(settlement), 0) from kept),
    'tot_qty',             (select coalesce(sum(qty), 0) from kept),
    'tot_cost',            (select coalesce(sum(qty * cost), 0) from kept where cost is not null),
    'tot_cov_qty',         (select coalesce(sum(qty), 0) from kept where cost is not null),
    'tot_cov_gross',       (select coalesce(sum(gross), 0) from kept where cost is not null),
    'tot_cov_settlement',  (select coalesce(sum(settlement), 0) from kept where cost is not null),
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

-- ── แยกทีละรหัสสี/ไซส์ — คิดทุนมาให้เหมือนกัน ──────────────────────────
create or replace function os_money_by_sku(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'disc',
  p_min_qty  int  default 5,
  p_limit    int  default 100
) returns json language sql stable as $$
  with base as (
    select i.platform, i.sku, i.product_name, i.image_url, i.order_id, i.matched,
           i.qty, i.gross, i.seller_discount, i.charges, i.settlement, i.is_return,
           c.cost, c.est, c.off_bill
      from os_money_items i
      left join os_sku_cost c on c.platform = i.platform and c.sku = i.sku
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
           coalesce(sum(settlement) filter (where is_return), 0)          as ret_settlement,
           coalesce(sum(qty * cost) filter (where not is_return and cost is not null), 0)  as cost,
           coalesce(sum(qty) filter (where not is_return and cost is not null), 0)         as cov_qty,
           coalesce(sum(gross) filter (where not is_return and cost is not null), 0)       as cov_gross,
           coalesce(sum(settlement) filter (where not is_return and cost is not null), 0)  as cov_settlement,
           bool_or(est) filter (where not is_return and cost is not null)      as cost_est,
           bool_or(off_bill) filter (where not is_return and cost is not null) as cost_off
      from base
     where matched
     group by sku
    having coalesce(sum(qty) filter (where not is_return), 0) >= p_min_qty
  ), ranked as (
    select *,
           case when gross > 0 then settlement / gross end       as keep,
           case when gross > 0 then -seller_discount / gross end as disc,
           case when cov_qty > 0 then cov_settlement - cost end  as profit,
           case when cov_qty > 0 and cov_gross > 0
                then (cov_settlement - cost) / cov_gross end     as margin
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
    'tot_cost',            (select coalesce(sum(qty * cost), 0) from kept where cost is not null),
    'tot_cov_qty',         (select coalesce(sum(qty), 0) from kept where cost is not null),
    'tot_cov_gross',       (select coalesce(sum(gross), 0) from kept where cost is not null),
    'tot_cov_settlement',  (select coalesce(sum(settlement), 0) from kept where cost is not null),
    'returns_n', (select count(distinct order_id) from base where matched and is_return),
    'returns',   (select coalesce(sum(settlement), 0) from base where matched and is_return),
    'unmatched_n', (select count(*) from base where not matched),
    'unmatched',   (select coalesce(sum(settlement), 0) from base where not matched)
  );
$$;

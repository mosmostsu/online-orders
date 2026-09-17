-- รายสินค้าแบบรวมตาม "ตะกร้า" — รันต่อจาก 017
--
-- ตะกร้า = สินค้าหนึ่งลิงก์บนแพลตฟอร์ม (product_id) ข้างในมีหลายตัวเลือกสี/ไซส์ (sku)
-- ร้านตั้งส่วนลดกันที่ระดับตะกร้าเป็นหลัก ดูแยกทีละรหัสแล้วตระกูลเดียวกันกินที่ 8-10 แถว
-- จึงรวมเป็นแถวเดียวต่อตะกร้า แล้วแนบตัวเลือกไว้ข้างในให้กางดูได้

alter table os_money_items add column if not exists product_id text;
create index if not exists os_money_items_product_idx on os_money_items (platform, product_id);

-- ── ตัวแตกรายสินค้า: เก็บ product_id ด้วย (นอกนั้นเหมือน 016 ทุกอย่าง) ────────────
create or replace function os_money_itemize_tx(p_platform text, p_tx_id text) returns void
language plpgsql as $$
declare
  t os_money_tx;
begin
  select * into t from os_money_tx where platform = p_platform and tx_id = p_tx_id;
  if not found then return; end if;

  delete from os_money_items where platform = t.platform and tx_id = t.tx_id;
  if t.order_id is null then return; end if;

  insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id, sku, product_id,
                              product_name, variant, image_url, qty, gross, seller_discount, charges,
                              settlement, matched)
  with lines as (
    select row_number() over (order by i.id)::int as line_no,
           i.sku, i.raw->>'product_id' as product_id, i.product_name, i.variant, i.image_url, i.qty,
           coalesce(nullif(i.raw->>'original_price', '')::numeric, i.price, 0) * i.qty  as w_gross,
           coalesce(nullif(i.raw->>'seller_discount', '')::numeric, 0) * i.qty          as w_disc,
           coalesce(nullif(i.raw->>'sale_price', '')::numeric, i.price, 0) * i.qty      as w_sale
      from os_orders o
      join os_order_items i on i.order_ref = o.id
     where o.platform = t.platform and o.shop = t.shop and o.order_id = t.order_id
  ), tot as (
    select sum(w_gross) as g, sum(w_disc) as d, sum(w_sale) as s, count(*) as n from lines
  ), shares as (
    select l.*,
           case when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_sale,
           case when tot.g > 0 then l.w_gross / tot.g
                when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_gross,
           case when tot.d > 0 then l.w_disc / tot.d
                when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_disc
      from lines l cross join tot
  )
  select t.platform, t.tx_id, line_no, t.shop, t.statement_at, t.order_id, sku, product_id,
         product_name, variant, image_url, qty,
         round(t.gross * s_gross, 2),
         round(t.seller_discount * s_disc, 2),
         round((t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         round(t.gross * s_gross + t.seller_discount * s_disc
               + (t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         true
    from shares;

  if not found then
    insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id,
                                gross, seller_discount, charges, settlement, matched)
    values (t.platform, t.tx_id, 0, t.shop, t.statement_at, t.order_id,
            t.gross, t.seller_discount, t.settlement - t.gross - t.seller_discount, t.settlement, false);
  end if;
end;
$$;

-- ── เติม product_id ให้แถวที่แตกไว้แล้ว ─────────────────────────────────
-- เติมอย่างเดียว ไม่แตกใหม่ทั้งหมด — ออเดอร์ที่ถูกล้างไปหลังรัน 016 ถ้าแตกใหม่จะกลายเป็น "หาสินค้าไม่เจอ"
update os_money_items m
   set product_id = x.product_id
  from (
    select o.platform, o.shop, o.order_id, i.sku, max(i.raw->>'product_id') as product_id
      from os_orders o
      join os_order_items i on i.order_ref = o.id
     group by 1, 2, 3, 4
  ) x
 where m.product_id is null
   and m.matched
   and x.platform = m.platform and x.shop = m.shop and x.order_id = m.order_id
   and x.sku is not distinct from m.sku;

-- ── สรุปตามตะกร้า พร้อมตัวเลือกข้างใน ────────────────────────────────────
-- กติกาเดียวกับ os_money_by_sku (017): ไม่นับออเดอร์ตีคืน แยกบอกจำนวนไว้ต่างหาก
-- p_min_qty นับรวมทั้งตะกร้า — ตัวเลือกที่ขายน้อยยังโผล่ข้างในได้
create or replace function os_money_by_product(
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
    select i.*,
           coalesce(i.product_id, 'sku:' || coalesce(i.sku, '')) as pkey,  -- ไม่มีรหัสตะกร้า ใช้รหัสสินค้าแทน
           (r.order_id is not null) as is_return
      from os_money_items i
      left join returned r on r.platform = i.platform and r.order_id = i.order_id
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
    -- ตัวเลือกข้างใน ทำเฉพาะตะกร้าที่ติดอันดับ ไม่ต้องคำนวณของที่ไม่ได้โชว์
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

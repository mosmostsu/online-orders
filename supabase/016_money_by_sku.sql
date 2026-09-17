-- เงินเข้าจริงรายสินค้า — รันต่อจาก 015
--
-- แตกยอดของแต่ละรายการในใบสรุป (os_money_tx) ลงไปเป็นรายสินค้าในออเดอร์นั้น:
--   • ราคาป้าย กับ ส่วนลดร้าน → ใช้ของจริงต่อชิ้นจาก line item (original_price, seller_discount)
--     ตรวจกับออเดอร์หลายสินค้าจริงแล้ว รวมกันตรงกับยอดของใบสรุปทุกบาท
--   • ค่าคอม ค่าธรรมเนียม ค่าส่ง ปรับปรุง → ใบสรุปให้มาเป็นยอดรวมต่อออเดอร์ จึงปันตามราคาขาย
--     กระทบแค่ออเดอร์ที่มีหลายสินค้า (~6% ของออเดอร์ TikTok) ที่เหลือมีสินค้าเดียว ได้เต็มจำนวนตรงๆ
--   ผลรวมของทุกสินค้าในออเดอร์ = ยอดเข้าจริงของออเดอร์นั้น (คลาดได้ไม่เกินเศษสตางค์จากการปัด)
--
-- ทำไมเก็บเป็นตาราง ไม่คำนวณสดตอนเปิดหน้า:
--   os_orders ลบออเดอร์ที่จบแล้วหลัง 30 วัน (ดู os_cleanup) แต่รายการเงินเก็บ 60 วัน
--   ถ้าคำนวณสด ยอดช่วงครึ่งหลังของ 60 วันจะหาสินค้าไม่เจอ
--   จึงแตกรายสินค้าเก็บไว้ทันทีที่ยอดเข้ามา ตอนที่ออเดอร์ยังอยู่
--   (ตอนรันครั้งแรกกับยอด 30 วันที่ดึงมาแล้ว หาสินค้าไม่เจอ 272 จาก ~13,600 ออเดอร์ = 2%)

create table if not exists os_money_items (
  platform        text not null,
  tx_id           text not null,
  line_no         int  not null,        -- 0 = หารายการสินค้าไม่เจอ (ออเดอร์ถูกล้างไปก่อน)
  shop            text not null,
  statement_at    timestamptz not null,
  order_id        text,
  sku             text,
  product_name    text,
  variant         text,
  image_url       text,
  qty             int,
  gross           numeric(12,2),        -- ราคาป้าย
  seller_discount numeric(12,2),        -- ส่วนลดร้าน (ติดลบ)
  charges         numeric(12,2),        -- ค่าคอม ค่าธรรมเนียม ค่าส่ง ปรับปรุง (ปันตามราคาขาย)
  settlement      numeric(12,2),        -- เข้าจริง = gross + seller_discount + charges
  matched         boolean not null,
  primary key (platform, tx_id, line_no),
  foreign key (platform, tx_id) references os_money_tx (platform, tx_id) on delete cascade
);

create index if not exists os_money_items_time_idx on os_money_items (statement_at desc);
create index if not exists os_money_items_sku_idx  on os_money_items (platform, sku);
alter table os_money_items enable row level security;

-- ── แตกหนึ่งรายการในใบสรุป → รายสินค้า ─────────────────────────────────
create or replace function os_money_itemize_tx(p_platform text, p_tx_id text) returns void
language plpgsql as $$
declare
  t os_money_tx;
begin
  select * into t from os_money_tx where platform = p_platform and tx_id = p_tx_id;
  if not found then return; end if;

  -- เขียนใหม่ทั้งชุดทุกครั้ง — แพลตฟอร์มอาจแก้ยอดของรายการเดิม
  delete from os_money_items where platform = t.platform and tx_id = t.tx_id;

  -- รายการปรับปรุงที่ไม่ผูกกับออเดอร์ ไม่มีสินค้าให้แตก
  if t.order_id is null then return; end if;

  insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id, sku, product_name,
                              variant, image_url, qty, gross, seller_discount, charges, settlement, matched)
  with lines as (
    select row_number() over (order by i.id)::int as line_no,
           i.sku, i.product_name, i.variant, i.image_url, i.qty,
           -- line item ของ TikTok เป็นราคาต่อชิ้น คูณจำนวนก่อนใช้เป็นน้ำหนัก
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
  select t.platform, t.tx_id, line_no, t.shop, t.statement_at, t.order_id, sku, product_name,
         variant, image_url, qty,
         round(t.gross * s_gross, 2),
         round(t.seller_discount * s_disc, 2),
         round((t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         round(t.gross * s_gross + t.seller_discount * s_disc
               + (t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         true
    from shares;

  -- หาสินค้าไม่เจอ — ยังเก็บยอดไว้ในถัง "ไม่ทราบสินค้า" จะได้รู้ว่าหลุดไปเท่าไร
  if not found then
    insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id,
                                gross, seller_discount, charges, settlement, matched)
    values (t.platform, t.tx_id, 0, t.shop, t.statement_at, t.order_id,
            t.gross, t.seller_discount, t.settlement - t.gross - t.seller_discount, t.settlement, false);
  end if;
end;
$$;

-- ทำที่ชั้นฐานข้อมูล — บันทึกยอดเข้ามาทางไหนก็แตกรายสินค้าให้เสมอ ไม่มีทางลืม
create or replace function os_money_tx_itemize_trg() returns trigger language plpgsql as $$
begin
  perform os_money_itemize_tx(new.platform, new.tx_id);
  return new;
end;
$$;

drop trigger if exists os_money_tx_itemize on os_money_tx;
create trigger os_money_tx_itemize
  after insert or update on os_money_tx
  for each row execute function os_money_tx_itemize_trg();

-- ── สรุปรายสินค้า ──────────────────────────────────────────────────────
--   p_sort: low = เหลือ % น้อยสุดก่อน (ตัวที่ลดเยอะ/โดนหักหนัก)
--           net = เงินเข้ามากสุดก่อน
--           qty = ขายได้มากสุดก่อน
--   p_min_qty: ตัดสินค้าที่ขายน้อยชิ้นทิ้ง ไม่งั้นตัวที่ขายชิ้นเดียวแล้วโดนตีคืนจะลอยขึ้นหัวตาราง
create or replace function os_money_by_sku(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null,
  p_sort     text default 'low',
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
           sum(qty)          as qty,
           count(distinct order_id) as orders,
           sum(gross)           as gross,
           sum(seller_discount) as seller_discount,
           sum(charges)         as charges,
           sum(settlement)      as settlement,
           count(*) filter (where settlement < 0) as loss_n
      from base
     where matched
     group by sku
    having sum(qty) >= p_min_qty
  ), ranked as (
    select *, case when gross > 0 then settlement / gross end as keep
      from g
  )
  select json_build_object(
    'skus', (select count(*) from ranked),
    'rows', coalesce((
      select json_agg(r) from (
        select * from ranked
         order by
           case when p_sort = 'low' then keep end asc nulls last,
           case when p_sort = 'net' then settlement end desc,
           case when p_sort = 'qty' then qty end desc,
           settlement desc
         limit p_limit
      ) r), '[]'::json),
    'unmatched_n', (select count(*) from base where not matched),
    'unmatched',   (select coalesce(sum(settlement), 0) from base where not matched),
    'matched',     (select coalesce(sum(settlement), 0) from base where matched)
  );
$$;

-- ── แตกรายสินค้าให้ยอดที่ดึงมาแล้ว ─────────────────────────────────────
-- ใบที่ออเดอร์ถูกล้างไปแล้วจะไปอยู่ถัง "ไม่ทราบสินค้า"
select count(*) as itemized from (select os_money_itemize_tx(platform, tx_id) from os_money_tx) x;

-- คิดทุนไว้ล่วงหน้า แทนคิดสดตอนเปิดหน้า — รันต่อจาก 022 (ใช้แทน 023 ที่มีแต่ดัชนี)
--
-- os_costs_for ใช้เวลา 4.3 วินาทีทุกครั้งที่เปิดหน้ารายสินค้า เพราะต้องไล่หาทุนแทน
-- ด้วย sku_key like 'prefix%' ให้รหัสที่ไม่มีบิลตรงตัว (หลายร้อยครั้งต่อการเปิดหนึ่งครั้ง)
-- ทั้งที่ผลลัพธ์เปลี่ยนแค่ตอนมีบิลใหม่เข้ามา (วันละครั้ง)
--
-- เปลี่ยนเป็น: คิดทีเดียวเก็บลง os_sku_cost ตอนรอบดึงต้นทุน แล้วหน้าเว็บอ่านตารางตรงๆ

create index if not exists os_costs_key_pattern_idx on os_costs (sku_key text_pattern_ops);
create index if not exists os_money_items_sold_idx on os_money_items (platform, statement_at) where matched;

create table if not exists os_sku_cost (
  platform   text not null,
  sku        text not null,
  cost       numeric(12,2) not null,   -- ทุนที่ใช้คิดกำไร (หักส่วนลดนอกบิลแล้ว)
  bill_cost  numeric(12,2),            -- ทุนตามบิลก่อนหักส่วนลดนอกบิล
  bill_date  date,
  supplier   text,
  est        boolean not null default false,  -- ยืมทุนของสี/ไซส์อื่นมา
  off_bill   boolean not null default false,  -- หักส่วนลดนอกบิลแล้ว
  updated_at timestamptz not null default now(),
  primary key (platform, sku)
);
alter table os_sku_cost enable row level security;

-- ── คิดทุนของทุกรหัสที่ขายใน p_days วันล่าสุด แล้วเก็บลงตาราง ──────────
-- ตรรกะเดียวกับ os_costs_for เดิมทุกอย่าง (รหัสเก่า→ใหม่ · ไซส์/สีใกล้เคียง · ส่วนลดนอกบิล SCS)
create or replace function os_costs_resolve(p_days int default 70) returns int
language plpgsql as $$
declare
  n int;
begin
  with aliases (new_prefix, old_prefix) as (
    values ('06253', '06233'),     -- Grand Sport 06-253 เดิมคือ 06-233
           ('06254', '06234'),     -- Grand Sport 06-254 เดิมคือ 06-234
           ('01595', '01495')      -- 01595 เดิมคือ 01495
  ), sold as (
    select distinct platform, sku
      from os_money_items
     where statement_at >= now() - make_interval(days => p_days)
       and matched and sku is not null
  ), keyed as (
    select s.platform, s.sku, lower(s.sku) as k,
           coalesce((select a.old_prefix || substr(lower(s.sku), length(a.new_prefix) + 1)
                       from aliases a where lower(s.sku) like a.new_prefix || '%' limit 1),
                    lower(s.sku)) as k2
      from sold s
  ), exact as (
    select k.platform, k.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, false as estimated
      from keyed k
      join os_costs c on c.sku_key = k.k
  ), codes as (
    select k.platform, k.sku, v.code,
           substring(v.code from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$') as size,
           regexp_replace(v.code, '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$', '') as base
      from keyed k
      cross join lateral (select k.k as code union select k.k2) v
     where not exists (select 1 from exact e where e.sku = k.sku and e.platform = k.platform)
  ), tries as (
    select c.platform, c.sku, c.code, c.size, n, left(c.base, n) as prefix
      from codes c
      cross join lateral generate_series(greatest(5, length(c.base) - 4), length(c.base)) n
     where length(c.base) >= 5
  ), fallback as (
    select distinct on (t.platform, t.sku)
           t.platform, t.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier,
           (c.sku_key <> t.code) as estimated
      from tries t
      join os_costs c on c.sku_key like t.prefix || '%'
     order by t.platform, t.sku,
              (substring(c.sku_key from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$')
                 is not distinct from t.size) desc,
              c.bill_date desc,
              t.n desc
  ), priced as (
    select x.*,
           case
             -- SCS: ลดนอกบิล — ทุน = ราคาป้าย × 70% (ดู 021)
             when x.supplier = 'SCS' and x.list_price > 0 then round(x.list_price * 0.70, 2)
             else x.unit_cost
           end as real_cost
      from (select * from exact union all select * from fallback) x
  )
  insert into os_sku_cost (platform, sku, cost, bill_cost, bill_date, supplier, est, off_bill, updated_at)
  select platform, sku, real_cost, unit_cost, bill_date, supplier, estimated, real_cost <> unit_cost, now()
    from priced
      on conflict (platform, sku) do update
     set cost = excluded.cost, bill_cost = excluded.bill_cost, bill_date = excluded.bill_date,
         supplier = excluded.supplier, est = excluded.est, off_bill = excluded.off_bill,
         updated_at = now();

  get diagnostics n = row_count;
  -- ทิ้งรหัสที่เลิกขายไปนานแล้ว ไม่ให้ตารางบวม
  delete from os_sku_cost
   where updated_at < now() - interval '30 days';
  return n;
end;
$$;

-- ── หน้าเว็บอ่านจากตารางที่คิดไว้แล้ว ───────────────────────────────────
-- ไม่ต้องกรองตามช่วงเวลา เพราะตารางเก็บเฉพาะรหัสที่ขายช่วง 70 วันล่าสุดอยู่แล้ว (ไม่กี่พันแถว)
create or replace function os_costs_for(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null
) returns json language sql stable as $$
  select coalesce(json_object_agg(sku, json_build_object(
           'cost', cost, 'bill', bill_cost, 'date', bill_date,
           'supplier', supplier, 'est', est, 'off', off_bill)), '{}'::json)
    from os_sku_cost
   where p_platform is null or platform = p_platform;
$$;

-- คิดทุนรอบแรกให้เลย
select os_costs_resolve(70) as skus_resolved;

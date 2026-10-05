-- ไม่ให้รหัสที่หาทุนไม่เจอมาอุดคิวคิดทุนทุกรอบ — รันต่อจาก 029
--
-- อาการที่เจอจริง (5 ต.ค. 69): os_sku_cost 619 แถวค้างอยู่ที่ 21 ก.ย. ไม่ขยับเลยสองสัปดาห์
-- ทั้งที่ซิงก์ทุนรันทุกวัน รหัสที่แก้ทุนที่ต้นทางไปแล้วก็ยังโชว์ทุนเก่า (เสื้อวอร์มสีแดง
-- ขึ้นทุน 655 เท่าราคาขาย หน้าเว็บโชว์ขาดทุน -35% ทั้งที่จริงกำไร)
--
-- ต้นเหตุ: os_costs_resolve เลือกผู้สมัครด้วย "ยังไม่เคยคิดทุน (ไม่มีแถวใน os_sku_cost)
-- ขึ้นก่อนเสมอ" แต่รหัสที่หาทุนไม่เจอจริงๆ จะไม่มีแถวใน os_sku_cost ตลอดกาล จึงถูกหยิบ
-- ขึ้นหัวคิวซ้ำทุกรอบไม่รู้จบ และเป็นพวกที่กินเวลามากที่สุดด้วย (ต้องวิ่ง fallback
-- เดารหัสใกล้เคียงจนสุดทางแล้วถึงจะรู้ว่าไม่เจอ) รอบหนึ่งเลยหมดไปกับมันจนโดน statement
-- timeout ตัวที่มีทุนแล้วแต่เก่าเกิน 7 วันไม่เคยถึงคิวสักที
--
-- แก้โดยจำว่า "รหัสนี้ลองแล้วไม่เจอเมื่อไหร่" แล้วเว้นไว้ 7 วันก่อนลองใหม่
-- พอมีบิลใหม่เข้ามาก็ครบกำหนดลองใหม่เอง ไม่ต้องล้างมือ

create table if not exists os_sku_cost_miss (
  platform text not null,
  sku      text not null,
  tried_at timestamptz not null default now(),
  primary key (platform, sku)
);
alter table os_sku_cost_miss enable row level security;

create or replace function os_costs_resolve(p_days int default 70, p_limit int default null) returns int
language plpgsql as $$
declare
  v_rows int;
begin
  -- แยกขั้นเลือกผู้สมัครออกมาก่อน เพราะต้องใช้ซ้ำตอนจดว่ารหัสไหนลองแล้วไม่เจอ
  create temp table tmp_sold on commit drop as
  with candidates as (
    select distinct platform, sku
      from os_money_items
     where statement_at >= now() - make_interval(days => p_days)
       and matched and sku is not null
  )
  -- sku ที่ยังไม่เคยคิดทุนมาก่อนขึ้นก่อนเสมอ ถัดมาคือตัวที่คิดไว้นานที่สุด
  -- ข้ามตัวที่เพิ่งลองแล้วไม่เจอ ไม่งั้นมันจะวนอยู่หัวคิวจนตัวอื่นไม่ได้คิว
  select c.platform, c.sku
    from candidates c
    left join os_sku_cost k on k.platform = c.platform and k.sku = c.sku
    left join os_sku_cost_miss m on m.platform = c.platform and m.sku = c.sku
   where (k.sku is null or k.updated_at < now() - interval '7 days')
     and (m.sku is null or m.tried_at < now() - interval '7 days')
   order by (k.sku is null) desc, k.updated_at asc nulls first
   limit coalesce(p_limit, 2147483647);

  with aliases (new_prefix, old_prefix) as (
    values ('06253', '06233'),     -- Grand Sport 06-253 เดิมคือ 06-233
           ('06254', '06234'),     -- Grand Sport 06-254 เดิมคือ 06-234
           ('01595', '01495')      -- 01595 เดิมคือ 01495
  ), keyed as (
    select s.platform, s.sku, lower(s.sku) as k,
           coalesce((select a.old_prefix || substr(lower(s.sku), length(a.new_prefix) + 1)
                       from aliases a where lower(s.sku) like a.new_prefix || '%' limit 1),
                    lower(s.sku)) as k2
      from tmp_sold s
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
  -- distinct กันรหัสซ้ำ — ถ้าซ้ำ on conflict จะฟ้อง "cannot affect row a second time" แล้วล้มทั้งสคริปต์
  select distinct on (platform, sku)
         platform, sku, real_cost, unit_cost, bill_date, supplier, estimated, real_cost <> unit_cost, now()
    from priced
   order by platform, sku, estimated, bill_date desc
      on conflict (platform, sku) do update
     set cost = excluded.cost, bill_cost = excluded.bill_cost, bill_date = excluded.bill_date,
         supplier = excluded.supplier, est = excluded.est, off_bill = excluded.off_bill,
         updated_at = now();

  get diagnostics v_rows = row_count;

  -- จดรหัสที่ลองรอบนี้แล้วยังไม่มีทุน — รอบหน้าจะได้ข้ามไปก่อน 7 วัน
  insert into os_sku_cost_miss (platform, sku, tried_at)
  select s.platform, s.sku, now()
    from tmp_sold s
   where not exists (select 1 from os_sku_cost k where k.platform = s.platform and k.sku = s.sku)
      on conflict (platform, sku) do update set tried_at = now();

  -- รหัสที่คิดทุนได้แล้ว ไม่ต้องจำว่าเคยพลาด
  delete from os_sku_cost_miss m
   using os_sku_cost k
   where m.platform = k.platform and m.sku = k.sku;

  -- ทิ้งรหัสที่เลิกขายไปนานแล้ว ไม่ให้ตารางบวม
  delete from os_sku_cost where updated_at < now() - interval '30 days';
  delete from os_sku_cost_miss where tried_at < now() - interval '30 days';
  return v_rows;
end;
$$;

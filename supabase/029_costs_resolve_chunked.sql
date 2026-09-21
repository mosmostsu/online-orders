-- แก้ os_costs_resolve ให้ทำทีละก้อนได้ — รันต่อจาก 028
--
-- เดิม os_costs_resolve(70) คิดทุนของ "ทุก sku ที่ขายใน 70 วัน" รวดเดียวไม่มีขีดจำกัด
-- ตอน os_money_items มีแต่ TikTok ก็ไหว แต่พอ Shopee ดึงย้อนหลังเข้ามาเพิ่มอีกหลายร้อย sku
-- (ส่วนใหญ่ไม่มีรหัสตรงกับ os_costs ตรงๆ ต้องไปวิ่ง fallback แบบเดารหัสใกล้เคียง ซึ่งกิน
-- เวลาต่อ sku มากกว่า exact match เยอะ) ทำให้รอบเดียวไม่จบใน budget ของ Netlify แล้วโดน
-- เตะกลางทาง (502 — เชื่อมต่อขาดเลย ไม่ใช่ error ที่โค้ดจับได้)
--
-- เพิ่ม p_limit ให้ทำทีละก้อน โดยเลือก sku ที่ยังไม่เคยคิดทุน (หรือคิดมานานเกิน 7 วัน) มาก่อน
-- เรียกซ้ำได้เรื่อยๆ จนกว่าจะครบ (route ฝั่ง JS เป็นคนวนเรียกภายใน time budget ของตัวเอง)

create or replace function os_costs_resolve(p_days int default 70, p_limit int default null) returns int
language plpgsql as $$
declare
  v_rows int;
begin
  with aliases (new_prefix, old_prefix) as (
    values ('06253', '06233'),     -- Grand Sport 06-253 เดิมคือ 06-233
           ('06254', '06234'),     -- Grand Sport 06-254 เดิมคือ 06-234
           ('01595', '01495')      -- 01595 เดิมคือ 01495
  ), candidates as (
    select distinct platform, sku
      from os_money_items
     where statement_at >= now() - make_interval(days => p_days)
       and matched and sku is not null
  ), sold as (
    -- sku ที่ยังไม่เคยคิดทุนมาก่อนขึ้นก่อนเสมอ ถัดมาคือตัวที่คิดไว้นานที่สุด — จำกัดจำนวนต่อรอบ
    -- ด้วย p_limit กันคิวรีนี้กินเวลาจนโดน Netlify เตะกลางทาง (ดูคอมเมนต์บนสุดของไฟล์)
    select c.platform, c.sku
      from candidates c
      left join os_sku_cost k on k.platform = c.platform and k.sku = c.sku
     where k.sku is null or k.updated_at < now() - interval '7 days'
     order by (k.sku is null) desc, k.updated_at asc nulls first
     limit coalesce(p_limit, 2147483647)
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
  -- ทิ้งรหัสที่เลิกขายไปนานแล้ว ไม่ให้ตารางบวม
  delete from os_sku_cost
   where updated_at < now() - interval '30 days';
  return v_rows;
end;
$$;

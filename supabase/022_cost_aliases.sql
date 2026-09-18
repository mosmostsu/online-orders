-- ทุนที่ใช้คิดกำไร (ทับ os_costs_for ของ 021) — รันต่อจาก 021
--
-- เพิ่มคู่รหัสเก่า→ใหม่ 01495 → 01595 และปรับวิธีเลือกทุนแทนเมื่อรหัสใหม่มีบิลบางส่วนแล้ว
--
-- ลำดับการหาทุนของรหัสที่ขาย:
--   1) บิลของรหัสนั้นตรงตัว → ใช้เลย
--   2) หาไม่เจอ → ไล่หาในรุ่นเดียวกัน ทั้งจากรหัสปัจจุบันและรหัสเดิม (ถ้าเคยเปลี่ยนรหัส)
--      เลือก ไซส์เดียวกันก่อน → บิลล่าสุด → รหัสใกล้เคียงที่สุด
--
-- ทำไมบิลล่าสุดมาก่อนรหัสเดิมตรงตัว: 01595 มีบิลของตัวเองแล้ว (S-XL ทุน 113.43 บิล 27 ส.ค.)
-- ส่วนรหัสเดิม 01495 ทุน 107.73 (บิล 3 ส.ค.) — ทุนขึ้นแล้ว ร้านเลือกคิดแบบ "ทุนล่าสุด"
-- ถ้าเอารหัสเดิมตรงตัวมาก่อน สีที่ยังไม่มีบิลใหม่จะได้ทุนเก่าที่ถูกกว่าจริง
-- รุ่นที่รหัสใหม่ยังไม่มีบิลเลย (06-253/254) ก็ยังได้ทุนจากรหัสเดิมเหมือนเดิม
--
-- ใช้ทุนจากรหัสเดิมตรงตัว (สี+ไซส์เดียวกัน) นับเป็นทุนจริง · นอกนั้นติดป้ายประมาณ (*)

create or replace function os_costs_for(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null
) returns json language sql stable as $$
  with aliases (new_prefix, old_prefix) as (
    values ('06253', '06233'),     -- Grand Sport 06-253 เดิมคือ 06-233
           ('06254', '06234'),     -- Grand Sport 06-254 เดิมคือ 06-234
           ('01595', '01495')      -- 01595 เดิมคือ 01495
  ), sold as (
    select distinct sku
      from os_money_items
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and matched and sku is not null
  ), keyed as (
    -- k = รหัสตามที่ขาย · k2 = รหัสเดิมก่อนเปลี่ยน (ถ้าไม่ได้เปลี่ยนก็ตัวเดียวกัน)
    select s.sku, lower(s.sku) as k,
           coalesce((select a.old_prefix || substr(lower(s.sku), length(a.new_prefix) + 1)
                       from aliases a where lower(s.sku) like a.new_prefix || '%' limit 1),
                    lower(s.sku)) as k2
      from sold s
  ), exact as (
    select k.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, false as estimated
      from keyed k
      join os_costs c on c.sku_key = k.k
  ), codes as (
    -- ฐานที่ใช้ไล่หา: รหัสปัจจุบัน และรหัสเดิม (ถ้ามี) — แยกไซส์ท้ายรหัสออก
    select k.sku, v.code,
           substring(v.code from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$') as size,
           regexp_replace(v.code, '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$', '') as base
      from keyed k
      cross join lateral (select k.k as code union select k.k2) v
     where not exists (select 1 from exact e where e.sku = k.sku)
  ), tries as (
    -- ตัดรหัสสั้นลงทีละตัว ตั้งแต่ครบ (ต่างแค่ไซส์) ไปจนถึงระดับรุ่น (อย่างน้อย 5 ตัวอักษร)
    select c.sku, c.code, c.size, n, left(c.base, n) as prefix
      from codes c
      cross join lateral generate_series(greatest(5, length(c.base) - 4), length(c.base)) n
     where length(c.base) >= 5
  ), fallback as (
    select distinct on (t.sku)
           t.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier,
           (c.sku_key <> t.code) as estimated                       -- รหัสเดิมตรงตัว = ทุนจริง
      from tries t
      join os_costs c on c.sku_key like t.prefix || '%'
     order by t.sku,
              (substring(c.sku_key from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$')
                 is not distinct from t.size) desc,                  -- ไซส์เดียวกันก่อน
              c.bill_date desc,                                      -- แล้วบิลล่าสุด
              t.n desc                                               -- แล้วรหัสใกล้เคียงที่สุด
  ), priced as (
    select x.*,
           case
             -- SCS: ลดนอกบิล — ทุน = ราคาป้าย × 70% (ดู 021)
             when x.supplier = 'SCS' and x.list_price > 0 then round(x.list_price * 0.70, 2)
             else x.unit_cost
           end as real_cost
      from (select * from exact union all select * from fallback) x
  )
  select coalesce(json_object_agg(sku, json_build_object(
           'cost', real_cost,
           'bill', unit_cost,
           'date', bill_date,
           'supplier', supplier,
           'est', estimated,
           'off', real_cost <> unit_cost)), '{}'::json)
    from priced;
$$;

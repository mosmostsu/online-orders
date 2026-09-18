-- ทุนที่ใช้คิดกำไร (ทับ os_costs_for ของ 020) — รันต่อจาก 020
--
-- 1) ส่วนลดนอกบิล SCS (รองเท้านักเรียน)
--    SCS ลดในบิล 20% แล้วมาลดเพิ่มนอกบิลทีหลัง (+7+1+3+2+1+1+1) ทุนตามบิลจึงสูงกว่าจริง
--    ตกลงกับร้านให้ตายตัว: ทุน SCS = ราคาป้ายในบิล × 70% (ลดรวม ~30%)
--    (คิดต่อทอดจริงได้ลดรวม 32.1% — ใช้ 30% ให้เผื่อไว้) บิลที่ไม่มีราคาป้ายใช้ทุนตามบิลไปก่อน
--    มีเจ้าอื่นลดนอกบิลแบบนี้ เพิ่มบรรทัดใน case ของ priced
--
-- 2) หาทุนแทนเมื่อไม่มีบิลของรหัสนั้นตรงๆ — ฉลาดขึ้นกว่า 020
--    020 ตัดไซส์ท้ายรหัสทิ้งแล้วหารหัสที่ขึ้นต้นเหมือนกัน ใช้ไม่ได้กับสีที่ไม่เคยรับเข้า
--    เช่น Grand Sport 062532000M (สีที่ไม่มีบิล) บิลมีแต่ 062531000M / 062530100L
--    หรือ c2f725WL (ขาว) บิลมีแต่ c2f725BL / c2f725NBL — รุ่นเดียวกันทุนเท่ากันทุกสี
--    จึงไล่ตัดรหัสสั้นลงทีละตัว (ไม่ต่ำกว่า 5 ตัวอักษร = ระดับรุ่น) ใช้ตัวแรกที่เจอ
--    ในนั้นเลือกไซส์เดียวกันก่อน (ไซส์ใหญ่ทุนแพงกว่า เช่น 5XL 244 vs M 171) แล้วค่อยบิลล่าสุด
--
-- 3) รหัสที่ร้านเปลี่ยนใหม่ — บิลเก่ายังเป็นรหัสเดิม
--    Grand Sport 06-253 / 06-254 คือรหัสใหม่ของ 06-233 / 06-234 (ของเดียวกัน)
--    หารหัสใหม่ไม่เจอ ลองรหัสเดิมก่อน นับเป็นทุนจริง ไม่ใช่ประมาณ
--    เปลี่ยนรหัสรุ่นอื่นอีก เพิ่มบรรทัดใน aliases

create or replace function os_costs_for(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null
) returns json language sql stable as $$
  with aliases (new_prefix, old_prefix) as (
    values ('06253', '06233'),     -- Grand Sport 06-253 เดิมคือ 06-233
           ('06254', '06234')      -- Grand Sport 06-254 เดิมคือ 06-234
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
    select distinct on (k.sku)
           k.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, false as estimated
      from keyed k
      join os_costs c on c.sku_key in (k.k, k.k2)
     order by k.sku, (c.sku_key = k.k) desc, c.bill_date desc     -- รหัสปัจจุบันก่อน แล้วค่อยรหัสเดิม
  ), missing as (
    -- แยก "ไซส์" ท้ายรหัสออก: 2XL 3XL XL XS SS S M L หรือตัวเลขไซส์เด็ก/รองเท้า
    -- ใช้รหัสเดิม (k2) เป็นฐาน เพราะบิลของรุ่นที่เปลี่ยนรหัสอยู่ใต้รหัสเดิม
    select k.sku,
           substring(k.k2 from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$') as size,
           regexp_replace(k.k2, '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$', '') as base
      from keyed k
     where not exists (select 1 from exact e where e.sku = k.sku)
  ), tries as (
    -- ตัดรหัสสั้นลงทีละตัว ตั้งแต่ครบ (ต่างแค่ไซส์) ไปจนถึงระดับรุ่น
    select m.sku, m.size, n, left(m.base, n) as prefix
      from missing m
      cross join lateral generate_series(greatest(5, length(m.base) - 4), length(m.base)) n
     where length(m.base) >= 5
  ), sibling as (
    select distinct on (t.sku)
           t.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, true as estimated
      from tries t
      join os_costs c on c.sku_key like t.prefix || '%'
     order by t.sku,
              t.n desc,                                                            -- รหัสใกล้เคียงที่สุดก่อน
              (substring(c.sku_key from '([0-9]?x{1,3}l|xs|ss|s|m|l|[0-9]{1,2})$')
                 is not distinct from t.size) desc,                                -- ไซส์เดียวกันก่อน
              c.bill_date desc                                                     -- แล้วบิลล่าสุด
  ), priced as (
    select x.*,
           case
             -- SCS: ลดนอกบิล — ทุน = ราคาป้าย × 70%
             when x.supplier = 'SCS' and x.list_price > 0 then round(x.list_price * 0.70, 2)
             else x.unit_cost
           end as real_cost
      from (select * from exact union all select * from sibling) x
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

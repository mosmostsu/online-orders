-- ส่วนลดนอกบิล SCS (รองเท้านักเรียน) — รันต่อจาก 020
--
-- SCS ลดในบิล 20% แล้วมาลดเพิ่มนอกบิลทีหลัง (+7+1+3+2+1+1+1) ทุนตามบิลจึงสูงกว่าจริง
-- รองเท้านักเรียนเลยดูขาดทุนทั้งที่ไม่ใช่
--
-- ตกลงกับร้านให้ตายตัว: ทุน SCS = ราคาป้ายในบิล × 70% (ลดรวม ~30%)
-- (ถ้าคิดต่อทอดจริง 20% แล้ว +7+1+3+2+1+1+1 จะได้ลดรวม 32.1% — ใกล้เคียง ใช้ 30% ให้เผื่อไว้)
-- บิลที่ไม่มีราคาป้าย ใช้ทุนตามบิลไปก่อน
--
-- ถ้ามีเจ้าอื่นลดนอกบิลแบบนี้ เพิ่มบรรทัดใน case ข้างล่าง

-- ── ทุนของรหัสที่ขายในช่วงเวลา (ทับของ 020) ─────────────────────────────
create or replace function os_costs_for(
  p_from     timestamptz,
  p_to       timestamptz,
  p_platform text default null
) returns json language sql stable as $$
  with sold as (
    select distinct sku
      from os_money_items
     where statement_at >= p_from and statement_at < p_to
       and (p_platform is null or platform = p_platform)
       and matched and sku is not null
  ), exact as (
    select s.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, false as estimated
      from sold s
      join os_costs c on c.sku_key = lower(s.sku)
  ), missing as (
    select s.sku,
           lower(regexp_replace(s.sku, '([0-9]?X{1,3}L|XS|SS|S|M|L|[0-9]{1,2})$', '', 'i')) as prefix
      from sold s
     where not exists (select 1 from exact e where e.sku = s.sku)
  ), sibling as (
    select distinct on (m.sku)
           m.sku, c.unit_cost, c.list_price, c.bill_date, c.supplier, true as estimated
      from missing m
      join os_costs c on c.sku_key like m.prefix || '%'
     where length(m.prefix) >= 4
     order by m.sku, c.bill_date desc
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

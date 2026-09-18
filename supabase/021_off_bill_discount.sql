-- ส่วนลดนอกบิลต่อซัพพลายเออร์ — รันต่อจาก 020
--
-- บางเจ้าลดในบิลส่วนหนึ่ง แล้วมาลดเพิ่มทีหลังนอกบิล เช่น SCS (รองเท้านักเรียน)
-- ในบิลลด 20% แล้วลดนอกบิลต่ออีก +7+1+3+2+1+1+1 — ทุนตามบิลจึงสูงกว่าทุนจริง
-- กำไรของรองเท้านักเรียนเลยดูติดลบทั้งที่จริงไม่ใช่
--
-- กฎเก็บเป็นตาราง แก้ได้โดยไม่ต้องดึงบิลใหม่ — ทุนที่หน้าเว็บคิดสดตอนเปิดหน้า

create table if not exists os_cost_rules (
  supplier    text primary key,           -- รหัสซัพพลายเออร์ตามบิล Seniorsoft เช่น SCS
  extra       text not null,              -- ส่วนลดนอกบิลต่อทอด เช่น 7+1+3+2+1+1+1
  note        text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table os_cost_rules enable row level security;

insert into os_cost_rules (supplier, extra, note)
values ('SCS', '7+1+3+2+1+1+1', 'รองเท้านักเรียน ลดนอกบิลต่อทอดหลังส่วนลดในบิล 20%')
on conflict (supplier) do nothing;

-- "7+1+3" → เหลือกี่ส่วน เมื่อลดต่อทอดทีละขั้น (0.93 × 0.99 × 0.97)
-- ลดต่อทอด = ขั้นหลังลดจากยอดที่เหลือหลังขั้นก่อน ไม่ใช่เอาเปอร์เซ็นต์มาบวกกัน
create or replace function os_discount_factor(p_chain text) returns numeric
language sql immutable as $$
  select coalesce(exp(sum(ln(1 - trim(x)::numeric / 100))), 1)
    from unnest(string_to_array(replace(replace(coalesce(p_chain, ''), '/', ''), '%', ''), '+')) x
   where trim(x) ~ '^[0-9]+(\.[0-9]+)?$';
$$;

-- ── ทุนของรหัสที่ขายในช่วงเวลา (ทับของ 020) — หักส่วนลดนอกบิลแล้ว ─────────
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
  ), rules as (
    select supplier, os_discount_factor(extra) as factor from os_cost_rules where active
  ), exact as (
    select s.sku, c.unit_cost, c.bill_date, c.supplier, false as estimated
      from sold s
      join os_costs c on c.sku_key = lower(s.sku)
  ), missing as (
    select s.sku,
           lower(regexp_replace(s.sku, '([0-9]?X{1,3}L|XS|SS|S|M|L|[0-9]{1,2})$', '', 'i')) as prefix
      from sold s
     where not exists (select 1 from exact e where e.sku = s.sku)
  ), sibling as (
    select distinct on (m.sku)
           m.sku, c.unit_cost, c.bill_date, c.supplier, true as estimated
      from missing m
      join os_costs c on c.sku_key like m.prefix || '%'
     where length(m.prefix) >= 4
     order by m.sku, c.bill_date desc
  ), priced as (
    select x.*, r.factor
      from (select * from exact union all select * from sibling) x
      left join rules r on r.supplier = x.supplier
  )
  select coalesce(json_object_agg(sku, json_build_object(
           'cost', round(unit_cost * coalesce(factor, 1), 2),
           'bill', unit_cost,
           'date', bill_date,
           'supplier', supplier,
           'est', estimated,
           'off', factor is not null)), '{}'::json)
    from priced;
$$;

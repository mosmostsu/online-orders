-- ต้นทุนล่าสุดต่อรหัสสินค้า จากบิลรับของใน Seniorsoft — รันต่อจาก 019
--
-- ที่มา: https://samchaiinvoice.netlify.app/ss/seniorsoft-YYYY-MM.js (ปี พ.ศ.)
-- ไฟล์รายเดือน หนึ่งบรรทัด = สินค้าหนึ่งรายการในบิลรับของ (IRVC/IRNC) มี scancode จำนวน ราคา ส่วนลด
-- ทุนต่อชิ้น = amount / qty (amount หักส่วนลดแล้ว และเป็นยอดตามบิล รวม VAT ถ้าบิลนั้นมี VAT)
--
-- scancode ตรงกับรหัสสินค้าบน TikTok (seller_sku) 94% ของรหัส = 98% ของชิ้นที่ขาย (ตรวจ ก.ย. 2569)
-- ที่ไม่ตรงส่วนใหญ่เป็นไซส์ที่ยังไม่เคยรับเข้าด้วยรหัสนั้น → ใช้ทุนของไซส์อื่นในรุ่นเดียวกันแทน (ติดป้ายว่าประมาณ)

create table if not exists os_costs (
  sku_key     text primary key,     -- รหัสตัวพิมพ์เล็ก ไว้จับคู่แบบไม่สนตัวพิมพ์
  sku         text not null,        -- รหัสตามบิล
  item_name   text,
  unit_cost   numeric(12,2) not null,
  list_price  numeric(12,2),        -- ราคาก่อนลดในบิล
  discount    text,                 -- ส่วนลดตามบิล เช่น 40/+2/
  bill_date   date not null,
  supplier    text,
  tranno      text,
  synced_at   timestamptz not null default now()
);

create index if not exists os_costs_date_idx on os_costs (bill_date desc);
alter table os_costs enable row level security;

-- ── ทุนของรหัสที่ขายในช่วงเวลา ─────────────────────────────────────────
-- ใช้ตอนเปิดหน้ารายสินค้า คืนเฉพาะรหัสที่ขายจริงในช่วงนั้น (ไม่กี่ร้อย) ไม่ต้องลากทั้งตาราง
-- หาไม่เจอแบบตรงตัว → ตัดไซส์ท้ายรหัสทิ้ง แล้วเอาทุนล่าสุดของรหัสที่ขึ้นต้นเหมือนกัน (ไซส์อื่นรุ่นเดียวกัน)
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
    select s.sku, c.unit_cost, c.bill_date, c.supplier, false as estimated
      from sold s
      join os_costs c on c.sku_key = lower(s.sku)
  ), missing as (
    select s.sku,
           -- ไซส์ท้ายรหัส: 2XL 3XL XL XS SS S M L หรือตัวเลขไซส์เด็ก/รองเท้า
           lower(regexp_replace(s.sku, '([0-9]?X{1,3}L|XS|SS|S|M|L|[0-9]{1,2})$', '', 'i')) as prefix
      from sold s
     where not exists (select 1 from exact e where e.sku = s.sku)
  ), sibling as (
    select distinct on (m.sku)
           m.sku, c.unit_cost, c.bill_date, c.supplier, true as estimated
      from missing m
      join os_costs c on c.sku_key like m.prefix || '%'
     where length(m.prefix) >= 4           -- กันตัดจนเหลือสั้นแล้วไปจับรุ่นอื่น
     order by m.sku, c.bill_date desc
  )
  select coalesce(json_object_agg(sku, json_build_object(
           'cost', unit_cost, 'date', bill_date, 'supplier', supplier, 'est', estimated)), '{}'::json)
    from (select * from exact union all select * from sibling) x;
$$;

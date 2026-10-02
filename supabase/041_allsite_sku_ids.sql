-- ติ๊ก "เลือกทั้งหมดที่กรองไว้" ในตาราง ALL SITE เร็วขึ้น — รันต่อจาก 040
--
-- เดิมปุ่มนี้เรียก os_allsite_skus หน้าละ 5,000 แถว ซึ่งคิด Y/N ทุกร้านของทุกแถวและสร้าง JSON ก้อนใหญ่
-- ทั้งที่ต้องการแค่รายการรหัส — ตัวนี้กรองแบบเดียวกันแต่คืนแค่รหัส
-- เงื่อนไขกรองต้องตรงกับ os_allsite_skus (040) — แก้ที่หนึ่งต้องแก้อีกที่ด้วย

create or replace function os_allsite_sku_ids(
  p_shops jsonb, p_stock text default 'all', p_filter jsonb default '{}'::jsonb,
  p_name text default '', p_sku text default '', p_brand text default '', p_cat text default '',
  p_limit int default 5000
) returns json language sql stable as $$
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), fs as (
    select sel.platform, sel.shop, (c.value = 'Y') as want
      from jsonb_each_text(coalesce(p_filter, '{}'::jsonb)) c
      join sel on sel.i = c.key::int
     where c.value in ('Y', 'N')
  ), base as (
    select s.sku
      from os_st s
     where (p_stock <> 'in' or coalesce(s.qty, 0) > 0)
       and (coalesce(p_name, '') = '' or s.name ilike '%' || p_name || '%')
       and (coalesce(p_sku, '') = '' or s.sku ilike '%' || p_sku || '%')
       and (coalesce(p_brand, '') = '' or s.brand ilike '%' || p_brand || '%')
       and (coalesce(p_cat, '') = '' or s.cat ilike '%' || p_cat || '%')
       and not exists (
             select 1 from fs
              where fs.want <> exists (select 1 from os_st_on o
                                        where o.lsku = lower(trim(s.sku)) and o.platform = fs.platform and o.shop = fs.shop))
  )
  select json_build_object(
    'total', (select count(*) from base),
    'skus', (select coalesce(json_agg(sku), '[]'::json) from (select sku from base order by sku limit p_limit) x)
  );
$$;

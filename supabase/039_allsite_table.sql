-- หน้า /allsite ตารางแบบ ALL SITE PRODUCT (../allsitepd) — รันต่อจาก 038
--
-- กรองแยกช่อง ชื่อ / SKU / แบรนด์ / หมวดหมู่ + เรียงได้ทุกคอลัมน์
-- ราคาใช้จาก ST (cf_price) — ไม่ดึงไฟล์ DC (ราคา 0/1 แบบ allsitepd) ตามที่ตกลงกัน

create index if not exists os_st_brand_idx on os_st (brand);

-- ตัวเก่า (038) พารามิเตอร์ไม่เหมือนกัน — ลบก่อน ไม่งั้น PostgREST เจอชื่อซ้ำสองตัว (PGRST203)
drop function if exists os_allsite_skus(jsonb, text, jsonb, text, text, text, text, int, int);

create or replace function os_allsite_skus(
  p_shops jsonb, p_stock text default 'all', p_filter jsonb default '{}'::jsonb,
  p_name text default '', p_sku text default '', p_brand text default '', p_cat text default '',
  p_sort text default '', p_dir text default 'asc', p_page int default 1, p_size int default 50
) returns json language sql stable as $$
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), base as (
    select s.* from os_st s
     where (p_stock <> 'in' or coalesce(s.qty, 0) > 0)
       and (coalesce(p_name, '') = '' or s.name ilike '%' || p_name || '%')
       and (coalesce(p_sku, '') = '' or s.sku ilike '%' || p_sku || '%')
       and (coalesce(p_brand, '') = '' or s.brand ilike '%' || p_brand || '%')
       and (coalesce(p_cat, '') = '' or s.cat ilike '%' || p_cat || '%')
  ), fl as (
    select b.sku, b.name, b.brand, b.cat, coalesce(b.qty, 0) as qty, b.price,
           array_agg((o.lsku is not null) order by sel.i) as flags
      from base b cross join sel
      left join os_st_on o on o.lsku = lower(trim(b.sku)) and o.platform = sel.platform and o.shop = sel.shop
     group by b.sku, b.name, b.brand, b.cat, b.qty, b.price
  ), f as (
    -- กรองร้าน: Y = ลงแล้ว · N = ยังไม่ลง (ที่ allsitepd เรียก N/A)
    select * from fl
     where not exists (select 1 from jsonb_each_text(coalesce(p_filter, '{}'::jsonb)) c
                        where c.value in ('Y', 'N') and fl.flags[c.key::int] is distinct from (c.value = 'Y'))
  ), r as (
    -- ไม่เลือกเรียง = เรียงตามแบรนด์ หมวด SKU แบบ allsitepd
    select f.*, row_number() over (order by
             case when p_sort = 'brand' and p_dir = 'asc'  then f.brand end asc nulls last,
             case when p_sort = 'brand' and p_dir <> 'asc' then f.brand end desc nulls last,
             case when p_sort = 'cat'   and p_dir = 'asc'  then f.cat end asc nulls last,
             case when p_sort = 'cat'   and p_dir <> 'asc' then f.cat end desc nulls last,
             case when p_sort = 'sku'   and p_dir = 'asc'  then f.sku end asc,
             case when p_sort = 'sku'   and p_dir <> 'asc' then f.sku end desc,
             case when p_sort = 'name'  and p_dir = 'asc'  then f.name end asc nulls last,
             case when p_sort = 'name'  and p_dir <> 'asc' then f.name end desc nulls last,
             case when p_sort = 'qty'   and p_dir = 'asc'  then f.qty end asc,
             case when p_sort = 'qty'   and p_dir <> 'asc' then f.qty end desc,
             case when p_sort = 'price' and p_dir = 'asc'  then f.price end asc nulls last,
             case when p_sort = 'price' and p_dir <> 'asc' then f.price end desc nulls last,
             f.brand nulls last, f.cat nulls last, f.sku) as rn
      from f
  )
  select json_build_object(
    'total', (select count(*) from f),
    'all_total', (select count(*) from os_st),
    'yes', (select coalesce(json_agg(n order by i), '[]'::json) from (
              select sel.i, count(*) filter (where f.flags[sel.i]) as n from sel cross join f group by sel.i) y),
    -- ตัวเลือกใน dropdown หัวคอลัมน์
    'brands', (select coalesce(json_agg(brand order by brand), '[]'::json)
                 from (select distinct brand from os_st where brand is not null) x),
    'cats', (select coalesce(json_agg(cat order by cat), '[]'::json)
               from (select distinct cat from os_st where cat is not null) x),
    'rows', coalesce((
      select json_agg(json_build_object(
               'sku', r.sku, 'name', r.name, 'brand', r.brand, 'cat', r.cat, 'qty', r.qty,
               'price', r.price, 'on', r.flags)
             order by r.rn)
        from r where r.rn > (greatest(p_page, 1) - 1) * p_size and r.rn <= greatest(p_page, 1) * p_size), '[]'::json),
    'st', (select json_build_object('file_modified', file_modified, 'row_count', row_count, 'synced_at', synced_at,
                                    'on_refreshed_at', on_refreshed_at)
             from os_st_meta where id = 1),
    'shop_list', os_listing_shops()
  );
$$;

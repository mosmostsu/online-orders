-- ตาราง ALL SITE เร็วขึ้น — รันต่อจาก 039 (พารามิเตอร์เหมือนเดิม แทนที่ตัวเดิมได้เลย)
--
-- 039 คิด Y/N ของทุก SKU (~43,000) × ทุกร้าน แล้วค่อยตัดเหลือหน้าละ 50 แถว — ไม่กรองอะไรใช้ 2-2.5 วินาที
-- ตอนนี้: กรอง/เรียง/ตัดหน้าจากคอลัมน์ของ ST ก่อน แล้วค่อยคิด Y/N เฉพาะแถวที่โชว์
-- กรองร้าน Y/N ใช้ exists ต่อแถวผ่าน primary key ของ os_st_on (lsku, platform, shop) แทนการรวมทั้งก้อน
-- ตัด 'yes' (นับลงแล้วต่อร้าน) ออก — หน้าเว็บไม่ได้ใช้แล้ว

create or replace function os_allsite_skus(
  p_shops jsonb, p_stock text default 'all', p_filter jsonb default '{}'::jsonb,
  p_name text default '', p_sku text default '', p_brand text default '', p_cat text default '',
  p_sort text default '', p_dir text default 'asc', p_page int default 1, p_size int default 50
) returns json language sql stable as $$
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), fs as (
    -- เงื่อนไขกรองร้าน: want = true ต้องลงแล้ว (Y) · false ต้องยังไม่ลง (N/A)
    select sel.platform, sel.shop, (c.value = 'Y') as want
      from jsonb_each_text(coalesce(p_filter, '{}'::jsonb)) c
      join sel on sel.i = c.key::int
     where c.value in ('Y', 'N')
  ), base as (
    select s.sku, s.name, s.brand, s.cat, coalesce(s.qty, 0) as qty, s.price
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
  ), r as (
    -- ไม่เลือกเรียง = เรียงตามแบรนด์ หมวด SKU แบบ allsitepd
    select b.*, row_number() over (order by
             case when p_sort = 'brand' and p_dir = 'asc'  then b.brand end asc nulls last,
             case when p_sort = 'brand' and p_dir <> 'asc' then b.brand end desc nulls last,
             case when p_sort = 'cat'   and p_dir = 'asc'  then b.cat end asc nulls last,
             case when p_sort = 'cat'   and p_dir <> 'asc' then b.cat end desc nulls last,
             case when p_sort = 'sku'   and p_dir = 'asc'  then b.sku end asc,
             case when p_sort = 'sku'   and p_dir <> 'asc' then b.sku end desc,
             case when p_sort = 'name'  and p_dir = 'asc'  then b.name end asc nulls last,
             case when p_sort = 'name'  and p_dir <> 'asc' then b.name end desc nulls last,
             case when p_sort = 'qty'   and p_dir = 'asc'  then b.qty end asc,
             case when p_sort = 'qty'   and p_dir <> 'asc' then b.qty end desc,
             case when p_sort = 'price' and p_dir = 'asc'  then b.price end asc nulls last,
             case when p_sort = 'price' and p_dir <> 'asc' then b.price end desc nulls last,
             b.brand nulls last, b.cat nulls last, b.sku) as rn
      from base b
  ), pg as (
    select * from r where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size
  )
  select json_build_object(
    'total', (select count(*) from base),
    'all_total', (select count(*) from os_st),
    'brands', (select coalesce(json_agg(brand order by brand), '[]'::json)
                 from (select distinct brand from os_st where brand is not null) x),
    'cats', (select coalesce(json_agg(cat order by cat), '[]'::json)
               from (select distinct cat from os_st where cat is not null) x),
    'rows', coalesce((
      select json_agg(json_build_object(
               'sku', pg.sku, 'name', pg.name, 'brand', pg.brand, 'cat', pg.cat, 'qty', pg.qty, 'price', pg.price,
               -- Y/N เฉพาะแถวที่โชว์
               'on', (select array_agg(exists (select 1 from os_st_on o
                                                where o.lsku = lower(trim(pg.sku)) and o.platform = sel.platform and o.shop = sel.shop)
                                       order by sel.i) from sel))
             order by pg.rn)
        from pg), '[]'::json),
    'st', (select json_build_object('file_modified', file_modified, 'row_count', row_count, 'synced_at', synced_at,
                                    'on_refreshed_at', on_refreshed_at)
             from os_st_meta where id = 1),
    'shop_list', os_listing_shops()
  );
$$;

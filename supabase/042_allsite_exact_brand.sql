-- กรองแบรนด์/หมวดในตาราง ALL SITE ให้ตรงเป๊ะ — รันต่อจาก 041
--
-- เดิมกรองแบบ "มีคำนี้อยู่ในชื่อ" เลือกแบรนด์ Pan แล้วได้ Spandex มาด้วย (s-PAN-dex)
-- ตอนนี้ถ้ามีแบรนด์/หมวดชื่อตรงเป๊ะ (ไม่สนตัวพิมพ์) ใช้อันนั้นอย่างเดียว ไม่มีค่อยค้นแบบมีคำ
-- (พิมพ์ "adi" ยังเจอ Adidas) — แก้ทั้งตาราง (os_allsite_skus) และปุ่มเลือกทั้งหมด (os_allsite_sku_ids)
-- ส่วนอื่นเหมือน 040 / 041 ทุกอย่าง

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
       -- แบรนด์/หมวด: ตรงเป๊ะ (ไม่สนตัวพิมพ์) ก่อน — ไม่มีชื่อไหนตรงเป๊ะค่อยค้นแบบมีคำอยู่ในชื่อ
       -- เดิมค้นแบบมีคำอย่างเดียว เลือก Pan แล้วได้ Spandex มาด้วย
       and (coalesce(p_brand, '') = '' or lower(s.brand) = lower(p_brand)
            or (not exists (select 1 from os_st x where lower(x.brand) = lower(p_brand))
                and s.brand ilike '%' || p_brand || '%'))
       and (coalesce(p_cat, '') = '' or lower(s.cat) = lower(p_cat)
            or (not exists (select 1 from os_st x where lower(x.cat) = lower(p_cat))
                and s.cat ilike '%' || p_cat || '%'))
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
       -- แบรนด์/หมวด: ตรงเป๊ะ (ไม่สนตัวพิมพ์) ก่อน — ไม่มีชื่อไหนตรงเป๊ะค่อยค้นแบบมีคำอยู่ในชื่อ
       -- เดิมค้นแบบมีคำอย่างเดียว เลือก Pan แล้วได้ Spandex มาด้วย
       and (coalesce(p_brand, '') = '' or lower(s.brand) = lower(p_brand)
            or (not exists (select 1 from os_st x where lower(x.brand) = lower(p_brand))
                and s.brand ilike '%' || p_brand || '%'))
       and (coalesce(p_cat, '') = '' or lower(s.cat) = lower(p_cat)
            or (not exists (select 1 from os_st x where lower(x.cat) = lower(p_cat))
                and s.cat ilike '%' || p_cat || '%'))
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

-- หน้า /allsite โหมด "ราย SKU" — ตารางยาวทีละรหัสแบบ ../allsitepd — รันต่อจาก 037
--
-- แถวละ SKU จาก ST: ชื่อ ยี่ห้อ หมวด คงเหลือ ราคา + ลงแต่ละร้านแล้วหรือยัง (Y/N)
-- กรองแต่ละร้านเป็น Y หรือ N ได้ เช่น {"3":"N"} = ร้านลำดับที่ 3 ใน p_shops ต้องยังไม่ลง
-- ใช้ os_st_on (036) ที่เตรียมไว้ล่วงหน้าเหมือนโหมดรุ่น

create or replace function os_allsite_skus(
  p_shops jsonb, p_stock text default 'in', p_filter jsonb default '{}'::jsonb,
  p_brand text default '', p_q text default '', p_sort text default 'qty', p_dir text default 'desc',
  p_page int default 1, p_size int default 100
) returns json language sql stable as $$
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), base as (
    select s.* from os_st s
     where (p_stock <> 'in' or coalesce(s.qty, 0) > 0)
       and (coalesce(p_brand, '') = '' or s.brand = p_brand)
       and (coalesce(p_q, '') = '' or s.sku ilike '%' || p_q || '%' or s.name ilike '%' || p_q || '%')
  ), fl as (
    select b.sku, b.name, b.brand, b.cat, coalesce(b.qty, 0) as qty, b.price,
           array_agg((o.lsku is not null) order by sel.i) as flags
      from base b cross join sel
      left join os_st_on o on o.lsku = lower(trim(b.sku)) and o.platform = sel.platform and o.shop = sel.shop
     group by b.sku, b.name, b.brand, b.cat, b.qty, b.price
  ), f as (
    -- ทุกเงื่อนไขของ p_filter ต้องตรง: Y = ลงแล้ว · N = ยังไม่ลง
    select * from fl
     where not exists (select 1 from jsonb_each_text(coalesce(p_filter, '{}'::jsonb)) c
                        where c.value in ('Y', 'N') and fl.flags[c.key::int] is distinct from (c.value = 'Y'))
  ), r as (
    select f.*, row_number() over (order by
             case when p_sort = 'sku'   and p_dir = 'asc'  then f.sku end asc,
             case when p_sort = 'sku'   and p_dir <> 'asc' then f.sku end desc,
             case when p_sort = 'price' and p_dir = 'asc'  then f.price end asc nulls last,
             case when p_sort = 'price' and p_dir <> 'asc' then f.price end desc nulls last,
             case when p_sort = 'qty'   and p_dir = 'asc'  then f.qty end asc,
             case when p_sort = 'qty'   and p_dir <> 'asc' then f.qty end desc,
             f.sku) as rn
      from f
  )
  select json_build_object(
    'total', (select count(*) from f),
    -- ลงแล้วกี่ SKU ต่อร้าน (ในชุดที่กรองแล้ว) — โชว์ใต้หัวคอลัมน์
    'yes', (select coalesce(json_agg(n order by i), '[]'::json) from (
              select sel.i, count(*) filter (where f.flags[sel.i]) as n from sel cross join f group by sel.i) y),
    'brands', (select coalesce(json_agg(json_build_object('brand', brand, 'n', n) order by n desc), '[]'::json)
                 from (select brand, count(*) as n from os_st
                        where brand is not null and (p_stock <> 'in' or coalesce(qty, 0) > 0) group by brand) x),
    'rows', coalesce((
      select json_agg(json_build_object(
               'sku', r.sku, 'name', r.name, 'brand', r.brand, 'cat', r.cat, 'qty', r.qty, 'price', r.price, 'on', r.flags)
             order by r.rn)
        from r where r.rn > (greatest(p_page, 1) - 1) * p_size and r.rn <= greatest(p_page, 1) * p_size), '[]'::json),
    'st', (select json_build_object('file_modified', file_modified, 'row_count', row_count, 'synced_at', synced_at,
                                    'on_refreshed_at', on_refreshed_at)
             from os_st_meta where id = 1),
    'shop_list', os_listing_shops()
  );
$$;

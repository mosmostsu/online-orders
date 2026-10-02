-- หน้า /allsite: ดูสถานะของร้านเดียว ("ดูที่ร้าน") — รันต่อจาก 036
--
-- เดิม "ลงไม่ครบ / ยังไม่ลงเลย / ครบแล้ว" คิดรวมทุกร้านที่เลือก — อยากรู้ว่าร้านไหนยังขาดอะไรต้องไล่ดูเอง
-- p_focus = ลำดับร้าน (เริ่มที่ 1) ใน p_shops — ใส่แล้วสถานะ/จำนวนคิดจากร้านนั้นร้านเดียว
-- คอลัมน์ร้านอื่นยังส่งกลับไปให้หน้าเว็บโชว์เทียบเหมือนเดิม
--
-- ลบตัวเก่าก่อน — เพิ่มพารามิเตอร์ด้วย create or replace จะได้ฟังก์ชันชื่อซ้ำสองตัว
-- แล้ว PostgREST เลือกไม่ถูกว่าจะเรียกตัวไหน (ตอบ error PGRST203)
drop function if exists os_allsite_page(jsonb, text, text, text, text, int, int);

create or replace function os_allsite_page(
  p_shops jsonb, p_stock text default 'in', p_state text default 'partial',
  p_brand text default '', p_q text default '', p_page int default 1, p_size int default 50,
  p_focus int default null
) returns json language sql stable as $$
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), g as (
    select group_name, max(brand) as brand, max(cat) as cat, count(*) as n, sum(coalesce(qty, 0)) as qty
      from os_st group by group_name
  ), per as (
    -- นับเฉพาะคู่ที่ลงแล้ว (os_st_on เตรียมไว้) — ไม่ต้องไล่ทุกรหัส × ทุกร้าน
    select s.group_name, sel.i, count(*) as n_on
      from os_st s
      join os_st_on o on o.lsku = lower(trim(s.sku))
      join sel on sel.platform = o.platform and sel.shop = o.shop
     group by s.group_name, sel.i
  ), pa as (
    -- min/max = ทุกร้านรวมกัน · หรือร้านเดียวถ้าเลือก "ดูที่ร้าน"
    select g.group_name, array_agg(coalesce(p.n_on, 0) order by sel.i) as per_shop,
           min(coalesce(p.n_on, 0)) filter (where p_focus is null or sel.i = p_focus) as min_on,
           max(coalesce(p.n_on, 0)) filter (where p_focus is null or sel.i = p_focus) as max_on
      from g cross join sel
      left join per p on p.group_name = g.group_name and p.i = sel.i
     group by g.group_name
  ), hit as (
    select distinct group_name from os_st
     where coalesce(p_q, '') <> '' and (group_name ilike '%' || p_q || '%' or sku ilike '%' || p_q || '%')
  ), gs as (
    select g.*, pa.per_shop, (pa.min_on = g.n) as is_complete, (pa.max_on = 0) as is_none
      from g join pa on pa.group_name = g.group_name
     where (p_stock <> 'in' or g.qty > 0)
       and (coalesce(p_q, '') = '' or g.group_name in (select group_name from hit))
  ), b as (
    select * from gs where coalesce(p_brand, '') = '' or brand = p_brand
  ), f as (
    select *, row_number() over (order by qty desc, group_name) as rn from b
     where case p_state when 'complete' then is_complete when 'none' then is_none
                        when 'partial' then not is_complete and not is_none else true end
  ), pg as (
    select * from f where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size
  ), pit as (
    -- ทีละไซส์ เฉพาะรุ่นที่อยู่ในหน้านี้
    select s.group_name, s.sku, coalesce(s.qty, 0) as qty,
           array_agg(exists (select 1 from os_st_on o
                              where o.lsku = lower(trim(s.sku)) and o.platform = sel.platform and o.shop = sel.shop)
                     order by sel.i) as flags
      from os_st s join pg on pg.group_name = s.group_name cross join sel
     group by s.group_name, s.sku, s.qty
  )
  select json_build_object(
    'counts', (select json_build_object(
                 'all', count(*), 'complete', count(*) filter (where is_complete),
                 'none', count(*) filter (where is_none),
                 'partial', count(*) filter (where not is_complete and not is_none)) from b),
    'total', (select count(*) from f),
    'brands', (select coalesce(json_agg(json_build_object('brand', brand, 'n', n) order by n desc), '[]'::json)
                 from (select brand, count(*) as n from gs where brand is not null group by brand) x),
    'rows', coalesce((
      select json_agg(json_build_object(
               'group', pg.group_name, 'brand', pg.brand, 'cat', pg.cat, 'n', pg.n, 'qty', pg.qty, 'per', pg.per_shop,
               'items', (select json_agg(json_build_object('sku', pit.sku, 'qty', pit.qty, 'on', pit.flags) order by pit.sku)
                           from pit where pit.group_name = pg.group_name)
             ) order by pg.rn)
        from pg), '[]'::json),
    'st', (select json_build_object('file_modified', file_modified, 'row_count', row_count, 'synced_at', synced_at,
                                    'on_refreshed_at', on_refreshed_at)
             from os_st_meta where id = 1),
    'shop_list', os_listing_shops()
  );
$$;

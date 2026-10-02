-- หน้า /allsite เร็วขึ้น + จับคู่ SKU แบบตัดเว้นวรรค — รันต่อจาก 035
--
-- 035 เทียบ 43,000 รหัส × ทุกร้านใหม่ทุกครั้งที่เปิดหน้า ใช้ 5-7 วินาที
-- ตอนนี้เตรียมรายการ "SKU ไหนลงร้านไหนแล้ว" (os_st_on) ไว้ล่วงหน้า อัปเดตหลังดึง ST/ดึงสินค้า
-- (ไม่ถี่กว่าทุก 10 นาที — ดู os_st_on_refresh) หน้าเว็บแค่หยิบมานับ
-- os_st_on สร้างจาก os_listing_skus อย่างเดียว ไฟล์ ST เปลี่ยนไม่ต้องสร้างใหม่
--
-- จับคู่ด้วย lower(trim(...)) — SKU บน Shopee บางตัวมีเว้นวรรคหน้า/หลัง (เจอ 31 ตัว ต.ค. 2569)
-- รหัสถูกแต่เทียบตรงตัวไม่เจอ จึงตัดทิ้งตอนเทียบ แล้วแยกโชว์ในรหัสน่าสงสัยหัวข้อ "มีเว้นวรรค"

create table if not exists os_st_on (
  lsku     text not null,                  -- lower(trim(seller_sku))
  platform text not null,
  shop     text not null,
  primary key (lsku, platform, shop)
);
alter table os_st_on enable row level security;
alter table os_st_meta add column if not exists on_refreshed_at timestamptz;

create index if not exists os_st_ltrim_idx on os_st (lower(trim(sku)));
create index if not exists os_listing_skus_ltrim_idx on os_listing_skus (platform, shop, lower(trim(seller_sku)));

-- สร้าง os_st_on ใหม่ทั้งชุด — p_min_age วินาที: เพิ่งทำไปไม่นานก็ข้าม (ตัวดึงสินค้าเรียกทุกรอบ)
create or replace function os_st_on_refresh(p_min_age int default 0) returns int
language plpgsql as $$
declare
  v_last timestamptz;
  n int;
begin
  select on_refreshed_at into v_last from os_st_meta where id = 1;
  if p_min_age > 0 and v_last is not null and v_last > now() - make_interval(secs => p_min_age) then
    return -1;
  end if;
  delete from os_st_on;
  insert into os_st_on (lsku, platform, shop)
  select distinct lower(trim(seller_sku)), platform, shop
    from os_listing_skus where coalesce(trim(seller_sku), '') <> '';
  get diagnostics n = row_count;
  insert into os_st_meta (id, on_refreshed_at) values (1, now())
    on conflict (id) do update set on_refreshed_at = excluded.on_refreshed_at;
  return n;
end;
$$;

select os_st_on_refresh();

-- ── มุมมอง "ลงครบไหม" (แทนของ 035 — พารามิเตอร์เหมือนเดิม) ─────────────────────
create or replace function os_allsite_page(
  p_shops jsonb, p_stock text default 'in', p_state text default 'partial',
  p_brand text default '', p_q text default '', p_page int default 1, p_size int default 50
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
    select g.group_name, array_agg(coalesce(p.n_on, 0) order by sel.i) as per_shop,
           min(coalesce(p.n_on, 0)) as min_on, max(coalesce(p.n_on, 0)) as max_on
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

-- ── มุมมอง "รหัสน่าสงสัย" (แทนของ 035) — เพิ่มหัวข้อ 'space' = มีเว้นวรรคหน้า/หลัง ─────
create or replace function os_allsite_suspects(
  p_platform text, p_shop text, p_kind text default 'notst', p_q text default '',
  p_page int default 1, p_size int default 50
) returns json language sql stable as $$
  with nb as (
    -- SKU นี้อยู่กี่ตะกร้า — แยกนับก่อน Postgres ไม่รองรับ count(distinct) แบบ over (partition by)
    select lower(trim(seller_sku)) as k, count(distinct product_id) as baskets
      from os_listing_skus
     where platform = p_platform and shop = p_shop and coalesce(trim(seller_sku), '') <> ''
     group by 1
  ), k as (
    select ls.*, l.title, l.status,
           (coalesce(trim(ls.seller_sku), '') = '') as is_empty,
           (coalesce(trim(ls.seller_sku), '') <> '' and ls.seller_sku <> trim(ls.seller_sku)) as has_space,
           (coalesce(trim(ls.seller_sku), '') <> '' and not exists (
              select 1 from os_st s where lower(trim(s.sku)) = lower(trim(ls.seller_sku)))) as not_st,
           coalesce(nb.baskets, 0) as baskets
      from os_listing_skus ls
      join os_listings l on l.platform = ls.platform and l.shop = ls.shop and l.product_id = ls.product_id
      left join nb on nb.k = lower(trim(ls.seller_sku))
     where ls.platform = p_platform and ls.shop = p_shop
  ), f as (
    select *, row_number() over (order by lower(trim(coalesce(seller_sku, ''))), product_id, sort) as rn from k
     where case p_kind when 'empty' then is_empty
                       when 'dup' then not is_empty and baskets > 1
                       when 'space' then has_space
                       else not_st end
       and (coalesce(p_q, '') = '' or seller_sku ilike '%' || p_q || '%' or title ilike '%' || p_q || '%')
  )
  select json_build_object(
    'counts', (select json_build_object(
                 'notst', count(*) filter (where not_st),
                 'empty', count(*) filter (where is_empty),
                 'dup', count(*) filter (where not is_empty and baskets > 1),
                 'space', count(*) filter (where has_space)) from k),
    'total', (select count(*) from f),
    'rows', coalesce((
      select json_agg(json_build_object(
               'sku', seller_sku, 'variant', variant, 'product_id', product_id, 'title', title,
               'status', status, 'stock', stock, 'baskets', baskets) order by rn)
        from f where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size), '[]'::json),
    'shop_list', os_listing_shops()
  );
$$;

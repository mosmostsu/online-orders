-- หน้า /allsite "ลงครบไหม" — สินค้าใน Seniorsoft ลงขายครบทุกร้านหรือยัง + รหัสน่าสงสัย — รันต่อจาก 034
--
-- ตัวตั้งต้นคือไฟล์ ST กลาง (Firebase samchai-checkstock → central/ST.json) ที่ Colab อัปทุกรอบตัด
-- เก็บสำเนาไว้ใน os_st (ดู app/api/sync/st) — ไฟล์มี ~43,000 รหัส โหลดทุกครั้งที่เปิดหน้าช้าเกิน
-- เทียบกับ os_listing_skus.seller_sku แบบไม่สนตัวพิมพ์เล็กใหญ่
--
-- ⚠️ os_st คือสำเนาเพื่อดูอย่างเดียว ไม่ใช่สต็อกของระบบนี้ — ความจริงอยู่ที่ Seniorsoft (ดู CLAUDE.md)

create table if not exists os_st (
  sku         text primary key,          -- cf_itemid
  name        text,                      -- cf_itemname
  group_name  text,                      -- ชื่อตัดไซส์ท้ายออก = รุ่น+สี (คิดตอนดึง ดู lib/central.js)
  brand       text,                      -- cf_itemgroupl1_groupname
  cat         text,                      -- cf_itemgroupl2_groupname
  qty         numeric,                   -- cf_quantity ณ ไฟล์ล่าสุด
  price       numeric,
  synced_at   timestamptz not null default now()
);
create index if not exists os_st_group_idx on os_st (group_name);
create index if not exists os_st_lower_idx on os_st (lower(sku));
create index if not exists os_listing_skus_lower_idx on os_listing_skus (platform, shop, lower(seller_sku));

-- ไฟล์ ST ล่าสุดที่ดึงมาแล้ว — เทียบกับ metadata บน Firebase ว่ามีไฟล์ใหม่ไหม
create table if not exists os_st_meta (
  id            int primary key default 1,
  updated       text,                    -- ค่า updated ของไฟล์บน Firebase
  file_modified timestamptz,             -- เวลาแก้ไฟล์ STlatest.xlsx จริง
  row_count     int,
  synced_at     timestamptz not null default now()
);

alter table os_st      enable row level security;
alter table os_st_meta enable row level security;

-- ── มุมมอง "ลงครบไหม" ─────────────────────────────────────────────────────
-- p_shops: ร้านที่จะเทียบ [["shopee","REAL"],["tiktok","SOLID"],...] ลำดับนี้คือลำดับคอลัมน์
-- p_stock: 'in' = เฉพาะรุ่นที่ยังมีของ (รวมทุกไซส์ > 0) · 'all' = ทั้งหมด
-- p_state: 'partial' ลงไม่ครบ · 'none' ไม่ลงเลย · 'complete' ครบทุกร้านที่เลือก · 'all'
create or replace function os_allsite_page(
  p_shops jsonb, p_stock text default 'in', p_state text default 'partial',
  p_brand text default '', p_q text default '', p_page int default 1, p_size int default 50
) returns json language sql stable as $$
  -- นับทีเดียวทั้งก้อนด้วย group by — ห้ามเขียนแบบ subquery ต่อกลุ่ม (13,000 กลุ่ม × แถวทั้งหมด = ช้ามาก)
  with sel as (
    select (x.ord)::int as i, x.v ->> 0 as platform, x.v ->> 1 as shop
      from jsonb_array_elements(p_shops) with ordinality as x(v, ord)
  ), listed as (
    select distinct sel.i, lower(ls.seller_sku) as sku
      from os_listing_skus ls join sel on ls.platform = sel.platform and ls.shop = sel.shop
     where coalesce(ls.seller_sku, '') <> ''
  ), it as (
    -- ทุกรหัสใน ST × ทุกร้านที่เลือก: ลงในร้านนั้นหรือยัง
    select s.sku, s.group_name, coalesce(s.qty, 0) as qty, sel.i, (l.sku is not null) as on_shop
      from os_st s cross join sel
      left join listed l on l.i = sel.i and l.sku = lower(s.sku)
  ), per as (
    select group_name, i, count(*) filter (where on_shop) as n_on from it group by group_name, i
  ), pa as (
    select group_name, array_agg(n_on order by i) as per_shop, min(n_on) as min_on, max(n_on) as max_on
      from per group by group_name
  ), g as (
    select group_name, max(brand) as brand, max(cat) as cat, count(*) as n, sum(coalesce(qty, 0)) as qty
      from os_st group by group_name
  ), hit as (
    -- ค้นชื่อรุ่น หรือ SKU ตัวใดตัวหนึ่งในรุ่น
    select distinct group_name from os_st
     where coalesce(p_q, '') = '' or group_name ilike '%' || p_q || '%' or sku ilike '%' || p_q || '%'
  ), gs as (
    select g.*, pa.per_shop, (pa.min_on = g.n) as is_complete, (pa.max_on = 0) as is_none
      from g join pa using (group_name) join hit using (group_name)
     where p_stock <> 'in' or g.qty > 0
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
    select it.group_name, it.sku, max(it.qty) as qty, array_agg(it.on_shop order by it.i) as flags
      from it join pg using (group_name) group by it.group_name, it.sku
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
    'st', (select json_build_object('file_modified', file_modified, 'row_count', row_count, 'synced_at', synced_at)
             from os_st_meta where id = 1),
    'shop_list', os_listing_shops()
  );
$$;

-- ── มุมมอง "รหัสน่าสงสัย" ของร้านเดียว ─────────────────────────────────────
-- p_kind: 'notst' SKU ที่ไม่มีใน ST · 'empty' ไม่ได้ใส่ SKU · 'dup' SKU เดียวกันอยู่หลายตะกร้า
create or replace function os_allsite_suspects(
  p_platform text, p_shop text, p_kind text default 'notst', p_q text default '',
  p_page int default 1, p_size int default 50
) returns json language sql stable as $$
  with nb as (
    -- SKU นี้อยู่กี่ตะกร้า — แยกนับก่อน Postgres ไม่รองรับ count(distinct) แบบ over (partition by)
    select lower(seller_sku) as k, count(distinct product_id) as baskets
      from os_listing_skus
     where platform = p_platform and shop = p_shop and coalesce(seller_sku, '') <> ''
     group by 1
  ), k as (
    select ls.*, l.title, l.status,
           (coalesce(ls.seller_sku, '') = '') as is_empty,
           (coalesce(ls.seller_sku, '') <> '' and not exists (
              select 1 from os_st s where lower(s.sku) = lower(ls.seller_sku))) as not_st,
           coalesce(nb.baskets, 0) as baskets
      from os_listing_skus ls
      join os_listings l on l.platform = ls.platform and l.shop = ls.shop and l.product_id = ls.product_id
      left join nb on nb.k = lower(ls.seller_sku)
     where ls.platform = p_platform and ls.shop = p_shop
  ), f as (
    select *, row_number() over (order by lower(coalesce(seller_sku, '')), product_id, sort) as rn from k
     where case p_kind when 'empty' then is_empty
                       when 'dup' then not is_empty and baskets > 1
                       else not_st end
       and (coalesce(p_q, '') = '' or seller_sku ilike '%' || p_q || '%' or title ilike '%' || p_q || '%')
  )
  select json_build_object(
    'counts', (select json_build_object(
                 'notst', count(*) filter (where not_st),
                 'empty', count(*) filter (where is_empty),
                 'dup', count(*) filter (where not is_empty and baskets > 1)) from k),
    'total', (select count(*) from f),
    'rows', coalesce((
      select json_agg(json_build_object(
               'sku', seller_sku, 'variant', variant, 'product_id', product_id, 'title', title,
               'status', status, 'stock', stock, 'baskets', baskets) order by rn)
        from f where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size), '[]'::json),
    'shop_list', os_listing_shops()
  );
$$;

-- ถามครั้งเดียวต่อหน้า — หน้า /product, /summary, รายละเอียดสินค้า — รันต่อจาก 033
-- (ต้องรันก่อน deploy โค้ดที่เรียกฟังก์ชันพวกนี้)
--
-- ทำไม: เซิร์ฟเวอร์ Netlify อยู่อเมริกา (iad) ส่วน Supabase อยู่เอเชีย ถามหนึ่งครั้ง ~0.3 วินาที
-- หน้าเดิมถาม 3-5 ครั้งต่อกัน (รายชื่อร้าน → นับแท็บ → แถวที่โชว์ → ตัวเลือก) ~1-1.5 วินาที
-- ย้ายตรรกะกรอง/เรียง/แบ่งหน้ามาไว้ในฐานข้อมูล แล้วตอบกลับก้อนเดียว เหลือครั้งเดียว
--
-- กติกาแท็บ/กรองต้องตรงกับ lib/listings.js (inListingTab) — แก้ที่หนึ่งต้องแก้อีกที่ด้วย

-- ── ตะกร้าพร้อมธงแท็บ (ใช้ร่วมกันทุกฟังก์ชันข้างล่าง) ─────────────────────
create or replace function os_listing_flags(p_platform text, p_shop text, p_q text)
returns table (
  product_id text, title text, thumb_url text, status text, deboost boolean, item_sku text,
  sku_n int, price_min numeric, price_max numeric, promo_min numeric, promo_max numeric,
  stock int, min_stock int, sold_total int, remote_updated_at timestamptz,
  is_live boolean, is_banned boolean, is_review boolean
)
language sql stable as $$
  select l.product_id, l.title, l.thumb_url, l.status, l.deboost, l.item_sku,
         l.sku_n, l.price_min, l.price_max, l.promo_min, l.promo_max,
         l.stock, l.min_stock, l.sold_total, l.remote_updated_at,
         l.status in ('NORMAL', 'ACTIVATE', 'ONSHELF'),
         -- การละเมิดแบบหลังร้าน Shopee: ถูกแบน/ถูกลบ หรือยังขายอยู่แต่ถูกลดการมองเห็น
         l.status in ('BANNED', 'PLATFORM_DEACTIVATED', 'FREEZE', 'FAILED', 'SHOPEE_DELETE') or coalesce(l.deboost, false),
         l.status in ('REVIEWING', 'PENDING')
    from os_listings l
   where l.platform = p_platform and l.shop = p_shop
     -- ค้นชื่อ / รหัสสินค้า / Parent SKU / เลข SKU ของตัวเลือก (หน้าเว็บตัด % _ ออกก่อนส่งมา)
     and (coalesce(p_q, '') = ''
          or l.title ilike '%' || p_q || '%'
          or l.product_id = p_q
          or l.item_sku ilike '%' || p_q || '%'
          or exists (select 1 from os_listing_skus s
                      where s.platform = l.platform and s.shop = l.shop and s.product_id = l.product_id
                        and s.seller_sku ilike '%' || p_q || '%'));
$$;

-- ── ร้านทั้งหมด + จำนวนตะกร้า (แถบร้าน) ──────────────────────────────────
-- ThisShop ไม่มีแถวใน os_shop_tokens — หน้าเว็บต่อท้ายเองถ้าตั้งคีย์ไว้ (นับให้ใน thisshop_n)
create or replace function os_listing_shops() returns json language sql stable as $$
  select json_build_object(
    'shops', coalesce((
      select json_agg(json_build_object('platform', t.platform, 'shop', t.shop,
               'n', (select count(*) from os_listings l where l.platform = t.platform and l.shop = t.shop))
             order by (t.platform = 'shopee') desc, t.platform, t.shop)
        from os_shop_tokens t where t.platform in ('shopee', 'tiktok')), '[]'::json),
    'thisshop_n', (select count(*) from os_listings where platform = 'thisshop' and shop = 'THISSHOP')
  );
$$;

-- ร้านที่ขอมามีจริงไหม — ไม่มี/ไม่ได้ส่งมา ใช้ร้านแรก (Shopee เรียงตามชื่อ)
create or replace function os_listing_pick_shop(p_platform text, p_shop text, out platform text, out shop text)
language plpgsql stable as $$
begin
  if p_platform = 'thisshop' then platform := 'thisshop'; shop := 'THISSHOP'; return; end if;
  if exists (select 1 from os_shop_tokens t where t.platform = p_platform and t.shop = p_shop) then
    platform := p_platform; shop := p_shop; return;
  end if;
  select t.platform, t.shop into platform, shop from os_shop_tokens t
   where t.platform in ('shopee', 'tiktok') order by (t.platform = 'shopee') desc, t.platform, t.shop limit 1;
end;
$$;

-- ── หน้า /product ──────────────────────────────────────────────────────
create or replace function os_product_page(
  p_platform text, p_shop text,
  p_tab text default 'live', p_stock text default '', p_sort text default 'new', p_q text default '',
  p_page int default 1, p_size int default 12, p_preview int default 3
) returns json language plpgsql stable as $$
declare
  c record;
  v json;
begin
  select * into c from os_listing_pick_shop(p_platform, p_shop);
  with b as (
    select * from os_listing_flags(c.platform, c.shop, p_q)
  ), t as (
    select * from b
     where case p_tab when 'all' then true when 'live' then is_live when 'banned' then is_banned
                      when 'review' then is_review
                      else not is_live and not is_banned and not is_review end
  ), f as (
    select * from t
     where case p_stock when 'out' then coalesce(stock, 0) = 0
                        when 'low' then coalesce(stock, 0) > 0 and min_stock is not null and min_stock <= 2
                        else true end
  ), r as (
    select f.*, row_number() over (order by
             case when p_sort = 'stock' then f.min_stock end asc nulls last,
             case when p_sort = 'stock' then coalesce(f.stock, 0) end asc,
             case when p_sort = 'price' then coalesce(f.price_max, 0) end desc,
             f.remote_updated_at desc nulls last, f.product_id) as rn
      from f
  ), pg as (
    select * from r where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size
  )
  select json_build_object(
    'platform', c.platform, 'shop', c.shop,
    'counts', (select json_build_object(
                 'all', count(*),
                 'live', count(*) filter (where is_live),
                 'banned', count(*) filter (where is_banned),
                 'review', count(*) filter (where is_review),
                 'unlisted', count(*) filter (where not is_live and not is_banned and not is_review)) from b),
    'stock_counts', (select json_build_object(
                 'any', count(*),
                 'out', count(*) filter (where coalesce(stock, 0) = 0),
                 'low', count(*) filter (where coalesce(stock, 0) > 0 and min_stock is not null and min_stock <= 2)) from t),
    'total', (select count(*) from f),
    'rows', coalesce((
      select json_agg(json_build_object(
               'product_id', pg.product_id, 'title', pg.title, 'thumb_url', pg.thumb_url, 'status', pg.status,
               'deboost', pg.deboost, 'item_sku', pg.item_sku, 'sku_n', pg.sku_n,
               'price_min', pg.price_min, 'price_max', pg.price_max, 'promo_min', pg.promo_min, 'promo_max', pg.promo_max,
               'stock', pg.stock, 'min_stock', pg.min_stock,
               'preview', coalesce((
                 select json_agg(json_build_object(
                          'sku_id', s.sku_id, 'seller_sku', s.seller_sku, 'variant', s.variant, 'price', s.price,
                          'promo_price', s.promo_price, 'stock', s.stock, 'image_url', s.image_url, 'sort', s.sort)
                        order by s.sort)
                   from os_listing_skus s
                  where s.platform = c.platform and s.shop = c.shop and s.product_id = pg.product_id
                    and s.sort < p_preview), '[]'::json)
             ) order by pg.rn)
        from pg), '[]'::json),
    'last_run', (select json_build_object('started_at', started_at, 'finished_at', finished_at, 'ok', ok, 'error', error)
                   from os_sync_log where platform = 'listings:' || c.platform and shop = c.shop
                  order by started_at desc limit 1),
    'shop_list', os_listing_shops()
  ) into v;
  return v;
end;
$$;

-- ── หน้า /summary ──────────────────────────────────────────────────────
-- p_sales: ยอดของ TikTok จาก Analytics ที่หน้าเว็บถามมาแล้ว {product_id: [ชิ้น, บาท]} — เจ้าอื่นส่ง null
-- p_range: 'all' = ยอดสะสมของ Shopee (sold_total) · อื่นๆ = 30 วันจากออเดอร์ในระบบ
create or replace function os_summary_page(
  p_platform text, p_shop text, p_range text default '30', p_show text default 'live',
  p_dir text default 'desc', p_q text default '', p_page int default 1, p_size int default 50,
  p_sales jsonb default null
) returns json language plpgsql stable as $$
declare
  c record;
  v json;
begin
  select * into c from os_listing_pick_shop(p_platform, p_shop);
  with b as (
    select * from os_listing_flags(c.platform, c.shop, p_q) where p_show = 'all' or is_live
  ), o as (
    -- 30 วันจากออเดอร์ — คิดเฉพาะเมื่อใช้จริง
    select s.product_id, sum(s.qty)::int as qty
      from os_listing_sales(c.platform, c.shop, 30) s
     where p_sales is null and p_range <> 'all'
     group by s.product_id
  ), u as (
    select b.*,
           case when p_sales is not null then coalesce((p_sales -> b.product_id ->> 0)::int, 0)
                when p_range = 'all' then b.sold_total
                else coalesce(o.qty, 0) end as units,
           case when p_sales is not null then coalesce((p_sales -> b.product_id ->> 1)::numeric, 0) end as gmv
      from b left join o on o.product_id = b.product_id
  ), r as (
    -- ไม่มีตัวเลข (null) ไปท้ายเสมอ · เท่ากันให้คลังมากขึ้นก่อน (ของจมทุน)
    select u.*, row_number() over (order by
             (u.units is null),
             case when p_dir = 'asc' then u.units end asc,
             case when p_dir <> 'asc' then u.units end desc,
             coalesce(u.stock, 0) desc, u.product_id) as rn
      from u
  ), pg as (
    select * from r where rn > (greatest(p_page, 1) - 1) * p_size and rn <= greatest(p_page, 1) * p_size
  )
  select json_build_object(
    'platform', c.platform, 'shop', c.shop,
    'total', (select count(*) from u),
    'units', (select coalesce(sum(units), 0) from u),
    'gmv', (select coalesce(sum(gmv), 0) from u),
    'zero', (select count(*) from u where coalesce(units, 0) = 0),
    'missing', (select count(*) from u where units is null),
    'rows', coalesce((
      select json_agg(json_build_object(
               'rank', pg.rn, 'product_id', pg.product_id, 'title', pg.title, 'thumb_url', pg.thumb_url,
               'status', pg.status, 'deboost', pg.deboost, 'sku_n', pg.sku_n,
               'price_min', pg.price_min, 'price_max', pg.price_max, 'promo_min', pg.promo_min, 'promo_max', pg.promo_max,
               'stock', pg.stock, 'units', pg.units, 'gmv', pg.gmv) order by pg.rn)
        from pg), '[]'::json),
    'shop_list', os_listing_shops()
  ) into v;
  return v;
end;
$$;

-- ── หน้ารายละเอียดสินค้า ────────────────────────────────────────────────
-- p_with_sold: ใส่รหัสปลดล็อกแล้วเท่านั้น (ดู lib/pin.js) — ไม่ปลดก็ไม่คิดยอดขายเลย
create or replace function os_listing_detail(p_platform text, p_shop text, p_id text, p_with_sold boolean default false)
returns json language sql stable as $$
  with sk as (
    select * from os_listing_skus where platform = p_platform and shop = p_shop and product_id = p_id
  ), sold as (
    -- ขาย 30 วันต่อตัวเลือก — กติกาเดียวกับ os_listing_sales (033) แต่คิดเฉพาะตะกร้านี้
    select x.sku_id, sum(x.qty)::int as qty from (
      select sk.sku_id, i.qty
        from os_order_items i join os_orders o on o.id = i.order_ref
        join sk on sk.sku_id = i.platform_sku_id
       where p_with_sold and o.platform = p_platform and o.shop = p_shop
         and o.status not in ('cancelled', 'unpaid') and o.ordered_at >= now() - interval '30 days'
      union all
      select sk.sku_id, i.qty
        from os_order_items i join os_orders o on o.id = i.order_ref
        join sk on sk.seller_sku = i.sku
       where p_with_sold and i.platform_sku_id is null and o.platform = p_platform and o.shop = p_shop
         and o.status not in ('cancelled', 'unpaid') and o.ordered_at >= now() - interval '30 days'
    ) x group by x.sku_id
  )
  select json_build_object(
    'listing', (select row_to_json(l) from os_listings l where l.platform = p_platform and l.shop = p_shop and l.product_id = p_id),
    'skus', coalesce((
      select json_agg(json_build_object(
               'sku_id', sk.sku_id, 'seller_sku', sk.seller_sku, 'variant', sk.variant, 'price', sk.price,
               'promo_price', sk.promo_price, 'stock', sk.stock, 'image_url', sk.image_url, 'sort', sk.sort,
               'sold', case when p_with_sold then coalesce(sold.qty, 0) end)
             order by sk.sort)
        from sk left join sold on sold.sku_id = sk.sku_id), '[]'::json),
    'shop_id', (select t.shop_id from os_shop_tokens t where t.platform = p_platform and t.shop = p_shop)
  );
$$;

-- หน้า /compare (เทียบร้านในกลุ่ม SOLID / REAL / MVP) — รันต่อจาก 050
--
-- ทำไม: เดิมหน้าเว็บดึงตะกร้า+ตัวเลือกทั้งกลุ่มมาคำนวณเอง (หมื่นแถว ข้ามทวีป) ช้า 2-6 วินาที
-- ย้ายการรวมตะกร้า/กรอง/เรียง/แบ่งหน้ามาไว้ในฐานข้อมูล ตอบกลับมาเฉพาะหน้าที่จะโชว์ (เหมือน 034 / 036)
--
-- ตรรกะต้องตรงกับ app/compare/page.js (buildRows):
--   • เทียบเฉพาะตะกร้าที่ขายอยู่ (NORMAL/ACTIVATE/ONSHELF) ที่มี seller_sku อย่างน้อย 1 ตัว
--   • จับคู่ด้วย seller_sku (ตัดช่องว่าง ไม่สนตัวพิมพ์) · SKU ที่อยู่ในตะกร้าเกิน 12 ใบ = รหัสกลาง ไม่เอามาจับคู่
--   • เชื่อมสองตะกร้าต่างร้านเมื่อ SKU ทับ ≥ p_thr % ของใบที่เล็กกว่า แล้วรวมที่เชื่อมถึงกันเป็นแถวเดียว
--   • ต่อร้าน: ok = มี SKU ครบชุดรวมของแถว · part = ขาดบางตัว · none = ไม่มีตะกร้าในแถวนี้
--   • ราคาไม่ตรง: ตัวเลือกที่อยู่ ≥2 ร้านแล้วราคาต่างกัน ร้านที่ไม่ตรงราคาส่วนใหญ่ถือว่าไม่ตรง (เสมอ = ไม่ตรงทุกร้าน)
-- กลุ่มร้าน: ThisShop อยู่ REAL, ที่เหลือใช้ชื่อร้านตัวพิมพ์ใหญ่ (ตรงกับ lib/shopGroups.js)

-- เพิ่มพารามิเตอร์ p_hide_out — ลบรุ่นเดิม (6 พารามิเตอร์) ก่อน ไม่งั้นสองรุ่นอยู่คู่กันแล้ว PostgREST เลือกไม่ถูก
drop function if exists os_compare_page(text, int, text, text, int, int);

create or replace function os_compare_page(
  p_group text, p_thr int default 60, p_filter text default 'all', p_q text default '',
  p_page int default 1, p_size int default 15, p_hide_out boolean default true
) returns json
language sql stable as $$
  with recursive
  shops as (
    select s.platform, s.shop,
           row_number() over (order by array_position(array['shopee', 'tiktok', 'lazada', 'thaimart', 'thisshop'], s.platform), s.shop) as idx
      from (select distinct platform, shop from os_listings) s
     where case when s.platform = 'thisshop' then 'REAL' else upper(s.shop) end = p_group
  ),
  nodes as (
    select l.platform, l.shop, l.product_id, l.title, l.thumb_url, l.status, l.item_sku,
           row_number() over (order by l.platform, l.shop, l.product_id) as id
      from os_listings l
      join shops s on s.platform = l.platform and s.shop = l.shop
     where l.status in ('NORMAL', 'ACTIVATE', 'ONSHELF')
  ),
  sk_all as (
    select n.id, n.platform, n.shop, lower(btrim(k.seller_sku)) as k, k.variant, k.price, k.stock
      from nodes n
      join os_listing_skus k on k.platform = n.platform and k.shop = n.shop and k.product_id = n.product_id
     where coalesce(btrim(k.seller_sku), '') <> ''
  ),
  alive as (   -- SKU ที่มีของอย่างน้อยหนึ่งร้านในกลุ่ม (คลังว่าง = ไม่รู้ นับว่ามี)
    select k from sk_all group by k having bool_or(coalesce(stock, 1) > 0)
  ),
  sk as (      -- ซ่อนของหมด: ตัด SKU ที่หมดทุกร้าน — ตะกร้าที่เหลือ 0 ตัวเลือกหายไปเอง
    select * from sk_all where not p_hide_out or k in (select k from alive)
  ),
  ks as (select distinct id, k from sk),
  sz as (select id, count(*)::int as c from ks group by id),
  common as (select k from ks group by k having count(*) > 12),
  pairs as (
    select x.id as a, y.id as b, count(*)::int as c
      from ks x
      join ks y on y.k = x.k and y.id > x.id
      join nodes na on na.id = x.id
      join nodes nb on nb.id = y.id
     where (na.platform <> nb.platform or na.shop <> nb.shop)
       and x.k not in (select k from common)
     group by x.id, y.id
  ),
  edges as (
    select p.a, p.b
      from pairs p
      join sz za on za.id = p.a
      join sz zb on zb.id = p.b
     where p.c::numeric / least(za.c, zb.c) >= p_thr / 100.0
  ),
  und as (select a as x, b as y from edges union all select b, a from edges),
  reach(id, lbl) as (
    select z.id, z.id from sz z
    union
    select u.y, r.lbl from reach r join und u on u.x = r.id
  ),
  comp as (select id, min(lbl) as cid from reach group by id),

  cu as (   -- SKU รวมของแต่ละแถว
    select c.cid, sk.k, min(sk.variant) as variant
      from comp c join sk on sk.id = c.id
     group by c.cid, sk.k
  ),
  cn as (select cid, count(*)::int as n from cu group by cid),
  cs as (   -- SKU ที่แต่ละร้านมีในแถวนั้น
    select c.cid, n.platform, n.shop, ks.k
      from comp c join nodes n on n.id = c.id join ks on ks.id = c.id
     group by c.cid, n.platform, n.shop, ks.k
  ),
  have as (select cid, platform, shop, count(*)::int as have from cs group by cid, platform, shop),
  nnode as (
    select c.cid, n.platform, n.shop, count(*)::int as nn
      from comp c join nodes n on n.id = c.id
     group by c.cid, n.platform, n.shop
  ),
  pp as (   -- ราคาของแต่ละตัวเลือกต่อร้าน
    select c.cid, sk.k, sk.platform, sk.shop, min(sk.price) as price
      from comp c join sk on sk.id = c.id
     group by c.cid, sk.k, sk.platform, sk.shop
  ),
  pcount as (
    select cid, k from pp where price is not null group by cid, k
    having count(*) >= 2 and count(distinct price) > 1
  ),
  pt as (
    select p.cid, p.k, p.price, count(*)::int as c
      from pp p join pcount q on q.cid = p.cid and q.k = p.k
     where p.price is not null
     group by p.cid, p.k, p.price
  ),
  ptop as (select cid, k, max(c) as mx from pt group by cid, k),
  pmode as (
    select t.cid, t.k, count(*)::int as n_modes, min(t.price) as mode_price
      from pt t join ptop m on m.cid = t.cid and m.k = t.k and t.c = m.mx
     group by t.cid, t.k
  ),
  pdiff as (
    select p.cid, p.k, p.platform, p.shop
      from pp p join pmode m on m.cid = p.cid and m.k = p.k
     where p.price is not null and not (m.n_modes = 1 and p.price = m.mode_price)
  ),
  pdc as (select cid, platform, shop, count(*)::int as pd from pdiff group by cid, platform, shop),

  cells as (
    select cn.cid, s.idx, s.platform, s.shop, cn.n,
           coalesce(h.have, 0) as have, coalesce(nd.nn, 0) as nn,
           case when coalesce(nd.nn, 0) = 0 then 'none'
                when coalesce(h.have, 0) = cn.n then 'ok'
                else 'part' end as state,
           coalesce(d.pd, 0) as pd
      from cn
      cross join shops s
      left join have h on h.cid = cn.cid and h.platform = s.platform and h.shop = s.shop
      left join nnode nd on nd.cid = cn.cid and nd.platform = s.platform and nd.shop = s.shop
      left join pdc d on d.cid = cn.cid and d.platform = s.platform and d.shop = s.shop
  ),
  rep as (  -- ตะกร้าที่ใหญ่สุดในแถว ใช้เป็นชื่อ/รูปของแถว
    select distinct on (c.cid) c.cid, n.platform, n.shop, n.product_id, n.title, n.thumb_url, n.item_sku
      from comp c join nodes n on n.id = c.id join sz on sz.id = c.id
     order by c.cid, sz.c desc, n.id
  ),
  agg as (
    select cid,
           bool_and(state = 'ok') as all_ok,
           bool_or(state = 'part') as any_part,
           bool_or(state = 'none') as any_none,
           bool_or(pd > 0) as any_pd,
           (count(*) filter (where state <> 'ok'))::int as gaps
      from cells group by cid
  ),
  base as (   -- หลังค้นหา ก่อนกรองชิป (ตัวนับชิปนับจากตรงนี้)
    select a.cid, a.all_ok, a.any_part, a.any_none, a.any_pd, a.gaps, r.title
      from agg a join rep r on r.cid = a.cid
     where coalesce(p_q, '') = ''
        or exists (select 1 from comp c join nodes n on n.id = c.id
                    where c.cid = a.cid
                      and (n.title ilike '%' || p_q || '%' or n.item_sku ilike '%' || p_q || '%' or n.product_id = p_q))
  ),
  fil as (
    select * from base
     where case p_filter when 'ok' then all_ok when 'part' then any_part
                         when 'none' then any_none when 'price' then any_pd else true end
  ),
  picked as (
    select cid, gaps, title, row_number() over (order by gaps desc, title, cid) as rn
      from fil
     order by gaps desc, title, cid
     limit greatest(p_size, 1) offset (greatest(p_page, 1) - 1) * greatest(p_size, 1)
  ),

  pk as (
    select p.cid, u.k, u.variant, s.idx, s.platform, s.shop
      from picked p join cu u on u.cid = p.cid cross join shops s
  ),
  pcell as (
    select x.cid, x.k, x.variant, x.idx,
           (cs.k is not null) as has, pp.price, (d.k is not null) as diff
      from pk x
      left join cs on cs.cid = x.cid and cs.k = x.k and cs.platform = x.platform and cs.shop = x.shop
      left join pp on pp.cid = x.cid and pp.k = x.k and pp.platform = x.platform and pp.shop = x.shop
      left join pdiff d on d.cid = x.cid and d.k = x.k and d.platform = x.platform and d.shop = x.shop
  ),
  mxr as (
    select g.cid,
           json_agg(json_build_object('k', g.k, 'variant', g.variant, 'has', g.has, 'price', g.price, 'diff', g.diff) order by g.k) as mx
      from (select pc.cid, pc.k, pc.variant,
                   json_agg(pc.has order by pc.idx) as has,
                   json_agg(pc.price order by pc.idx) as price,
                   json_agg(pc.diff order by pc.idx) as diff
              from pcell pc
             group by pc.cid, pc.k, pc.variant) g
     group by g.cid
  ),
  nodej as (
    select p.cid, n.platform, n.shop,
           json_agg(json_build_object('pid', n.product_id, 'title', n.title, 'status', n.status, 'size', z.c) order by n.id) as nodes
      from picked p
      join comp c on c.cid = p.cid
      join nodes n on n.id = c.id
      join sz z on z.id = n.id
     group by p.cid, n.platform, n.shop
  ),
  cellj as (
    select c.cid,
           json_agg(json_build_object('state', c.state, 'have', c.have, 'n', c.n, 'pd', c.pd,
                                      'nodes', coalesce(nj.nodes, '[]'::json)) order by c.idx) as cells
      from cells c
      join picked p on p.cid = c.cid
      left join nodej nj on nj.cid = c.cid and nj.platform = c.platform and nj.shop = c.shop
     group by c.cid
  ),
  rowj as (
    select p.rn,
           json_build_object(
             'rep', json_build_object('platform', r.platform, 'shop', r.shop, 'product_id', r.product_id,
                                      'title', r.title, 'thumb_url', r.thumb_url, 'item_sku', r.item_sku),
             'n', cn.n, 'cells', cj.cells, 'mx', coalesce(m.mx, '[]'::json)) as j
      from picked p
      join rep r on r.cid = p.cid
      join cn on cn.cid = p.cid
      join cellj cj on cj.cid = p.cid
      left join mxr m on m.cid = p.cid
  ),
  shopstat as (
    select c.idx,
           (count(*) filter (where c.state = 'ok'))::int as ok,
           (count(*) filter (where c.state = 'part'))::int as part,
           (count(*) filter (where c.state = 'none'))::int as none
      from cells c join base b on b.cid = c.cid
     group by c.idx
  )
  select json_build_object(
    'shops', (select coalesce(json_agg(json_build_object('platform', platform, 'shop', shop) order by idx), '[]'::json) from shops),
    'total', (select count(*)::int from fil),
    'counts', (select json_build_object(
                 'all', count(*)::int,
                 'ok', (count(*) filter (where all_ok))::int,
                 'part', (count(*) filter (where any_part))::int,
                 'none', (count(*) filter (where any_none))::int,
                 'price', (count(*) filter (where any_pd))::int) from base),
    'per_shop', (select coalesce(json_agg(json_build_object('ok', ok, 'part', part, 'none', none) order by idx), '[]'::json) from shopstat),
    'no_sku', (select count(*)::int from nodes where id not in (select id from sk_all)),
    'hidden_out', (select count(distinct id)::int from sk_all where id not in (select id from sz)),
    'rows', (select coalesce(json_agg(j order by rn), '[]'::json) from rowj)
  );
$$;

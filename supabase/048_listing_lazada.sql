-- ให้หน้า /product เห็นร้าน Lazada — รันต่อจาก 047
--
-- 034 เขียนรายชื่อร้านไว้เฉพาะ shopee กับ tiktok (ThisShop ต่อท้ายเองที่หน้าเว็บ)
-- ร้าน Lazada เลยไม่ขึ้นแถบร้านและเลือกไม่ได้ แก้โดยเพิ่ม 'lazada' ในสองฟังก์ชันที่คัดร้าน
-- (ลำดับแถบ: Shopee ก่อน แล้วตามด้วยชื่อแพลตฟอร์ม/ร้านตามตัวอักษร เหมือนเดิม)

create or replace function os_listing_shops() returns json language sql stable as $$
  select json_build_object(
    'shops', coalesce((
      select json_agg(json_build_object('platform', t.platform, 'shop', t.shop,
               'n', (select count(*) from os_listings l where l.platform = t.platform and l.shop = t.shop))
             order by (t.platform = 'shopee') desc, t.platform, t.shop)
        from os_shop_tokens t where t.platform in ('shopee', 'tiktok', 'lazada')), '[]'::json),
    'thisshop_n', (select count(*) from os_listings where platform = 'thisshop' and shop = 'THISSHOP')
  );
$$;

create or replace function os_listing_pick_shop(p_platform text, p_shop text, out platform text, out shop text)
language plpgsql stable as $$
begin
  if p_platform = 'thisshop' then platform := 'thisshop'; shop := 'THISSHOP'; return; end if;
  if exists (select 1 from os_shop_tokens t where t.platform = p_platform and t.shop = p_shop) then
    platform := p_platform; shop := p_shop; return;
  end if;
  select t.platform, t.shop into platform, shop from os_shop_tokens t
   where t.platform in ('shopee', 'tiktok', 'lazada') order by (t.platform = 'shopee') desc, t.platform, t.shop limit 1;
end;
$$;

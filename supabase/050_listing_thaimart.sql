-- ร้าน Thaimart (Solid Sports) ให้ขึ้นในหน้า /product และ /allsite — รันต่อจาก 049
--
-- Thaimart ไม่มี API สาธารณะและไม่มีแถวใน os_shop_tokens ส่วนขยาย Chrome (extensions/thaimart-stock)
-- ส่งรายการสินค้าเข้า os_listings เป็น platform='thaimart', shop='SOLID' ทุกรอบที่กดอัปเดตคลัง
-- (ดู app/api/thaimart/listings) ฟังก์ชันคัดร้านเดิมรู้จักแค่ shopee/tiktok/lazada เลยต้องเพิ่ม 'thaimart'
--
-- ส่วน /allsite (os_st_on_refresh, os_allsite_page) ไม่ผูกกับแพลตฟอร์ม ใช้ os_listing_skus ตรงๆ ไม่ต้องแก้

create or replace function os_listing_shops() returns json language sql stable as $$
  with s as (
    select platform, shop from os_shop_tokens where platform in ('shopee', 'tiktok', 'lazada', 'thaimart')
    union
    -- ร้านที่มีสินค้าแต่ไม่มีโทเคน (ไม่รวม ThisShop ที่หน้าเว็บต่อท้ายเอง)
    select distinct platform, shop from os_listings where platform in ('shopee', 'tiktok', 'lazada', 'thaimart')
  )
  select json_build_object(
    'shops', coalesce((
      select json_agg(json_build_object('platform', s.platform, 'shop', s.shop,
               'n', (select count(*) from os_listings l where l.platform = s.platform and l.shop = s.shop))
             order by (s.platform = 'shopee') desc, s.platform, s.shop)
        from s), '[]'::json),
    'thisshop_n', (select count(*) from os_listings where platform = 'thisshop' and shop = 'THISSHOP')
  );
$$;

create or replace function os_listing_pick_shop(p_platform text, p_shop text, out platform text, out shop text)
language plpgsql stable as $$
begin
  if p_platform = 'thisshop' then platform := 'thisshop'; shop := 'THISSHOP'; return; end if;
  if exists (select 1 from os_shop_tokens t where t.platform = p_platform and t.shop = p_shop)
     or exists (select 1 from os_listings l where l.platform = p_platform and l.shop = p_shop) then
    platform := p_platform; shop := p_shop; return;
  end if;
  select t.platform, t.shop into platform, shop from os_shop_tokens t
   where t.platform in ('shopee', 'tiktok', 'lazada') order by (t.platform = 'shopee') desc, t.platform, t.shop limit 1;
end;
$$;

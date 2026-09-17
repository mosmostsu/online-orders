-- ข้อมูลตะกร้า (สินค้าหนึ่งลิงก์) — รูปปก + ชื่อ — รันต่อจาก 018
--
-- ข้อมูลออเดอร์มีแค่รูปของตัวเลือกสี/ไซส์ (sku_image) ไม่มีรูปปกของตะกร้า
-- หน้ารวมตามตะกร้าเลยได้รูปของตัวเลือกใดตัวหนึ่งมาแทน ซึ่งมักไม่ใช่รูปที่ลูกค้าเห็นหน้าร้าน
-- รูปปกต้องถาม Product API ทีละตะกร้า จึงดึงเก็บไว้ตอนรอบดึงยอดเงิน ไม่ถามตอนเปิดหน้า

create table if not exists os_products (
  platform    text not null,
  product_id  text not null,
  title       text,
  cover_url   text,        -- รูปปกขนาดเต็ม
  thumb_url   text,        -- รูปปกขนาดย่อ ใช้ในตาราง
  status      text,
  synced_at   timestamptz not null default now(),
  primary key (platform, product_id)
);

alter table os_products enable row level security;

-- ตะกร้าที่ยังไม่มีข้อมูล หรือข้อมูลเก่าเกิน 7 วัน (ลิงก์รูปของแพลตฟอร์มมีลายเซ็น อาจหมดอายุ)
-- เอาตะกร้าที่ขายเยอะก่อน — คนเปิดดูหน้ารายสินค้าเห็นพวกนี้ก่อนเสมอ
create or replace function os_products_todo(p_platform text, p_limit int default 40)
returns json language sql stable as $$
  select coalesce(json_agg(x.product_id), '[]'::json)
    from (
      select m.product_id
        from os_money_items m
        left join os_products p on p.platform = m.platform and p.product_id = m.product_id
       where m.platform = p_platform
         and m.product_id is not null
         and (p.product_id is null or p.synced_at < now() - interval '7 days')
       group by m.product_id
       order by sum(m.qty) desc nulls last
       limit p_limit
    ) x;
$$;

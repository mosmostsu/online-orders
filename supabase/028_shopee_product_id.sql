-- แก้ "รวมตามตะกร้า" ของ Shopee แยกทุกสี/ไซส์เป็นคนละตะกร้า — รันต่อจาก 027
--
-- os_money_itemize_tx (018) อ่าน i.raw->>'product_id' ตรงๆ ซึ่งเป็นชื่อฟิลด์ที่มีแค่ใน
-- ก้อนดิบของ TikTok เท่านั้น ก้อนดิบของ Shopee (จาก order/get_order_detail — ดู lib/shopee.js
-- normalizeOrder) เก็บรหัสตะกร้า/ลิงก์สินค้าไว้ในฟิลด์ item_id แทน ไม่มี product_id เลย
-- ผลคือทุกแถวของ Shopee ได้ product_id = null หมด → หน้ารายสินค้าเลยแยกทุกสี/ไซส์เป็น
-- คนละ "ตะกร้า" (ใช้ 'sku:'||sku แทนเมื่อไม่มี product_id — ดู os_money_by_product) ทั้งที่
-- จริงๆเป็นตัวเลือกในลิงก์สินค้าเดียวกัน

create or replace function os_money_itemize_tx(p_platform text, p_tx_id text) returns void
language plpgsql as $$
declare
  t os_money_tx;
begin
  select * into t from os_money_tx where platform = p_platform and tx_id = p_tx_id;
  if not found then return; end if;

  -- เขียนใหม่ทั้งชุดทุกครั้ง — แพลตฟอร์มอาจแก้ยอดของรายการเดิม
  delete from os_money_items where platform = t.platform and tx_id = t.tx_id;

  -- รายการปรับปรุงที่ไม่ผูกกับออเดอร์ ไม่มีสินค้าให้แตก
  if t.order_id is null then return; end if;

  insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id, sku, product_id,
                              product_name, variant, image_url, qty, gross, seller_discount, charges,
                              settlement, matched)
  with lines as (
    select row_number() over (order by i.id)::int as line_no,
           i.sku,
           -- TikTok เก็บที่ product_id · Shopee เก็บที่ item_id (คนละชื่อ คนละก้อนดิบ)
           coalesce(nullif(i.raw->>'product_id', ''), nullif(i.raw->>'item_id', '')) as product_id,
           i.product_name, i.variant, i.image_url, i.qty,
           -- line item ของ TikTok เป็นราคาต่อชิ้น คูณจำนวนก่อนใช้เป็นน้ำหนัก
           coalesce(nullif(i.raw->>'original_price', '')::numeric, i.price, 0) * i.qty  as w_gross,
           coalesce(nullif(i.raw->>'seller_discount', '')::numeric, 0) * i.qty          as w_disc,
           coalesce(nullif(i.raw->>'sale_price', '')::numeric, i.price, 0) * i.qty      as w_sale
      from os_orders o
      join os_order_items i on i.order_ref = o.id
     where o.platform = t.platform and o.shop = t.shop and o.order_id = t.order_id
  ), tot as (
    select sum(w_gross) as g, sum(w_disc) as d, sum(w_sale) as s, count(*) as n from lines
  ), shares as (
    select l.*,
           case when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_sale,
           case when tot.g > 0 then l.w_gross / tot.g
                when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_gross,
           case when tot.d > 0 then l.w_disc / tot.d
                when tot.s > 0 then l.w_sale / tot.s else 1.0 / tot.n end as s_disc
      from lines l cross join tot
  )
  select t.platform, t.tx_id, line_no, t.shop, t.statement_at, t.order_id, sku, product_id,
         product_name, variant, image_url, qty,
         round(t.gross * s_gross, 2),
         round(t.seller_discount * s_disc, 2),
         round((t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         round(t.gross * s_gross + t.seller_discount * s_disc
               + (t.settlement - t.gross - t.seller_discount) * s_sale, 2),
         true
    from shares;

  -- หาสินค้าไม่เจอ — ยังเก็บยอดไว้ในถัง "ไม่ทราบสินค้า" จะได้รู้ว่าหลุดไปเท่าไร
  if not found then
    insert into os_money_items (platform, tx_id, line_no, shop, statement_at, order_id,
                                gross, seller_discount, charges, settlement, matched)
    values (t.platform, t.tx_id, 0, t.shop, t.statement_at, t.order_id,
            t.gross, t.seller_discount, t.settlement - t.gross - t.seller_discount, t.settlement, false);
  end if;
end;
$$;

-- ย้อนแก้ข้อมูล Shopee ที่มีอยู่แล้ว (โดยเฉพาะที่เพิ่งดึงย้อนหลังมา) ให้ product_id ถูกต้อง
-- itemize_tx ลบแล้วสร้างใหม่ทั้งชุดต่อ tx_id เดิม ไม่ทำให้ยอดเข้าจริงเพี้ยน แค่แก้การจัดกลุ่มตะกร้า
select count(*) as reitemized from (
  select os_money_itemize_tx(platform, tx_id) from os_money_tx where platform = 'shopee'
) x;

-- ตัด/คืนคลังอัตโนมัติ (lib/autoZero.js) — รันต่อจาก 057 · รันซ้ำได้
-- บันทึกทุกตัวเลือกที่ตั้งคลังเป็น 0 (หรือ "จะตั้ง" ในโหมดทดลอง) ไว้ตรวจย้อนหลัง
-- กันยิงซ้ำ: ตัวเลือกเดิม + ไฟล์ ST รอบเดียวกัน ตัดสำเร็จแล้วและยังไม่คืน ไม่ตัดอีก
-- คืนคลัง (ลูกค้ายกเลิกก่อนเรากดจัดส่ง) ทำเฉพาะแถวที่ตัดไปเองในไฟล์ ST รอบเดียวกัน แล้วเติม restored_*

create table if not exists os_auto_zero (
  id          bigserial primary key,
  sku         text not null,           -- รหัสตาม os_st
  platform    text not null,
  shop        text not null,
  product_id  text not null,
  sku_id      text not null,           -- Shopee: model_id (ไม่มีตัวเลือก = item_id) · TikTok: sku id
  st_file_at  timestamptz not null,    -- เวลาไฟล์ ST ที่ใช้คิด
  st_qty      int,
  to_ship     int,                     -- ออเดอร์รอส่งที่เข้ามาหลังไฟล์ ST
  remaining   int,
  from_order  text,                    -- ออเดอร์ที่ทำให้ตัด
  dry_run     boolean not null default false,
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);

alter table os_auto_zero add column if not exists variant      text;
alter table os_auto_zero add column if not exists restored_at  timestamptz;
alter table os_auto_zero add column if not exists restored_qty int;
alter table os_auto_zero add column if not exists restored_by  text;   -- ออเดอร์ที่ยกเลิกแล้วทำให้คืน

create index if not exists os_auto_zero_dedupe_idx on os_auto_zero (platform, shop, sku_id, st_file_at);
create index if not exists os_auto_zero_sku_idx on os_auto_zero (sku, st_file_at);
create index if not exists os_auto_zero_created_idx on os_auto_zero (created_at desc);

alter table os_auto_zero enable row level security;

-- คงเหลือสดๆ ต่อรหัส — คิดจบในคำสั่งเดียว เทียบรหัสแบบไม่สนตัวพิมพ์เล็กใหญ่ทั้ง ST และออเดอร์
-- คงเหลือ = os_st.qty − ชิ้นในออเดอร์ทุกร้านที่สั่งหลัง p_since (เวลาไฟล์ ST) และ "กินของแล้ว"
--   กินของ = ทุกสถานะ ยกเว้น unpaid และยกเลิกที่จบแล้ว (Shopee IN_CANCEL ยังนับ — ร้านยังไม่อนุมัติ)
--   ต้องตรงกับ consumes() ใน lib/autoZero.js
-- รหัสที่ไม่อยู่ใน os_st ไม่คืนแถว
create index if not exists os_order_items_sku_lower_idx on os_order_items (lower(sku));
create index if not exists os_st_sku_lower_idx on os_st (lower(sku));

create or replace function os_auto_zero_remaining(p_skus text[], p_since timestamptz)
returns table (req text, st_sku text, st_qty int, sold int)
language sql stable as $$
  select r.req, st.sku, floor(st.qty)::int,
         coalesce((
           select sum(i.qty)::int
             from os_order_items i
             join os_orders o on o.id = i.order_ref
            where lower(i.sku) = lower(st.sku)
              and o.ordered_at > p_since
              and o.status <> 'unpaid'
              and not (o.status = 'cancelled' and coalesce(o.raw_status, '') <> 'IN_CANCEL')
         ), 0)
    from unnest(p_skus) as r(req)
    cross join lateral (
      select s.sku, s.qty from os_st s
       where lower(s.sku) = lower(r.req)
       order by (s.sku = r.req) desc
       limit 1
    ) st;
$$;

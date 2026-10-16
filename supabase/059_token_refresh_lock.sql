-- ล็อกต่ออายุโทเคนต่อร้าน (lib/tokens.js usableToken) — รันต่อจาก 058 · รันซ้ำได้
-- refresh_token ของ Shopee ใช้ได้ครั้งเดียว ถ้า 2 คำขอต่ออายุพร้อมกัน ฝั่งหนึ่งได้โทเคนเสีย
-- และอาจเขียน refresh_token เก่าทับของใหม่ → ร้านต้องกดอนุญาตใหม่
-- จองสิทธิ์แบบ compare-and-swap: ได้แถวคืน = เราเป็นคนต่ออายุ · ไม่ได้ = มีคนอื่นกำลังต่ออยู่
-- ล็อกหมดเองหลัง p_seconds กันค้างถ้าฟังก์ชันตายกลางทาง
-- กันได้แค่ฝั่งเว็บ — โน้ตบุ๊ก Colab ต่ออายุ TikTok เองไม่ผ่านล็อกนี้

alter table os_shop_tokens add column if not exists refreshing_until timestamptz;

create or replace function os_token_claim_refresh(p_id bigint, p_seconds int default 30)
returns setof os_shop_tokens
language sql
as $$
  update os_shop_tokens
     set refreshing_until = now() + make_interval(secs => p_seconds)
   where id = p_id
     and (refreshing_until is null or refreshing_until < now())
  returning *;
$$;

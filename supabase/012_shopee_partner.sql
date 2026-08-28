-- รองรับหลายแอปของ Shopee — รันต่อจาก 011
-- ร้าน SOLID กับ REAL เป็นคนละแอป (partner คนละตัว) ไม่ใช่แอปเดียวผูกสองร้าน
-- จึงต้องเก็บว่าร้านไหนใช้แอปไหน ไม่งั้นเซ็นคำขอด้วยกุญแจผิดตัว

alter table os_shop_tokens add column if not exists partner_id  text;
alter table os_shop_tokens add column if not exists partner_key text;

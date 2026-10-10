# Thaimart Stock Sync (ส่วนขยาย Chrome)

อัปเดตคลังร้าน **Solid Sports** บน Thaimart จาก ST เมื่อกดปุ่มในส่วนขยาย (ไม่มีรอบอัตโนมัติ) — แบบเดียวกับ `extensions/mvp-stock`

Thaimart ไม่มี API สาธารณะ แต่หน้า Seller Center เรียก API หลังบ้าน `seller-bff.marketplus.dev/api/v1` ด้วยคุกกี้ `accessToken`
ส่วนขยายเรียกชุดเดียวกันจากในแท็บที่ล็อกอินค้างไว้ (ไม่เก็บโทเคนที่ไหน)

คำขอที่ใช้ (พิสูจน์แล้ว 2026-10-10):
- `GET /seller/products?page=N&limit=100` — สินค้าทั้งร้านพร้อม `variants[].sku/quantity`
- `GET /shops/products/{id}` — GET สดก่อนแก้ทุกตะกร้า
- `PUT /shops/products/{id}` — body `{product:{status,name,description,categoryPath,requiredCompliances,images,dimensions,options,variants[]}}`
  ต้องส่งทั้งก้อน (ไม่ใช่เฉพาะสต็อก) · `price` เป็นสตริง · `dimensions` เอาจาก `variants[0].dimensions`

จำนวนมาจาก `POST /api/mvp/stock` ของเว็บ order-sync (กุญแจเดียวกับ MVP: `MVP_STOCK_KEY`):
**ST − ออเดอร์รอส่งที่สั่งหลังไฟล์ ST** (ติดลบ = 0) — SKU ที่ไม่มีใน ST คงค่าเดิม
ผลแต่ละรอบส่งเข้า Telegram ผ่าน `POST /api/mvp/report` (ชื่อร้านใช้ `label`)

## ติดตั้ง (ครั้งเดียว)

1. เปิด Chrome **โปรไฟล์ที่ล็อกอิน seller.thaimart.com** → `chrome://extensions` → เปิด Developer mode
2. Load unpacked → เลือกโฟลเดอร์นี้ (`extensions/thaimart-stock`)
3. กดไอคอนส่วนขยาย → ตั้งค่า → วางกุญแจ (ค่าเดียวกับ `MVP_STOCK_KEY` ที่ Netlify) → บันทึก
4. **รอบแรก** ติ๊ก "ครั้งแรก/ยอมให้เปลี่ยนเกินครึ่ง" — เลขสต็อกที่ลงไว้ตอนนำเข้าเป็นเลขจาก TikTok จึงต่างจาก ST เยอะ

## เงื่อนไข / ข้อจำกัด

- ต้องล็อกอิน Seller Center ค้างไว้ ถ้าหลุด รอบนั้นหยุดและแจ้งเตือน
- ไม่ทำงานถ้า: ร้านไม่ใช่ Solid Sports · ไฟล์ ST เก่าเกิน 48 ชม. · จะเปลี่ยนเกินครึ่งของตัวเลือก (ถ้าไม่ติ๊กครั้งแรก)
- **ออเดอร์ของ Thaimart เอง ยังไม่ถูกหักจากสูตร** (order-sync ยังไม่ดึงออเดอร์ Thaimart) ระหว่างวันที่มีคนสั่งบน Thaimart เลขจะไม่ลดจนกว่า ST รอบถัดไปจะสะท้อน
- ตัวเลือกที่เติมให้ครบคู่สี×ไซส์ตอนนำเข้า (สต็อก 0) ถ้ามี SKU ใน ST จะถูกตั้งตาม ST ตามปกติ
- ทุกรอบส่งรายการสินค้าทั้งร้านเข้า `POST /api/thaimart/listings` → หน้า `/product` และ `/allsite` แสดงร้าน Thaimart (SOLID) · ต้องรัน `supabase/050` ก่อน

## ถ้าพัง

คำขอพวกนี้ Thaimart ไม่ได้รับรองเป็น API สาธารณะ ถ้าหน้าเว็บ/หลังบ้านเปลี่ยนอาจใช้ไม่ได้
รายละเอียดคำขออยู่หัวไฟล์ `background.js`

# Samchai Tools (portal)

เว็บสถิตล้วน (HTML/CSS/JS ไม่มี framework) แยกจากแอป order-sync ที่ root — Netlify: Base directory = `portal`, Publish = `.`, ไม่มี build command

- `apps.json` — รายการแอป/หมวด (ใส่ `url`, `beta`, `roles`) แอปที่ `url` ว่างจะขึ้นจางและกดไม่ได้
- `firebase-config.js` — ใส่ค่า Firebase web config; เปิด Google ใน Authentication และเพิ่ม domain Netlify ใน Authorized domains
- `firestore.rules` — คัดลอกไปวางใน Firestore Rules; allowlist = เอกสาร `users/<อีเมลพิมพ์เล็ก>` มีฟิลด์ `name`, `role` (staff | manager | finance)
- ดูตัวอย่างในเครื่องโดยไม่ล็อกอิน (เฉพาะ localhost เมื่อยังไม่ตั้ง Firebase): `?role=staff` ดูมุมมองพนักงาน

หมายเหตุ: ซ่อนหมวดตาม role เป็นแค่ฝั่งหน้าจอ แอปปลายทางต้องคุมสิทธิ์ของตัวเองด้วย

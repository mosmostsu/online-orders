-- ของคืน: จำว่ากล่องไหนส่งเป็นไฟล์ Seniorsoft ไปแล้ว — กันนำเข้าสต็อกซ้ำ · รันต่อจาก 069 · รันซ้ำได้
-- ปุ่ม "💾 ไฟล์ Seniorsoft" บนหน้า /returns เอากล่องที่รับแล้วแต่ ss_at ยังว่าง แล้วจดเวลาลงตรงนี้หลังบันทึกไฟล์
alter table os_returns add column if not exists ss_at timestamptz;

-- กล่องที่รับก่อนมีปุ่มนี้ (ประวัติจาก BigSeller + ที่ยิงรับไปแล้ว) ถือว่าเข้า Seniorsoft ไปแล้ว ไม่ต้องส่งซ้ำ
update os_returns set ss_at = coalesce(received_at, now()) where recv is not null and ss_at is null;

create index if not exists os_returns_ss_pending on os_returns (received_at) where recv is not null and ss_at is null;

-- หน้ารอบจัดส่ง (/round): ผลเช็ค R02.102 ต่อวัน — เดิมจำในเบราว์เซอร์เครื่องเดียว ย้ายมาเก็บที่นี่ให้ทุกเครื่องเห็น · รันซ้ำได้
--   lines = ใบยิงออก OSVS ของวันนั้น (อ่านจากไฟล์ในเบราว์เซอร์ ดู lib/r02.js) [{ doc, at, platform, cust, sku, name, qty }]
--   fix   = แก้ทีละใบ/ทีละตัว { เลขใบ | "เลขใบ#sku": 'skip' | 'แพลตฟอร์ม' | 'แพลตฟอร์ม|รอบ' | '|รอบ' }
--   merge = รอบที่ติ๊ก "ยิงปนกัน" { รอบ: true } · subs = ส่งของแทน [{ n, platform, from, to, qty }]
-- เขียนผ่าน /api/round/r02 (service key) เท่านั้น
create table if not exists os_round_r02 (
  day         date primary key,              -- วันตามเวลาไทย
  file        text,                          -- ชื่อไฟล์ที่อัป
  uploaded_at timestamptz,
  lines       jsonb not null default '[]'::jsonb,
  fix         jsonb not null default '{}'::jsonb,
  merge       jsonb not null default '{}'::jsonb,
  subs        jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table os_round_r02 enable row level security;

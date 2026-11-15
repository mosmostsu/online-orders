-- หน้า Studio (/studio) — วางแผนคลิป · คิวตัด · งานถ่ายฟุต · วันนี้โพสต์ · รันต่อจาก 066 · รันซ้ำได้
-- เขียนผ่าน /api/studio เท่านั้น (ต้องปลดล็อก SALES_PIN) · ฟุตเทจจริงอยู่ Google Drive โฟลเดอร์ "ฟุตเทจแยกสินค้า"
-- ตารางนี้ไม่เกี่ยวกับสต็อก/บัญชีจอง

create extension if not exists pgcrypto;

create table if not exists os_studio_clips (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  slot        int  not null default 0,
  shop        text not null default 'SOLID' check (shop in ('SOLID','REAL','MVP','PACE')),
  product     text not null,
  folder      text,                       -- "หมวด/รุ่น" ตรงกับ os_studio_folders.key
  angle       text,
  length_s    int,
  status      text not null default 'idea' check (status in ('idea','need_footage','queued','cut','approved','posted')),
  caption     text,
  hashtags    text[] not null default '{}',
  basket_url  text,                       -- ใส่เองเฉพาะคลิปนี้ (ว่าง = ใช้ตะกร้าของโฟลเดอร์ตามร้าน)
  file        text,                       -- ชื่อไฟล์ที่ตัดเสร็จใน #TTvid/คลิปพร้อมโพสต์
  note        text,                       -- ใบสั่ง AI / โน้ต
  posted_url  text,
  updated_at  timestamptz not null default now()
);
create index if not exists os_studio_clips_date_idx on os_studio_clips (date);
create index if not exists os_studio_clips_status_idx on os_studio_clips (status);

create table if not exists os_studio_shoots (
  id          uuid primary key default gen_random_uuid(),
  product     text not null,
  folder      text,
  shots       text[]    not null default '{}',
  got         boolean[] not null default '{}',
  due         date,
  done        boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- ข้อมูลเสริมของโฟลเดอร์ฟุต (จำนวนคลิป/ลิงก์ Drive นับสดจาก Drive — n กับ drive_url ที่นี่ใช้สำรองตอนอ่าน Drive ไม่ได้)
create table if not exists os_studio_folders (
  key         text primary key,
  shops       text[] not null default '{}',      -- ร้านที่ขายสินค้านี้ SOLID/REAL/MVP/PACE
  baskets     jsonb  not null default '{}'::jsonb, -- {"SOLID":{"platform":"tiktok","id":"..."},"PACE":{"url":"..."}}
  n           int    not null default 0,
  drive_url   text,
  updated_at  timestamptz not null default now()
);

alter table os_studio_clips   enable row level security;
alter table os_studio_shoots  enable row level security;
alter table os_studio_folders enable row level security;

insert into os_studio_folders (key, n, drive_url) values
  ('กางเกงบอล-ขาสั้น/FBT', 17, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/Flyhawk b511-b514', 12, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/GrandSport', 40, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/GrandSport ผ้าร่มขาสั้น', 15, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/Pegan', 1, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/Warrix', 10, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงบอล-ขาสั้น/รวมยี่ห้อ-อื่นๆ', 9, 'https://drive.google.com/drive/folders/1x4pJSG2jw8SscuFlctViOz4pOBW67gCl'),
  ('กางเกงวอร์ม/BCS ผ้าร่ม', 2, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/FBT', 4, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/FBT ผ้าร่ม', 10, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/Flyhawk b516-b517', 24, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/Flyhawk รุ่นอื่น', 1, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/GrandSport', 38, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/GrandSport ผ้าร่ม', 13, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/Warrix', 13, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('กางเกงวอร์ม/รวมยี่ห้อ-อื่นๆ', 11, 'https://drive.google.com/drive/folders/1rsMWgS-ufpJ8uEYsmVOPRYMYEcxBX353'),
  ('ถุงมือโกล/Eepro', 5, 'https://drive.google.com/drive/folders/1EdcMg_pZs93fUh2navYklTiIzSxbqEnN'),
  ('ถุงเท้า-สนับ/ถุงเท้าบอล', 7, 'https://drive.google.com/drive/folders/1SnwrGsz8jtkNF3wf57B-N73w41yJtclG'),
  ('ถุงเท้า-สนับ/ผ้าพันรัด', 1, 'https://drive.google.com/drive/folders/1SnwrGsz8jtkNF3wf57B-N73w41yJtclG'),
  ('รองเท้านักเรียน/Breaker', 5, 'https://drive.google.com/drive/folders/1npUPsi_iAEtyg4FwegwXTdIpooa9K3bS'),
  ('รองเท้านักเรียน/Popteen-Catcha', 16, 'https://drive.google.com/drive/folders/1npUPsi_iAEtyg4FwegwXTdIpooa9K3bS'),
  ('รองเท้านักเรียน/รวมรุ่น', 2, 'https://drive.google.com/drive/folders/1npUPsi_iAEtyg4FwegwXTdIpooa9K3bS'),
  ('รองเท้านักเรียน/รองเท้าอนุบาล', 3, 'https://drive.google.com/drive/folders/1npUPsi_iAEtyg4FwegwXTdIpooa9K3bS'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Breaker ฟุตซอล', 3, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/GrandSport', 4, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Pan Balancer', 8, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Pan Super Sonic', 2, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Pan Vigor X Thunder', 3, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Pan Wave II', 3, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Pan รุ่นอื่น', 26, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/Zeta', 4, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าสตั๊ด-ฟุตซอล/รวมยี่ห้อ-อื่นๆ', 9, 'https://drive.google.com/drive/folders/11qLq7iMW1Y95UZIZHv8cE03-DJvw8dGl'),
  ('รองเท้าแบดมินตัน/Pan', 4, 'https://drive.google.com/drive/folders/1sMseY5VPzREMFjlHaJsra3vZbAHLCL-u'),
  ('ลูกบอล/ฟุตบอล-ฟุตซอล', 9, 'https://drive.google.com/drive/folders/1VQrtBlZfwazng8B7mbes2F_sjmPKKQ9i'),
  ('ลูกบอล/วอลเลย์บอล', 5, 'https://drive.google.com/drive/folders/1VQrtBlZfwazng8B7mbes2F_sjmPKKQ9i'),
  ('อุปกรณ์อื่นๆ/รวม', 3, 'https://drive.google.com/drive/folders/149ziHzXbmKlqhauLrTvQ5-IROLlAa5b1'),
  ('อุปกรณ์อื่นๆ/ว่ายน้ำ', 1, 'https://drive.google.com/drive/folders/149ziHzXbmKlqhauLrTvQ5-IROLlAa5b1'),
  ('เสื้อวอร์ม-แทร็คสูท/GrandSport', 7, 'https://drive.google.com/drive/folders/1hT27vwRyDz9r0xx-mB7YwUKf0Wx4VEnD'),
  ('เสื้อวอร์ม-แทร็คสูท/Warrix', 2, 'https://drive.google.com/drive/folders/1s0tRDeTlvgktHQkOhvAvwFgzJZba0mso'),
  ('เสื้อโปโล-เสื้อกีฬา/GrandSport', 9, 'https://drive.google.com/drive/folders/1yXShj74Ltz8LK0Q5XZgTmCZKAr2yQLWc'),
  ('เสื้อโปโล-เสื้อกีฬา/Pegan โปโล', 2, 'https://drive.google.com/drive/folders/1yXShj74Ltz8LK0Q5XZgTmCZKAr2yQLWc'),
  ('เสื้อโปโล-เสื้อกีฬา/Warrix เสื้อเชียร์ทีมชาติไทย', 6, 'https://drive.google.com/drive/folders/1yXShj74Ltz8LK0Q5XZgTmCZKAr2yQLWc'),
  ('เสื้อโปโล-เสื้อกีฬา/Warrix โปโล', 4, 'https://drive.google.com/drive/folders/1yXShj74Ltz8LK0Q5XZgTmCZKAr2yQLWc'),
  ('เสื้อโปโล-เสื้อกีฬา/รวมยี่ห้อ-อื่นๆ', 3, 'https://drive.google.com/drive/folders/1yXShj74Ltz8LK0Q5XZgTmCZKAr2yQLWc'),
  ('ไม้แบด-ปิงปอง/ไม้ปิงปอง GrandSport', 8, 'https://drive.google.com/drive/folders/1PQNY01Ltb_BZ7vRLL_KicejtfLGLRm4b'),
  ('ไม้แบด-ปิงปอง/ไม้ปิงปอง อื่นๆ', 3, 'https://drive.google.com/drive/folders/1PQNY01Ltb_BZ7vRLL_KicejtfLGLRm4b'),
  ('ไม้แบด-ปิงปอง/ไม้แบด GrandSport', 9, 'https://drive.google.com/drive/folders/1PQNY01Ltb_BZ7vRLL_KicejtfLGLRm4b')
on conflict (key) do nothing;

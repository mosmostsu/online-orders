-- คลิป TikTok ของช่อง Solid/Meta ที่ดึงจาก Display API (video.list) — ให้หน้า /video ใช้ (ดู lib/tiktok-display.js)
-- โทเคนของแต่ละบัญชีเก็บใน os_shop_tokens เดิม (platform = 'tiktok_display', shop = 'solid' | 'meta') ไม่ต้องสร้างตารางใหม่
-- รันใน Supabase SQL Editor ต่อจาก 044

create table if not exists os_videos (
  account       text not null,                    -- solid_sports_ | meta_sports_
  video_id      text not null,                    -- id คลิปของ TikTok (ตัวเลขเดียวกับใน URL)
  uploaded_date date not null,                    -- วันที่ลง (เวลาไทย)
  created_at    timestamptz not null,             -- เวลาที่ลงจริง (create_time)
  caption       text not null default '',
  link          text,
  duration      int,
  metrics       jsonb,                            -- {views, likes, comments, shares}
  fetched_at    timestamptz not null default now(),
  primary key (account, video_id)
);

create index if not exists os_videos_date_idx on os_videos (uploaded_date desc);

-- เว็บอ่าน/เขียนผ่าน service_role ฝั่งเซิร์ฟเวอร์เท่านั้น — เปิด RLS ไว้ไม่ให้ anon key อ่านได้
alter table os_videos enable row level security;

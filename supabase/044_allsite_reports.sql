-- รายงานที่บันทึกไว้ของหน้า /allsite/report — รันต่อจาก 043
--
-- เดิมรายการที่เลือกกับแถวที่ไฮไลต์อยู่แค่ในเบราว์เซอร์เครื่องนั้น (localStorage) คนอื่นมาเช็คต่อไม่ได้
-- บันทึกเป็นรายงาน = ได้ลิงก์ /allsite/report?id=... ใครเปิดก็เห็นรายการเดียวกัน
-- done = แถวที่ติ๊ก "ทำแล้ว" (รุ่น+สี = ชื่อรุ่น+สี · แยกไซส์ = รหัส SKU) ทุกคนเห็นร่วมกัน

create table if not exists os_allsite_reports (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  skus       text[] not null default '{}',
  done       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists os_allsite_reports_updated_idx on os_allsite_reports (updated_at desc);
alter table os_allsite_reports enable row level security;

-- ติ๊ก/เอาติ๊กออกทีละแถวแบบไม่ทับกัน — สองคนติ๊กพร้อมกันคนละแถว ได้ครบทั้งคู่
-- (ถ้าเขียน done ทั้งก้อนจากหน้าเว็บ คนที่บันทึกทีหลังจะลบของอีกคนทิ้ง)
create or replace function os_report_mark(p_id uuid, p_key text, p_on boolean) returns text[]
language sql as $$
  update os_allsite_reports
     set done = case when p_on then array(select distinct unnest(done || p_key))
                     else array_remove(done, p_key) end,
         updated_at = now()
   where id = p_id
  returning done;
$$;

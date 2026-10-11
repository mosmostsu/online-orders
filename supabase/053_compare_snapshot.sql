-- ผลสำเร็จรูปของหน้า /compare — รันต่อจาก 051/052
--
-- ปัญหา: ทุกครั้งที่กดชุดตัวกรองใหม่ (ยี่ห้อ ชิป หน้า 2 ...) ฐานข้อมูลคำนวณรวมตะกร้าทั้งกลุ่มใหม่ ~4-6 วินาที
-- ทางแก้: คำนวณ "ทั้งกลุ่ม" ครั้งเดียวต่อ (กลุ่ม, เกณฑ์ %, ซ่อน SKU, ซ่อนตะกร้า) เก็บไว้ในตารางนี้
--   หน้าเว็บอ่านก้อนเดียวแล้วกรอง/แบ่งหน้า/นับยี่ห้อเองในเซิร์ฟเวอร์ (ไม่กี่ร้อยมิลลิวินาที)
--   ถ้าก้อนเก่ากว่า 20 นาที หน้าเว็บสั่งสร้างใหม่ให้เบื้องหลัง (ผู้ใช้ได้ก้อนเก่าไปก่อน)
--   ปุ่ม "ดึงข้อมูลใหม่" / ↻ รายแถว ลบก้อนทิ้ง → คนถัดไปสร้างใหม่
--
-- ใช้ os_compare_page เดิมคำนวณ (p_size ใหญ่ = ทุกแถว ไม่กรอง) จึงต้องให้แต่ละแถวมี 'brand' ด้วย (ส่วนแรกของไฟล์นี้)

-- 1) ใส่ยี่ห้อต่อแถวใน os_compare_page — แก้ฟังก์ชันที่มีอยู่ ถ้าหาข้อความไม่เจอจะ error ไม่แก้เงียบๆ
do $$
declare r record; d2 text; n int := 0;
begin
  for r in select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = 'os_compare_page' loop
    if r.d like '%''brand'', bb.brand%' then
      n := n + 1;
      continue;
    end if;
    d2 := regexp_replace(r.d, 'left\s+join\s+mxr\s+m\s+on\s+m\.cid\s*=\s*p\.cid',
                         'left join mxr m on m.cid = p.cid left join base bb on bb.cid = p.cid');
    d2 := regexp_replace(d2, '''n'',\s*cn\.n,', '''brand'', bb.brand, ''n'', cn.n,');
    if d2 like '%''brand'', bb.brand%' and d2 like '%left join base bb%' then
      execute d2;
      n := n + 1;
    else
      raise exception 'แก้ os_compare_page ไม่สำเร็จ (ไม่พบ rowj/mxr ที่คาดไว้) — รัน 051/052 แล้วหรือยัง?';
    end if;
  end loop;
  if n = 0 then raise exception 'ไม่พบฟังก์ชัน os_compare_page — รัน 051 ก่อน'; end if;
end $$;

-- 2) ตารางเก็บผลสำเร็จรูป
create table if not exists os_compare_snap (
  grp        text    not null,
  thr        int     not null,
  hide_skus  boolean not null,
  hide_rows  boolean not null,
  built_at   timestamptz not null default now(),
  data       jsonb   not null,
  primary key (grp, thr, hide_skus, hide_rows)
);
alter table os_compare_snap enable row level security;

-- 3) สร้าง/เขียนทับผลสำเร็จรูปของหนึ่งชุด — คืนเวลาที่สร้าง
create or replace function os_compare_build(
  p_group text, p_thr int, p_hide_skus boolean, p_hide_rows boolean
) returns timestamptz
language plpgsql as $$
declare
  d json;
  t timestamptz := now();
begin
  d := os_compare_page(p_group, p_thr, 'all', '', 1, 100000, p_hide_skus, p_hide_rows, '');
  insert into os_compare_snap (grp, thr, hide_skus, hide_rows, built_at, data)
  values (p_group, p_thr, p_hide_skus, p_hide_rows, t, d::jsonb)
  on conflict (grp, thr, hide_skus, hide_rows)
  do update set built_at = excluded.built_at, data = excluded.data;
  return t;
end;
$$;

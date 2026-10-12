-- รหัสย่อของยี่ห้อ (FBT, GS, WARRIX, ...) สำหรับปุ่มยี่ห้อในหน้า /compare — รันต่อจาก 051
--
-- ชื่อยี่ห้อใน ST (os_st.brand = cf_itemgroupl1_groupname) เขียนยาว/สะกดต่างกัน
-- ตารางนี้แปลงเป็นรหัสย่อชุดเดียวกับที่ใช้ในระบบเดิม (SUPPLIER_MAP ของ samchai-invoice)
--   pattern = รูปแบบ LIKE ตัวพิมพ์เล็ก (ไม่ใส่ % = ตรงเป๊ะ) · ถ้าตรงหลายแถวใช้แถวที่ pattern ยาวสุด
--   ชื่อยี่ห้อที่ไม่ตรงกฎไหนเลย → ปุ่มโชว์ชื่อเดิมใน ST (ไม่หาย)
-- เพิ่ม/แก้ได้เองในตาราง เช่น
--   insert into os_brand_code values ('ชื่อใน st ตัวพิมพ์เล็ก', 'CODE') on conflict (pattern) do update set code = excluded.code;

create table if not exists os_brand_code (
  pattern text primary key,
  code    text not null
);
alter table os_brand_code enable row level security;

insert into os_brand_code (pattern, code) values
  ('%grand%sport%', 'GS'), ('%grandsport%', 'GS'), ('gs', 'GS'),
  ('grand marketing', 'GM'), ('gm', 'GM'),
  ('%fbt%', 'FBT'),
  ('%warrix%', 'WARRIX'), ('%วอริกซ์%', 'WARRIX'),
  ('ego', 'EGO'), ('ego %', 'EGO'), ('%ego sport%', 'EGO'),
  ('%flyhawk%', 'FH'), ('%fly hawk%', 'FH'), ('fh', 'FH'),
  ('scs', 'SCS'), ('scs %', 'SCS'),
  ('vrk', 'VRK'), ('vrk %', 'VRK'),
  ('bcs', 'BCS'), ('bcs %', 'BCS'),
  ('%mizuno%', 'MIZUNO'),
  ('%adidas%', 'ADIDAS'),
  ('pan', 'PAN'), ('pan %', 'PAN'),
  ('%wingz%', 'WINGZ'),
  ('%imane%', 'IMANE'),
  ('h3', 'H3'), ('h3 %', 'H3'),
  ('kgr', 'KGR'), ('kgr %', 'KGR'),
  ('eepro', 'EEPRO'), ('eepro %', 'EEPRO'),
  ('option', 'OPTION'), ('option %', 'OPTION'),
  ('pegan', 'PEGAN'), ('pegan %', 'PEGAN'),
  ('d-step', 'DSTEP'), ('dstep', 'DSTEP'), ('d step', 'DSTEP'),
  ('%trophy%', 'TROPHY'),
  ('%world of sport%', 'WORLDOFF')
on conflict (pattern) do nothing;

-- ปรับฟังก์ชัน os_compare_page ให้ปุ่มยี่ห้อใช้รหัสย่อ (ถ้าไม่ตรงกฎไหน ใช้ชื่อใน ST เดิม)
-- แก้เฉพาะ CTE ckb ในฟังก์ชันที่มีอยู่ — ถ้าไม่พบข้อความที่จะแก้ จะ error ไม่แก้อะไร
do $$
declare d text;
        old_ckb text := E'  ckb as (\n    select u.cid, st.brand, count(*)::int as c\n      from cu u join os_st st on lower(trim(st.sku)) = u.k\n     where st.brand is not null and btrim(st.brand) <> \'\'\n     group by u.cid, st.brand\n  ),';
        new_ckb text := E'  ckb as (\n    select u.cid, coalesce(bc.code, st.brand) as brand, count(*)::int as c\n      from cu u join os_st st on lower(trim(st.sku)) = u.k\n      left join lateral (select b.code from os_brand_code b where lower(btrim(st.brand)) like b.pattern\n                          order by length(b.pattern) desc limit 1) bc on true\n     where st.brand is not null and btrim(st.brand) <> \'\'\n     group by u.cid, coalesce(bc.code, st.brand)\n  ),';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'os_compare_page' limit 1;
  if d is null then raise exception 'ไม่พบฟังก์ชัน os_compare_page — รัน 051 ก่อน'; end if;
  if position(old_ckb in d) = 0 then raise exception 'ไม่พบข้อความ ckb เดิมในฟังก์ชัน (ฟังก์ชันถูกแก้ไปแล้ว?)'; end if;
  d := replace(d, old_ckb, new_ckb);
  execute d;
end $$;

-- หน้า Studio: เก็บลิงก์ไฟล์คลิปใน Google Drive เพื่อกด "ดูคลิป" ในหน้าได้ · รันต่อจาก 067 · รันซ้ำได้
alter table os_studio_clips add column if not exists video_url text;

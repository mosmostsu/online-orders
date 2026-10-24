'use client';
// ปุ่ม "← กลับ" ที่ย้อนไปหน้าที่กดเข้ามา (เช่น /compare พร้อมตัวกรองเดิม) แทนลิงก์ตายตัว
// ไม่รู้ว่ามาจากไหน (เปิดลิงก์ตรง / แท็บใหม่) ค่อยไป href ที่ให้มา
// NavTrack (ใส่ใน app/layout.js) จำ URL ของหน้าก่อนหน้าที่ path ต่างจากหน้านี้ไว้ใน sessionStorage
// ใช้ document.referrer ไม่ได้ — เปลี่ยนหน้าภายในเว็บ (client) referrer ไม่เปลี่ยนตาม
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const KEY = 'os_nav';   // { cur, prev, direct } — direct = หน้านี้มาจาก prev ตรง ๆ (ย้อนด้วย history ได้)

const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
const pathOf = (u) => String(u || '').split('?')[0];

export function NavTrack() {
  const path = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const url = path + (sp.toString() ? `?${sp}` : '');
    const s = read();
    if (s.cur === url) return;   // โหลดหน้าเดิมซ้ำ
    // เปลี่ยนแค่ ?query ในหน้าเดิม (เรียง/ใส่รหัส) → prev เดิม แต่ย้อน history ทีเดียวไม่ถึงแล้ว
    const next = pathOf(s.cur) === path
      ? { cur: url, prev: s.prev, direct: false }
      : { cur: url, prev: s.cur, direct: !!s.cur };
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }, [path, sp]);
  return null;
}

export default function BackLink({ href, children, ...rest }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // เปิดแท็บใหม่ = ไป href ตามปกติ
        const s = read();
        if (!s.prev || pathOf(s.cur) !== path) return;
        e.preventDefault();
        // ย้อน history ได้หน้าเดิมพร้อมตำแหน่งเลื่อนเดิม · ถ้ามีหน้าแทรก (เรียง/ใส่รหัส) ก็เปิด URL ก่อนหน้าตรง ๆ
        if (s.direct && window.history.length > 1) router.back();
        else router.push(s.prev);
      }}
    >
      {children}
    </Link>
  );
}

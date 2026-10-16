'use client';
// ลิงก์ที่โหลดหน้าปลายทางรอไว้ "ตอนชี้" เท่านั้น — ชี้ค้าง ~80ms (หรือแตะบนมือถือ) ค่อยสั่ง
// ไม่ใช้ prefetch ตอนเปิดหน้า เพราะเคยทำให้ยิงทุกลิงก์พร้อมกันจนเซิร์ฟเวอร์ค้าง (ดู 7fdebe8)
// ห้ามใช้กับลิงก์ที่ไปสั่งงาน (เช่น /api/compare/refresh) — การโหลดรอไว้ก็คือการเปิดลิงก์นั้นจริง
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

const DELAY = 80;

export default function HoverLink({ href, onMouseEnter, onMouseLeave, onTouchStart, onFocus, ...rest }) {
  const router = useRouter();
  const timer = useRef(null);
  const done = useRef('');   // href ที่สั่งไปแล้ว (หลังเปลี่ยนหน้าปุ่มเดิมได้ href ใหม่ ต้องสั่งใหม่)
  // 'full' = เอาข้อมูลทั้งหน้า ไม่ใช่แค่โครง loading.js (ค่าเริ่มต้นของหน้าแบบ dynamic)
  const go = () => {
    if (done.current === href) return;
    done.current = href;
    try { router.prefetch(href, { kind: 'full' }); } catch {}
  };
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => { cancel(); timer.current = setTimeout(go, DELAY); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { cancel(); onMouseLeave?.(e); }}
      onTouchStart={(e) => { go(); onTouchStart?.(e); }}
      onFocus={(e) => { go(); onFocus?.(e); }}
    />
  );
}

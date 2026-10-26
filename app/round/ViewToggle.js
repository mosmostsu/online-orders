'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

// สลับ แถว ↔ ตารางไซส์ — จำในคุกกี้ (ROUND_VIEW_COOKIE) เปิดครั้งหน้าได้แบบเดิม
export default function ViewToggle({ view, cookie }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (v) => {
    document.cookie = `${cookie}=${v}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <span className="rview" data-pending={pending ? '1' : '0'}>
      <button className="btn" data-on={view === 'rows' ? '1' : '0'} onClick={() => pick('rows')}>แถว</button>
      <button className="btn" data-on={view === 'grid' ? '1' : '0'} onClick={() => pick('grid')}>ตารางไซส์</button>
    </span>
  );
}

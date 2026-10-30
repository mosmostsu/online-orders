'use client';

// สลับ แถว ↔ ตารางไซส์ — สลับทันทีในเบราว์เซอร์ และจำในคุกกี้ (ROUND_VIEW_COOKIE) เปิดครั้งหน้าได้แบบเดิม
export default function ViewToggle({ view, cookie, onChange }) {
  const pick = (v) => {
    document.cookie = `${cookie}=${v}; path=/; max-age=31536000; samesite=lax`;
    onChange(v);
  };
  return (
    <span className="rview">
      <button className="btn" data-on={view === 'rows' ? '1' : '0'} onClick={() => pick('rows')}>แถว</button>
      <button className="btn" data-on={view === 'grid' ? '1' : '0'} onClick={() => pick('grid')}>ตารางไซส์</button>
    </span>
  );
}

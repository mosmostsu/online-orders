'use client';
import { useRouter } from 'next/navigation';

// dropdown/ช่องติ๊กที่เปลี่ยนแล้วไปลิงก์ทันที (ไม่ต้องกดปุ่มกรอง) — แบบที่ ../allsitepd ทำ
// ลิงก์ของแต่ละตัวเลือกคิดไว้แล้วฝั่งเซิร์ฟเวอร์ ส่งมาเป็น options: [{ value, label, href }]
export function NavSelect({ value, options, className }) {
  const router = useRouter();
  return (
    <select className={className} value={value}
      onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href); }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function NavCheck({ checked, href, label, className }) {
  const router = useRouter();
  return (
    <label className={className}>
      <input type="checkbox" checked={checked} onChange={() => router.push(href)} /> {label}
    </label>
  );
}

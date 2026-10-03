'use client';
// ช่องกรอง ชื่อ / SKU / แบรนด์ / หมวดหมู่ ของตาราง ALL SITE — ค้นทันทีระหว่างพิมพ์
//
// เดิมเป็นฟอร์มธรรมดา พิมพ์แล้วกด Enter = เบราว์เซอร์โหลดหน้าใหม่ทั้งหน้า (เหมือนกดรีเฟรช)
// และที่ติ๊กเลือกไว้หาย (จำแค่ในหน้า) — ตอนนี้หยุดพิมพ์ครึ่งวินาทีแล้วเปลี่ยนลิงก์แบบไม่โหลดหน้าใหม่
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const FIELDS = [
  ['nm', 'ชื่อสินค้า', 'ระบุชื่อ...'],
  ['sk', 'รหัสสินค้า (SKU)', 'ระบุ SKU...'],
  ['br', 'แบรนด์', 'กรองแบรนด์...'],
  ['ct', 'หมวดหมู่', 'กรองหมวดหมู่...'],
];
const WAIT_MS = 500;

// base = พารามิเตอร์อื่นของลิงก์ (ไม่รวมช่องกรองทั้ง 4 และเลขหน้า) · values = ค่าปัจจุบันจากลิงก์
export default function LiveFilters({ base, values }) {
  const router = useRouter();
  const [v, setV] = useState(values);
  const [pending, start] = useTransition();
  const timer = useRef(null);
  const first = useRef(true);

  // ลิงก์เปลี่ยนจากที่อื่น (เช่น dropdown หัวคอลัมน์ / ล้างทั้งหมด) — ช่องตามค่าใหม่
  const key = FIELDS.map(([k]) => values[k] || '').join('|');
  useEffect(() => { setV(values); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  function go(next) {
    const p = new URLSearchParams(base);
    for (const [k] of FIELDS) {
      const x = String(next[k] || '').trim();
      if (x) p.set(k, x); else p.delete(k);
    }
    p.delete('page');
    const s = p.toString();
    start(() => router.replace(s ? `/allsite?${s}` : '/allsite', { scroll: false }));
  }

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const same = FIELDS.every(([k]) => String(v[k] || '').trim() === String(values[k] || '').trim());
    if (same) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go(v), WAIT_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const any = FIELDS.some(([k]) => v[k]);
  return (
    <form className="ast-filters" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); go(v); }}>
      {FIELDS.map(([k, label, ph]) => (
        <label key={k}>{label}
          <input value={v[k] || ''} placeholder={ph} autoComplete="off"
            onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))} />
        </label>
      ))}
      <span className="ast-fstate">{pending ? '⏳ กำลังค้นหา…' : ''}</span>
      {any && (
        <button type="button" className="link" onClick={() => { const empty = { nm: '', sk: '', br: '', ct: '' }; setV(empty); clearTimeout(timer.current); go(empty); }}>
          ล้างช่องค้นหา
        </button>
      )}
    </form>
  );
}

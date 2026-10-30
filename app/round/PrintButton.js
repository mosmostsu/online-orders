'use client';

// พิมพ์เฉพาะหัวรอบ + ตาราง (globals.css @media print ซ่อนส่วนอื่น) ส่งให้คนจัดของ
export default function PrintButton() {
  return <button className="btn" onClick={() => window.print()}>🖨 พิมพ์ให้คนจัด</button>;
}

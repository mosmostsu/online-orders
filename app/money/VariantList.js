'use client';
import { useState } from 'react';

// ตัวเลือกสี/ไซส์ข้างในตะกร้า — โหลดตอนกดกาง ไม่ใช่ส่งมาพร้อมหน้า
//
// เดิมหน้ารายสินค้าส่งตัวเลือกของทุกตะกร้ามาด้วย (บางตะกร้า 59 ตัวเลือก) หน้าโต 1.8 MB
// ทั้งที่ส่วนใหญ่ไม่ได้กางดูสักใบ ตอนนี้เหลือ ~0.2 MB และกางทีละใบเอาข้อมูลตอนนั้น
const baht = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−฿' : '฿') + Math.abs(v).toLocaleString('en-US');
};
const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null);
const tone = (p) => (p === null ? 'dim' : p >= 65 ? 'ok' : p >= 55 ? 'warn' : 'err');

export default function VariantList({ count, pick, by, from, to, platform = 'tiktok' }) {
  const [rows, setRows] = useState(null);
  const [costs, setCosts] = useState(null);
  const [state, setState] = useState('idle');   // idle | loading | error

  async function load(e) {
    if (!e.currentTarget.open || rows || state === 'loading') return;
    setState('loading');
    try {
      const qs = new URLSearchParams({ pick, by, from, to, platform });
      const j = await fetch('/api/money/variants?' + qs).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setRows(j.variants || []);
      setCosts(j.costs || {});
      setState('idle');
    } catch {
      setState('error');
    }
  }

  return (
    <details className="fees variants" onToggle={load}>
      <summary>{count} ตัวเลือก</summary>
      {state === 'loading' && <div className="sku">กำลังโหลด...</div>}
      {state === 'error' && <div className="sku danger">โหลดตัวเลือกไม่สำเร็จ ลองกดปิดแล้วเปิดใหม่</div>}
      {rows && (
        <table className="mini">
          <tbody>
            {rows.map((v) => {
              const qty = Number(v.qty) || 0;
              const keep = pct(v.settlement, v.gross);
              const disc = pct(Math.abs(Number(v.seller_discount) || 0), v.gross);
              const c = costs?.[v.sku];
              const profit = c && qty ? Number(v.settlement) / qty - Number(c.cost) : null;
              return (
                <tr key={v.sku || '-'}>
                  <td>{v.variant || v.sku || '—'}<span className="sku"> {v.sku}</span></td>
                  <td>{qty} ชิ้น</td>
                  <td>{disc === null ? '—' : `ลด ${disc}%`}</td>
                  <td>{keep === null ? '—' : <span className={`badge ${tone(keep)}`}>{keep}%</span>}</td>
                  <td>{qty > 0 ? `เข้า ${baht(Number(v.settlement) / qty)}/ชิ้น` : '—'}</td>
                  <td>{c ? `ทุน ${baht(c.cost)}${c.est ? '*' : ''}${c.off ? ' (ลดนอกบิล)' : ''}` : 'ไม่มีทุน'}</td>
                  <td className={profit !== null && profit < 0 ? 'danger' : undefined}>
                    {profit === null ? '—' : `กำไร ${baht(profit)}/ชิ้น`}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td>ไม่มีตัวเลือกในช่วงนี้</td></tr>}
          </tbody>
        </table>
      )}
    </details>
  );
}

'use client';
// ตารางแบรนด์ที่ ThisShop ยังไม่ให้ใช้ + ปุ่มคัดลอกรายการไปส่งขอเพิ่ม
import { useEffect, useState } from 'react';

const num = (n) => Number(n || 0).toLocaleString('th-TH');

export default function BrandGaps() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true); setErr(''); setCopied(false);
    try {
      const j = await fetch('/api/clone/brand-gaps').then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setD(j);
    } catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // ข้อความสำหรับส่ง ThisShop: แบรนด์ + หมวดที่ต้องการ
  const text = d ? d.rows.map((r) => `${r.brand} — หมวด: ${r.cats.map((c) => c.name).join(', ')}`).join('\n') : '';
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 20, margin: '4px 0' }}>🏷️ แบรนด์ที่ ThisShop ยังไม่มีให้ร้านใช้</h1>
      <div className="sku" style={{ marginBottom: 12 }}>
        จากตะกร้า Shopee REAL ที่ขายอยู่และยังไม่มีใน ThisShop · เทียบชื่อแบรนด์กับรายชื่อที่ ThisShop เปิดให้ร้านใช้ในหมวดที่จับคู่ไว้ (แบบเดียวกับตอนโคลน)
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="chip" onClick={load} disabled={loading}>🔄 ตรวจใหม่</button>
        {d && d.rows.length > 0 && <button type="button" className="chip" onClick={copy}>{copied ? '✅ คัดลอกแล้ว' : '📋 คัดลอกรายการไปส่ง ThisShop'}</button>}
      </div>
      {loading && <div className="note">กำลังถาม Shopee และ ThisShop… (อาจใช้ 20-50 วินาที)</div>}
      {err && <div className="note note-danger">{err}</div>}
      {d && !loading && (
        <>
          <div className="note" style={{ marginBottom: 12 }}>
            ตะกร้าขายอยู่ {num(d.counts.live)} · มีใน ThisShop แล้ว {num(d.counts.onThisShop)} · ตรวจ {num(d.counts.checked)} ·
            แบรนด์ตรง {num(d.counts.ok)} · <b>แบรนด์ไม่มี {num(d.counts.gapProducts)} ตะกร้า ({num(d.rows.length)} แบรนด์)</b> ·
            ไม่ระบุแบรนด์ {num(d.counts.noBrand)} · หมวดยังไม่จับคู่ {num(d.counts.unmappedProducts)} ตะกร้า ({num(d.unmappedCats)} หมวด — ต้องจับคู่หมวดในหน้าโคลนก่อนถึงจะรู้)
          </div>
          {d.catErrors?.length > 0 && <div className="note note-danger">ถามแบรนด์ของ {d.catErrors.length} หมวดไม่สำเร็จ ลองกดตรวจใหม่</div>}
          {d.rows.length === 0 ? <div className="note">ไม่มีแบรนด์ที่ขาด 🎉</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: 6 }}>แบรนด์</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>ตะกร้า</th>
                  <th style={{ padding: 6 }}>หมวด ThisShop ที่ต้องขอ</th>
                  <th style={{ padding: 6 }}>ตัวอย่างสินค้า</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.brand} style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
                    <td style={{ padding: 6 }}>
                      <b>{r.brand}</b>
                      {r.elsewhere && <div className="sku">มีในหมวดอื่นแล้ว — ขอเปิดหมวดเพิ่ม</div>}
                    </td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{num(r.n)}</td>
                    <td style={{ padding: 6 }}>{r.cats.map((c) => <div key={c.id}>{c.name} <span className="sku">({num(c.n)})</span></div>)}</td>
                    <td style={{ padding: 6 }} className="sku">{r.samples.map((s, i) => <div key={i}>{s}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

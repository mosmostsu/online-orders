'use client';
// "ThisShop ขาดอะไร" ของแถวหนึ่ง (Shopee = main) — กดแล้วโชว์รายการ SKU ที่ Shopee มีแต่ ThisShop ไม่มี
// พร้อมปุ่มคัดลอก (วางลง Excel/ข้อความได้) และดาวน์โหลด CSV ไปเติมในหลังบ้าน ThisShop
// อ่านอย่างเดียว — ไม่แก้อะไรใน ThisShop (API ของ ThisShop ไม่มีวิธีเพิ่มตัวเลือกเข้าตะกร้าเดิมที่ยืนยันแล้ว)
import { useState } from 'react';

const num = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US'));

export default function MissingSkus({ shopee, thisshop, backoffice }) {
  const [st, setSt] = useState('idle');   // idle | run | ok | err
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    setSt('run'); setErr('');
    try {
      const j = await fetch(`/api/compare/missing?s=${shopee.join(',')}&t=${thisshop.join(',')}`).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || 'โหลดไม่สำเร็จ');
      setData(j); setSt('ok');
    } catch (e) { setErr(String(e.message || e)); setSt('err'); }
  }

  const lines = (data?.missing || []).map((x) => [x.sku, x.variant || '', x.price ?? '', x.stock ?? '']);
  function copy() {
    const text = ['SKU\tตัวเลือก\tราคาป้ายเต็ม\tสต็อก', ...lines.map((l) => l.join('\t'))].join('\n');
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => prompt('คัดลอกข้อความนี้', text));
  }
  function csv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [['SKU', 'ตัวเลือก', 'ราคาป้ายเต็ม', 'สต็อก'], ...lines].map((l) => l.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `thisshop-missing-${shopee[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="cmp-missing" onClick={(e) => e.stopPropagation()}>
      {st !== 'ok' && (
        <button type="button" className="chip" onClick={load} disabled={st === 'run'}>
          {st === 'run' ? '⏳ กำลังเทียบ…' : 'ดูว่า ThisShop ขาดอะไร (Shopee = main)'}
        </button>
      )}
      {st === 'err' && <span className="cl-err"> ❌ {err}</span>}
      {st === 'ok' && (
        <div className="cmp-missing-box">
          {data.missing.length === 0 ? (
            <b className="cmp-allok">ThisShop มี SKU ครบตาม Shopee แล้ว ({data.shopeeN} ตัว)</b>
          ) : (
            <>
              <div>
                <b className="danger">ThisShop ขาด {data.missing.length} SKU</b>
                <span className="sku"> จาก Shopee {data.shopeeN} ตัว · ThisShop มี {data.thisshopN} ตัว</span>
                {' '}
                <button type="button" className="chip" onClick={copy}>{copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}</button>
                {' '}
                <button type="button" className="chip" onClick={csv}>CSV</button>
                {backoffice && <> <a className="link" href={backoffice} target="_blank" rel="noreferrer">เปิดหลังบ้าน ThisShop ↗</a></>}
              </div>
              <table className="cmp-mx cmp-missing-tbl">
                <thead><tr><th>SKU</th><th>ตัวเลือก</th><th>ราคาป้ายเต็ม</th><th>สต็อก</th></tr></thead>
                <tbody>
                  {data.missing.map((x) => (
                    <tr key={x.sku}>
                      <td className="mono">{x.sku}</td><td>{x.variant || '—'}</td>
                      <td>{num(x.price) || '—'}</td>
                      <td>{x.stock === null ? '—' : num(x.stock)}{x.fromST ? '' : ' *'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sku">* = ไม่มีรหัสนี้ใน ST ใช้เลขสต็อกที่ตั้งไว้บน Shopee · ราคา = ราคาป้ายเต็ม ไม่ใช่ราคาโปร</div>
            </>
          )}
          {data.extra.length > 0 && (
            <div className="sku" style={{ marginTop: 6 }}>
              ThisShop มีเกิน {data.extra.length} SKU ที่ Shopee ไม่มี (ไม่ต้องเติม): {data.extra.map((x) => x.sku).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

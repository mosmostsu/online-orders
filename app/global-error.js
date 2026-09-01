'use client';

// หน้าจอเวลาเว็บพังทั้งหน้า — เดิมเบราว์เซอร์ขึ้นแค่ "Application error" ลอยๆ
// ซึ่งบอกไม่ได้ว่าพังเพราะอะไร ต้องเปิด console ของคอมดู ทำจากมือถือไม่ได้
// หน้านี้เอาข้อความจริงมาโชว์เลย จะได้ถ่ายรูปส่งมาแก้ได้ทันที
export default function GlobalError({ error, reset }) {
  const raw = (typeof window !== 'undefined' && window.__E) || [];
  const info = [
    error?.message ? 'ข้อความ: ' + error.message : '',
    error?.digest ? 'รหัส: ' + error.digest : '',
    error?.stack ? '\n' + String(error.stack).split('\n').slice(0, 6).join('\n') : '',
    ...raw.map((r, i) => 'ดักได้ ' + (i + 1) + ': ' + r),
  ].filter(Boolean).join('\n');

  return (
    <html lang="th">
      <body style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: 20, background: '#fff', color: '#111' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>เว็บพัง — ส่งภาพนี้ให้คนแก้</h1>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.6,
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, color: '#7f1d1d',
        }}>{info || 'ไม่มีรายละเอียด'}</pre>
        <p style={{ fontSize: 12, color: '#666' }}>
          เบราว์เซอร์: <span style={{ wordBreak: 'break-all' }}>{typeof navigator !== 'undefined' ? navigator.userAgent : '—'}</span>
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => reset()} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}>
            ลองใหม่
          </button>
          <a href="/orders?status=packed" style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #ddd', textDecoration: 'none', color: '#111' }}>
            กลับหน้าออเดอร์
          </a>
        </div>
      </body>
    </html>
  );
}

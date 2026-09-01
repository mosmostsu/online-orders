'use client';

// พังเฉพาะบางหน้า (ไม่ถึงกับพังทั้งเว็บ) — โชว์สาเหตุจริงเหมือนกัน
export default function ErrorPage({ error, reset }) {
  return (
    <div className="note note-danger">
      <b>หน้านี้โหลดไม่ขึ้น</b>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, marginTop: 6 }}>
        {[error?.message && 'ข้อความ: ' + error.message, error?.digest && 'รหัส: ' + error.digest]
          .filter(Boolean).join('\n') || 'ไม่มีรายละเอียด'}
      </pre>
      <button className="btn" onClick={() => reset()} style={{ marginTop: 8 }}>ลองใหม่</button>
    </div>
  );
}

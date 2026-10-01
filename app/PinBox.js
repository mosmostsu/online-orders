// ช่องใส่รหัส / ปุ่มล็อก ของตัวเลขยอดขาย (หน้า /summary, /money) — ฟอร์มธรรมดาส่งไป /api/sales-pin ไม่ต้องใช้ JavaScript
// รหัสเดียวกันทั้งเว็บ ใส่ที่หน้าไหนก็ปลดทุกหน้า (ดู lib/pin.js)
import { pinConfigured } from '@/lib/pin';

export default function PinBox({ unlocked, back, wrong, label = 'ดูยอดขาย' }) {
  if (unlocked) {
    return (
      <form action="/api/sales-pin" method="post" className="pinbox">
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="action" value="lock" />
        <span className="sub" style={{ margin: 0 }}>🔓 ปลดล็อกอยู่</span>
        <button className="btn" type="submit">ล็อก</button>
      </form>
    );
  }
  if (!pinConfigured()) {
    return <div className="sub" style={{ margin: 0 }}>🔒 ถูกซ่อน — ยังไม่ได้ตั้ง SALES_PIN ที่ Netlify</div>;
  }
  return (
    <form action="/api/sales-pin" method="post" className="pinbox">
      <input type="hidden" name="back" value={back} />
      <span className="sub" style={{ margin: 0 }}>🔒 ใส่รหัสเพื่อ{label}</span>
      <input name="pin" type="password" autoComplete="current-password" placeholder="รหัส" />
      <button className="btn" type="submit">ดู</button>
      {wrong && <span className="danger" style={{ fontSize: 12 }}>รหัสไม่ถูก</span>}
    </form>
  );
}

import './globals.css';

export const metadata = { title: 'order-sync — ออเดอร์รวมทุกร้าน' };

// ดักข้อผิดพลาดตั้งแต่ก่อนโค้ดหน้าเว็บเริ่มทำงาน
// ตอนพังจริง Next จะซ่อนรายละเอียดไว้หมด เหลือแค่ "Application error"
// ซึ่งอ่านจากมือถือไม่ได้เลย ตัวนี้เก็บข้อความดิบไว้ให้หน้าแจ้งพังหยิบไปโชว์
const CATCH = `
window.__E = [];
function push(s) {
  try { if (window.__E.length < 20) window.__E.push(String(s).slice(0, 400)); } catch (_) {}
}
addEventListener('error', function (e) {
  push((e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
});
addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  push('rejected: ' + ((r && (r.message || r.toString())) || String(r)));
});
// React เขียนสาเหตุจริงลง console.error ไม่ได้โยนออกมาให้ตัวดักข้างบนเห็น
// (เช่น hydration ไม่ตรงตรงไหน หรือ error ที่ถูก error boundary รับไปแล้ว)
// ไม่ดักตรงนี้ด้วย หน้าแจ้งพังจะขึ้นว่า "ไม่มีรายละเอียด" ทั้งที่มีสาเหตุอยู่
var ce = console.error;
console.error = function () {
  try {
    push('console: ' + Array.prototype.map.call(arguments, function (a) {
      if (a && a.message) return a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }).join(' '));
  } catch (_) {}
  return ce.apply(console, arguments);
};
`;

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head><script dangerouslySetInnerHTML={{ __html: CATCH }} /></head>
      <body><div className="wrap">{children}</div></body>
    </html>
  );
}

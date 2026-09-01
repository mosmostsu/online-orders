import './globals.css';

export const metadata = { title: 'order-sync — ออเดอร์รวมทุกร้าน' };

// ดักข้อผิดพลาดตั้งแต่ก่อนโค้ดหน้าเว็บเริ่มทำงาน
// ตอนพังจริง Next จะซ่อนรายละเอียดไว้หมด เหลือแค่ "Application error"
// ซึ่งอ่านจากมือถือไม่ได้เลย ตัวนี้เก็บข้อความดิบไว้ให้หน้าแจ้งพังหยิบไปโชว์
const CATCH = `
window.__E = [];
addEventListener('error', function (e) {
  window.__E.push((e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
});
addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  window.__E.push('rejected: ' + ((r && (r.message || r.toString())) || String(r)));
});
`;

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head><script dangerouslySetInnerHTML={{ __html: CATCH }} /></head>
      <body><div className="wrap">{children}</div></body>
    </html>
  );
}

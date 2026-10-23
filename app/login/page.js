// หน้าเข้าสู่ระบบ — ใส่รหัสร้าน (SITE_PIN) ครั้งเดียว เครื่องนี้จำไว้ 30 วัน (ด่านอยู่ที่ middleware.js)
// ฟอร์มธรรมดา ไม่ต้องใช้ JavaScript
export const dynamic = 'force-dynamic';
export const metadata = { title: 'เข้าสู่ระบบ — order-sync' };

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const next = String(sp?.next || '/');
  return (
    <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
      <h1 style={{ marginTop: 0 }}>order-sync</h1>
      <div className="sub">ใส่รหัสร้านเพื่อเข้าใช้งาน</div>
      <form action="/api/login" method="post" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input type="hidden" name="next" value={next} />
        <input name="pin" type="password" autoComplete="current-password" placeholder="รหัสร้าน" autoFocus style={{ flex: 1 }} />
        <button className="btn" type="submit">เข้า</button>
      </form>
      {sp?.wrong && <div className="danger" style={{ marginTop: 8, fontSize: 13 }}>รหัสไม่ถูก</div>}
    </div>
  );
}

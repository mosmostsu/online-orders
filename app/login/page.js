// หน้าใส่รหัสเข้าเว็บ — ฟอร์มธรรมดา ไม่ต้องใช้ JavaScript
export const dynamic = 'force-dynamic';
export const metadata = { title: 'เข้าสู่ระบบ — order-sync', robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const back = typeof sp?.back === 'string' ? sp.back : '/orders';
  return (
    <main style={{ maxWidth: 340, margin: '18vh auto 0', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20, marginBottom: 6 }}>order-sync</h1>
      <p className="sub" style={{ marginTop: 0 }}>ใส่รหัสเพื่อเข้าเว็บ (ใส่ครั้งเดียว เครื่องนี้จะจำไว้)</p>
      <form action="/api/site-login" method="post" style={{ display: 'flex', gap: 8 }}>
        <input type="hidden" name="back" value={back} />
        <input name="password" type="password" autoComplete="current-password" placeholder="รหัส" autoFocus required style={{ flex: 1 }} />
        <button className="btn" type="submit">เข้า</button>
      </form>
      {sp?.wrong && <p className="danger" style={{ fontSize: 13 }}>รหัสไม่ถูก</p>}
    </main>
  );
}

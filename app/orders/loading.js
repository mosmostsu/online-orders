// โผล่ทันทีตอนกดเปลี่ยนช่องทาง/สถานะ ระหว่างที่ข้อมูลกำลังมา
// ไม่งั้นหน้าจะค้างอยู่ที่เดิมเงียบๆ จนคนกดคิดว่าเว็บแฮงค์
export default function Loading() {
  return (
    <>
      <div className="row">
        <div>
          <h1>ออเดอร์รวมทุกร้าน</h1>
          <div className="sub">กำลังโหลด...</div>
        </div>
      </div>
      <div className="skeleton-tabs">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-tab" />)}
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

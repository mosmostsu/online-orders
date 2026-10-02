import Nav from '../Nav';

// โผล่ทันทีตอนเปลี่ยนตัวกรอง ระหว่างที่ข้อมูลกำลังมา
export default function Loading() {
  return (
    <>
      <Nav active="allsite" />
      <div className="row"><div><h1>ลงครบทุกร้านหรือยัง</h1><div className="sub">กำลังโหลด...</div></div></div>
      <div className="skeleton-tabs">
        {Array.from({ length: 4 }).map((_, i) => <span key={i} className="sk sk-tab" />)}
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

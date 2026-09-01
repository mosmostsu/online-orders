import Nav from '../Nav';

// โผล่ทันทีตอนเปลี่ยนช่วงเวลา/ตัวกรอง ระหว่างที่ข้อมูลกำลังมา
export default function Loading() {
  return (
    <>
      <Nav active="money" />
      <div className="row"><div><h1>เงินเข้าจริง</h1><div className="sub">กำลังโหลด...</div></div></div>
      <div className="skeleton-tabs">
        {Array.from({ length: 3 }).map((_, i) => <span key={i} className="sk sk-tab" />)}
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

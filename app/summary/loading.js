import Nav from '../Nav';

// โผล่ทันทีตอนสลับร้าน/ช่วงเวลา ระหว่างที่ข้อมูลกำลังมา
export default function Loading() {
  return (
    <>
      <Nav active="summary" />
      <div className="row"><div><h1>ยอดขายรายตะกร้า</h1><div className="sub">กำลังโหลด...</div></div></div>
      <div className="skeleton-tabs">
        {Array.from({ length: 4 }).map((_, i) => <span key={i} className="sk sk-tab" />)}
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

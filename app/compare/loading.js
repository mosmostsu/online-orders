import Nav from '../Nav';

// โผล่ทันทีตอนกดเข้า ระหว่างที่เซิร์ฟเวอร์อ่านสินค้าของร้านที่เลือก (ครั้งแรกหลังเครื่องเงียบนานอาจช้าหลายวินาที)
export default function Loading() {
  return (
    <>
      <Nav active="compare" />
      <div className="row"><div><h1>เทียบร้าน</h1><div className="sub">กำลังอ่านสินค้าของร้านที่เลือก...</div></div></div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

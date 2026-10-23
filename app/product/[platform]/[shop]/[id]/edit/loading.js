import Nav from '../../../../../Nav';

// โผล่ทันทีที่กด "แก้ไขสินค้า / เพิ่ม SKU" — หน้าแก้ไขอ่านตะกร้าสดจากร้านทุกครั้ง (2–3 วินาที) เดิมกดแล้วหน้านิ่งไม่มีอะไรบอก
export default function Loading() {
  return (
    <>
      <Nav active="product" />
      <div className="row"><div><h1>แก้ไขสินค้า</h1><div className="sub">กำลังอ่านตะกร้าสดจากร้าน...</div></div></div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

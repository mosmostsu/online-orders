import Nav from '../Nav';

export default function Loading() {
  return (
    <>
      <Nav active="round" />
      <h1>รอบจัดส่ง</h1>
      <div className="sub">กำลังโหลด…</div>
      <div className="skeleton-tabs">
        {Array.from({ length: 4 }).map((_, i) => <span key={i} className="sk sk-tab" />)}
      </div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

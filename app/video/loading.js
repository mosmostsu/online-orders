import Nav from '../Nav';

// โผล่ทันทีระหว่างรออ่านชีท
export default function Loading() {
  return (
    <>
      <Nav active="video" />
      <div className="row"><div><h1>วิดีโอ</h1><div className="sub">กำลังโหลด...</div></div></div>
      <div className="skeleton-rows">
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="sk sk-row" />)}
      </div>
    </>
  );
}

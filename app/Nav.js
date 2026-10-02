// แถบสลับหน้าหลัก — ออเดอร์ (งานประจำวัน) · สินค้า (ตะกร้าที่ลงขายของแต่ละร้าน) · ลงครบไหม (ลงครบทุกร้านหรือยัง) · ยอดขาย (ขายกี่ชิ้นต่อตะกร้า) · เงินเข้า (ยอดหลังหักค่าธรรมเนียม)
import Link from 'next/link';

const PAGES = [
  { key: 'orders', href: '/orders', label: 'ออเดอร์' },
  { key: 'product', href: '/product', label: 'สินค้า' },
  { key: 'allsite', href: '/allsite', label: 'ลงครบไหม' },
  { key: 'summary', href: '/summary', label: 'ยอดขาย' },
  { key: 'money',  href: '/money',  label: 'เงินเข้า' },
];

export default function Nav({ active }) {
  return (
    <nav className="nav">
      {PAGES.map((p) => (
        // โหลดหน้าอื่นรอไว้ตั้งแต่เปิดหน้า — เซิร์ฟเวอร์อยู่อเมริกา กดแล้วรอโหลดใหม่ทุกครั้ง ~2 วินาที
        // แบบนี้กดเปลี่ยนแท็บแล้วขึ้นทันที แลกกับเซิร์ฟเวอร์ทำงานเพิ่ม (เปิดหน้าหนึ่ง โหลดแท็บอื่นรอไว้ทุกแท็บ)
        <Link key={p.key} prefetch className="navtab" data-on={active === p.key ? '1' : '0'} href={p.href}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

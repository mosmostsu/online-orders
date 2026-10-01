// แถบสลับหน้าหลัก — ออเดอร์ (งานประจำวัน) · สินค้า (ตะกร้าที่ลงขายของแต่ละร้าน) · ยอดขาย (ขายกี่ชิ้นต่อตะกร้า) · เงินเข้า (ยอดหลังหักค่าธรรมเนียม)
import Link from 'next/link';

const PAGES = [
  { key: 'orders', href: '/orders', label: 'ออเดอร์' },
  { key: 'product', href: '/product', label: 'สินค้า' },
  { key: 'summary', href: '/summary', label: 'ยอดขาย' },
  { key: 'money',  href: '/money',  label: 'เงินเข้า' },
];

export default function Nav({ active }) {
  return (
    <nav className="nav">
      {PAGES.map((p) => (
        <Link key={p.key} prefetch={false} className="navtab" data-on={active === p.key ? '1' : '0'} href={p.href}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

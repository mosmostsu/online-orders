// แถบสลับหน้าหลัก — ออเดอร์ (งานประจำวัน) กับ เงินเข้า (ยอดหลังหักค่าธรรมเนียม)
import Link from 'next/link';

const PAGES = [
  { key: 'orders', href: '/orders', label: 'ออเดอร์' },
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

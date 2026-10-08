// ลิงก์ท้ายทุกหน้า — Terms/Privacy ต้องมองเห็นบนเว็บโดยไม่ต้องเปิดเมนู (เงื่อนไขรีวิวแอป TikTok) และมีหน้า /about อธิบายแอป
import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="sitefoot">
      <Link prefetch={false} href="/about">About</Link>
      <Link prefetch={false} href="/terms">Terms of Service</Link>
      <Link prefetch={false} href="/privacy">Privacy Policy</Link>
    </footer>
  );
}

import './globals.css';

export const metadata = { title: 'order-sync — ออเดอร์รวมทุกร้าน' };

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body><div className="wrap">{children}</div></body>
    </html>
  );
}

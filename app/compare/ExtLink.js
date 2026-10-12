'use client';

// ลิงก์ออกไปหลังบ้านแพลตฟอร์ม ที่วางอยู่ใน <summary> ของแถวที่กางได้
// กดแล้วเปิดแท็บใหม่โดยไม่ให้แถวกาง/หุบตามไปด้วย (ถ้าใช้ <a> ตรงๆ แถวจะกางทุกครั้งที่กดลิงก์)
export default function ExtLink({ href, children, title }) {
  return (
    <a
      className="cmp-ext"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
    >
      {children}
    </a>
  );
}

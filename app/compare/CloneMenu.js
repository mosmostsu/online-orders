'use client';
// ปุ่มเดียว "🧬 โคลนไปแพลตฟอร์มอื่น" ในหน้า /compare — กดแล้วค่อยเลือกปลายทางข้างใน (แทนแถวปุ่มยาวๆ)
// เมนูไม่ปิดเองเมื่อคลิกที่อื่น: แผงโคลนของแต่ละปลายทางเปิดซ้อนจากในเมนู ถ้าเมนูปิด แผงจะหายไปด้วย
import { useState } from 'react';

export default function CloneMenu({ count = 0, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="clmenu">
      <button type="button" className="chip" data-on={open ? '1' : '0'} onClick={() => setOpen((o) => !o)}>
        🧬 โคลนไปแพลตฟอร์มอื่น{count ? ` (ติ๊ก ${count})` : ''} {open ? '▴' : '▾'}
      </button>
      {open && <div className="clmenu-pop">{children}</div>}
    </span>
  );
}

// หนึ่งกลุ่มในเมนู: หัวข้อ (ต้นทาง) + ปุ่มปลายทาง
export function CloneMenuRow({ label, children }) {
  return (
    <div className="clmenu-row">
      <span className="sku">{label}</span>
      <span className="clmenu-dests">{children}</span>
    </div>
  );
}

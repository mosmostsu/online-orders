'use client';
import { useRouter } from 'next/navigation';

// สวิตช์ท้ายแถบเลือกร้าน: ซ้าย = จัดกลุ่มตามร้าน (SOLID / REAL / MVP) · ขวา = ตามแพลตฟอร์ม
// เก็บค่าในคุกกี้ shopgroup (อ่านที่ app/ShopBar.js) แล้ว refresh ให้เซิร์ฟเวอร์วาดแถบใหม่ ใช้ร่วมกันทุกหน้า
export default function ShopGroupToggle({ mode }) {
  const router = useRouter();
  const next = mode === 'platform' ? 'shop' : 'platform';
  const flip = () => {
    try { document.cookie = `shopgroup=${next}; path=/; max-age=31536000; samesite=lax`; } catch { /* คุกกี้ถูกปิด — สลับไม่ได้ ไม่เป็นไร */ }
    router.refresh();
  };
  return (
    <button type="button" className="gtoggle" data-mode={mode} onClick={flip}
      title="สลับการจัดกลุ่มแถบร้าน: ตามร้าน / ตามแพลตฟอร์ม" aria-label="สลับการจัดกลุ่มแถบร้าน">
      <span className="gt-l">ร้าน</span>
      <span className="gt-track"><span className="gt-knob" /></span>
      <span className="gt-r">แพลตฟอร์ม</span>
    </button>
  );
}

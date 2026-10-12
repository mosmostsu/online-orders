'use client';
import { useState } from 'react';
import Link from 'next/link';
import Pending from './Pending';
import { groupShopsBy, shopGroup, PLATFORM_LABEL, GROUP_COOKIE } from '@/lib/shopGroups';

// วาดแถบเลือกร้าน + สวิตช์ ร้าน ⇄ แพลตฟอร์ม
// สวิตช์แค่เปลี่ยน state ในเบราว์เซอร์ (จัดเรียงชิปใหม่ทันที) แล้วจำค่าไว้ในคุกกี้ให้หน้าถัดไป
// ไม่เรียก router.refresh() — เดิมสั่งเซิร์ฟเวอร์วาดทั้งหน้าใหม่ (รวมคิวรีข้อมูลหนัก) ทำให้สวิตช์ช้า
export default function ShopBarView({ items, all, lead, prefetch, initialMode }) {
  const [mode, setMode] = useState(initialMode);
  const flip = () => {
    const next = mode === 'platform' ? 'shop' : 'platform';
    setMode(next);
    try { document.cookie = `${GROUP_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`; } catch { /* คุกกี้ถูกปิด — สลับได้แค่ในหน้านี้ ไม่เป็นไร */ }
  };

  return (
    <div className="chans shopbar">
      {lead && <Link prefetch={false} className="chan-lead" href={lead.href}>{lead.label}<Pending /></Link>}
      {all && (
        <Link prefetch={prefetch} className="chan" data-on={all.on ? '1' : '0'} href={all.href}>{all.label || 'ทุกช่องทาง'}<Pending /></Link>
      )}
      {groupShopsBy(items, mode).map(({ group, platform, items: list }) => (
        <span key={group} className="chgroup" data-group={group} data-by={mode} data-plat={platform}>
          <span className="chglabel">{mode === 'platform' ? (PLATFORM_LABEL[platform] || platform) : group}</span>
          {list.map((s) => (
            <Link
              prefetch={prefetch}
              key={`${s.platform}:${s.shop}`}
              className="chan"
              data-plat={s.platform}
              data-shop={s.shop}
              data-group={shopGroup(s.platform, s.shop)}
              data-on={s.on ? '1' : '0'}
              href={s.href}
            >
              <b>{mode === 'platform' ? shopGroup(s.platform, s.shop) : (PLATFORM_LABEL[s.platform] || s.platform)}</b>
              {s.count !== undefined && s.count !== null && <span>{s.count}</span>}
              <Pending />
            </Link>
          ))}
        </span>
      ))}
      <button type="button" className="gtoggle" data-mode={mode} onClick={flip}
        title="สลับการจัดกลุ่มแถบร้าน: ตามร้าน / ตามแพลตฟอร์ม" aria-label="สลับการจัดกลุ่มแถบร้าน">
        <span className="gt-l">ร้าน</span>
        <span className="gt-track"><span className="gt-knob" /></span>
        <span className="gt-r">แพลตฟอร์ม</span>
      </button>
    </div>
  );
}

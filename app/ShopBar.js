// แถบเลือกร้าน จัดกลุ่ม SOLID / REAL / MVP (ThisShop อยู่ REAL) — ใช้ร่วมกันทุกหน้า
//   items: [{ platform, shop, href, on, count? }]   all: { href, on, label } (ปุ่ม "ทุกช่องทาง" ถ้ามี)
//   prefetch: ส่งต่อให้ Link — หน้าที่ข้อมูลแต่ละร้านจำไว้ฝั่งเซิร์ฟเวอร์แล้วโหลดร้านอื่นรอไว้ได้ (เช่น /product)
import Link from 'next/link';
import { groupShops, PLATFORM_LABEL } from '@/lib/shopGroups';

export default function ShopBar({ items, all = null, prefetch = false }) {
  if (!items?.length) return null;
  return (
    <div className="chans shopbar">
      {all && (
        <Link prefetch={prefetch} className="chan" data-on={all.on ? '1' : '0'} href={all.href}>{all.label || 'ทุกช่องทาง'}</Link>
      )}
      {groupShops(items).map(({ group, items: list }) => (
        <span key={group} className="chgroup">
          <span className="chglabel">{group}</span>
          {list.map((s) => (
            <Link
              prefetch={prefetch}
              key={`${s.platform}:${s.shop}`}
              className="chan"
              data-plat={s.platform}
              data-shop={s.shop}
              data-on={s.on ? '1' : '0'}
              href={s.href}
            >
              <b>{PLATFORM_LABEL[s.platform] || s.platform}</b>
              {s.count !== undefined && s.count !== null && <span>{s.count}</span>}
            </Link>
          ))}
        </span>
      ))}
    </div>
  );
}

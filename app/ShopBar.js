// แถบเลือกร้าน จัดกลุ่ม SOLID / REAL / MVP (ThisShop อยู่ REAL) — ใช้ร่วมกันทุกหน้า
//   items: [{ platform, shop, href, on, count? }]   all: { href, on, label } (ปุ่ม "ทุกช่องทาง" ถ้ามี)
//   prefetch: ส่งต่อให้ Link — หน้าที่ข้อมูลแต่ละร้านจำไว้ฝั่งเซิร์ฟเวอร์แล้วโหลดร้านอื่นรอไว้ได้ (เช่น /product)
import Link from 'next/link';
import { cookies } from 'next/headers';
import { groupShopsBy, shopGroup, PLATFORM_LABEL, GROUP_COOKIE } from '@/lib/shopGroups';
import ShopGroupToggle from './ShopGroupToggle';

// สวิตช์ท้ายแถบสลับการจัดกลุ่ม: ตามร้าน (SOLID│REAL│MVP) หรือตามแพลตฟอร์ม (Shopee│TikTok│...) จำค่าไว้ในคุกกี้
export default async function ShopBar({ items, all = null, prefetch = false }) {
  if (!items?.length) return null;
  const mode = (await cookies()).get(GROUP_COOKIE)?.value === 'platform' ? 'platform' : 'shop';
  return (
    <div className="chans shopbar">
      {all && (
        <Link prefetch={prefetch} className="chan" data-on={all.on ? '1' : '0'} href={all.href}>{all.label || 'ทุกช่องทาง'}</Link>
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
            </Link>
          ))}
        </span>
      ))}
      <ShopGroupToggle mode={mode} />
    </div>
  );
}

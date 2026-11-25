// ของคืน — กล่องที่ขนส่งเอากลับมาที่ร้าน (ส่งไม่สำเร็จ/ตีกลับ + ลูกค้าขอคืน) · แทนหน้า "การคืนสินค้า Stock-In" ของ BigSeller
// เป้าหมาย: รู้ว่าของที่ควรกลับมา ได้กลับมาครบหรือเปล่า — กองที่ต้องตามคือ "คืนสินค้าแล้ว แต่ยังไม่รับ"
// สถานะการคืน = จากแพลตฟอร์ม (lib/returnsSync.js ทุกชั่วโมง) · สถานะรับ = พนักงานยิงรับ (ScanBox)
// ไม่กดอะไรบนแพลตฟอร์ม (คืนเงิน/ยอมรับ/โต้แย้ง ยังทำในแอปแพลตฟอร์ม) · ไม่แตะสต็อก Seniorsoft
import Link from 'next/link';
import Nav from '../Nav';
import ScanBox from './ScanBox';
import ReturnsTable from './ReturnsTable';
import SyncReturns from './SyncReturns';
import { loadBoxes } from '@/lib/returnsSync';
import {
  STATE_LABEL, STATE_FILTERS, RECV_LABEL, RECV_FILTERS, KIND_LABEL, LATE_DAYS,
  filterBoxes, sortBoxes, countBy, isLate,
} from '@/lib/returns';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const PLATFORM_NAME = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop' };

export default async function ReturnsPage({ searchParams }) {
  const sp = await searchParams;
  const f = {
    recv: sp?.recv || 'none', state: sp?.state || '', kind: sp?.kind || '',
    chan: sp?.chan || '', q: (sp?.q || '').trim(), late: sp?.late === '1',
  };
  const page = Math.max(1, Number(sp?.page) || 1);
  const qs = (o = {}) => {
    const m = { ...f, page: 1, ...o };
    const p = new URLSearchParams();
    if (m.recv && m.recv !== 'none') p.set('recv', m.recv);
    for (const k of ['state', 'kind', 'chan', 'q']) if (m[k]) p.set(k, m[k]);
    if (m.late) p.set('late', '1');
    if (m.page > 1) p.set('page', String(m.page));
    const s = p.toString();
    return '/returns' + (s ? '?' + s : '');
  };

  let all = [], err = null;
  try { all = await loadBoxes(90); } catch (e) { err = String(e.message || e); }

  // ตัวเลขบนปุ่ม นับตามตัวกรองอื่นที่เลือกอยู่ (ยกเว้นกลุ่มของปุ่มนั้นเอง)
  const recvCount = countBy(filterBoxes(all, f, 'recv'), 'recv');
  const stateCount = countBy(filterBoxes(all, f, 'state'), 'state');
  const recvAll = filterBoxes(all, f, 'recv').length;
  const stateAll = filterBoxes(all, f, 'state').length;
  const live = all.filter((b) => b.state !== 'not_needed' || b.recv);
  const arrivedNotRecv = live.filter((b) => b.state === 'arrived' && !b.recv).length;
  const late = live.filter((b) => isLate(b)).length;
  const chans = [...new Set(live.map((b) => `${b.platform}:${b.shop}`))].sort();

  const rows = sortBoxes(filterBoxes(all, f));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exportAllHref = '/api/returns/export' + qs({ page: 1 }).replace('/returns', '');

  return (
    <>
      <Nav active="returns" />
      <div className="row">
        <div>
          <h1>ของคืน</h1>
          <div className="sub">
            กล่องที่ขนส่งเอากลับมาร้าน 90 วันล่าสุด — ส่งไม่สำเร็จ/ตีกลับ + ลูกค้าขอคืน · ยิงรับตอนของมาถึง
          </div>
        </div>
        <SyncReturns />
      </div>

      {err && <div className="note note-danger"><b>อ่านข้อมูลไม่ได้</b><br />{err}<br />ถ้าเพิ่งเปิดใช้ ต้องรัน <code>supabase/069_returns.sql</code> ก่อน</div>}

      {(arrivedNotRecv > 0 || late > 0) && (
        <div className="note note-danger">
          {arrivedNotRecv > 0 && (
            <Link href={qs({ recv: 'none', state: 'arrived', late: false })}>
              ⚠️ <b>คืนสินค้าแล้ว แต่ยังไม่รับ {arrivedNotRecv} กล่อง</b>
            </Link>
          )}
          {arrivedNotRecv > 0 && late > 0 && ' · '}
          {late > 0 && (
            <Link href={qs({ recv: 'none', state: 'transit', late: true })}>
              อยู่ระหว่างคืนเกิน {LATE_DAYS} วัน {late} กล่อง
            </Link>
          )}
          <div className="sub">ขนส่งบอกว่าส่งถึงร้านแล้วแต่ยังไม่มีใครยิงรับ = ของอาจหาย ต้องตามหา</div>
        </div>
      )}

      <ScanBox />

      <form className="row" action="/returns" style={{ justifyContent: 'flex-start', gap: 8, margin: '10px 0' }}>
        <input name="q" defaultValue={f.q} placeholder="ค้นเลขออเดอร์ / เลขพัสดุ / ID คืนสินค้า" style={{ minWidth: 280 }} />
        {f.recv !== 'none' && <input type="hidden" name="recv" value={f.recv} />}
        <button className="btn">ค้นหา</button>
        {f.q && <Link href={qs({ q: '' })}>ล้างการค้นหา</Link>}
      </form>

      <div className="tabs">
        <span className="sub">สถานะรับ:</span>
        <Link prefetch={false} className="tab" data-on={f.recv === 'all' ? '1' : '0'} href={qs({ recv: 'all' })}>ทั้งหมด <b>{recvAll}</b></Link>
        {RECV_FILTERS.map((k) => (
          <Link key={k} prefetch={false} className="tab" data-on={f.recv === k ? '1' : '0'} data-alert={k === 'partial' && recvCount[k] ? '1' : '0'} href={qs({ recv: k })}>
            {RECV_LABEL[k]} <b>{recvCount[k] || 0}</b>
          </Link>
        ))}
      </div>

      <div className="tabs">
        <span className="sub">สถานะการคืน:</span>
        <Link prefetch={false} className="tab" data-on={!f.state ? '1' : '0'} href={qs({ state: '', late: false })}>ทั้งหมด <b>{stateAll}</b></Link>
        {STATE_FILTERS.map((k) => (
          <Link key={k} prefetch={false} className="tab" data-on={f.state === k ? '1' : '0'} href={qs({ state: k, late: false })}>
            {STATE_LABEL[k]} <b>{stateCount[k] || 0}</b>
          </Link>
        ))}
      </div>

      <div className="tabs">
        <span className="sub">ประเภท:</span>
        <Link prefetch={false} className="tab" data-on={!f.kind ? '1' : '0'} href={qs({ kind: '' })}>ทั้งหมด</Link>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <Link key={k} prefetch={false} className="tab" data-on={f.kind === k ? '1' : '0'} href={qs({ kind: k })}>{label}</Link>
        ))}
        <span className="divider" />
        <span className="sub">ร้าน:</span>
        <Link prefetch={false} className="tab" data-on={!f.chan ? '1' : '0'} href={qs({ chan: '' })}>ทุกร้าน</Link>
        {chans.map((c) => {
          const [p, s] = c.split(':');
          return (
            <Link key={c} prefetch={false} className="tab" data-on={f.chan === c ? '1' : '0'} href={qs({ chan: c })}>
              {PLATFORM_NAME[p] || p} {s}
            </Link>
          );
        })}
      </div>

      {f.late && <div className="note">เฉพาะกล่องที่อยู่ระหว่างคืนเกิน {LATE_DAYS} วัน · <Link href={qs({ late: false })}>ดูทั้งหมด</Link></div>}

      <ReturnsTable rows={shown} total={rows.length} exportAllHref={exportAllHref} />

      {rows.length > PAGE_SIZE && (
        <nav className="pager">
          {page <= 1 ? <span className="btn" data-off="1">‹ ก่อนหน้า</span> : <Link prefetch={false} className="btn" href={qs({ page: page - 1 })}>‹ ก่อนหน้า</Link>}
          <span className="sub">หน้า {page} จาก {Math.ceil(rows.length / PAGE_SIZE)} · ทั้งหมด {rows.length.toLocaleString('en-US')} กล่อง</span>
          {page * PAGE_SIZE >= rows.length ? <span className="btn" data-off="1">ถัดไป ›</span> : <Link prefetch={false} className="btn" href={qs({ page: page + 1 })}>ถัดไป ›</Link>}
        </nav>
      )}
    </>
  );
}

// ส่งออกของคืนเป็น CSV ตามตัวกรองบนหน้า /returns (ใช้ตอนไม่ได้ติ๊กเลือกแถว = เอาทุกแถวที่กรองอยู่)
// ติ๊กเลือกแถวแล้วส่งออก ทำในเบราว์เซอร์เอง (app/returns/ReturnsTable.js) ไม่ผ่านตรงนี้
import { loadBoxes } from '@/lib/returnsSync';
import { filterBoxes, sortBoxes, toCsv, csvRows, CSV_COLS } from '@/lib/returns';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  const f = {
    recv: sp.get('recv') || 'none', state: sp.get('state') === 'all' ? '' : sp.get('state') || '', kind: sp.get('kind') || '',
    chan: sp.get('chan') || '', q: sp.get('q') || '', late: sp.get('late') === '1',
  };
  try {
    const rows = sortBoxes(filterBoxes(await loadBoxes(90), f));
    const stamp = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return new Response(toCsv(csvRows(rows), CSV_COLS), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="returns-${stamp}.csv"`,
      },
    });
  } catch (e) {
    return new Response('ส่งออกไม่สำเร็จ: ' + String(e.message || e), { status: 500 });
  }
}

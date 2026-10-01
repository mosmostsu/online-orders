// ปลดล็อก/ล็อกตัวเลขยอดขาย (ดู lib/pin.js) — ฟอร์มในหน้า /summary, /money ส่งมาที่นี่แล้วเด้งกลับหน้าเดิม
import { NextResponse } from 'next/server';
import { PIN_COOKIE, PIN_MAX_AGE, pinMatches, pinToken } from '@/lib/pin';

export const dynamic = 'force-dynamic';

// เด้งกลับด้วยที่อยู่แบบสั้น (/money) ไม่ใช่เต็ม — บน Netlify req.url เป็นโดเมนของ deploy นั้นๆ
// (6abe…--order-sync-solid.netlify.app) ถ้าใช้ที่อยู่เต็ม คนจะถูกพาไปโดเมนนั้น คุกกี้ก็ไปติดที่นั่น
// กลับมาโดเมนหลักแล้วยังล็อกอยู่
function back303(path) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(req) {
  const form = await req.formData();
  // กลับหน้าเดิมได้เฉพาะลิงก์ในเว็บนี้ — กันถูกใช้เป็นทางเด้งไปเว็บอื่น
  const raw = String(form.get('back') || '/summary');
  const back = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/summary';
  const [path, query = ''] = back.split('?');
  const params = new URLSearchParams(query);
  params.delete('pin');
  const withParams = () => (params.toString() ? `${path}?${params}` : path);

  if (form.get('action') === 'lock') {
    const res = back303(withParams());
    res.cookies.delete(PIN_COOKIE);
    return res;
  }

  if (!pinMatches(String(form.get('pin') || ''))) {
    // ช้าลงนิดนึงตอนใส่ผิด กันเดารหัสรัวๆ
    await new Promise((r) => setTimeout(r, 1500));
    params.set('pin', 'wrong');
    return back303(withParams());
  }

  const res = back303(withParams());
  res.cookies.set(PIN_COOKIE, pinToken(), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: PIN_MAX_AGE,
  });
  return res;
}

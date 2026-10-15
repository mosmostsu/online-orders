// ดึงรูปสินค้าจาก CDN ของแพลตฟอร์มผ่านเซิร์ฟเวอร์เรา — หน้าแก้รูปก่อนโคลน (app/compare/ImageEditor.js) วาดลง canvas ได้
// (CDN ไม่ส่ง CORS → วาดตรงๆ แล้ว export ไม่ได้) · รับเฉพาะโดเมนรูปของแพลตฟอร์ม ไม่ใช่ proxy ทั่วไป
//   GET ?u=<url รูป>
import { fetchImageBytes } from '@/lib/cloneCommon';

export const dynamic = 'force-dynamic';

const HOSTS = /(^|\.)(shopee\.co\.th|susercontent\.com|ibyteimg\.com|tiktokcdn\.com|tiktokcdn-us\.com|slatic\.net|alicdn\.com)$/i;

export async function GET(req) {
  let u;
  try { u = new URL(new URL(req.url).searchParams.get('u') || ''); } catch { return new Response('bad url', { status: 400 }); }
  if (u.protocol !== 'https:' || !HOSTS.test(u.hostname)) return new Response('host not allowed', { status: 400 });
  try {
    const { bytes, type } = await fetchImageBytes(u.toString(), 'image/jpeg,image/png,image/webp');
    if (!/^image\//.test(type)) return new Response('not an image', { status: 502 });
    return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' } });
  } catch (e) {
    return new Response(String(e.message || e), { status: 502 });
  }
}

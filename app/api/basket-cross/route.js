// แก้พร้อมกันทุกร้าน — ส่งต่อการแก้จากตะกร้าหนึ่งไปตะกร้าเดียวกันในร้านอื่น (lib/basketCross.js · หน้าจอ app/product/CrossShop.js)
//
// GET  ?platform=&shop=&itemId=   → { ok, targets: [{ platform, shop, itemId, label, title, n, total, mine }] } ตะกร้าเดียวกันในร้านกลุ่มเดียวกันบนแพลตฟอร์มอื่น
// POST { action: 'preview', target: { platform, shop, itemId }, src, intent, imgs } → { ok, preview: { lines, skipped, warns, needImg, gallery, mainPrev, descPrev, why, sig, empty } }
//      intent: { prices, add, renames, main?, title?, desc? } — main/title/desc เอาจากตะกร้าต้นทางที่อ่านสด
//      อ่านตะกร้าสดของร้านนั้น แปลงคำสั่ง — ไม่เขียนอะไร
// POST { action: 'apply', target, src, intent, imgs, sig } → { ok, done, warnings }
//      แปลงใหม่กับตะกร้าสด ต้องได้ sig เดียวกับตัวอย่าง ไม่งั้นไม่เขียน · ร้านละคำขอ (หน้าเว็บยิงทีละร้าน)
//
// ⚠ apply เขียนลงร้านจริง — ล็อกแบบเดียวกับ /api/basket/<platform>: SALES_PIN + Origin เว็บเราเอง (?key=SYNC_SECRET ใช้แทนได้)
import { NextResponse } from 'next/server';
import { BasketError } from '@/lib/basket';
import { CROSS, crossTargets, checkIntent, previewCross, applyCross } from '@/lib/basketCross';
import { salesUnlocked } from '@/lib/pin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const digits = (x) => /^\d+$/.test(String(x ?? ''));

async function guard(req, write) {
  const key = new URL(req.url).searchParams.get('key');
  if (process.env.SYNC_SECRET && key === process.env.SYNC_SECRET) return null;
  if (write) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    let same = false;
    try { same = Boolean(origin) && new URL(origin).host === host; } catch { same = false; }
    if (!same) return NextResponse.json({ ok: false, error: 'คำขอไม่ได้มาจากหน้าเว็บนี้' }, { status: 403 });
  }
  if (!(await salesUnlocked())) return NextResponse.json({ ok: false, error: 'ต้องใส่รหัสปลดล็อกก่อนถึงจะแก้ตะกร้าได้' }, { status: 401 });
  return null;
}

const bad = (error) => NextResponse.json({ ok: false, error }, { status: 400 });
const fail = (e) => NextResponse.json({ ok: false, error: String(e.message || e) }, { status: e instanceof BasketError ? 400 : 500 });

async function checkShop(platform, shop, itemId) {
  const P = CROSS[platform];
  if (!P) return 'ไม่รู้จักแพลตฟอร์มนี้';
  if (!(await P.shops()).includes(shop)) return `ไม่รู้จักร้าน ${P.label} ${shop}`;
  if (!digits(itemId)) return 'itemId ไม่ถูกต้อง';
  return null;
}

export async function GET(req) {
  const denied = await guard(req, false);
  if (denied) return denied;
  const u = new URL(req.url);
  const platform = u.searchParams.get('platform') || '';
  const shop = u.searchParams.get('shop') || '';
  const itemId = u.searchParams.get('itemId') || '';
  const why = await checkShop(platform, shop, itemId);
  if (why) return bad(why);
  try {
    return NextResponse.json({ ok: true, targets: await crossTargets(platform, shop, itemId) });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const write = b.action === 'apply';
  if (!write && b.action !== 'preview') return bad('action ไม่ถูกต้อง');
  const denied = await guard(req, write);
  if (denied) return denied;
  const t = b.target || {};
  const target = { platform: String(t.platform || ''), shop: String(t.shop || ''), itemId: String(t.itemId || '') };
  const why = await checkShop(target.platform, target.shop, target.itemId);
  if (why) return bad(why);
  const s = b.src || {};
  if (String(s.platform) === target.platform && String(s.shop) === target.shop) return bad('ร้านปลายทางเป็นร้านเดียวกับต้นทาง');
  const imgs = b.imgs && typeof b.imgs === 'object' && !Array.isArray(b.imgs)
    ? Object.fromEntries(Object.entries(b.imgs).filter(([, v]) => typeof v === 'string' && v).slice(0, 20)) : {};
  try {
    const { src, intent } = checkIntent(s, b.intent);
    if (!write) return NextResponse.json({ ok: true, preview: await previewCross(target, src, intent, imgs) });
    if (!/^[0-9a-f]{16}$/.test(String(b.sig || ''))) return bad('ต้องดูตัวอย่างก่อนยืนยัน');
    return NextResponse.json({ ok: true, ...(await applyCross(target, src, intent, imgs, String(b.sig))) });
  } catch (e) { return fail(e); }
}

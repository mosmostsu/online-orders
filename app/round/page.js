// รอบจัดส่ง — แต่ละร้านกดจัดส่งไปกี่ใบ กี่ชิ้น ในแต่ละรอบ
// แทนการ export รีพอร์ตจากทุกร้านมาวางในชีต "tiktok SCS order" ทุกครั้งที่ตัดรอบ
// รอบตามเวลาตัดของร้าน แบ่งด้วยเวลากดจัดส่ง (ดู lib/rounds.js) ไม่ต้องมีคนกดปุ่มตัดรอบ
import Link from 'next/link';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase';
import { thaiDay, dayRange, shiftDay, splitRounds, shipAt, normSku } from '@/lib/rounds';
import Nav from '../Nav';
import AutoRefresh from '../orders/AutoRefresh';
import RoundView from './RoundView';

export const dynamic = 'force-dynamic';

const ROUND_VIEW_COOKIE = 'round_view';   // 'rows' = แถวแบบแท็บ final · 'grid' = ตารางไซส์แบบแท็บ SCS ST23

const TH = { timeZone: 'Asia/Bangkok' };
const dayLabel = (d) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { ...TH, day: 'numeric', month: 'short' });

// ขอทีละ 1,000 แถว (เพดานต่อคำขอของ Supabase) จนหมด
async function allPages(query) {
  const all = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await query().range(i, i + 999);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) return all;
  }
}

const ORDER_COLS = 'id, order_id, platform, shop, status, buyer, rts_at, cancelled_at, os_order_items(sku, product_name, variant, qty)';

// ออเดอร์ที่ปริ้นใบปะหน้า/กดส่งในวันนั้น — เวลาที่ใช้คือ shipAt (lib/rounds.js)
// ดึงจากสองทาง แล้วกรองด้วย ship_at อีกที:
//   1. rts_at ตกในวันนั้น (TikTok ทั้งหมด + Shopee/Lazada ที่ rts_at ยังถูก)
//   2. กลายเป็น "แพ็คแล้ว" ในวันนั้น (os_order_events) — Shopee/Lazada ที่ rts_at ถูกเขียนทับไปวันอื่น
async function loadDay(day) {
  const { from, to } = dayRange(day);
  const sb = db();
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  // สองคำขอแรกไม่ขึ้นต่อกัน ยิงพร้อมกัน — กดเปลี่ยนวัน/รีเฟรชจะได้ไม่รอทีละคำขอ
  const [byRts, packedToday] = await Promise.all([
    allPages(() => sb.from('os_orders').select(ORDER_COLS).gte('rts_at', from).lt('rts_at', to).order('id')),
    allPages(() => sb.from('os_order_events').select('order_ref').eq('to_status', 'packed').gte('at', from).lt('at', to).order('id')),
  ]);
  const byId = new Map(byRts.map((o) => [o.id, o]));
  const more = [...new Set(packedToday.map((e) => e.order_ref))].filter((id) => !byId.has(id));
  for (const res of await Promise.all(chunks(more, 200).map((ids) => sb.from('os_orders').select(ORDER_COLS).in('id', ids)))) {
    if (res.error) throw new Error(res.error.message);
    for (const o of res.data || []) byId.set(o.id, o);
  }

  // เวลาแพ็คครั้งแรกของ Shopee/Lazada (อาจเป็นเมื่อวาน — ใบนั้นก็จะหลุดจากวันนี้ไป)
  const firstPacked = new Map();
  const ids = [...byId.values()].filter((o) => o.platform !== 'tiktok').map((o) => o.id);
  const evs = await Promise.all(chunks(ids, 200).map((part) =>
    sb.from('os_order_events').select('order_ref, at').eq('to_status', 'packed').in('order_ref', part)));
  for (const res of evs) {
    if (res.error) throw new Error(res.error.message);
    for (const e of res.data || []) {
      const prev = firstPacked.get(e.order_ref);
      if (!prev || Date.parse(e.at) < Date.parse(prev)) firstPacked.set(e.order_ref, e.at);
    }
  }

  const lo = Date.parse(from), hi = Date.parse(to);
  return [...byId.values()]
    .map((o) => ({ ...o, ship_at: shipAt(o, firstPacked.get(o.id)) }))
    .filter((o) => o.ship_at && Date.parse(o.ship_at) >= lo && Date.parse(o.ship_at) < hi);
}

// ชื่อ/หมวดใน ST ของ SKU ทั้งวัน — ไซส์ยึดตาม ST (ดู lib/rounds.js) · คืนเป็น object ส่งให้ client ได้
// os_st เก็บตามตัวพิมพ์ของ Seniorsoft แต่แพลตฟอร์มอาจพิมพ์ต่าง จึงถามทั้งแบบเดิม/เล็ก/ใหญ่
// ถามไม่ได้ก็ไม่เป็นไร ตารางยังออก แค่ไซส์มาจากแพลตฟอร์มแทน
async function loadSt(skus) {
  // SKU ตัวเลขที่ 0 นำหน้าหายไป ("625410008") ถามแบบเติม 0 ด้วย ("0625410008") — normSku จับคู่ให้ภายหลัง
  const ask = [...new Set(skus.filter(Boolean).flatMap((s) => [s, s.toLowerCase(), s.toUpperCase(), ...(/^\d/.test(s) ? ['0' + s, '00' + s] : [])]))];
  const parts = Array.from({ length: Math.ceil(ask.length / 150) }, (_, i) => ask.slice(i * 150, i * 150 + 150));
  const st = {};
  for (const { data, error } of await Promise.all(parts.map((p) => db().from('os_st').select('sku, name, cat').in('sku', p)))) {
    if (error) return st;
    for (const r of data || []) st[normSku(r.sku)] = { name: r.name, cat: r.cat };
  }
  return st;
}

export default async function RoundPage({ searchParams }) {
  const sp = await searchParams;
  const today = thaiDay();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp?.d || '') && sp.d <= today ? sp.d : today;
  const dayHref = (d) => '/round' + (d !== today ? `?d=${d}` : '');

  // โหลดทั้งวันครั้งเดียว แล้วให้ RoundView สลับรอบ/ร้าน/มุมมองในเบราว์เซอร์ — กดแท็บแล้วขึ้นทันที ไม่ต้องรอเซิร์ฟเวอร์
  let rounds = [], st = {}, err = null;
  try {
    const orders = await loadDay(day);
    rounds = splitRounds(orders);
    st = await loadSt(orders.flatMap((o) => (o.os_order_items || []).map((i) => i.sku)));
  } catch (e) {
    err = String(e.message || e);
  }
  // กดส่งล่าสุดไม่เกิน 45 นาที = น่าจะยังกดอยู่ (คิดที่เซิร์ฟเวอร์ ไม่ให้นาฬิกาเครื่องลูกทำหน้าเพี้ยนตอน hydrate)
  const now = Date.now();
  const live = (r) => day === today && now - Date.parse(r.to) < 45 * 60000;
  rounds = rounds.map((r) => ({ ...r, live: live(r), shops: r.shops.map((x) => ({ ...x, live: live(x) })) }));
  const view = (await cookies()).get(ROUND_VIEW_COOKIE)?.value === 'grid' ? 'grid' : 'rows';
  const dayNav = (
    <>
      <Link className="btn" href={dayHref(shiftDay(day, -1))}>◀ {dayLabel(shiftDay(day, -1))}</Link>
      <b>{day === today ? 'วันนี้ · ' : ''}{dayLabel(day)}</b>
      {day < today && <Link className="btn" href={dayHref(shiftDay(day, 1))}>{dayLabel(shiftDay(day, 1))} ▶</Link>}
      {day < today && <Link className="btn" href={dayHref(today)}>วันนี้</Link>}
    </>
  );

  return (
    <>
      <Nav active="round" />
      {/* ไทยแบบมีหัวให้คนจัดของอ่านง่าย (ทั้งบนจอและตอนพิมพ์) — เครื่อง Windows/Android ไม่มีฟอนต์แบบนี้ในเครื่อง จึงโหลดจาก Google Fonts */}
      <link rel="stylesheet" precedence="default"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&display=swap" />
      <div className="rpage">
      <div className="row">
        <div>
          <h1>รอบจัดส่ง</h1>
          <div className="sub">
            แบ่งรอบจากเวลาปริ้นใบปะหน้า/กดจัดส่ง — รอบ 1 ก่อน 12:00 · รอบ 2 12:00-13:59 · รอบ 3 ตั้งแต่ 14:00 · Shopee MVP ยังไม่มีข้อมูลออเดอร์
          </div>
        </div>
        <AutoRefresh />
      </div>

      {!rounds.length && <div className="rday">{dayNav}</div>}
      {err && <div className="note note-danger">โหลดออเดอร์ไม่สำเร็จ: {err}</div>}
      {!err && !rounds.length && <div className="note">ยังไม่มีออเดอร์ที่กดจัดส่งใน{day === today ? 'วันนี้' : 'วันนั้น'}</div>}

      {rounds.length > 0 && (
        <RoundView
          rounds={rounds} st={st} day={day} dayText={dayLabel(day)} dayNav={dayNav}
          initialRound={sp?.r} initialShop={sp?.s} initialView={view} viewCookie={ROUND_VIEW_COOKIE}
        />
      )}
      </div>
    </>
  );
}

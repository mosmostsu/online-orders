// ของคืน (หน้า /returns) — ฟังก์ชันล้วน ใช้ได้ทั้งเบราว์เซอร์และเซิร์ฟเวอร์ ไม่แตะฐานข้อมูล
// 1 แถวใน os_returns = 1 กล่องที่จะกลับร้าน (ตีกลับ = ทั้งออเดอร์ · ลูกค้าคืน = หนึ่งคำขอคืน)
// ชื่อสถานะตามหน้า "การคืนสินค้า Stock-In" ของ BigSeller ที่ร้านใช้อยู่ — พนักงานจะได้ไม่ต้องเรียนใหม่

export const RET_STATES = ['waiting', 'transit', 'arrived', 'failed', 'lost', 'not_needed'];

export const STATE_LABEL = {
  waiting: 'รอคืนสินค้า',
  transit: 'อยู่ระหว่างคืนสินค้า',
  arrived: 'คืนสินค้าแล้ว',
  failed: 'การคืนสินค้าล้มเหลว',
  lost: 'สูญหาย',
  not_needed: 'ไม่ต้องส่งคืน',
};

// ปุ่มกรองสถานะการคืนบนหน้า (ไม่ต้องส่งคืน ซ่อนไว้ ไม่มีของต้องรับ)
export const STATE_FILTERS = ['waiting', 'transit', 'arrived', 'failed', 'lost'];

// สถานะรับของ — แทนแถบ Stock-In ของ BigSeller (ร้านกด "ไม่ Stock-In" ทุกใบ เพราะสต็อกจริงอยู่ Seniorsoft)
export const RECV_LABEL = { none: 'ยังไม่รับ', partial: 'รับไม่ครบ', full: 'รับครบ' };
export const RECV_FILTERS = ['none', 'partial', 'full'];

export const KIND_LABEL = { failed: 'ส่งไม่สำเร็จ/ตีกลับ', buyer: 'ลูกค้าขอคืน' };

// ── โค้ดจากปืนยิง ────────────────────────────────────────────────────
// ปืนยิงบาร์โค้ดพิมพ์ "ปุ่ม" ไม่ใช่ตัวอักษร — ถ้าแป้นค้างเป็นภาษาไทย JTTH209 จะเข้ามาเป็น ๋ธธ็/จต
// BigSeller ให้คนเปลี่ยนแป้นเป็น EN ก่อนยิงเอง ของเราแปลงกลับให้ตามแป้นเกษมณี (ปุ่มเดียวกันบนแป้นอังกฤษ)
const KEYS_EN = '1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
const KEYS_TH = 'ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';
const TH_TO_EN = new Map([...KEYS_TH].map((c, i) => [c, KEYS_EN[i]]));
const HAS_THAI = /[฀-๿]/;

export function normCode(s) {
  let t = String(s ?? '').replace(/\s+/g, '');
  // มีตัวไทยปนแม้ตัวเดียว = ยิงตอนแป้นไทย → แปลงทุกตัว (เลข 2 3 บนแป้นไทยออกมาเป็น / - ที่เป็นตัวอังกฤษ)
  if (HAS_THAI.test(t)) t = [...t].map((c) => TH_TO_EN.get(c) ?? c).join('');
  return t.toUpperCase();
}

// ── แปลงสถานะจากแต่ละแพลตฟอร์ม → สถานะการคืนของเรา (null = ไม่ต้องเก็บ ยังไม่มีของต้องกลับ) ──

// TikTok คำขอคืน (POST /return_refund/202309/returns/search)
// เจอจริง 90 วัน: COMPLETE 403 · CANCEL 49 · BUYER_SHIPPED_ITEM 23 · AWAITING_BUYER_SHIP 8 · PENDING 1
// COMPLETE ส่วนใหญ่ = คืนเงินเร็ว (quick refund) ตั้งแต่ลูกค้าส่งของ ของยังไม่ถึง → ถือว่าอยู่ระหว่างคืน
// จนกว่าจะเจอ SELLER_CONFIRM_RECEIVE ในประวัติ หรือพนักงานยิงรับ
export function tiktokReturnState(r) {
  const type = r?.return_type;
  if (type !== 'RETURN_AND_REFUND' && type !== 'EXCHANGE') return null;   // REFUND = คืนเงินอย่างเดียว
  const s = String(r?.return_status || '');
  if (s === 'REJECT_RECEIVE_PACKAGE') return 'arrived';                  // ร้านกดปฏิเสธหลังเปิดกล่อง = ของถึงแล้ว
  if (/CANCEL|REJECT/.test(s)) return 'not_needed';                       // ลูกค้ายกเลิก / ร้านปฏิเสธคำขอ
  if (s === 'AWAITING_BUYER_SHIP') return 'waiting';
  if (s === 'BUYER_SHIPPED_ITEM' || s === 'RETURN_OR_REFUND_REQUEST_COMPLETE') {
    return r?.return_tracking_number ? 'transit' : 'not_needed';
  }
  return null;   // ยังเจรจา (PENDING) — ยังไม่รู้ว่าต้องส่งของคืนไหม
}

// ประวัติคำขอคืน TikTok (GET /return_refund/202309/returns/{id}/records) — ร้านกดยืนยันรับในแอป = ของถึงแล้ว
export function tiktokRecordsState(records) {
  const hit = (records || []).find((e) => e?.event === 'SELLER_CONFIRM_RECEIVE');
  return hit ? { state: 'arrived', at: new Date(Number(hit.create_time) * 1000).toISOString() } : null;
}

// Shopee คำขอคืน (GET /api/v2/returns/get_return_list)
// เจอจริง 90 วัน: ACCEPTED · CANCELLED · PROCESSING · CLOSED · needs_logistics=false = คืนเงินอย่างเดียว
export function shopeeReturnState(r) {
  if (!r?.needs_logistics) return null;
  const s = String(r?.status || '');
  if (s === 'CANCELLED') return 'not_needed';
  if (s === 'REQUESTED' || s === 'JUDGING') return null;                   // ยังเจรจา
  if (s === 'ACCEPTED' || s === 'PROCESSING' || s === 'CLOSED' || s === 'SELLER_DISPUTE') {
    return r?.tracking_number ? 'transit' : 'waiting';
  }
  return null;
}

// ขนส่งขาไปที่ตีกลับ — TikTok GET /fulfillment/202309/orders/{id}/tracking
// action_code 80101 = "Your package has been returned to the seller" (เวลาตรงกับ "ถึงคลัง" ของ BigSeller)
// 702xx = กำลังส่งคืนผู้ขาย ("being returned to the seller", "Return package …") — ออเดอร์ยังไม่ถูกยกเลิกก็ได้
// TikTok ยกเลิกออเดอร์ทีหลังตอนของถึงร้าน แต่ BigSeller นับเป็น "อยู่ระหว่างคืนสินค้า" ตั้งแต่ตรงนี้
export function tiktokTrackingState(events) {
  const list = events || [];
  const hit = list.find((e) => Number(e?.action_code) === 80101);
  if (hit) return { state: 'arrived', at: new Date(Number(hit.update_time_millis)).toISOString() };
  if (list.some((e) => Math.floor(Number(e?.action_code) / 100) === 702)) return { state: 'transit', at: null };
  return null;
}

// Shopee GET /api/v2/logistics/get_tracking_info (ตีกลับ) — ล่าสุดอยู่บนสุด
export function shopeeTrackingState(info) {
  const list = info || [];
  const find = (st) => list.find((e) => e?.logistics_status === st);
  const at = (e) => new Date(Number(e.update_time) * 1000).toISOString();
  const ret = find('RETURNED');
  if (ret) return { state: 'arrived', at: at(ret) };
  const lost = find('LOST');
  if (lost) return { state: 'lost', at: null };
  if (find('RETURN_STARTED') || find('RETURN_INITIATED')) return { state: 'transit', at: null };
  return null;
}

// Shopee GET /api/v2/returns/get_reverse_tracking_info (ลูกค้าคืน)
export function shopeeReverseState(res) {
  const s = String(res?.reverse_logistics_status || '');
  const t = res?.reverse_logistics_update_time;
  if (s === 'LOGISTICS_DELIVERY_DONE') return { state: 'arrived', at: t ? new Date(Number(t) * 1000).toISOString() : null };
  if (s === 'LOGISTICS_LOST') return { state: 'lost', at: null };
  if (s === 'LOGISTICS_DELIVERY_FAILED') return { state: 'failed', at: null };
  return null;
}

// Lazada สถานะออเดอร์ดิบ (มีในตาราง os_orders อยู่แล้ว)
export function lazadaOrderState(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'shipped_back_success' || s === 'returned') return 'arrived';
  if (s === 'shipped_back_failed') return 'failed';
  if (s === 'lost_by_3pl' || s === 'damaged_by_3pl') return 'lost';
  if (s === 'shipped_back') return 'transit';
  return null;
}

// สถานะที่ได้จากแพลตฟอร์มห้ามถอยหลัง — ถึงแล้ว/หาย/ล้มเหลว ไม่กลับไปเป็นกำลังมา
const RANK = { not_needed: 0, waiting: 1, transit: 2, failed: 3, lost: 3, arrived: 4 };
export function laterState(oldState, newState) {
  if (!oldState) return newState;
  if (!newState) return oldState;
  if (newState === 'not_needed') return oldState === 'arrived' ? oldState : newState;   // ยกเลิกคำขอได้ เว้นของมาถึงแล้ว
  return (RANK[newState] ?? 0) >= (RANK[oldState] ?? 0) ? newState : oldState;
}

// ── กรอง/เรียงบนหน้า ────────────────────────────────────────────────
// f = { recv: 'none'|'full'|'partial'|'all', state, kind, chan: 'platform:shop', q, late }
export const LATE_DAYS = 7;   // อยู่ระหว่างคืนนานเกินนี้ = เตือน
const recvKey = (b) => b.recv || 'none';

export function isLate(b, now = Date.now()) {
  return !b.recv && b.state === 'transit' && b.started_at
    && now - new Date(b.started_at).getTime() > LATE_DAYS * 86400000;
}

export function filterBoxes(rows, f = {}, skip = null) {
  const q = f.q ? normCode(f.q) : '';
  return rows.filter((b) => {
    if (b.state === 'not_needed' && !b.recv) return false;   // ไม่มีของต้องรับ
    if (skip !== 'recv' && f.recv && f.recv !== 'all' && recvKey(b) !== f.recv) return false;
    if (skip !== 'state' && f.state && b.state !== f.state) return false;
    if (f.kind && b.kind !== f.kind) return false;
    if (f.chan && `${b.platform}:${b.shop}` !== f.chan) return false;
    if (f.late && !isLate(b)) return false;
    if (q && ![b.order_id, b.return_id, b.tracking_no].some((v) => v && normCode(v).includes(q))) return false;
    return true;
  });
}

// ยังไม่รับ: ถึงร้านแล้วขึ้นก่อน (ต้องตามหาของ) แล้วค่อยกำลังมา เก่าสุดก่อน · รับแล้ว: รับล่าสุดก่อน
export function sortBoxes(rows) {
  const t = (s) => (s ? new Date(s).getTime() : 0);
  return [...rows].sort((a, b) => {
    if (!a.recv !== !b.recv) return a.recv ? 1 : -1;
    if (!a.recv) {
      if ((a.state === 'arrived') !== (b.state === 'arrived')) return a.state === 'arrived' ? -1 : 1;
      return t(a.arrived_at || a.started_at) - t(b.arrived_at || b.started_at);
    }
    return t(b.received_at) - t(a.received_at);
  });
}

export function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key === 'recv' ? recvKey(r) : r[key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// ── ส่งออก CSV ────────────────────────────────────────────────────────
// ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยถูก · ค่าที่มี , " หรือขึ้นบรรทัด ใส่เครื่องหมายคำพูด
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv(rows, cols) {
  const lines = [cols.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

export const CSV_COLS = [
  { key: 'platform', label: 'แพลตฟอร์ม' },
  { key: 'shop', label: 'ร้าน' },
  { key: 'kind', label: 'ประเภท' },
  { key: 'order_id', label: 'เลขออเดอร์' },
  { key: 'return_id', label: 'ID คืนสินค้า' },
  { key: 'tracking_no', label: 'เลขพัสดุ' },
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'ชื่อสินค้า' },
  { key: 'qty', label: 'จำนวน' },
  { key: 'reason', label: 'สาเหตุ' },
  { key: 'state', label: 'สถานะการคืน' },
  { key: 'recv', label: 'สถานะรับ' },
  { key: 'arrived_at', label: 'เวลาถึงร้าน' },
  { key: 'received_at', label: 'เวลารับ' },
  { key: 'received_by', label: 'คนรับ' },
  { key: 'receive_note', label: 'หมายเหตุ' },
];

const fmtCsvTime = (iso) => (iso
  ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
  : '');

// แถวกล่อง → แถว CSV ทีละ SKU (แบบไฟล์ส่งออกของ BigSeller)
export function csvRows(boxes) {
  const out = [];
  for (const b of boxes) {
    const items = b.items?.length ? b.items : [{}];
    for (const it of items) {
      out.push({
        platform: b.platform, shop: b.shop, kind: KIND_LABEL[b.kind] || b.kind,
        order_id: b.order_id, return_id: b.return_id || '', tracking_no: b.tracking_no || '',
        sku: it.sku || '', name: it.name || '', qty: it.qty ?? '',
        reason: b.reason || '', state: STATE_LABEL[b.state] || b.state,
        recv: RECV_LABEL[b.recv || 'none'], arrived_at: fmtCsvTime(b.arrived_at),
        received_at: fmtCsvTime(b.received_at), received_by: b.received_by || '', receive_note: b.receive_note || '',
      });
    }
  }
  return out;
}

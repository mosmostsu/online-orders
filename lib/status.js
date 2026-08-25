// สถานะกลาง — แต่ละแพลตฟอร์มเรียกไม่เหมือนกัน แปลงมาลงรางเดียวกันก่อนเก็บ
export const STATUS = {
  unpaid:    { t: 'รอชำระเงิน',  c: 'dim'  },  // ยังไม่จ่าย = ยังไม่ใช่งานของเรา
  to_ship:   { t: 'รอจัดส่ง',    c: 'hot'  },  // ยังไม่ได้หยิบของ — ยกเลิกตอนนี้ไม่เจ็บ
  packed:    { t: 'แพ็คแล้ว รอขนส่งรับ', c: 'hot' },  // ของออกจากชั้นแล้ว — ยกเลิกตอนนี้คือของที่ต้องตามดึงกลับ
  shipped:   { t: 'จัดส่งแล้ว',  c: 'ok'   },
  delivered: { t: 'ถึงมือลูกค้า', c: 'ok'   },
  done:      { t: 'สำเร็จ',      c: 'ok'   },
  cancelled: { t: 'ยกเลิก',      c: 'err'  },
  unknown:   { t: 'ไม่รู้จัก',    c: 'warn' },
};

export const STATUS_ORDER = ['to_ship', 'packed', 'shipped', 'delivered', 'done', 'cancelled'];
// สถานะที่ไม่ต้องสนใจในงานประจำวัน — ดันไปท้ายแถบและทำให้จางลง
export const MINOR_STATUS = ['unpaid'];

// TikTok Shop (API 202309)
const TIKTOK = {
  UNPAID: 'unpaid',
  ON_HOLD: 'unpaid',
  AWAITING_SHIPMENT: 'to_ship',
  PARTIALLY_SHIPPING: 'packed',
  AWAITING_COLLECTION: 'packed',    // แพ็คเสร็จ รอขนส่งมารับ — จุดที่ยกเลิกแล้วเจ็บที่สุด
  IN_TRANSIT: 'shipped',
  DELIVERED: 'delivered',
  COMPLETED: 'done',
  CANCELLED: 'cancelled',
};

// Shopee (เตรียมไว้ เฟสถัดไป)
const SHOPEE = {
  UNPAID: 'unpaid',
  READY_TO_SHIP: 'to_ship',
  PROCESSED: 'packed',              // Shopee: พิมพ์ใบปะหน้าแล้ว = ของถูกหยิบมาแพ็คแล้ว
  RETRY_SHIP: 'packed',
  SHIPPED: 'shipped',
  TO_CONFIRM_RECEIVE: 'shipped',
  COMPLETED: 'done',
  CANCELLED: 'cancelled',
  IN_CANCEL: 'cancelled',
  TO_RETURN: 'cancelled',
};

const MAPS = { tiktok: TIKTOK, shopee: SHOPEE };

export function toStatus(platform, rawStatus) {
  const m = MAPS[platform];
  if (!m || !rawStatus) return 'unknown';
  return m[String(rawStatus).toUpperCase()] || 'unknown';
}

export function statusLabel(s) {
  return (STATUS[s] || STATUS.unknown).t;
}

// ยกเลิกจากสถานะพวกนี้ = ของถูกหยิบ/แพ็คไปแล้ว ต้องรีบตามดึงออกก่อนขนส่งรับไป
export const RISKY_BEFORE_CANCEL = ['packed', 'to_ship'];

export function isRiskyCancel(order) {
  return order?.status === 'cancelled' && RISKY_BEFORE_CANCEL.includes(order?.cancelled_from);
}

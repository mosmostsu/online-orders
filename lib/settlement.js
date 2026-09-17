// เงินที่ได้รับจริง — ส่วนที่ใช้ร่วมกันทุกแพลตฟอร์ม
// (ตัวดึง/ตัวแปลงของแต่ละเจ้าอยู่ใน lib/<platform>.js แล้วมาลงสองตารางนี้)
import { db } from './supabase.js';

export async function saveStatements(rows) {
  if (!rows.length) return 0;
  // ไม่แตะคอลัมน์ความคืบหน้า (tx_synced, cursor, done) — ตรงนั้นรอบดึงรายการเป็นคนเขียน
  const { error } = await db().from('os_statements')
    .upsert(rows, { onConflict: 'platform,shop,statement_id' });
  if (error) throw new Error('บันทึกใบสรุปไม่สำเร็จ: ' + error.message);
  return rows.length;
}

export async function saveMoneyTx(rows) {
  if (!rows.length) return 0;
  const { error } = await db().from('os_money_tx').upsert(rows, { onConflict: 'platform,tx_id' });
  if (error) throw new Error('บันทึกรายการเงินไม่สำเร็จ: ' + error.message);
  return rows.length;
}

// ── ชื่อไทยของรายการย่อย ──────────────────────────────────────────────
// คัดจากที่ร้านโดนจริงในข้อมูล ก.ย. 2569 — ตัวที่ไม่อยู่ในนี้จะโชว์ชื่อเดิมไปก่อน
const LABEL = {
  // รายได้
  'rev.subtotal_before_discount_amount': 'ราคาป้าย',
  'rev.refund_subtotal_before_discount_amount': 'คืนเงินค่าสินค้า',
  'rev.seller_discount_amount': 'ส่วนลดที่ร้านออก',
  'rev.seller_discount_refund_amount': 'ได้ส่วนลดร้านคืน',
  // ค่าธรรมเนียม
  'fee.dynamic_commission_amount': 'ค่าคอมมิชชั่น (ผันแปร)',
  'fee.platform_commission_amount': 'ค่าคอมมิชชั่นแพลตฟอร์ม',
  'fee.transaction_fee_amount': 'ค่าธรรมเนียมชำระเงิน',
  'fee.vn_fix_infrastructure_fee': 'ค่าโครงสร้างพื้นฐาน',
  'fee.affiliate_commission_amount': 'ค่าคอมแอฟฟิลิเอต',
  'fee.affiliate_ads_commission_amount': 'ค่าคอมโฆษณาแอฟฟิลิเอต',
  'fee.affiliate_partner_commission_amount': 'ค่าคอมพาร์ตเนอร์',
  'fee.live_specials_fee_amount': 'ค่า LIVE Specials',
  'fee.flash_sales_service_fee_amount': 'ค่าบริการแฟลชเซล',
  'fee.voucher_xtra_service_fee_amount': 'ค่าบริการ Voucher Xtra',
  'fee.seller_paylater_handling_fee_amount': 'ค่าธรรมเนียมผ่อนจ่าย',
  'fee.refund_administration_fee_amount': 'ค่าดำเนินการคืนเงิน',
  'tax.vat_amount': 'VAT',
  // ค่าส่ง
  'ship.actual_shipping_fee_amount': 'ค่าส่งจริง',
  'ship.shipping_fee_discount_amount': 'แพลตฟอร์มช่วยค่าส่ง',
  'ship.customer_paid_shipping_fee_amount': 'ค่าส่งที่ลูกค้าจ่าย',
  'ship.return_shipping_fee_amount': 'ค่าส่งคืน',
  'ship.failed_delivery_subsidy_amount': 'ชดเชยส่งไม่สำเร็จ',
};

const GROUP = { rev: 'รายได้', fee: 'ค่าธรรมเนียม', tax: 'ภาษี', ship: 'ค่าส่ง' };

export function moneyLabel(key) {
  return LABEL[key] || key.split('.').pop().replace(/_amount$/, '').replace(/_/g, ' ');
}

// รายการย่อยจัดกลุ่มสำหรับโชว์ในแถว — กลุ่มรายได้ขึ้นก่อน ในกลุ่มเรียงตัวที่หนักสุดก่อน
export function breakdownGroups(breakdown) {
  if (!breakdown) return [];
  const groups = new Map();
  for (const [key, amount] of Object.entries(breakdown)) {
    const g = key.split('.')[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ key, label: moneyLabel(key), amount: Number(amount) });
  }
  return ['rev', 'fee', 'tax', 'ship']
    .filter((g) => groups.has(g))
    .map((g) => ({
      key: g,
      label: GROUP[g],
      lines: groups.get(g).sort((a, b) => (g === 'rev' ? b.amount - a.amount : a.amount - b.amount)),
    }));
}

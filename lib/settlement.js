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
// ใช้ชื่อเดียวกับที่ TikTok โชว์ในหน้า Seller Centre — เทียบกับใบจริงแล้วตรงทุกบรรทัด
// ชื่อฟิลด์ใน API ชวนเข้าใจผิด เช่น dynamic_commission ที่จริงคือค่าธรรมเนียมสนับสนุนการเติบโตของร้าน
// ตัวที่ไม่อยู่ในนี้จะโชว์ชื่อฟิลด์เดิมไปก่อน
const LABEL = {
  // รายได้
  'rev.subtotal_before_discount_amount': 'ราคาป้าย',
  'rev.refund_subtotal_before_discount_amount': 'คืนเงินค่าสินค้า',
  'rev.seller_discount_amount': 'ส่วนลดที่ร้านออก',
  'rev.seller_discount_refund_amount': 'ได้ส่วนลดร้านคืน',
  // ค่าธรรมเนียม
  'fee.dynamic_commission_amount': 'ค่าธรรมเนียมสนับสนุนการเติบโตของร้าน',   // TikTok เรียกชื่อนี้ในหน้า Seller Centre ไม่ใช่ค่าคอมมิชชั่น
  'fee.seller_growth_fee_amount': 'ค่าธรรมเนียมสนับสนุนการเติบโตของร้าน',
  'fee.platform_commission_amount': 'ค่าคอมมิชชั่น TikTok Shop',
  'fee.transaction_fee_amount': 'ค่าธรรมเนียมคำสั่งซื้อ',
  'fee.vn_fix_infrastructure_fee': 'ค่าธรรมเนียมโครงสร้างพื้นฐาน',
  'fee.affiliate_commission_amount': 'ค่าคอมแอฟฟิลิเอต',
  'fee.affiliate_ads_commission_amount': 'ค่าคอมโฆษณาแอฟฟิลิเอต',
  'fee.affiliate_partner_commission_amount': 'ค่าคอมพาร์ตเนอร์',
  'fee.live_specials_fee_amount': 'ค่าบริการคูปองไลฟ์คุ้ม',
  'fee.flash_sales_service_fee_amount': 'ค่าบริการแฟลชเซล',
  'fee.voucher_xtra_service_fee_amount': 'ค่าบริการ Voucher Xtra',
  'fee.seller_paylater_handling_fee_amount': 'ค่าธรรมเนียมผ่อนจ่าย',
  'fee.refund_administration_fee_amount': 'ค่าดำเนินการคืนเงิน',
  'tax.vat_amount': 'VAT',
  // ค่าส่ง
  'ship.actual_shipping_fee_amount': 'ค่าจัดส่งก่อนส่วนลด',
  'ship.shipping_fee_discount_amount': 'ส่วนลดค่าจัดส่งจาก TikTok Shop',
  'ship.customer_paid_shipping_fee_amount': 'ค่าส่งที่ลูกค้าจ่าย',
  'ship.return_shipping_fee_amount': 'ค่าส่งคืน',
  'ship.failed_delivery_subsidy_amount': 'ชดเชยส่งไม่สำเร็จ',
  // Shopee (get_escrow_detail) — ชื่อฟิลด์คนละชุดกับ TikTok
  'rev.subtotal': 'ราคาป้าย',
  'rev.seller_discount': 'ส่วนลดที่ร้านออก',
  'rev.shopee_discount': 'ส่วนลดจาก Shopee',
  'rev.voucher_from_seller': 'โค้ดส่วนลดที่ร้านออก',
  'rev.voucher_from_shopee': 'โค้ดส่วนลดจาก Shopee',
  'rev.coins': 'ลูกค้าใช้เหรียญ Shopee',
  'rev.credit_card_promotion': 'โปรโมชั่นบัตรเครดิต',
  'fee.commission_fee': 'ค่าคอมมิชชั่น Shopee',
  'fee.transaction_fee': 'ค่าธรรมเนียมธุรกรรม',
  'fee.service_fee': 'ค่าบริการ',
  'fee.buyer_transaction_fee': 'ค่าธรรมเนียมฝั่งลูกค้า',
  'fee.insurance_fee': 'ค่าประกันพัสดุ',
  'tax.vat': 'VAT',
  'tax.seller_withholding_tax': 'ภาษีหัก ณ ที่จ่าย',
  'ship.actual_shipping_fee': 'ค่าจัดส่งจริง',
  'ship.buyer_paid_shipping_fee': 'ค่าส่งที่ลูกค้าจ่าย',
  'ship.shipping_fee_rebate_from_shopee': 'ค่าส่งที่ Shopee ช่วยออก',
  'ship.reverse_shipping_fee': 'ค่าส่งคืน',
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

export async function saveProducts(rows) {
  if (!rows.length) return 0;
  const { error } = await db().from('os_products').upsert(rows, { onConflict: 'platform,product_id' });
  if (error) throw new Error('บันทึกข้อมูลตะกร้าไม่สำเร็จ: ' + error.message);
  return rows.length;
}

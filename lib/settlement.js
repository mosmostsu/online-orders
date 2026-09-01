// เงินที่ได้รับจริงต่อออเดอร์ — ส่วนที่ใช้ร่วมกันทุกแพลตฟอร์ม
// (แต่ละเจ้ามีตัวดึง/ตัวแปลงของตัวเองใน lib/<platform>.js แล้วมาลงตารางเดียวกันที่นี่)
import { db } from './supabase.js';

export async function saveSettlements(rows) {
  if (!rows.length) return 0;
  const { error } = await db().from('os_settlements').upsert(rows, { onConflict: 'order_ref' });
  if (error) throw new Error('บันทึกยอดเงินไม่สำเร็จ: ' + error.message);
  return rows.length;
}

// ถามแล้วยังไม่มีตัวเลข (ยังไม่ถึงรอบปิดยอด) หรือถามแล้วพัง
// ต้องจดไว้ว่าถามแล้ว ไม่งั้นรอบหน้าจะวนมาถามใบเดิมซ้ำจนเต็มโควต้าเรียก API
export function pendingRow({ orderRef, platform, shop, orderId, error }) {
  return {
    order_ref: orderRef,
    platform,
    shop,
    order_id: String(orderId),
    settled: false,
    tried_at: new Date().toISOString(),
    error: error ? String(error).slice(0, 300) : null,
    updated_at: new Date().toISOString(),
  };
}

// ── ชื่อไทยของรายการที่ถูกหัก ─────────────────────────────────────────
// ชื่อฟิลด์ที่ไม่รู้จักจะโชว์ตามชื่อเดิม — เห็นแล้วค่อยมาเติมคำแปลทีหลัง
const FEE_LABEL = {
  customer_payment_amount: 'ลูกค้าจ่าย',
  customer_paid_amount: 'ลูกค้าจ่าย',
  sub_total_amount: 'ค่าสินค้า',
  platform_discount_amount: 'ส่วนลดแพลตฟอร์มช่วยจ่าย',
  seller_discount_amount: 'ส่วนลดที่ร้านออกเอง',
  shipping_fee_amount: 'ค่าส่งที่ลูกค้าจ่าย',
  actual_shipping_fee_amount: 'ค่าส่งจริง',
  shipping_fee_subsidy_amount: 'ค่าส่งที่แพลตฟอร์มช่วย',
  shipping_fee_platform_discount_amount: 'ส่วนลดค่าส่งจากแพลตฟอร์ม',
  shipping_fee_seller_discount_amount: 'ส่วนลดค่าส่งที่ร้านออก',
  platform_commission_amount: 'ค่าคอมมิชชั่น',
  referral_fee_amount: 'ค่าคอมมิชชั่น',
  transaction_fee_amount: 'ค่าธรรมเนียมชำระเงิน',
  payment_fee_amount: 'ค่าธรรมเนียมชำระเงิน',
  affiliate_commission_amount: 'ค่าคอมแอฟฟิลิเอต',
  affiliate_partner_commission_amount: 'ค่าคอมพาร์ตเนอร์',
  sfp_service_fee_amount: 'ค่าบริการส่งโดยแพลตฟอร์ม',
  logistics_fee_amount: 'ค่าขนส่ง',
  sales_fee_amount: 'ค่าธรรมเนียมการขาย',
  voucher_amount: 'คูปอง',
  refund_amount: 'คืนเงิน',
  adjustment_amount: 'ปรับปรุงรายการ',
  revenue_amount: 'รายรับก่อนหัก',
  fee_amount: 'ค่าธรรมเนียมรวม',
  settlement_amount: 'ยอดเข้าจริง',
};

export function feeLabel(key) {
  const bare = key.split('.').pop();
  return FEE_LABEL[bare] || bare.replace(/_amount$/, '').replace(/_/g, ' ');
}

// รายการที่เอาไปโชว์เป็น "หักอะไรไปบ้าง" — ตัดตัวสรุปรวมออก เหลือเฉพาะรายการย่อย
const ROLLUP = new Set(['revenue_amount', 'fee_amount', 'settlement_amount', 'total_amount']);

export function feeLines(breakdown) {
  if (!breakdown) return [];
  return Object.entries(breakdown)
    .filter(([k]) => !ROLLUP.has(k.split('.').pop()))
    .map(([k, v]) => ({ key: k, label: feeLabel(k), amount: Number(v) }))
    .sort((a, b) => a.amount - b.amount);   // ตัวที่หักหนักสุด (ติดลบมากสุด) ขึ้นก่อน
}

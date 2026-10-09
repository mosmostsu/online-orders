// ส่วนขยาย Chrome (extensions/mvp-stock) รายงานผลแต่ละรอบ → แจ้งเตือนเข้า Telegram
// แจ้งทั้งตอนสำเร็จและตอนพัง — รอบ 18:00 ทำงานตอนไม่มีคนเฝ้า ถ้าพังเงียบจะไม่มีใครรู้ว่าคลัง MVP ค้าง
import { NextResponse } from 'next/server';
import { notifyPaused } from '@/lib/line';
import { pushTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key || req.headers.get('x-key') !== key) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  const r = await req.json().catch(() => ({}));
  const how = r.trigger === 'auto' ? 'รอบอัตโนมัติ' : 'กดเอง';
  let text;
  if (r.ok && r.changed === 0) {
    text = `🛒 คลัง Shopee MVP (${how}): ตรงกับ ST อยู่แล้ว ไม่มีอะไรเปลี่ยน`;
  } else if (r.ok) {
    text = [
      `🛒 อัปเดตคลัง Shopee MVP สำเร็จ (${how})`,
      `เปลี่ยน ${fmt(r.changed)} ตัวเลือก (ลด ${fmt(r.down)} / เพิ่ม ${fmt(r.up)}) จาก ${fmt(r.rows)}`,
      r.upload ? `Shopee รับ ${fmt(r.upload.success)}/${fmt(r.upload.total)} สินค้า` : null,
      r.missing ? `ไม่มีใน ST ${fmt(r.missing)} ตัว (คงค่าเดิม${r.missingWithStock ? ` · ยังมีคลังค้าง ${fmt(r.missingWithStock)}` : ''})` : null,
      r.stFileAt ? `ST ไฟล์: ${new Date(new Date(r.stFileAt).getTime() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ')}` : null,
    ].filter(Boolean).join('\n');
  } else {
    text = `⚠️ อัปเดตคลัง Shopee MVP ไม่สำเร็จ (${how})\n${String(r.error || 'ไม่ทราบสาเหตุ').slice(0, 300)}`;
  }
  // เข้า Telegram อย่างเดียว (ผู้ใช้ขอไว้ 2026-10-09) — ไม่ใช้ pushText เพราะนั่นส่ง LINE ด้วย
  // MVP_TELEGRAM_CHAT_ID = ห้องแยกสำหรับเรื่องคลัง (ไม่ตั้ง = ห้องหลักของเว็บ)
  // ยังเคารพ NOTIFY_START เหมือนการแจ้งอื่น
  if (notifyPaused()) return NextResponse.json({ ok: true, skipped: 'หยุดแจ้งชั่วคราว (NOTIFY_START)' });
  const sent = await pushTelegram(text, { chatId: process.env.MVP_TELEGRAM_CHAT_ID });
  return NextResponse.json({ ok: true, sent: Boolean(sent.ok), skipped: sent.skipped || undefined });
}

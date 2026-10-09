// ส่วนขยาย Chrome (extensions/mvp-stock) รายงานผลแต่ละรอบ → แจ้งเตือนเข้า Telegram
// แจ้งทั้งตอนสำเร็จและตอนพัง — รอบ 20:00 ทำงานตอนไม่มีคนเฝ้า ถ้าพังเงียบจะไม่มีใครรู้ว่าคลัง MVP ค้าง
//
// หน้าตาเดียวกับรายงานของโน้ตบุ๊ก Colab (tg_step_report ใน sync_stock_all_platforms_v12) ที่ส่งเข้าห้องเดียวกัน:
//   ✅ ชื่อขั้น / เวลา · ใช้เวลา / สรุป / 10 SKU แรก "sku  เดิม → ใหม่" / ที่เหลือแนบเป็น CSV (sku,old,new,status)
import { NextResponse } from 'next/server';
import { notifyPaused } from '@/lib/line';
import { pushTelegram, pushTelegramFile } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const LABEL = 'Shopee MVP';
const PREVIEW = 10;   // เท่ากับ TG_SKU_PREVIEW ของ Colab
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const thTime = (iso, withDate = false) => {
  const d = new Date(new Date(iso || Date.now()).getTime() + 7 * 3600000).toISOString();
  return withDate ? `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}` : d.slice(11, 16);
};
const dur = (a, b) => {
  const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) || 0;
  return s < 60 ? `${s} วิ` : `${Math.floor(s / 60)} นาที ${s % 60} วิ`;
};
const csvSafe = (s) => String(s).replace(/[,\r\n]/g, ' ');

export async function POST(req) {
  const key = process.env.MVP_STOCK_KEY;
  if (!key || req.headers.get('x-key') !== key) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }
  if (notifyPaused()) return NextResponse.json({ ok: true, skipped: 'หยุดแจ้งชั่วคราว (NOTIFY_START)' });

  const r = await req.json().catch(() => ({}));
  const how = r.trigger === 'auto' ? 'รอบ 20:00' : 'กดเอง';
  const changes = Array.isArray(r.changes) ? r.changes : [];
  const missingList = Array.isArray(r.missingList) ? r.missingList : [];
  // รายงานเข้าห้องเรื่องคลัง (Stock sync noti) ถ้าตั้งไว้ ไม่งั้นห้องหลักของเว็บ
  const opts = { chatId: process.env.MVP_TELEGRAM_CHAT_ID };

  const lines = [
    `${r.ok ? '✅' : '❌'} ${LABEL} (${how})`,
    `${thTime(r.finished)} · ใช้เวลา ${dur(r.started, r.finished)}`,
  ];
  if (!r.ok) {
    lines.push(`ไม่สำเร็จ: ${String(r.error || 'ไม่ทราบสาเหตุ').slice(0, 300)}`);
  } else if (!r.changed) {
    lines.push('ตรงกับ ST อยู่แล้ว ไม่มีอะไรเปลี่ยน');
  } else {
    lines.push(`อัปเดต ${fmt(r.changed)} SKU (ลด ${fmt(r.down)} / เพิ่ม ${fmt(r.up)})`
      + (r.upload ? ` · Shopee รับ ${fmt(r.upload.success)}/${fmt(r.upload.total)} สินค้า` : ''));
  }
  if (r.missingWithStock) lines.push(`ไม่มีใน ST แต่ MVP ยังมีคลัง ${fmt(r.missingWithStock)} SKU (คงค่าเดิม)`);
  if (r.stFileAt) lines.push(`ST: ${thTime(r.stFileAt, true)}`);

  if (r.ok && changes.length) {
    lines.push('');
    for (const [sku, old, neu] of changes.slice(0, PREVIEW)) lines.push(`   ${sku}  ${old} → ${neu}`);
    if (changes.length > PREVIEW) lines.push(`   ... อีก ${changes.length - PREVIEW} รายการ (ดูไฟล์แนบ)`);
  }

  const sent = await pushTelegram(lines.join('\n'), opts);
  const stamp = thTime(r.finished).replace(':', '');
  if (r.ok && changes.length > PREVIEW) {
    const rows = ['sku,old,new,status', ...changes.map(([s, o, n]) => `${csvSafe(s)},${o},${n},ok`)];
    await pushTelegramFile(`${stamp}_Shopee_MVP.csv`, rows.join('\n'), `${LABEL} — รายการเต็ม ${changes.length} SKU`, opts);
  }
  if (missingList.length) {
    const rows = ['sku,mvp_stock', ...missingList.map(([s, c]) => `${csvSafe(s)},${c}`)];
    await pushTelegramFile(`${stamp}_Shopee_MVP_not_in_ST.csv`, rows.join('\n'),
      `${LABEL} — SKU ที่ไม่มีใน ST แต่ยังมีคลัง ${missingList.length} ตัว (เช็ครหัสที่ลงบน Shopee)`, opts);
  }
  return NextResponse.json({ ok: true, sent: Boolean(sent.ok), skipped: sent.skipped || undefined });
}

// ตัวช่วยตั้งค่า Telegram ครั้งแรก — หา chat id ของห้อง แล้วลองส่งข้อความทดสอบ
//
// ใช้ยังไง (ใส่ key=SYNC_SECRET ต่อท้ายทุกครั้ง):
//   1. สร้างบอทกับ @BotFather ใน Telegram → ได้ token → ตั้ง TELEGRAM_BOT_TOKEN ที่ Netlify
//   2. ชวนบอทเข้ากลุ่ม แล้วพิมพ์อะไรก็ได้ในกลุ่มหนึ่งข้อความ (บอทจะเห็นห้องต่อเมื่อมีข้อความ)
//   3. เปิด /api/telegram/setup?key=... → ได้ chat id ของกลุ่ม → ตั้ง TELEGRAM_CHAT_ID
//   4. เปิด /api/telegram/setup?key=...&test=1 → ต้องมีข้อความเด้งเข้ากลุ่ม
import { NextResponse } from 'next/server';
import { pushTelegram, getUpdates } from '@/lib/telegram';
import { notifyPaused, notifyPlatforms } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  if (process.env.SYNC_SECRET && url.searchParams.get('key') !== process.env.SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: 'key ไม่ถูกต้อง' }, { status: 401 });
  }

  const config = {
    'มี TELEGRAM_BOT_TOKEN': Boolean(process.env.TELEGRAM_BOT_TOKEN),
    'TELEGRAM_CHAT_ID': process.env.TELEGRAM_CHAT_ID || null,
    'LINE ยังเปิดอยู่': Boolean(process.env.LINE_MESSAGING_TOKEN && process.env.LINE_NOTIFY_TO),
    'เตือนเฉพาะช่องทาง': notifyPlatforms() || 'ทุกช่องทาง',
    'หยุดแจ้งถึง': notifyPaused(),
  };

  if (url.searchParams.get('test') === '1') {
    const res = await pushTelegram(
      'ทดสอบจาก order-sync — ถ้าเห็นข้อความนี้แปลว่าตั้งค่าเสร็จแล้ว\n' +
      'ต่อไปใบยกเลิกหลังแพ็ค ออเดอร์ส่งด่วน และสรุปใบค้างตอนเย็น จะเข้ามาทางนี้'
    );
    return NextResponse.json({ ok: Boolean(res.ok), config, ผลการส่ง: res });
  }

  const up = await getUpdates();
  return NextResponse.json({
    ok: true,
    config,
    'ห้องที่บอทเห็น': up.rooms || [],
    'ทำต่อ': up.rooms?.length
      ? 'เอา id ของห้องที่ต้องการไปตั้งเป็น TELEGRAM_CHAT_ID ที่ Netlify แล้วเรียกซ้ำด้วย &test=1'
      : 'ยังไม่เห็นห้องไหน — ชวนบอทเข้ากลุ่มแล้วพิมพ์ข้อความในกลุ่มหนึ่งครั้ง จากนั้นเปิดหน้านี้ใหม่',
    error: up.error,
  });
}

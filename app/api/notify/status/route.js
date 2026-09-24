// สถานะการแจ้งเตือนแบบเปิดดูได้ — ตอบแค่ว่า "ตั้งค่าไว้ไหม" ไม่เผยโทเคนหรือรหัสห้อง
// มีไว้เพื่อเช็คหลังเปลี่ยน env ว่าฟังก์ชันมองเห็นค่าใหม่แล้วจริง (env จะมีผลก็ต่อเมื่อ deploy รอบใหม่)
import { NextResponse } from 'next/server';
import { notifyPaused, notifyPlatforms } from '@/lib/line';
import { telegramReady } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    telegram: telegramReady() ? 'พร้อมส่ง' : 'ยังไม่ได้ตั้งค่า',
    line: process.env.LINE_MESSAGING_TOKEN && process.env.LINE_NOTIFY_TO ? 'พร้อมส่ง' : 'ยังไม่ได้ตั้งค่า',
    'LINE เตือนเฉพาะช่องทาง': notifyPlatforms() || 'ทุกช่องทาง',
    'Telegram เตือนทุกช่องทาง': true,
    'หยุดแจ้งถึง': notifyPaused() || 'ไม่ได้หยุด',
  });
}

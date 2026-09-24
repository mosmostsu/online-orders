// แจ้งเตือนเข้า Telegram — ฟรี ไม่มีโควตารายเดือนเหมือน LINE
// ตั้ง env ที่ Netlify: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (ใส่หลายห้องได้ คั่นด้วยคอมมา)
// ถ้ายังไม่ได้ตั้ง → ข้ามเงียบๆ ไม่ทำให้การซิงก์พัง

export function telegramReady() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Telegram รับข้อความยาวสุด 4096 ตัวอักษรต่อครั้ง
// สรุปใบค้างตอนเย็นยาวเกินได้ง่าย ถ้าไม่ตัดจะไม่ได้รับทั้งก้อน
// ตัดตรงรอยขึ้นบรรทัดเพื่อไม่ให้รายการใบไหนขาดกลางบรรทัด
const LIMIT = 3900;
function chunk(text) {
  const out = [];
  let buf = '';
  for (const line of String(text).split('\n')) {
    const piece = line.length > LIMIT ? line.slice(0, LIMIT) : line;
    if ((buf + '\n' + piece).length > LIMIT) {
      if (buf) out.push(buf);
      buf = piece;
    } else {
      buf = buf ? buf + '\n' + piece : piece;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [''];
}

export async function pushTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const to = process.env.TELEGRAM_CHAT_ID;
  if (!token || !to) return { skipped: true };

  const rooms = to.split(',').map((s) => s.trim()).filter(Boolean);
  const parts = chunk(text);
  const results = [];

  for (const room of rooms) {
    for (const part of parts) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: room,
            text: part,
            // ไม่ให้ขึ้นการ์ดพรีวิวลิงก์ท้ายข้อความ กินที่จนอ่านรายการไม่สะดวก
            disable_web_page_preview: true,
          }),
        });
        const body = await res.json().catch(() => ({}));
        results.push({ to: room, ok: res.ok && body.ok !== false, status: res.status, error: body.description });
      } catch (e) {
        results.push({ to: room, ok: false, error: e.message });
      }
    }
  }

  const ok = results.some((r) => r.ok);
  if (!ok) console.error('ส่ง Telegram ไม่สำเร็จ:', JSON.stringify(results.filter((r) => !r.ok)).slice(0, 300));
  return { ok, sent: results.length, results };
}

// ถามว่าบอทเห็นห้องไหนอยู่ — ใช้ตอนตั้งค่าครั้งแรกเพื่อหา chat id
// (ต้องมีคนพิมพ์ข้อความในห้องนั้นก่อน บอทจึงจะเห็น)
export async function getUpdates() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { error: 'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const j = await res.json();
    const rooms = new Map();
    for (const u of j.result || []) {
      const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (c?.id) rooms.set(String(c.id), { id: String(c.id), type: c.type, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' });
    }
    return { ok: j.ok !== false, rooms: [...rooms.values()], error: j.description };
  } catch (e) {
    return { error: e.message };
  }
}

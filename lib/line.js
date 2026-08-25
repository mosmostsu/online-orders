// แจ้งเตือนเข้า LINE ผ่าน Messaging API (ตัวเดียวกับที่ samchai2004.com ใช้อยู่)
// ตั้ง env: LINE_MESSAGING_TOKEN + LINE_NOTIFY_TO (userId/groupId คั่นด้วยคอมมาได้)
// ถ้ายังไม่ได้ตั้ง env → ข้ามเงียบๆ ไม่ทำให้การซิงก์พัง
export async function pushText(text) {
  const token = process.env.LINE_MESSAGING_TOKEN;
  const to = process.env.LINE_NOTIFY_TO;
  if (!token || !to) return { skipped: true };

  const targets = to.split(',').map((s) => s.trim()).filter(Boolean);
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ to: t, messages: [{ type: 'text', text }] }),
        });
        return { to: t, ok: res.ok, status: res.status };
      } catch (e) {
        return { to: t, ok: false, error: e.message };
      }
    })
  );
  return { sent: results.length, results };
}

const SITE = process.env.URL || 'https://order-sync-solid.netlify.app';
const th = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const baht = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');

// เด้งทันทีเมื่อเจอใบที่ยกเลิกทั้งที่ของถูกหยิบมาแพ็คแล้ว — ยิ่งรู้เร็วยิ่งดึงของทัน
export function riskyCancelMessage(o, items) {
  const list = (items || [])
    .map((i) => `  · ${i.sku || '(ไม่มี SKU)'} × ${i.qty}`)
    .join('\n');
  return (
    `🚨 ยกเลิกแล้ว ของยังอยู่ในกอง\n` +
    `${o.order_id} · ${o.shop}\n` +
    `${list || '  (ไม่มีรายการ)'}\n` +
    `ยอด ${baht(o.total)}\n\n` +
    `กดส่งไว้ ${th(o.rts_at)} น.\n` +
    `ยกเลิก ${th(o.cancelled_at)} น.${o.cancel_reason ? ` — ${o.cancel_reason}` : ''}\n\n` +
    `รีบเอาออกจากกองก่อนรถมารับ\n` +
    `${SITE}/orders?status=risky`
  );
}

// สรุปตอนเย็น: ใบที่แพ็คไว้แล้วแต่ยังไม่ได้ออกจากร้าน
export function packedSummaryMessage(rows) {
  if (!rows.length) return `✅ เคลียร์หมด ไม่มีใบค้างรอขนส่ง`;
  const lines = rows.slice(0, 20).map((o) => {
    const skus = (o.os_order_items || []).map((i) => `${i.sku}×${i.qty}`).join(' ');
    return `· ${o.order_id}\n  ${skus}${o.note ? `\n  💬 ${o.note}` : ''}`;
  });
  return (
    `📦 ค้างในกอง ${rows.length} ใบ ยังไม่ออกจากร้าน\n\n` +
    lines.join('\n') +
    (rows.length > 20 ? `\n... และอีก ${rows.length - 20} ใบ` : '') +
    `\n\nใบไหนของหมด/ขนส่งลืมยิง ใส่คอมเมนต์ไว้ด้วย\n${SITE}/orders?status=packed`
  );
}

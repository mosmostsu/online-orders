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
  // ok=true ต่อเมื่อถึงปลายทางอย่างน้อยหนึ่งที่จริงๆ
  // LINE ปฏิเสธได้หลายกรณี เช่นโควต้าเดือนนั้นเต็ม (429) ต้องรู้เพื่อจะได้ลองใหม่
  const ok = results.some((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  if (!ok) console.error('ส่ง LINE ไม่สำเร็จ:', JSON.stringify(failed).slice(0, 200));
  return { ok, sent: results.length, results };
}

const SITE = process.env.URL || 'https://order-sync-solid.netlify.app';
const th = (s) =>
  s ? new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const baht = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');
const PLATFORM_NAME = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop' };
const chan = (o) => `${PLATFORM_NAME[o.platform] || o.platform || ''} ${o.shop || ''}`.trim();

// เด้งทันทีเมื่อเจอใบที่ยกเลิกทั้งที่ของถูกหยิบมาแพ็คแล้ว — ยิ่งรู้เร็วยิ่งดึงของทัน
export function riskyCancelMessage(o, items) {
  const list = (items || [])
    .map((i) => `  · ${i.sku || '(ไม่มี SKU)'} × ${i.qty}`)
    .join('\n');

  // ใบส่งด่วนไรเดอร์มารับในไม่กี่สิบนาที ต่างจากส่งปกติที่รอรถรอบเย็น (เฉลี่ย 7 ชั่วโมง)
  // ต้องบอกให้ชัดว่าอันไหนวิ่งเดี๋ยวนี้
  if (o.is_express) {
    return (
      `⚡🚨 ด่วนที่สุด — ยกเลิกใบส่งด่วน\n` +
      `${chan(o)}\n` +
      `${o.order_id}\n` +
      `${list || '  (ไม่มีรายการ)'}\n` +
      `ยอด ${baht(o.total)}\n\n` +
      `ขนส่ง ${o.carrier || '-'} (มารับเร็ว)\n` +
      `กดส่งไว้ ${th(o.rts_at)} น.\n` +
      `ยกเลิก ${th(o.cancelled_at)} น.${o.cancel_reason ? ` — ${o.cancel_reason}` : ''}\n\n` +
      `⚡ วิ่งไปเอาออกเดี๋ยวนี้ คนขับมารับไม่กี่นาที\n` +
      `${SITE}/orders?status=risky`
    );
  }

  return (
    `🚨 ยกเลิกแล้ว ของยังอยู่ในกอง\n` +
    `${chan(o)}\n` +
    `${o.order_id}\n` +
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
  // ใบส่งด่วนขึ้นก่อน เพราะรอไม่ได้เท่าใบธรรมดา
  const sorted = [...rows].sort((a, b) => (b.is_express ? 1 : 0) - (a.is_express ? 1 : 0));
  const expressCount = rows.filter((o) => o.is_express).length;
  const lines = sorted.slice(0, 20).map((o) => {
    const skus = (o.os_order_items || []).map((i) => `${i.sku}×${i.qty}`).join(' ');
    return `${o.is_express ? '⚡ ' : '· '}${o.order_id} · ${chan(o)}\n  ${skus}${o.note ? `\n  💬 ${o.note}` : ''}`;
  });
  return (
    `📦 ค้างในกอง ${rows.length} ใบ ยังไม่ออกจากร้าน` +
    (expressCount ? ` (ส่งด่วน ${expressCount} ใบ)` : '') +
    `\n\n` +
    lines.join('\n') +
    (rows.length > 20 ? `\n... และอีก ${rows.length - 20} ใบ` : '') +
    `\n\nใบไหนของหมด/ขนส่งลืมยิง ใส่คอมเมนต์ไว้ด้วย\n${SITE}/orders?status=packed`
  );
}

// ออเดอร์ส่งด่วนเข้าใหม่ — ช้อปปี้บังคับแพ็คภายใน 2 ชั่วโมง ต้องรู้ตั้งแต่เข้ามา
export function newExpressMessage(o, items) {
  const list = (items || [])
    .map((i) => {
      const name = i.product_name ? `\n    ${String(i.product_name).slice(0, 45)}` : '';
      return `  · ${i.sku || '(ไม่มี SKU)'} × ${i.qty}${name}`;
    })
    .join('\n');
  return (
    `⚡ ออเดอร์ส่งด่วนเข้าใหม่\n` +
    `${chan(o)}\n` +
    `${o.order_id}\n` +
    `${list || '  (ไม่มีรายการ)'}\n` +
    `ยอด ${baht(o.total)}${o.is_cod ? ' · เก็บเงินปลายทาง' : ''}\n\n` +
    `ขนส่ง ${o.carrier || '-'}\n` +
    (o.ship_by ? `ต้องส่งภายใน ${th(o.ship_by)} น.\n` : '') +
    `\nรีบแพ็คก่อนใบอื่น\n` +
    `${SITE}/orders?status=to_ship`
  );
}

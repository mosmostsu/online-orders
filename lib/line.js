// ศูนย์รวมการแจ้งเตือน — การแจ้งทุกแบบผ่าน pushText ตรงนี้หมด
//
// ส่งได้สองทาง ตั้ง env ทางไหนก็ส่งทางนั้น ตั้งทั้งคู่ก็ส่งทั้งคู่
//   Telegram (ฟรี ไม่มีโควตาเดือน) : TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   LINE     (โควตา 300 ข้อความ/เดือน และนับตามจำนวนคนในกลุ่ม) : LINE_MESSAGING_TOKEN + LINE_NOTIFY_TO
// ถ้าไม่ได้ตั้งเลย → ข้ามเงียบๆ ไม่ทำให้การซิงก์พัง
//
// หยุดแจ้งจนถึงวันที่กำหนด — ตั้ง NOTIFY_START=2026-10-01 ที่ Netlify แล้วจะเงียบจนถึงวันนั้น
// เช็คที่ pushText จุดเดียวเหมือนกัน ไม่มีทางหลุด
import { pushTelegram, telegramReady } from './telegram.js';
function beforeStart() {
  const start = (process.env.NOTIFY_START || '').trim();
  if (!start) return false;
  const t = Date.parse(start.length === 10 ? `${start}T00:00:00+07:00` : start);
  return Number.isFinite(t) && Date.now() < t;
}

// เช็คจากภายนอกได้ว่าตอนนี้หยุดแจ้งอยู่ไหม (ใช้ในหน้า dry run)
export function notifyPaused() {
  return beforeStart() ? (process.env.NOTIFY_START || '').trim() : null;
}

// ส่งแจ้งเตือน — Telegram ได้ทุกใบทุกช่องทางเพราะฟรี
// LINE มีโควตาจำกัด จึงได้เฉพาะช่องทางที่ตั้งไว้ใน NOTIFY_PLATFORMS
//
//   opts.platform  ช่องทางขายของใบนี้ ใช้ตัดสินว่าจะเข้า LINE ด้วยไหม (ไม่ใส่ = เข้าทั้งคู่)
//   opts.lineText  ข้อความฉบับสำหรับ LINE ถ้าต้องการคนละฉบับ (เช่นสรุปเย็นที่ตัดเหลือเฉพาะ Shopee)
//                  ใส่เป็นค่าว่าง/null = ไม่ต้องส่ง LINE รอบนี้
export async function pushText(text, opts = {}) {
  if (beforeStart()) return { ok: true, skipped: `ยังไม่ถึงวันเริ่มแจ้ง (${process.env.NOTIFY_START})` };

  const lineText = 'lineText' in opts ? opts.lineText : text;
  const lineOk = Boolean(lineText) && (!opts.platform || isNotifyPlatform(opts.platform));

  // ส่งทั้งสองทางพร้อมกัน ทางที่ไม่ได้ตั้ง env จะคืน skipped มาเอง
  const [tg, line] = await Promise.all([
    pushTelegram(text),
    lineOk ? pushLine(lineText) : Promise.resolve({ skipped: 'ไม่เข้าเงื่อนไขช่องทางของ LINE' }),
  ]);

  // ถือว่าสำเร็จถ้าถึงปลายทางอย่างน้อยหนึ่งทาง — LINE โควตาเต็มแต่ Telegram ส่งได้
  // ก็ไม่ควรให้ทั้งใบถูกนับว่าแจ้งไม่สำเร็จแล้วส่งซ้ำไม่จบ
  // และถ้าใบนี้ไม่เข้าเงื่อนไขของ LINE อยู่แล้ว การที่ LINE ไม่ส่งก็ไม่นับเป็นความผิดพลาด
  const ok = Boolean(tg.ok || line.ok);
  const skipped = tg.skipped && (line.skipped || !lineOk) ? true : undefined;
  return { ok, skipped, telegram: tg, line };
}

async function pushLine(text) {
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
// ── เตือนเฉพาะช่องทางไหน ───────────────────────────────────────────────
// ร้านขอให้เตือนเฉพาะ Shopee — TikTok ออเดอร์เยอะกว่ามาก แจ้งทุกใบแล้วเสียงดังเกินจนไม่มีใครอ่าน
// เปลี่ยนได้ที่ Netlify → Environment variables โดยไม่ต้องแก้โค้ด:
//   NOTIFY_PLATFORMS=shopee            (ค่าเริ่มต้น)
//   NOTIFY_PLATFORMS=shopee,tiktok     (หลายช่องทาง)
//   NOTIFY_PLATFORMS=all               (ทุกช่องทาง)
export function notifyPlatforms() {
  const raw = (process.env.NOTIFY_PLATFORMS ?? 'shopee').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === '*') return null;
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

// ใบนี้เข้าเงื่อนไขของ LINE ไหม (Telegram ได้ทุกใบอยู่แล้ว)
export function isNotifyPlatform(platform) {
  const list = notifyPlatforms();
  return !list || list.includes(String(platform || '').toLowerCase());
}

// คัดเหลือเฉพาะใบที่ LINE ต้องได้ — ใช้ทำสรุปฉบับ LINE ที่สั้นกว่าฉบับ Telegram
export function keepNotifyPlatforms(rows) {
  const list = notifyPlatforms();
  if (!list) return rows || [];
  return (rows || []).filter((r) => list.includes(String(r.platform || '').toLowerCase()));
}

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

// สรุปรอบเย็นรวมเป็นข้อความเดียว — ยกเลิกที่ยังไม่มีคนเก็บของออก + ใบที่แพ็คแล้วยังไม่ออกจากร้าน
// แยกสองข้อความแล้วคนอ่านทีละอัน สุดท้ายลืมอันหลัง รวมไว้อันเดียวจบในครั้งเดียว
export function dailySummaryMessage(risky, packed) {
  const parts = [];

  if (risky.length) {
    const lines = risky.slice(0, 15).map((o) => {
      const skus = (o.os_order_items || []).map((i) => `${i.sku}×${i.qty}`).join(' ');
      return `${o.is_express ? '⚡ ' : '· '}${o.order_id} · ${chan(o)}
  ${skus}
  ยกเลิก ${th(o.cancelled_at)} น.`;
    });
    parts.push(
      `🚨 ยกเลิกแล้วของยังอยู่ในกอง ${risky.length} ใบ — ยังไม่มีใครกดว่าเก็บออกแล้ว\n\n`
      + lines.join('\n')
      + (risky.length > 15 ? `\n... และอีก ${risky.length - 15} ใบ` : '')
      + `\n${SITE}/orders?status=risky`,
    );
  }

  if (packed.length) {
    const sorted = [...packed].sort((a, b) => (b.is_express ? 1 : 0) - (a.is_express ? 1 : 0));
    const expressCount = packed.filter((o) => o.is_express).length;
    const lines = sorted.slice(0, 20).map((o) => {
      const skus = (o.os_order_items || []).map((i) => `${i.sku}×${i.qty}`).join(' ');
      return `${o.is_express ? '⚡ ' : '· '}${o.order_id} · ${chan(o)}
  ${skus}${o.note ? `
  💬 ${o.note}` : ''}`;
    });
    parts.push(
      `📦 ค้างในกอง ${packed.length} ใบ ยังไม่ออกจากร้าน`
      + (expressCount ? ` (ส่งด่วน ${expressCount} ใบ)` : '')
      + `\n\n`
      + lines.join('\n')
      + (packed.length > 20 ? `\n... และอีก ${packed.length - 20} ใบ` : '')
      + `\nใบไหนของหมด/ขนส่งลืมยิง ใส่คอมเมนต์ไว้ด้วย\n${SITE}/orders?status=packed`,
    );
  }

  if (!parts.length) return null;   // ไม่มีอะไรค้าง = ไม่ต้องส่ง จะได้ไม่รบกวนทุกเย็น
  return `🕐 สรุปก่อนปิดร้าน\n\n${parts.join('\n\n———\n\n')}`;
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

// โควต้าข้อความของบัญชี LINE เดือนนี้ — บัญชีฟรีส่งได้จำกัดต่อเดือน
// ถ้าเต็มแล้วระบบจะส่งไม่ออก จึงควรเห็นตัวเลขนี้ก่อนที่จะพลาดการแจ้งเตือน
export async function getQuota() {
  const token = process.env.LINE_MESSAGING_TOKEN;
  const to = process.env.LINE_NOTIFY_TO;
  if (!token) return null;
  const headers = { authorization: 'Bearer ' + token };
  const groupId = (to || '').split(',')[0].trim();
  try {
    const [q, used, members] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers }).then((r) => r.json()),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }).then((r) => r.json()),
      // LINE นับโควต้าตามจำนวนผู้รับ ไม่ใช่จำนวนครั้งที่ส่ง
      // ส่งเข้ากลุ่มสามคนหนึ่งครั้ง = ใช้โควต้าสามข้อความ
      groupId.startsWith('C')
        ? fetch(`https://api.line.me/v2/bot/group/${groupId}/members/count`, { headers }).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]);
    const limit = q?.type === 'limited' ? Number(q.value) : null;   // none = ไม่จำกัด
    const total = Number(used?.totalUsage ?? 0);
    const perSend = Number(members?.count) || 1;
    const left = limit == null ? null : Math.max(0, limit - total);
    return {
      limit, used: total, left, perSend,
      // ตัวเลขที่ใช้ตัดสินใจจริงคือ "ส่งได้อีกกี่ครั้ง" ไม่ใช่ "เหลือกี่ข้อความ"
      sendsLeft: left == null ? null : Math.floor(left / perSend),
    };
  } catch {
    return null;
  }
}

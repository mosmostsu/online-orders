'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// ตัวเลือกของตะกร้าหนึ่งในโปร — ดูอย่างเดียว หรือกด "แก้ไข" แก้ราคาโปร/% · ปิดสวิตช์ = เอาออกจากโปร · แก้เป็นชุด · จำกัดการซื้อ
// แบบเดียวกับหน้าแก้โปรในหลังร้าน Shopee · บันทึกทีละตะกร้า (/api/discount/shopee) แล้วโชว์ผลรายตัวเลือก
// editable = ปลดล็อกรหัสแล้ว และโปรยังไม่หมดอายุ
// ใช้ทั้งหน้าโปร (ทุกแถวอยู่ในโปร) และหน้าสินค้า (แถวที่ inPromo === false = ยังไม่อยู่ เปิดสวิตช์ = ใส่เข้าโปร)
// startEditing: เปิดมาในโหมดแก้เลย (ตอนเลือกโปรจะใส่ตะกร้าเข้าไปใหม่)
// limit: จำกัดการซื้อเดิม · null = ไม่รู้ค่า → ซ่อนช่อง · ไม่ได้แก้ = ส่ง null ให้เซิร์ฟเวอร์ใช้ค่าล่าสุดในร้าน
// TikTok (platform="tiktok" → /api/discount/tiktok):
//   pct   = โปรแบบ % ลด (DIRECT_DISCOUNT) — แก้ช่อง % (จำนวนเต็ม) ราคาโปรคิดให้ดู · ไม่งั้นแก้ราคา (ราคาตายตัว ทศนิยมได้)
//   whole = โปรระดับตะกร้า (PRODUCT) — ทุกตัวเลือกใช้ค่าเดียวกัน เปิด/ปิด = ทั้งตะกร้า · ส่งเป็นหน่วยเดียว (model_id = รหัสตะกร้า)
const baht = (n) => (n === null || n === undefined || n === '' ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const offOf = (price, promo) => (price && promo ? Math.round((1 - promo / price) * 100) : null);
const MAX_OFF = 90;   // เพดานลดที่เว็บยอม (เซิร์ฟเวอร์เช็คซ้ำ — lib/discounts.js)
const PLAT = { shopee: 'Shopee', tiktok: 'TikTok' };
const pctPrice = (price, off) => (price && off ? Math.round(Number(price) * (1 - off / 100) * 100) / 100 : null);

export default function BasketEdit({ shop, discountId, itemId, rows, limit, editable, startEditing = false, onDone = null, platform = 'shopee', pct = false, whole = false }) {
  const router = useRouter();
  const inP = (r) => r.inPromo !== false;
  const tt = platform === 'tiktok';
  // ค่าที่แก้ในแบบร่าง (draft.promo): โปรแบบ % = % ลด · ไม่งั้น = ราคาโปร (บาท)
  const cur = (r) => (pct ? r.off : r.promo);
  const promoOf = (r, v) => (pct ? pctPrice(r.price, Number(v)) : Number(v));
  // ใส่ตะกร้าเข้าโปรใหม่ (startEditing) เปิดทุกตัวเลือกไว้ก่อน — ส่วนใหญ่ใส่ทั้งตะกร้า ปิดตัวที่ไม่เอาเอง
  const initDraft = () => Object.fromEntries(rows.map((r) => [r.sku_id, { on: inP(r) || Boolean(startEditing), promo: String(cur(r) ?? '') }]));
  const [editing, setEditing] = useState(Boolean(startEditing && editable));
  const [draft, setDraft] = useState(() => (startEditing && editable ? initDraft() : null));   // { [sku_id]: { on, promo } }
  const [lim, setLim] = useState(String(limit || 0));
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);           // { ok, text, fails: {sku_id: error} }
  const [, startTransition] = useTransition();

  // Shopee: ตะกร้าไม่มีตัวเลือก = model 0 · TikTok ระดับตะกร้า = รหัสตะกร้า
  const modelOf = (r) => (tt ? (whole ? String(itemId) : r.sku_id) : (r.sku_id === String(itemId) ? '0' : r.sku_id));
  const start = () => {
    setDraft(initDraft());
    setLim(String(limit || 0));
    setBulk('');
    setMsg(null);
    setEditing(true);
  };
  // ระดับตะกร้า: แก้แถวไหนก็เปลี่ยนทุกแถว (ค่าเดียวทั้งตะกร้า)
  const set = (k, patch) => setDraft((d) => (whole
    ? Object.fromEntries(Object.entries(d).map(([x, v]) => [x, { ...v, ...patch }]))
    : { ...d, [k]: { ...d[k], ...patch } }));

  const problems = useMemo(() => {
    if (!draft) return {};
    const out = {};
    for (const r of rows) {
      const d = draft[r.sku_id];
      if (!d?.on) continue;
      const p = Number(d.promo);
      if (pct) {
        if (!d.promo || !Number.isInteger(p) || p < 1) out[r.sku_id] = 'ใส่ % (จำนวนเต็ม)';
        else if (p > MAX_OFF) out[r.sku_id] = `ลดเกิน ${MAX_OFF}%`;
      } else if (!d.promo || !Number.isFinite(p) || p <= 0) out[r.sku_id] = 'ใส่ราคา';
      else if (r.price && p >= Number(r.price)) out[r.sku_id] = 'ต้องต่ำกว่าราคาปกติ';
      else if (r.price && offOf(r.price, p) > MAX_OFF) out[r.sku_id] = `ลดเกิน ${MAX_OFF}%`;
    }
    return out;
  }, [draft, rows, pct]);

  const changes = useMemo(() => {
    if (!draft) return { set: [], remove: [] };
    const s = [], rm = [];
    const item = (r) => ({ model_id: modelOf(r), [pct ? 'discount' : 'price']: Number(draft[r.sku_id].promo) });
    const has = (r) => s.some((x) => x.model_id === modelOf(r)) || rm.includes(modelOf(r));   // ระดับตะกร้า: หลายแถว = หน่วยเดียว
    for (const r of rows) {
      const d = draft[r.sku_id];
      if (has(r)) continue;
      if (!d.on) { if (inP(r)) rm.push(modelOf(r)); }
      else if (!inP(r) || Number(d.promo) !== Number(cur(r))) s.push(item(r));
    }
    // จำกัดการซื้อเป็นค่าระดับตะกร้า — เปลี่ยนแล้วต้องส่งทุกตัวที่ยังอยู่ในโปร
    if (limit !== null && Number(lim) !== Number(limit || 0)) {
      for (const r of rows) if (draft[r.sku_id].on && !has(r)) s.push(item(r));
    }
    return { set: s, remove: rm };
  }, [draft, rows, lim, limit, pct, whole]);

  function applyBulk(kind) {
    const v = Number(bulk);
    if (!Number.isFinite(v) || v <= 0) return;
    setDraft((d) => Object.fromEntries(rows.map((r) => {
      const x = d[r.sku_id];
      if (!x.on) return [r.sku_id, x];
      // โปรแบบ %: ค่าคือ % ตรงๆ · Shopee บาทเต็ม (ปัดทศนิยมเอง) · TikTok ราคาตายตัวทศนิยม 2 ตำแหน่งได้
      const round = (y) => (tt ? Math.round(y * 100) / 100 : Math.round(y));
      const promo = pct ? Math.round(v) : round(kind === 'pct' ? Number(r.price) * (1 - v / 100) : v);
      return [r.sku_id, { ...x, promo: String(promo) }];
    })));
  }

  async function save() {
    const n = changes.set.length + changes.remove.length;
    if (!n || Object.keys(problems).length) return;
    if (changes.remove.length && !confirm(tt && whole ? 'เอาทั้งตะกร้าออกจากโปร?' : `เอา ${changes.remove.length} ตัวเลือกออกจากโปร?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/discount/${tt ? 'tiktok' : 'shopee'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // จำกัดการซื้อส่งเฉพาะตอนผู้ใช้แก้ — ไม่งั้นส่ง null ให้เซิร์ฟเวอร์ใช้ค่าล่าสุดใน Shopee (หน้าอาจค้างนาน ค่าเก่า)
          // ตัวไหนอยู่ในโปรแล้ว เซิร์ฟเวอร์อ่านจากร้านเอง ไม่ต้องส่ง
          shop, discountId, itemId,
          purchaseLimit: limit !== null && Number(lim) !== Number(limit || 0) ? Number(lim) || 0 : null,
          set: changes.set, remove: changes.remove,
        }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.results) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
      const errOf = new Map(j.results.filter((r) => r.error).map((r) => [r.model_id, r.error]));
      const fails = Object.fromEntries(rows.filter((r) => errOf.has(modelOf(r))).map((r) => [r.sku_id, errOf.get(modelOf(r))]));
      const okN = j.results.length - errOf.size;
      setMsg({ ok: !errOf.size, text: `บันทึกแล้ว ${okN}/${j.results.length} ${tt && whole ? 'ตะกร้า' : 'ตัวเลือก'}`, fails });
      if (!errOf.size) { setEditing(false); if (onDone) onDone(); }
      // ดึงหน้าใหม่ให้เห็นค่าจากร้าน (อาจหน่วงไม่กี่วินาที)
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg({ ok: false, text: `พลาด: ${e.message}`, fails: {} });
    } finally {
      setBusy(false);
    }
  }

  const nChange = changes.set.length + changes.remove.length;
  return (
    <div className="bedit">
      {editable && !editing && (
        <div className="bedit-bar">
          <button type="button" className="btn" onClick={start}>แก้ไข</button>
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
        </div>
      )}
      {editing && (
        <div className="bedit-bar">
          <span className="sku">แก้เป็นชุด:</span>
          <input className="bin" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="ค่า" inputMode="decimal" />
          <button type="button" className="btn" onClick={() => applyBulk('pct')}>% ลด</button>
          {!pct && <button type="button" className="btn" onClick={() => applyBulk('price')}>฿ ราคา</button>}
          {limit !== null && (
            <>
              <span className="sku" style={{ marginLeft: 8 }}>จำกัดการซื้อ</span>
              <input className="bin" value={lim} onChange={(e) => setLim(e.target.value.replace(/\D/g, ''))} inputMode="numeric" title="0 = ไม่จำกัด" />
              <span className="sku">ชิ้น/คน (0 = ไม่จำกัด)</span>
            </>
          )}
        </div>
      )}
      <div className="skutable-wrap">
        <table className="dopts">
          <thead>
            <tr>
              {editing && <th>ในโปร</th>}
              <th>ตัวเลือก</th><th>SKU</th><th className="r">ราคาปกติ</th><th className="r">ราคาโปร</th><th className="r">ลด</th><th className="r">คลัง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draft?.[r.sku_id];
              const promo = editing ? promoOf(r, d.promo) : r.promo;
              const off = editing && !d.on ? null : offOf(r.price, promo);
              const st = r.stock === null || r.stock === undefined ? null : Number(r.stock);
              const prob = editing && problems[r.sku_id];
              const fail = msg?.fails?.[r.sku_id];
              const changed = editing && (d.on !== inP(r) || (d.on && Number(d.promo) !== Number(cur(r))));
              return (
                <tr key={r.sku_id} className={(editing && !d.on ? 'boff ' : '') + (changed ? 'bchg' : '')}>
                  {editing && (
                    <td><label className="tg"><input type="checkbox" checked={d.on} onChange={(e) => set(r.sku_id, { on: e.target.checked })} /><i /></label></td>
                  )}
                  <td>{r.model_name || <span className="sku">(ไม่มีตัวเลือก)</span>}{fail && <div className="danger" style={{ fontSize: 12 }}>✕ {fail}</div>}</td>
                  <td className="mono">{r.seller_sku || <span className="sku">—</span>}</td>
                  <td className="num">{baht(r.price)}</td>
                  <td className="num">
                    {editing && !pct ? (
                      <>
                        <input className={'bin ' + (prob ? 'bad' : '')} value={d.promo} disabled={!d.on} inputMode={tt ? 'decimal' : 'numeric'}
                          onChange={(e) => set(r.sku_id, { promo: e.target.value.replace(tt ? /[^0-9.]/g : /[^0-9]/g, '') })} />
                        {prob && <div className="danger" style={{ fontSize: 11 }}>{prob}</div>}
                      </>
                    ) : editing ? (d.on && r.price ? (
                      // โปรแบบ %: พิมพ์ราคาลดได้ (แบบ BigSeller) — กดออก/Enter แล้วแปลงเป็น % จำนวนเต็มที่ใกล้สุด (TikTok รับแค่ %)
                      // ราคาที่ได้จริงจึงอาจขยับจากที่พิมพ์เล็กน้อย เช่น 225 พิมพ์ 190 → 16% = 189
                      <input key={d.promo} className="bin" defaultValue={promo ?? ''} inputMode="decimal" title="พิมพ์ราคาลด แล้วระบบแปลงเป็น % ให้"
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        onBlur={(e) => {
                          const v = Number(e.target.value.replace(/[^0-9.]/g, ''));
                          if (!(v > 0) || v === promo) return;
                          set(r.sku_id, { promo: String(Math.round((1 - v / Number(r.price)) * 100)) });
                        }} />
                    ) : d.on ? <span className="promo">{baht(promo)}</span> : '—')
                      : inP(r) ? <span className="promo">{baht(r.promo)}</span> : <span className="sku">ไม่อยู่ในโปร</span>}
                  </td>
                  <td className="num doff">
                    {editing && d.on && pct ? (
                      <>
                        <input className={'bin pct ' + (prob ? 'bad' : '')} value={d.promo} inputMode="numeric"
                          onChange={(e) => set(r.sku_id, { promo: e.target.value.replace(/[^0-9]/g, '') })} />
                        {prob && <div className="danger" style={{ fontSize: 11 }}>{prob}</div>}
                      </>
                    ) : editing && d.on ? (
                      <input className="bin pct" value={off ?? ''} inputMode="decimal"
                        onChange={(e) => {
                          const x = Number(r.price) * (1 - Number(e.target.value) / 100);
                          set(r.sku_id, { promo: e.target.value === '' ? '' : String(tt ? Math.round(x * 100) / 100 : Math.round(x)) });
                        }} />
                    ) : off !== null ? `-${off}%` : '—'}
                  </td>
                  <td className={'num ' + (st === 0 ? 'danger' : '')}>{st === 0 ? 'หมด' : st ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="bedit-bar">
          <span className="sku">
            {nChange ? `ใส่/แก้ ${changes.set.length} · เอาออก ${changes.remove.length} ${tt && whole ? 'ตะกร้า' : 'ตัวเลือก'}` : 'ยังไม่ได้แก้อะไร'}
            {tt && whole && <> · โปรนี้ตั้งทั้งตะกร้า ทุกตัวเลือกใช้ค่าเดียวกัน</>}
            {Object.keys(problems).length > 0 && <span className="danger"> · ยังมี {Object.keys(problems).length} ช่องไม่ถูก</span>}
          </span>
          <span style={{ flex: 1 }} />
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
          <button type="button" className="btn" onClick={() => { setEditing(false); setMsg(null); if (onDone) onDone(); }} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn dark" onClick={save} disabled={busy || !nChange || Object.keys(problems).length > 0}>
            {busy ? 'กำลังบันทึก…' : `บันทึกขึ้น ${PLAT[platform] || platform}`}
          </button>
        </div>
      )}
    </div>
  );
}

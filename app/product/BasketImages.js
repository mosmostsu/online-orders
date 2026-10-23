'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ImageEditOne from './ImageEditOne';
import CoverMaker from './CoverMaker';

// ส่วน "รูปสินค้า" ในหน้าแก้ไขสินค้า (Shopee / Lazada / TikTok) — บันทึกที่ /api/basket/<platform> action 'images'
//   รูปสินค้า: เรียงใหม่ (← →) · เอาออก · เพิ่มจากรูปที่ตะกร้ามีอยู่ หรืออัปโหลดจากเครื่อง · รูปแรก = รูปปก
//   รูปตัวเลือก (ชั้นแรก เช่น สี): เปลี่ยนรูปของตัวเลือกเดิม · ลบรูปตัวเลือกไม่ได้ (Shopee/TikTok บังคับมีทุกตัวหรือไม่มีเลย)
//   ✎ แก้รูป: แปะโลโก้ร้าน / ปิดโลโก้เดิม (ImageEditOne) → อัปเป็นรูปใหม่แทนที่ตำแหน่งเดิม
//   สร้างปกใหม่ (CoverMaker): เลือกรูปสี / มุมอื่น / คนใส่ (รวมของร้านอื่น) + แบบจัดวาง + โลโก้ร้าน → วางเป็นรูปแรก (เต็มแล้วตัดรูปท้ายออก)
// อัปโหลด = เข้าคลังรูปของแพลตฟอร์ม (ยังไม่ผูกตะกร้า) · ยังไม่เขียนลงร้านจนกด "บันทึกรูป" · ตรวจซ้ำที่เซิร์ฟเวอร์ทุกอย่าง
const LABEL = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok' };

export default function BasketImages({ platform, shop, itemId, plan }) {
  const label = LABEL[platform] || platform;
  const router = useRouter();
  const max = plan.maxImages || 8;
  const tier0 = plan.hasModel ? plan.tiers[0] : null;
  const [main, setMain] = useState(() => (plan.main || []).filter((x) => x.image_url));
  const [opt, setOpt] = useState({});          // ข้อความตัวเลือก → { image_id, image_url } ที่เปลี่ยนใหม่
  const [pick, setPick] = useState(null);      // null | 'main' | ข้อความตัวเลือกที่กำลังเลือกรูป
  const [extra, setExtra] = useState([]);      // รูปที่อัปโหลดรอบนี้ — เลือกซ้ำได้
  const [edit, setEdit] = useState(null);      // null | { url, main: image_id } | { url, opt: ข้อความตัวเลือก } รูปที่กำลังแก้
  const [cover, setCover] = useState(false);   // หน้าต่างสร้างปกใหม่
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const pool = [...new Map([...(plan.gallery || []), ...extra].filter((g) => g.image_url).map((g) => [g.image_id, g])).values()];
  const mainChanged = main.map((x) => x.image_id).join('\u0001') !== (plan.main || []).map((x) => x.image_id).join('\u0001');
  const nOpt = Object.keys(opt).length;
  const dirty = mainChanged || nOpt > 0;

  const move = (i, d) => setMain((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const choose = (g) => {
    if (pick === 'main') {
      if (main.some((x) => x.image_id === g.image_id)) { setMsg({ ok: false, text: 'รูปนี้มีในรูปสินค้าแล้ว' }); return; }
      if (main.length >= max) { setMsg({ ok: false, text: `${label} ใส่รูปสินค้าได้ไม่เกิน ${max} รูป` }); return; }
      setMain((l) => [...l, g]);
    } else if (pick) {
      setOpt((o) => ({ ...o, [pick]: g }));
    }
    setMsg(null); setPick(null);
  };

  // อัปไฟล์เข้าคลังรูปของแพลตฟอร์ม → { image_id, image_url }
  async function send(file, use) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('รูปต้องเป็น JPG หรือ PNG');
    if (file.size > 4 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 4MB');
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
    const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', shop, data, type: file.type, use }) });
    const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
    if (!j.ok) throw new Error(j.error);
    const g = { image_id: j.image_id, image_url: /^https:/.test(j.image_id) ? j.image_id : URL.createObjectURL(file) };
    setExtra((l) => [...l, g]);
    return g;
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true); setMsg(null);
    try { choose(await send(file, pick === 'main' ? 'main' : 'option')); }
    catch (e) { setMsg({ ok: false, text: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(false); }
  }

  // รูปที่แก้เสร็จ → อัปแล้วแทนที่รูปเดิมตำแหน่งเดิม (error โยนกลับให้หน้าแก้รูปโชว์)
  async function edited(file) {
    const g = await send(file, edit.main ? 'main' : 'option');
    if (edit.main) setMain((l) => l.map((x) => (x.image_id === edit.main ? g : x)));
    else setOpt((o) => ({ ...o, [edit.opt]: g }));
    setEdit(null); setPick(null);
    setMsg({ ok: true, text: 'แก้รูปแล้ว — กด "บันทึกรูป" เพื่อเขียนลงร้าน' });
  }

  // รูปให้เลือกทำปกใหม่: รูปสี (รวมที่เปลี่ยนแล้วยังไม่บันทึก) · รูปสินค้าตะกร้านี้ · รูปสีจากร้านอื่น (plan.siblings)
  // + ปุ่มโหลดรูปทุกรูปของตะกร้าร้านอื่น (plan.sibItems → GET ?gallery=)
  const https = (u) => /^https:/.test(u || '');
  const colorImgs = (tier0?.options || []).map((o) => ({ url: opt[o.text]?.image_url || o.image_url, label: o.text, group: `รูป${tier0.name}` })).filter((x) => https(x.url));
  const coverPool = [
    ...colorImgs,
    ...main.filter((g) => https(g.image_url)).map((g, i) => ({ url: g.image_url, label: `รูปสินค้าที่ ${i + 1}${i === 0 ? ' (ปกตอนนี้)' : ''}`, group: 'รูปสินค้าตะกร้านี้' })),
    ...(plan.siblings || []).filter((x) => https(x.image_url)).map((x) => ({ url: x.image_url, label: `${x.opts.join(' / ')} · ${x.from.join(', ')}`, group: 'รูปสีจากร้านอื่น' })),
  ];
  const coverMore = (plan.sibItems || []).map((x) => ({
    label: x.label,
    load: async () => {
      const r = await fetch(`/api/basket/${platform}?${new URLSearchParams({ shop, itemId, gallery: x.platform, gshop: x.shop, gid: x.id })}`);
      const j = await r.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${r.status}` }));
      if (!j.ok) throw new Error(j.error);
      return j.images;
    },
  }));
  async function covered(file) {
    const g = await send(file, 'main');
    const cut = main.length >= max;
    setMain((l) => [g, ...l].slice(0, max));
    setCover(false);
    setMsg({ ok: true, text: `ใส่ปกใหม่เป็นรูปแรกแล้ว${cut ? ` (รูปเต็ม ${max} — ตัดรูปท้ายออก 1 รูป)` : ''} — กด "บันทึกรูป" เพื่อเขียนลงร้าน` });
  }

  async function save() {
    const lines = [mainChanged && `รูปสินค้า ${main.length} รูป (เรียง/เพิ่ม/ลบ)`, nOpt && `รูปตัวเลือก ${nOpt} ตัว: ${Object.keys(opt).join(', ')}`].filter(Boolean);
    if (!window.confirm(`บันทึกรูปลงตะกร้าจริงใน ${label} ${shop}?\n\n${lines.join('\n')}${platform === 'tiktok' ? '\n\nTikTok ต้องรอตรวจก่อนรูปใหม่จะขึ้น' : ''}`)) return;
    setBusy(true); setMsg(null);
    try {
      const body = {
        action: 'images', shop, itemId,
        main: mainChanged ? main.map((x) => x.image_id) : null,
        options: nOpt ? Object.fromEntries(Object.entries(opt).map(([k, g]) => [k, g.image_id])) : null,
      };
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `✓ บันทึกรูปแล้ว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setOpt({});
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const reset = () => { setMain((plan.main || []).filter((x) => x.image_url)); setOpt({}); setPick(null); setMsg(null); };

  return (
    <section className="pcard esec">
      <div className="eimg-head">
        <h2 className="esec-h" style={{ margin: 0 }}>รูปสินค้า</h2>
        <div className="etop-r">
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
          {!msg && dirty && <span className="sku">ยังไม่ได้บันทึก</span>}
          {dirty && <button type="button" className="btn" onClick={reset} disabled={busy}>ยกเลิก</button>}
          <button type="button" className="btn dark" onClick={save} disabled={busy || !dirty || plan.auditing || !main.length}>{busy ? 'กำลังบันทึก…' : 'บันทึกรูป'}</button>
        </div>
      </div>
      {plan.auditing && <div className="note" style={{ margin: '10px 0' }}>การแก้ไขครั้งก่อนของตะกร้านี้ยังรอ TikTok ตรวจ — แก้รูปได้หลังผ่านตรวจ</div>}

      <div className="erow">
        <div className="elabel">รูปสินค้า <span className="sku">{main.length}/{max}</span></div>
        <div className="efield">
          <div className="sub" style={{ margin: '0 0 4px' }}>
            กดรูปเพื่อแก้ (แปะโลโก้ / ปิดโลโก้เดิม)
            {coverPool.length > 0 && (
              <button type="button" className="chip" style={{ marginLeft: 8 }} disabled={busy} onClick={() => setCover(true)}
                title={`โลโก้ ${shop} + เลือกรูปมุมอื่น / รูปคนใส่ / รูปสี มาจัดปกใหม่ ไม่ให้ซ้ำร้านอื่น`}>＋ สร้างปกใหม่</button>
            )}
          </div>
          <div className="eimgs">
            {main.map((g, i) => (
              <div key={g.image_id} className="eimg mimg">
                <button type="button" className="mimg-edit" onClick={() => setEdit({ url: g.image_url, main: g.image_id })} title="แก้รูป (แปะโลโก้ / ปิดโลโก้เดิม)">
                  <img src={g.image_url} alt="" loading="lazy" />
                  <span className="mimg-pen">✎</span>
                </button>
                {i === 0 && <span className="mimg-cover">ปก</span>}
                <span className="mimg-bar">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="เลื่อนซ้าย">←</button>
                  <button type="button" onClick={() => setMain((l) => l.filter((x) => x.image_id !== g.image_id))} disabled={main.length <= 1} title="เอาออก">✕</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === main.length - 1} title="เลื่อนขวา">→</button>
                </span>
              </div>
            ))}
            {main.length < max && (
              <button type="button" className={'eimg eimg-add' + (pick === 'main' ? ' on' : '')} onClick={() => setPick(pick === 'main' ? null : 'main')}>
                <span className="eimg-empty">+ เพิ่มรูป</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {tier0 && tier0.options.some((o) => o.image_url || opt[o.text]) && (
        <div className="erow">
          <div className="elabel">รูปตัวเลือก <span className="sku">({tier0.name})</span></div>
          <div className="efield">
            <div className="eimgs">
              {tier0.options.map((o) => {
                const g = opt[o.text] || (o.image_url ? { image_url: o.image_url } : null);
                return (
                  <button key={o.text} type="button" className={'eimg eimg-opt' + (opt[o.text] ? ' new' : '') + (pick === o.text ? ' on' : '')}
                    onClick={() => setPick(pick === o.text ? null : o.text)} title="กดเพื่อเปลี่ยนรูป">
                    {g ? <img src={g.image_url} alt="" loading="lazy" /> : <span className="eimg-empty">+ รูป</span>}
                    <span className="sku clamp1">{o.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="sub" style={{ margin: '4px 0 0' }}>กดรูปเพื่อเปลี่ยน · กรอบเหลือง = เปลี่ยนแล้วยังไม่บันทึก</div>
          </div>
        </div>
      )}

      {pick !== null && (
        <div className="note" style={{ marginTop: 8 }}>
          <b>{pick === 'main' ? 'เพิ่มรูปสินค้า' : `รูปของ ${pick}`}</b> <span className="sku">— เลือกจากรูปที่ตะกร้ามีอยู่ หรืออัปโหลดจากเครื่อง (JPG/PNG ไม่เกิน 4MB)</span>
          <div className="basket-img">
            {pool.map((g) => (
              <button key={g.image_id} type="button" className="pick" onClick={() => choose(g)} title="ใช้รูปนี้">
                <img src={g.image_url} alt="" loading="lazy" />
              </button>
            ))}
            <label className="btn" style={{ padding: '4px 10px' }}>{busy ? 'กำลังอัปโหลด…' : 'อัปโหลด…'}
              <input type="file" accept="image/jpeg,image/png" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {pick !== 'main' && (opt[pick]?.image_url || tier0?.options.find((o) => o.text === pick)?.image_url) && (
              <button type="button" className="btn" style={{ padding: '4px 10px' }} disabled={busy}
                onClick={() => setEdit({ url: opt[pick]?.image_url || tier0.options.find((o) => o.text === pick).image_url, opt: pick })}>✎ แก้รูปนี้</button>
            )}
            <button type="button" className="btn" onClick={() => setPick(null)}>ปิด</button>
          </div>
        </div>
      )}

      {edit && (
        <ImageEditOne shop={shop} url={edit.url} title={`แก้รูป${edit.opt ? `ของ ${edit.opt}` : 'สินค้า'} — ${label} ${shop}`}
          onDone={edited} onCancel={() => setEdit(null)} />
      )}
      {cover && (
        <CoverMaker shop={shop} images={coverPool} more={coverMore} pre={colorImgs.map((x) => x.url)} query={plan.title || ''}
          heading={`สร้างปกใหม่ — ${label} ${shop}`} onDone={covered} onCancel={() => setCover(false)} />
      )}
    </section>
  );
}

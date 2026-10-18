'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ส่วน "รูปสินค้า" ในหน้าแก้ไขสินค้า (Shopee / Lazada / TikTok) — บันทึกที่ /api/basket/<platform> action 'images'
//   รูปสินค้า: เรียงใหม่ (← →) · เอาออก · เพิ่มจากรูปที่ตะกร้ามีอยู่ หรืออัปโหลดจากเครื่อง · รูปแรก = รูปปก
//   รูปตัวเลือก (ชั้นแรก เช่น สี): เปลี่ยนรูปของตัวเลือกเดิม · ลบรูปตัวเลือกไม่ได้ (Shopee/TikTok บังคับมีทุกตัวหรือไม่มีเลย)
// อัปโหลด = เข้าคลังรูปของแพลตฟอร์ม (ยังไม่ผูกตะกร้า) · ยังไม่เขียนลงร้านจนกด "บันทึกรูป" · ตรวจซ้ำที่เซิร์ฟเวอร์ทุกอย่าง
const LABEL = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok' };

// onSaved({ main, options }) — บอกหน้าแก้ไขว่าบันทึกอะไรไป (เปิดแผง "ใช้กับร้านอื่นด้วย")
export default function BasketImages({ platform, shop, itemId, plan, onSaved }) {
  const label = LABEL[platform] || platform;
  const router = useRouter();
  const max = plan.maxImages || 8;
  const tier0 = plan.hasModel ? plan.tiers[0] : null;
  const [main, setMain] = useState(() => (plan.main || []).filter((x) => x.image_url));
  const [opt, setOpt] = useState({});          // ข้อความตัวเลือก → { image_id, image_url } ที่เปลี่ยนใหม่
  const [pick, setPick] = useState(null);      // null | 'main' | ข้อความตัวเลือกที่กำลังเลือกรูป
  const [extra, setExtra] = useState([]);      // รูปที่อัปโหลดรอบนี้ — เลือกซ้ำได้
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

  async function upload(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setMsg({ ok: false, text: 'รูปต้องเป็น JPG หรือ PNG' }); return; }
    if (file.size > 4 * 1024 * 1024) { setMsg({ ok: false, text: 'รูปใหญ่เกิน 4MB' }); return; }
    setBusy(true); setMsg(null);
    try {
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', shop, data, type: file.type, use: pick === 'main' ? 'main' : 'option' }) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) throw new Error(j.error);
      const g = { image_id: j.image_id, image_url: /^https:/.test(j.image_id) ? j.image_id : URL.createObjectURL(file) };
      setExtra((l) => [...l, g]);
      choose(g);
    } catch (e) { setMsg({ ok: false, text: `อัปโหลดรูปไม่สำเร็จ: ${e.message}` }); }
    finally { setBusy(false); }
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
      onSaved?.({ main: mainChanged, options: nOpt });
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
          <div className="eimgs">
            {main.map((g, i) => (
              <div key={g.image_id} className="eimg mimg">
                <img src={g.image_url} alt="" loading="lazy" />
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
            <button type="button" className="btn" onClick={() => setPick(null)}>ปิด</button>
          </div>
        </div>
      )}
    </section>
  );
}

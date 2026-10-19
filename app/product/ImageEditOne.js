'use client';
// แก้รูปทีละรูปในหน้าแก้ไขสินค้า (เปิดจาก BasketImages) — แปะโลโก้ร้านทับ / วางกล่องสีปิดโลโก้เดิม
// ใช้ชิ้นส่วนเดียวกับหน้าแก้รูปก่อนโคลน (app/compare/ImageEditor.js) · โลโก้จำในเบราว์เซอร์ร่วมกัน (แยกตามชื่อร้าน)
// ยืนยัน → วาดรูปใหม่เป็น JPEG ในเบราว์เซอร์ → onDone(File) ให้ BasketImages อัปขึ้นคลังรูปแล้วแทนที่รูปเดิม (ยังไม่บันทึกลงร้าน)
import { useRef, useState } from 'react';
import Modal from './Modal';
import { Box, proxied, render, sampleColor, useShopLogo } from '../compare/ImageEditor';

const MAX = 4 * 1024 * 1024;   // ตรงกับเพดานอัปโหลดใน BasketImages

export default function ImageEditOne({ shop, url, title, onDone, onCancel }) {
  const { logo, ratio, pick } = useShopLogo(shop);
  const [box, setBox] = useState(null);       // กล่องโลโก้ { x, y, w, h } (0..1 ของรูป)
  const [covers, setCovers] = useState([]);   // กล่องปิด [{ x, y, w, h, color }]
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const stage = useRef(null);
  const imgRef = useRef(null);

  const ar = () => (imgRef.current ? imgRef.current.naturalWidth / imgRef.current.naturalHeight : 1);   // กว้าง/สูง ของรูป
  const addLogo = () => { const w = 0.22; setBox({ x: 0.01, y: 0.01, w, h: w * ratio * ar() }); };
  const addCover = () => {
    const b = { x: 0.01, y: 0.01, w: 0.22, h: 0.09 };
    setCovers((l) => [...l, { ...b, color: imgRef.current ? sampleColor(imgRef.current, b) : '#ffffff' }]);
  };
  const pickLogo = async (file) => {
    if (!file) return;
    try {
      const r = await pick(file);
      setBox((b) => (b ? { ...b, h: b.w * r * ar() } : b));
    } catch (e) { setErr(e.message); }
  };

  const edited = Boolean(box) || covers.length > 0;
  async function confirm() {
    if (box && !logo) { setErr(`ยังไม่มีโลโก้ ${shop} — กด "อัปโลโก้" ก่อน`); return; }
    setErr('');
    try {
      setBusy('กำลังวาดรูป…');
      let blob = null;
      for (const q of [0.92, 0.8, 0.65]) {
        blob = await (await fetch(await render({ url, logo: box, covers }, logo, q))).blob();
        if (blob.size <= MAX) break;
      }
      setBusy('กำลังอัปรูป…');
      await onDone(new File([blob], 'edited.jpg', { type: 'image/jpeg' }));
    } catch (e) {
      setErr(String(e.message || e));
      setBusy('');
    }
  }

  return (
    <Modal title={title || 'แก้รูป'} onClose={onCancel} busy={Boolean(busy)} wide>
      <div className="ie-main">
        <div className="ie-tools">
          <button type="button" className="chip" disabled={Boolean(box) || Boolean(busy)} onClick={addLogo}>＋ แปะโลโก้ {shop}</button>
          <button type="button" className="chip" disabled={Boolean(busy)} onClick={addCover}>＋ กล่องปิดโลโก้เดิม</button>
          {covers.map((k, i) => (
            <label key={i} className="sku ie-color">สีกล่อง {i + 1}
              <input type="color" value={k.color} onChange={(e) => setCovers((l) => l.map((c, j) => (j === i ? { ...c, color: e.target.value } : c)))} />
            </label>
          ))}
          <span className="psep" />
          {logo && <img src={logo} alt="" className="ie-logo-prev" title={`โลโก้ ${shop}`} />}
          <label className="chip ie-upl">{logo ? 'เปลี่ยนโลโก้' : 'อัปโลโก้'} {shop}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <div className="ie-stage" ref={stage}>
          <img ref={imgRef} src={proxied(url)} alt="" crossOrigin="anonymous" draggable={false} onError={() => setErr('โหลดรูปไม่ได้')} />
          {covers.map((k, i) => (
            <Box key={`c${i}`} stage={stage} b={k} label="กล่องปิด"
              onChange={(nb) => setCovers((l) => l.map((c, j) => (j === i ? nb : c)))}
              onRemove={() => setCovers((l) => l.filter((_, j) => j !== i))}>
              <div className="ie-fill" style={{ background: k.color }} />
            </Box>
          ))}
          {box && (
            <Box stage={stage} b={box} ratio={ratio} label={`โลโก้ ${shop}`} onChange={setBox} onRemove={() => setBox(null)}>
              {logo ? <img src={logo} alt="" className="ie-fill" draggable={false} /> : <div className="ie-fill ie-nologo">ยังไม่มีโลโก้</div>}
            </Box>
          )}
        </div>
        <div className="sku">ลากกล่องเพื่อย้าย · ลากมุมขวาล่างเพื่อย่อ/ขยาย · × เพื่อเอาออก · สีกล่องปิดดูดจากพื้นรอบๆ ให้อัตโนมัติ เปลี่ยนเองได้</div>
        {err && <div className="note note-danger">{err}</div>}
        <div className="etop-r" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={Boolean(busy)}>ยกเลิก</button>
          <button type="button" className="btn dark" onClick={confirm} disabled={Boolean(busy) || !edited}>{busy || 'ใช้รูปนี้'}</button>
        </div>
      </div>
    </Modal>
  );
}

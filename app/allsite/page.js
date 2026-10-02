// ลงครบไหม — สินค้าใน Seniorsoft (ไฟล์ ST กลาง) ลงขายครบทุกร้านหรือยัง + รหัสน่าสงสัยที่อาจลงผิด
// ต่อยอดจาก ../allsitepd (ที่ต้องอัปไฟล์ export ของทุกร้านเองทุกครั้ง) — ตอนนี้ใช้สินค้าที่ดึงไว้ใน os_listings
//
// มุมมอง "ลงครบไหม": แถวละรุ่น+สี (ชื่อใน ST ตัดไซส์ท้ายออก) ช่องร้าน = ลงแล้วกี่ไซส์จากทั้งหมด กางดูทีละไซส์ได้
// มุมมอง "รหัสน่าสงสัย": SKU บนร้านที่ไม่มีใน ST / ไม่ได้ใส่ SKU / SKU เดียวกันอยู่หลายตะกร้า
// ตรรกะทั้งหมดอยู่ในฐานข้อมูล ถามครั้งเดียวต่อหน้า (supabase/035)
import Link from 'next/link';
import { db } from '@/lib/supabase';
import { shopsFrom, listingLabel } from '@/lib/listings';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncSt from './SyncSt';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', thisshop: 'ThisShop' };
const VIEWS = [
  { key: 'match', label: 'ลงครบไหม' },
  { key: 'sus', label: 'รหัสน่าสงสัย' },
];
const STATES = [
  { key: 'partial', label: 'ลงไม่ครบ' },
  { key: 'none', label: 'ยังไม่ลงเลย' },
  { key: 'complete', label: 'ครบแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
];
const STOCKS = [
  { key: 'in', label: 'เฉพาะที่มีของ' },
  { key: 'all', label: 'รวมของหมด' },
];
const KINDS = [
  { key: 'notst', label: 'ไม่มีใน ST', hint: 'รหัสผิด หรือเป็นรหัสเก่าที่ลบจาก Seniorsoft แล้ว' },
  { key: 'empty', label: 'ไม่ได้ใส่ SKU', hint: 'ตัวเลือกที่ช่อง SKU ว่าง — ตัดสต็อกไม่ได้' },
  { key: 'dup', label: 'SKU ซ้ำหลายตะกร้า', hint: 'รหัสเดียวกันลงไว้มากกว่าหนึ่งตะกร้าในร้านเดียวกัน' },
  { key: 'space', label: 'มีเว้นวรรค', hint: 'SKU มีช่องว่างหน้า/หลัง — หน้านี้ตัดทิ้งตอนเทียบ แต่ตัวซิงก์สต็อกอาจจับคู่ไม่ได้ ควรแก้ในหลังร้าน' },
];

const num = (n) => Number(n || 0).toLocaleString('en-US');
const keyOf = (s) => `${s.platform}:${s.shop}`;
const shortLabel = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${s.shop === 'THISSHOP' ? '' : s.shop}`.trim();

export default async function AllSitePage({ searchParams }) {
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp?.view) ? sp.view : 'match';
  const q = String(sp?.q || '').trim();
  const page = Math.max(1, Number(sp?.page) || 1);
  const pq = q.replace(/[%_]/g, ' ').trim();   // % _ เป็นอักขระพิเศษของ ilike

  // รายชื่อร้าน — ถามรวบกับข้อมูลของหน้า (ฟังก์ชันส่ง shop_list มาด้วย) แต่ต้องรู้ร้านก่อนจะถาม
  // จึงใช้ค่าที่ส่งมาในลิงก์ ไม่มีก็ถามรายชื่อร้านก่อนหนึ่งครั้ง
  let shops = [];
  let picked = String(sp?.sh || '').split(',').filter(Boolean);
  if (view === 'match' && !picked.length) {
    const { data } = await db().rpc('os_listing_shops');
    shops = shopsFrom(data);
    picked = shops.map(keyOf);
  }
  const stock = STOCKS.some((s) => s.key === sp?.stock) ? sp.stock : 'in';
  const state = STATES.some((s) => s.key === sp?.state) ? sp.state : 'partial';
  const brand = String(sp?.brand || '');
  // "ดูที่ร้าน" — สถานะ/จำนวนคิดจากร้านเดียว (supabase/037) · ร้านนั้นต้องอยู่ในร้านที่เทียบด้วย
  const focus = view === 'match' && /^[a-z]+:.+/.test(String(sp?.focus || '')) ? String(sp.focus) : '';
  if (focus && !picked.includes(focus)) picked.push(focus);
  const focusIdx = focus ? picked.indexOf(focus) + 1 : 0;
  const kind = KINDS.some((k) => k.key === sp?.kind) ? sp.kind : 'notst';
  const [spf, ssh] = String(sp?.s || '').split(':');

  let err = null, d = null;
  try {
    const res = view === 'match'
      ? await db().rpc('os_allsite_page', {
        p_shops: picked.map((k) => k.split(':')), p_stock: stock, p_state: state,
        p_brand: brand, p_q: pq, p_page: page, p_size: PAGE_SIZE,
        // ส่งเฉพาะตอนเลือกร้าน — ฐานข้อมูลที่ยังไม่ได้รัน 037 จะได้ยังเปิดแบบรวมทุกร้านได้
        ...(focusIdx ? { p_focus: focusIdx } : {}),
      })
      : await db().rpc('os_allsite_suspects', {
        p_platform: spf || 'shopee', p_shop: ssh || 'REAL', p_kind: kind, p_q: pq, p_page: page, p_size: PAGE_SIZE,
      });
    if (res.error) throw new Error(res.error.message);
    d = res.data;
  } catch (e) {
    err = String(e.message || e);
  }
  if (d?.shop_list) shops = shopsFrom(d.shop_list);
  const cols = picked.map((k) => shops.find((s) => keyOf(s) === k)).filter(Boolean);
  const susShop = shops.find((s) => s.platform === (spf || 'shopee') && s.shop === (ssh || 'REAL')) || shops[0];

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { view, sh: view === 'match' ? picked.join(',') : null, focus, stock, state, brand, kind, s: view === 'sus' && susShop ? keyOf(susShop) : null, q, page, ...o };
    const defaults = { view: 'match', stock: 'in', state: 'partial', kind: 'notst' };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '' || defaults[k] === x || (k === 'page' && Number(x) === 1)) continue;
      // ร้านที่เลือกครบทุกร้าน = ค่าเริ่มต้น ไม่ต้องใส่ในลิงก์
      if (k === 'sh' && x === shops.map(keyOf).join(',')) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/allsite?${s}` : '/allsite';
  };
  const toggleShop = (k) => {
    const next = picked.includes(k) ? picked.filter((x) => x !== k) : shops.map(keyOf).filter((x) => x === k || picked.includes(x));
    // เอาร้านที่กำลัง "ดูที่ร้าน" ออก = เลิกดูร้านนั้นด้วย
    return qs({ sh: (next.length ? next : [k]).join(','), focus: next.includes(focus) ? focus : '', page: 1 });
  };
  const focusShop = shops.find((s) => keyOf(s) === focus);
  const where = focusShop ? `ใน ${shortLabel(focusShop)}` : '';
  const total = d?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = d?.rows || [];
  const productHref = (s, id) => `/product/${s.platform}/${encodeURIComponent(s.shop)}/${encodeURIComponent(id)}`;

  return (
    <>
      <Nav active="allsite" />

      <div className="row">
        <div>
          <h1>ลงครบทุกร้านหรือยัง</h1>
          <div className="sub">
            ตั้งต้นจากไฟล์ ST (Seniorsoft)
            {d?.st && <> · {num(d.st.row_count)} รหัส · ไฟล์วันที่ {fmtTimeTH(d.st.file_modified)} น.</>}
            {d?.st?.on_refreshed_at && <> · เทียบกับสินค้าในร้านเมื่อ {fmtTimeTH(d.st.on_refreshed_at)} น.</>}
          </div>
        </div>
        <SyncSt />
      </div>

      <div className="ptabs">
        {VIEWS.map((v) => (
          <Link prefetch key={v.key} className="ptab" data-on={view === v.key ? '1' : '0'} href={qs({ view: v.key, page: 1, q: '' })}>{v.label}</Link>
        ))}
      </div>

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/035</code> และ <code>036</code> ใน Supabase แล้วกด “ดึงไฟล์ ST” ก่อน
        </div>
      )}

      {!err && view === 'match' && (
        <>
          <div className="mcards">
            <div className="mcard"><span className="mlabel">รุ่น+สี ({stock === 'in' ? 'ที่มีของ' : 'ทั้งหมด'})</span><b>{num(d?.counts?.all)}</b></div>
            <div className="mcard hero"><span className="mlabel">{focusShop ? `ลงครบ${where}` : 'ลงครบทุกร้านที่เลือก'}</span><b>{num(d?.counts?.complete)}</b></div>
            <div className="mcard"><span className="mlabel">ลงไม่ครบ{where && ` ${where}`}</span><b className="lowstock">{num(d?.counts?.partial)}</b></div>
            <div className="mcard"><span className="mlabel">{focusShop ? `ยังไม่ลงเลย${where}` : 'ยังไม่ลงเลยสักร้าน'}</span><b className="danger">{num(d?.counts?.none)}</b></div>
          </div>

          <div className="pcard">
            <div className="asel">
              <span className="sku">เทียบกับร้าน:</span>
              {shops.map((s) => (
                <Link prefetch={false} key={keyOf(s)} className="chip" data-on={picked.includes(keyOf(s)) ? '1' : '0'} href={toggleShop(keyOf(s))}>
                  {picked.includes(keyOf(s)) ? '☑' : '☐'} {shortLabel(s)}
                </Link>
              ))}
            </div>
            {/* ดูสถานะของร้านเดียว — เช่น TikTok + "ยังไม่ลงเลย" = รุ่นที่มีของแต่ยังไม่ได้ลง TikTok */}
            <div className="asel">
              <span className="sku">ดูที่ร้าน:</span>
              <Link prefetch={false} className="chip" data-on={!focus ? '1' : '0'} href={qs({ focus: '', page: 1 })}>ทุกร้านรวมกัน</Link>
              {cols.map((s) => (
                <Link prefetch={false} key={keyOf(s)} className="chip" data-on={focus === keyOf(s) ? '1' : '0'} href={qs({ focus: keyOf(s), page: 1 })}>
                  {shortLabel(s)}
                </Link>
              ))}
            </div>

            <div className="ptools">
              <form className="search" action="/allsite" method="get">
                {picked.join(',') !== shops.map(keyOf).join(',') && <input type="hidden" name="sh" value={picked.join(',')} />}
                {stock !== 'in' && <input type="hidden" name="stock" value={stock} />}
                {state !== 'partial' && <input type="hidden" name="state" value={state} />}
                {brand && <input type="hidden" name="brand" value={brand} />}
                {focus && <input type="hidden" name="focus" value={focus} />}
                <input name="q" defaultValue={q} placeholder="ค้นชื่อรุ่น หรือรหัส SKU" autoComplete="off" inputMode="search" />
                {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
                <button className="btn" type="submit">ค้นหา</button>
              </form>
            </div>

            <div className="pbar">
              <span className="psort">
                {STATES.map((s) => (
                  <Link prefetch={false} key={s.key} className="chip" data-on={state === s.key ? '1' : '0'} href={qs({ state: s.key, page: 1 })}>
                    {s.label}{s.key !== 'all' ? ` ${num(d?.counts?.[s.key])}` : ''}
                  </Link>
                ))}
                <span className="psep" />
                {STOCKS.map((s) => (
                  <Link prefetch={false} key={s.key} className="chip" data-on={stock === s.key ? '1' : '0'} href={qs({ stock: s.key, page: 1 })}>{s.label}</Link>
                ))}
              </span>
              <form action="/allsite" method="get" className="psort">
                {Object.entries({ sh: picked.join(',') !== shops.map(keyOf).join(',') ? picked.join(',') : '', stock: stock !== 'in' ? stock : '', state: state !== 'partial' ? state : '', focus, q })
                  .filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <select name="brand" defaultValue={brand} className="aselect">
                  <option value="">ทุกยี่ห้อ</option>
                  {(d?.brands || []).map((b) => <option key={b.brand} value={b.brand}>{b.brand} ({num(b.n)})</option>)}
                </select>
                <button className="btn" type="submit">กรอง</button>
              </form>
            </div>

            {rows.length === 0 ? (
              <div className="note">ไม่มีรายการ{q ? ` ที่ตรงกับ “${q}”` : ''}</div>
            ) : (
              <div className="atable-wrap">
                <table className="atable">
                  <thead>
                    <tr>
                      <th className="l">รุ่น + สี</th>
                      <th>คงเหลือ</th>
                      {cols.map((s) => <th key={keyOf(s)} data-plat={s.platform} className={keyOf(s) === focus ? 'afocus' : ''}>{shortLabel(s)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.group}>
                        <td className="l">
                          <details>
                            <summary>
                              <b>{r.group}</b>
                              <div className="sku">{r.brand || '—'} · {r.cat || '—'} · {r.n} ไซส์</div>
                            </summary>
                            <table className="ainner">
                              <thead><tr><th className="l">SKU</th><th>คงเหลือ</th>{cols.map((s) => <th key={keyOf(s)}>{shortLabel(s)}</th>)}</tr></thead>
                              <tbody>
                                {(r.items || []).map((it) => (
                                  <tr key={it.sku}>
                                    <td className="l mono">{it.sku}</td>
                                    <td>{num(it.qty)}</td>
                                    {cols.map((s, i) => (
                                      it.on?.[i]
                                        ? <td key={keyOf(s)} className="a-ok">Y</td>
                                        // ยังไม่ลง ทั้งที่มีของ = ตัวที่ควรไปลง ทำตัวหนาให้เห็นชัด
                                        : <td key={keyOf(s)} className={Number(it.qty) > 0 ? 'a-miss' : 'a-no'}>N</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </td>
                        <td>{num(r.qty)}</td>
                        {cols.map((s, i) => {
                          const on = r.per?.[i] ?? 0;
                          const fc = keyOf(s) === focus ? ' afocus' : '';
                          return on === r.n ? <td key={keyOf(s)} className={'a-ok' + fc}>✓ {on}/{r.n}</td>
                            : on === 0 ? <td key={keyOf(s)} className={'a-no' + fc}>—</td>
                              : <td key={keyOf(s)} className={'a-part' + fc}>⚠ {on}/{r.n}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!err && view === 'sus' && susShop && (
        <div className="pcard">
          <div className="asel">
            {shops.map((s) => (
              <Link prefetch={false} key={keyOf(s)} className="chan" data-plat={s.platform} data-shop={s.shop}
                data-on={keyOf(s) === keyOf(susShop) ? '1' : '0'} href={qs({ s: keyOf(s), page: 1 })}>
                {PLATFORM_LABEL[s.platform]} <b>{s.shop}</b>
              </Link>
            ))}
          </div>
          <div className="pbar">
            <span className="psort">
              {KINDS.map((k) => (
                <Link prefetch={false} key={k.key} className="chip" data-on={kind === k.key ? '1' : '0'}
                  data-tone={d?.counts?.[k.key] ? 'err' : undefined} href={qs({ kind: k.key, page: 1 })}>
                  {k.label} {num(d?.counts?.[k.key])}
                </Link>
              ))}
            </span>
          </div>
          <div className="sub" style={{ margin: '0 0 10px' }}>{KINDS.find((k) => k.key === kind)?.hint}</div>
          <div className="ptools">
            <form className="search" action="/allsite" method="get">
              <input type="hidden" name="view" value="sus" />
              <input type="hidden" name="s" value={keyOf(susShop)} />
              {kind !== 'notst' && <input type="hidden" name="kind" value={kind} />}
              <input name="q" defaultValue={q} placeholder="ค้น SKU หรือชื่อสินค้า" autoComplete="off" inputMode="search" />
              {q && <Link prefetch={false} className="link" href={qs({ q: '', page: 1 })}>ล้าง</Link>}
              <button className="btn" type="submit">ค้นหา</button>
            </form>
          </div>
          {rows.length === 0 ? (
            <div className="note">ไม่มีรายการ 👍</div>
          ) : (
            <div className="atable-wrap">
              <table className="atable">
                <thead>
                  <tr><th className="l">SKU บนร้าน</th><th className="l">ตัวเลือก</th><th className="l">ตะกร้า</th><th>คลัง</th>{kind === 'dup' && <th>อยู่กี่ตะกร้า</th>}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.product_id}-${r.sku}-${i}`}>
                      {/* โชว์ช่องว่างให้เห็น (·) ไม่งั้นมองไม่ออกว่าผิดตรงไหน */}
                      <td className="l mono">{r.sku ? (kind === 'space' ? r.sku.replace(/ /g, '·') : r.sku) : <span className="danger">(ว่าง)</span>}</td>
                      <td className="l">{r.variant || '—'}</td>
                      <td className="l">
                        <Link prefetch={false} href={productHref(susShop, r.product_id)} className="clamp2">{r.title || r.product_id}</Link>
                        <div className="sku">{listingLabel(r.status)} · รหัสสินค้า {r.product_id}</div>
                      </td>
                      <td>{r.stock ?? '—'}</td>
                      {kind === 'dup' && <td className="a-part">{r.baskets}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!err && pages > 1 && (
        <div className="ppager">
          <Link prefetch={false} className="pgbtn" data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>‹</Link>
          <span><b>{Math.min(page, pages)}</b> / {pages} · {num(total)} รายการ</span>
          <Link prefetch={false} className="pgbtn" data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>›</Link>
        </div>
      )}
    </>
  );
}

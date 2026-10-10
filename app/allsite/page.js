// ลงครบไหม — สินค้าใน Seniorsoft (ไฟล์ ST กลาง) ลงขายครบทุกร้านหรือยัง
// ต่อยอดจาก ../allsitepd (ที่ต้องอัปไฟล์ export ของทุกร้านเองทุกครั้ง) — ตอนนี้ใช้สินค้าที่ดึงไว้ใน os_listings
//
// มุมมองหลัก "ALL SITE": ตารางแถวละ SKU หน้าตาแบบ ALL SITE PRODUCT เดิม — แบรนด์ หมวด SKU ชื่อ สต็อก ราคา
//   + Y / N/A ทุกร้าน กรองที่หัวคอลัมน์ได้ (supabase/039-040)
// มุมมอง "รุ่น + สี": แถวละรุ่น+สี (ชื่อใน ST ตัดไซส์ท้ายออก) ช่องร้าน = ลงแล้วกี่ไซส์ กางดูทีละไซส์ได้ (035-037)
// ตรรกะทั้งหมดอยู่ในฐานข้อมูล ถามครั้งเดียวต่อหน้า
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { after } from 'next/server';
import { db } from '@/lib/supabase';
import { shopsFrom } from '@/lib/listings';
import { groupShops } from '@/lib/shopGroups';
import { fmtTimeTH } from '@/lib/fmt';
import Nav from '../Nav';
import SyncSt from './SyncSt';
import { NavSelect, NavCheck } from './NavSelect';
import { RowCheck, PageCheck, SelectionBar } from './Selection';
import LiveFilters from './LiveFilters';
import Pending from '../Pending';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;            // มุมมองรุ่น+สี
const TABLE_SIZES = [50, 100, 200];
const TABLE_SORTS = ['brand', 'cat', 'sku', 'name', 'qty', 'price'];
const PLATFORM_LABEL = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', thisshop: 'ThisShop', thaimart: 'Thaimart' };
// กลุ่มร้านแบบ allsitepd (ใช้แค่ตั้งชื่อหัวคอลัมน์) — ThisShop อยู่กลุ่ม REAL
const groupOf = (s) => (s.platform === 'thisshop' ? 'REAL' : String(s.shop).toUpperCase());
// ตัวย่อหัวคอลัมน์แบบ allsitepd: SHO REAL / TIK SOLID / THIS REAL
const SHORT = { shopee: 'SHO', tiktok: 'TIK', thisshop: 'THIS', lazada: 'LAZ', thaimart: 'THM' };
const colLabel = (s) => `${SHORT[s.platform] || s.platform.toUpperCase()} ${groupOf(s)}`;
const VIEWS = [
  { key: 'table', label: 'ALL SITE' },
  { key: 'match', label: 'รุ่น + สี' },
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

const num = (n) => Number(n || 0).toLocaleString('en-US');
const keyOf = (s) => `${s.platform}:${s.shop}`;
// ชื่อร้านใช้กลุ่ม SOLID / REAL / MVP (ThisShop = REAL) ให้ตรงกับแถบร้านหน้าอื่น (lib/shopGroups)
const shortLabel = (s) => `${PLATFORM_LABEL[s.platform] || s.platform} ${groupOf(s)}`;
// เรียงร้านตามกลุ่ม SOLID → REAL → MVP แล้วตามแพลตฟอร์ม
const ordered = (list) => groupShops(list).flatMap((g) => g.items);

// ปุ่มลัดเลือกร้านตามกลุ่ม SOLID / REAL / MVP — ร้านเดียวกันทุกแพลตฟอร์มควรลงสินค้าเหมือนกัน (ยกเว้น REAL)
// ปุ่ม: ทุกร้าน + 3 กลุ่ม (ผู้ใช้ขอเก็บ "ทุกร้าน" ไว้ 2026-10-10 ส่วน "ทุกร้านยกเว้น REAL" ตัดออก)
function groupPresets(shops) {
  const groups = groupShops(shops).map((g) => ({ key: g.group, label: g.group, keys: g.items.map(keyOf) }));
  return [{ key: 'all', label: 'ทุกร้าน', keys: shops.map(keyOf) }, ...groups];
}
const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

function GroupPresets({ shops, picked, allShops, qs, className = 'asel' }) {
  const presets = groupPresets(shops);
  if (presets.length < 2) return null;
  return (
    <div className={className}>
      <span className="sku">กลุ่มร้าน:</span>
      {presets.map((p) => (
        <Link prefetch={false} key={p.key} className="chip" data-on={sameSet(picked, p.keys) ? '1' : '0'} href={qs({ sh: p.keys.join(','), focus: '', page: 1 })}>{p.label}<Pending /></Link>
      ))}
    </div>
  );
}
const clean = (v) => String(v || '').replace(/[%_]/g, ' ').trim();   // % _ เป็นอักขระพิเศษของ ilike

// ข้อมูลหน้านี้เปลี่ยนแค่ตอนดึงไฟล์ ST (ทุกชั่วโมง) กับหลังดึงสินค้า (os_st_on ไม่ถี่กว่าทุก 10 นาที)
// จำผลไว้ 2 นาทีต่อชุดตัวกรอง — สลับ ALL SITE ↔ รุ่น+สี ไปมาไม่ต้องคำนวณใหม่ทุกครั้ง
// /api/sync/st และ /api/sync/products ล้างที่จำด้วย revalidateTag('allsite') เมื่อมีของใหม่
const cachedRpc = unstable_cache(async (name, args) => {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
// 30 นาที: ของเปลี่ยนแค่ตอนดึงไฟล์ ST (ทุกชั่วโมง) / ดึงสินค้า ซึ่งสั่ง revalidateTag('allsite') ล้างที่จำให้เอง
}, ['allsite-rpc'], { revalidate: 1800, tags: ['allsite'] });

export default async function AllSitePage({ searchParams }) {
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp?.view) ? sp.view : 'table';
  const page = Math.max(1, Number(sp?.page) || 1);

  // ร้านที่เทียบ — ส่งมาในลิงก์ ไม่มีก็ถามรายชื่อร้านก่อนหนึ่งครั้ง
  let shops = [];
  let picked = String(sp?.sh || '').split(',').filter(Boolean);
  if (!picked.length) {
    const data = await cachedRpc('os_listing_shops', {}).catch(() => null);
    shops = ordered(shopsFrom(data));
    picked = shops.map(keyOf);
  }

  // ── มุมมองรุ่น+สี ──
  const q = String(sp?.q || '').trim();
  const stock = STOCKS.some((s) => s.key === sp?.stock) ? sp.stock : 'in';
  const state = STATES.some((s) => s.key === sp?.state) ? sp.state : 'partial';
  const brand = String(sp?.brand || '');
  // "ดูที่ร้าน" — สถานะ/จำนวนคิดจากร้านเดียว (supabase/037)
  const focus = view === 'match' && /^[a-z]+:.+/.test(String(sp?.focus || '')) ? String(sp.focus) : '';
  if (focus && !picked.includes(focus)) picked.push(focus);
  const focusIdx = focus ? picked.indexOf(focus) + 1 : 0;

  // ── ตาราง ALL SITE ──
  // กรองร้าน Y / N/A — ในลิงก์เป็น yn=tiktok:SOLID=N,shopee:REAL=Y
  const yn = Object.fromEntries(String(sp?.yn || '').split(',')
    .map((x) => x.split('=')).filter(([k, v]) => k && picked.includes(k) && (v === 'Y' || v === 'N')));
  const ynStr = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',');
  const tf = { nm: String(sp?.nm || '').trim(), sk: String(sp?.sk || '').trim(), br: String(sp?.br || '').trim(), ct: String(sp?.ct || '').trim() };
  // ซ่อนของหมดเป็นค่าเริ่มต้น — ติ๊กออกแล้วลิงก์มี hide=0
  const hide = sp?.hide !== '0';
  const size = TABLE_SIZES.includes(Number(sp?.n)) ? Number(sp.n) : TABLE_SIZES[0];
  const tSort = TABLE_SORTS.includes(sp?.sort) ? sp.sort : '';
  const tDir = sp?.dir === 'desc' ? 'desc' : 'asc';

  let err = null, d = null;
  try {
    d = view === 'table'
      ? await cachedRpc('os_allsite_skus', {
        p_shops: picked.map((k) => k.split(':')), p_stock: hide ? 'in' : 'all',
        // ลำดับร้าน (เริ่มที่ 1) → Y/N
        p_filter: Object.fromEntries(Object.entries(yn).map(([k, v]) => [String(picked.indexOf(k) + 1), v])),
        p_name: clean(tf.nm), p_sku: clean(tf.sk), p_brand: clean(tf.br), p_cat: clean(tf.ct),
        p_sort: tSort, p_dir: tDir, p_page: page, p_size: size,
      })
      : await cachedRpc('os_allsite_page', {
        p_shops: picked.map((k) => k.split(':')), p_stock: stock, p_state: state,
        p_brand: brand, p_q: clean(q), p_page: page, p_size: PAGE_SIZE,
        ...(focusIdx ? { p_focus: focusIdx } : {}),
      });
  } catch (e) {
    err = String(e.message || e);
  }
  if (d?.shop_list) shops = ordered(shopsFrom(d.shop_list));
  const cols = picked.map((k) => shops.find((s) => keyOf(s) === k)).filter(Boolean);
  const allShops = shops.map(keyOf).join(',');

  // อุ่นแคชของกลุ่มร้านอื่นไว้ล่วงหน้า (หลังตอบหน้านี้ไปแล้ว) — กดสลับ SOLID / REAL / MVP จะได้ไม่ต้องรอคิวรีหนักครั้งแรก
  // ใช้ตัวกรองเดียวกับหน้านี้ ไปหน้า 1 ตามที่ปุ่มกลุ่มทำ และต้องเรียงพารามิเตอร์ให้ตรงกับคำขอจริงเป๊ะ (คีย์แคช)
  if (!err && shops.length) {
    const warm = groupPresets(shops).filter((g) => !sameSet(picked, g.keys));
    if (warm.length) {
      after(async () => {
        for (const g of warm) {
          const pk = g.keys;
          const ynW = Object.fromEntries(Object.entries(yn).filter(([k]) => pk.includes(k)));
          try {
            if (view === 'table') {
              await cachedRpc('os_allsite_skus', {
                p_shops: pk.map((k) => k.split(':')), p_stock: hide ? 'in' : 'all',
                p_filter: Object.fromEntries(Object.entries(ynW).map(([k, v]) => [String(pk.indexOf(k) + 1), v])),
                p_name: clean(tf.nm), p_sku: clean(tf.sk), p_brand: clean(tf.br), p_cat: clean(tf.ct),
                p_sort: tSort, p_dir: tDir, p_page: 1, p_size: size,
              });
            } else {
              await cachedRpc('os_allsite_page', {
                p_shops: pk.map((k) => k.split(':')), p_stock: stock, p_state: state,
                p_brand: brand, p_q: clean(q), p_page: 1, p_size: PAGE_SIZE,
              });
            }
          } catch { /* อุ่นไม่ได้ก็แค่ช้าตอนกด ไม่กระทบหน้านี้ */ }
        }
      });
    }
  }

  const qs = (o) => {
    const v0 = o.view ?? view;
    const isT = v0 === 'table';
    const v = {
      view, sh: picked.join(','),
      focus: isT ? '' : focus, stock: isT ? '' : stock, state: isT ? '' : state, brand: isT ? '' : brand, q: isT ? '' : q,
      yn: isT ? ynStr(yn) : '', nm: isT ? tf.nm : '', sk: isT ? tf.sk : '',
      br: isT ? tf.br : '', ct: isT ? tf.ct : '', hide: isT && !hide ? '0' : '', n: isT ? String(size) : '',
      sort: isT ? tSort : '', dir: isT ? tDir : '', page, ...o,
    };
    const defaults = { view: 'table', sh: allShops, stock: 'in', state: 'partial', n: String(TABLE_SIZES[0]), dir: 'asc' };
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '' || defaults[k] === String(x) || (k === 'page' && Number(x) === 1)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/allsite?${s}` : '/allsite';
  };

  const total = d?.total || 0;
  const pages = Math.max(1, Math.ceil(total / (view === 'table' ? size : PAGE_SIZE)));
  const rows = d?.rows || [];

  return (
    <>
      <Nav active="allsite" />

      {/* ตาราง ALL SITE เต็มจอแบบ allsitepd — หัวข้อ/แท็บย้ายไปอยู่ในแถบของตาราง */}
      {view !== 'table' && (<>
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
          <Link prefetch key={v.key} className="ptab" data-on={view === v.key ? '1' : '0'} href={qs({ view: v.key, page: 1 })}>{v.label}</Link>
        ))}
      </div>
      </>)}

      {err && (
        <div className="note">
          <b>ดึงข้อมูลไม่ได้</b><br />{err}<br /><br />
          รัน <code>supabase/035</code> ถึง <code>039</code> ใน Supabase แล้วกด “ดึงไฟล์ ST” ก่อน
        </div>
      )}

      {!err && view === 'table' && (
        <AllTable {...{ d, rows, cols, picked, yn, ynStr, tf, hide, size, tSort, tDir, qs, page, pages, shops, allShops }} />
      )}

      {!err && view === 'match' && (
        <GroupView {...{ d, rows, cols, shops, picked, focus, stock, state, brand, q, qs, allShops }} />
      )}

      {!err && view !== 'table' && pages > 1 && (
        <div className="ppager">
          <Link prefetch={false} className="pgbtn" data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>‹</Link>
          <span><b>{Math.min(page, pages)}</b> / {pages} · {num(total)} รายการ</span>
          <Link prefetch={false} className="pgbtn" data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>›</Link>
        </div>
      )}
    </>
  );
}

// ── ตาราง ALL SITE — หน้าตาแบบ ALL SITE PRODUCT (../allsitepd) ─────────────────
function AllTable({ d, rows, cols, picked, yn, ynStr, tf, hide, size, tSort, tDir, qs, page, pages, shops, allShops }) {
  const tcols = cols.map((s, i) => ({ s, i }));
  // กดหัวคอลัมน์: ครั้งแรกน้อย→มาก กดซ้ำสลับ (แบบ allsitepd)
  const sortHref = (k) => qs({ sort: k, dir: tSort === k && tDir === 'asc' ? 'desc' : 'asc', page: 1 });
  const mark = (k) => <span className="tsort">{tSort === k ? (tDir === 'desc' ? '▼' : '▲') : '▲▼'}</span>;
  const ynOpts = (k) => [['', 'All'], ['Y', 'Y'], ['N', 'N/A']].map(([v, label]) => {
    const next = { ...yn };
    if (v) next[k] = v; else delete next[k];
    return { value: v, label, href: qs({ yn: ynStr(next), page: 1 }) };
  });
  const listOpts = (list, key, cur) => [{ value: '', label: 'ทั้งหมด', href: qs({ [key]: '', page: 1 }) },
    ...(list || []).map((x) => ({ value: x, label: x, href: qs({ [key]: x, page: 1 }) }))];
  const keep = Object.fromEntries(Object.entries({ yn: ynStr(yn), hide: hide ? '' : '0', n: String(size), sort: tSort, dir: tDir === 'desc' ? 'desc' : '', sh: picked.join(',') }).filter(([, v]) => v));

  return (
    <div className="ast">
      <div className="ast-top">
        <div>
          <b className="ast-title">ALL SITE PRODUCT</b>
          <div className="sku">
            {num(d?.all_total)} รายการสินค้าในระบบ · ตรงเงื่อนไข {num(d?.total)}
            {d?.st && <> · ไฟล์ ST {fmtTimeTH(d.st.file_modified)} น.</>}
            {d?.st?.on_refreshed_at && <> · เทียบร้านเมื่อ {fmtTimeTH(d.st.on_refreshed_at)} น.</>}
          </div>
        </div>
        <div className="ast-ctl">
          <Link prefetch className="chip" href={qs({ view: 'match', page: 1 })}>ดูแบบรุ่น + สี →</Link>
          <SyncSt />
          {/* เลขหน้าอยู่บนแถบนี้ ไม่ต้องเลื่อนลงไปท้ายตาราง */}
          <span className="ast-pager">
            <Link prefetch={false} className="pgbtn" data-off={page <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, page - 1) })}>‹</Link>
            <span><b>{Math.min(page, pages)}</b> / {num(pages)}</span>
            <Link prefetch={false} className="pgbtn" data-off={page >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, page + 1) })}>›</Link>
          </span>
          <NavCheck className="ast-hide" checked={hide} label="ซ่อนของหมด" href={qs({ hide: hide ? '0' : '', page: 1 })} />
          <span className="ast-size">แสดง:
            <NavSelect value={String(size)} options={TABLE_SIZES.map((n) => ({ value: String(n), label: String(n), href: qs({ n: String(n), page: 1 }) }))} />
          </span>
        </div>
      </div>

      <GroupPresets {...{ shops, picked, allShops, qs }} className="asel ast-groups" />

      {/* เลือกแถวแล้วเปิดในแท็บใหม่ แบบ allsitepd — ที่เลือกจำข้ามหน้า (localStorage) */}
      <SelectionBar />

      {/* ช่องกรองด้านบน — ค้นทันทีระหว่างพิมพ์ ไม่โหลดหน้าใหม่ (LiveFilters) */}
      <LiveFilters base={keep} values={tf} />
      {Object.keys(yn).length > 0 && (
        <div className="ast-selbar">
          <Link prefetch={false} className="link" href={qs({ yn: '', page: 1 })}>ล้างตัวกรองร้าน (Y / N/A)</Link>
        </div>
      )}

      <div className="ast-wrap">
        <table className="ast-table">
          <thead>
            <tr>
              <th className="ast-cbcol"><PageCheck skus={rows.map((r) => r.sku)} total={d?.total || 0}
                query={`${qs({ page: 1 }).split('?')[1] || ''}&sh=${encodeURIComponent(picked.join(','))}`} /></th>
              <th className="l"><Link prefetch={false} href={sortHref('brand')}>แบรนด์ {mark('brand')}</Link>
                <NavSelect className="ast-hsel" value={tf.br} options={listOpts(d?.brands, 'br', tf.br)} /></th>
              <th className="l"><Link prefetch={false} href={sortHref('cat')}>หมวดหมู่ {mark('cat')}</Link>
                <NavSelect className="ast-hsel" value={tf.ct} options={listOpts(d?.cats, 'ct', tf.ct)} /></th>
              <th className="l"><Link prefetch={false} href={sortHref('sku')}>SKU {mark('sku')}</Link></th>
              <th className="l"><Link prefetch={false} href={sortHref('name')}>ชื่อสินค้า {mark('name')}</Link></th>
              <th className="ast-num"><Link prefetch={false} href={sortHref('qty')}>สต็อก<br />{mark('qty')}</Link></th>
              <th className="ast-num"><Link prefetch={false} href={sortHref('price')}>ราคา<br />{mark('price')}</Link></th>
              {tcols.map(({ s }) => (
                <th key={keyOf(s)} className="ast-shop" data-plat={s.platform}>
                  {colLabel(s)}
                  <NavSelect className="ast-hsel" value={yn[keyOf(s)] || ''} options={ynOpts(keyOf(s))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="l" colSpan={7 + tcols.length}>ไม่มีรายการที่ตรงเงื่อนไข</td></tr>
            ) : rows.map((r) => (
              <tr key={r.sku}>
                <td className="ast-cbcol"><RowCheck sku={r.sku} /></td>
                <td className="l ast-brand">{r.brand || '—'}</td>
                <td className="l ast-cat">{r.cat || '—'}</td>
                <td className="l ast-sku">{r.sku}</td>
                <td className="l ast-name">{r.name}</td>
                <td className={'ast-num ' + (Number(r.qty) > 0 ? 'ast-qty' : 'ast-zero')}>{num(r.qty)}</td>
                <td className="ast-num">{r.price === null || r.price === undefined ? '—' : num(r.price)}</td>
                {tcols.map(({ s, i }) => (
                  r.on?.[i]
                    ? <td key={keyOf(s)} className="ast-y" data-plat={s.platform}>Y</td>
                    : <td key={keyOf(s)} className="ast-na">N/A</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── มุมมองรุ่น+สี ─────────────────────────────────────────────────────────
function GroupView({ d, rows, cols, shops, picked, focus, stock, state, brand, q, qs, allShops }) {
  const toggleShop = (k) => {
    const next = picked.includes(k) ? picked.filter((x) => x !== k) : shops.map(keyOf).filter((x) => x === k || picked.includes(x));
    // เอาร้านที่กำลัง "ดูที่ร้าน" ออก = เลิกดูร้านนั้นด้วย
    return qs({ sh: (next.length ? next : [k]).join(','), focus: next.includes(focus) ? focus : '', page: 1 });
  };
  const focusShop = shops.find((s) => keyOf(s) === focus);
  const where = focusShop ? `ใน ${shortLabel(focusShop)}` : '';
  const hidden = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const keep = { view: 'match', sh: picked.join(',') !== allShops ? picked.join(',') : '', stock: stock !== 'in' ? stock : '', state: state !== 'partial' ? state : '', focus };

  return (
    <>
      <div className="mcards">
        <div className="mcard"><span className="mlabel">รุ่น+สี ({stock === 'in' ? 'ที่มีของ' : 'ทั้งหมด'})</span><b>{num(d?.counts?.all)}</b></div>
        <div className="mcard hero"><span className="mlabel">{focusShop ? `ลงครบ${where}` : 'ลงครบทุกร้านที่เลือก'}</span><b>{num(d?.counts?.complete)}</b></div>
        <div className="mcard"><span className="mlabel">ลงไม่ครบ{where && ` ${where}`}</span><b className="lowstock">{num(d?.counts?.partial)}</b></div>
        <div className="mcard"><span className="mlabel">{focusShop ? `ยังไม่ลงเลย${where}` : 'ยังไม่ลงเลยสักร้าน'}</span><b className="danger">{num(d?.counts?.none)}</b></div>
      </div>

      <div className="pcard">
        <GroupPresets {...{ shops, picked, allShops, qs }} />
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
            {hidden({ ...keep, brand })}
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
            {hidden({ ...keep, q })}
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
  );
}

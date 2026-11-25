# หน้ารับของคืน /returns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/returns` ให้พนักงานยิงรับกล่องคืน และเห็นว่าใบไหนขนส่งบอกว่าถึงร้านแล้วแต่ยังไม่มีใครรับ (แทนหน้า Stock-In ของ BigSeller)

**Architecture:** ตารางใหม่ `os_returns` (1 แถว = 1 กล่อง) เติมจาก os_orders (ตีกลับ) + API คืนสินค้าของ TikTok/Shopee/Lazada ทุกชั่วโมง แล้วถามสถานะขนส่งขากลับทีละไม่กี่ใบ · หน้าเว็บ server component + client component สำหรับยิง/เลือก/ส่งออก · ประวัติ 1,050 กล่องจาก BigSeller นำเข้าครั้งเดียวด้วยสคริปต์ Python

**Tech Stack:** Next.js 15 app router · Supabase (supabase-js) · Netlify scheduled functions · html5-qrcode (มีอยู่แล้ว) · Python 3 สำหรับสคริปต์นำเข้า

**Spec:** `docs/superpowers/specs/2026-11-25-returns-receive-design.md`

## Global Constraints

- SQL ใหม่ใช้เลข `069` · ผู้ใช้รันเอง นอกช่วงรอบตัด 08:00/12:00/14:00 · รันซ้ำได้ (`if not exists`)
- ห้ามเรียก API ที่เขียน/กดอะไรบนแพลตฟอร์ม — อ่านอย่างเดียว
- ไม่เพิ่ม dependency ใน package.json
- เครื่องนี้ไม่มี node → เทสต์ `node --test` รันในเครื่องไม่ได้ ตรวจด้วย Netlify Deploy Preview (`deploy-preview` ต้อง SUCCESS) + เรียก `/api/sync/returns?key=…` บน preview
- ข้อความบนหน้าเป็นภาษาไทย ชื่อสถานะตาม BigSeller: รอคืนสินค้า · อยู่ระหว่างคืนสินค้า · คืนสินค้าแล้ว · การคืนสินค้าล้มเหลว · สูญหาย
- สถานะรับ: ยังไม่รับ · รับครบ · รับไม่ครบ · ย้อนหลัง 90 วัน
- ห้าม `\n` กลายเป็นบรรทัดจริงในสตริง JS (เคยทำ build พัง) — เขียนไฟล์ด้วย Write/Edit ไม่ใช้ heredoc ของ shell
- ไม่เก็บชื่อผู้ซื้อ/อีเมลผู้ดำเนินการจากไฟล์ BigSeller

## Review Focus

1. ยิงบาร์โค้ดที่มีช่องว่าง/ตัวพิมพ์เล็ก/ขึ้นบรรทัดใหม่ติดมา → ต้องหาเจอ (`normCode` ตัดช่องว่าง + ตัวพิมพ์ใหญ่) — เทสต์ใน Task 1
2. เลขพัสดุเดียวมีหลายกล่อง (ออเดอร์เดียวคืนหลาย return_id แต่ใช้เลขพัสดุขากลับเดียวกัน / ตีกลับหลายใบในกล่องเดียว) → รับทุกแถวที่ตรง และโชว์ครบ — Task 4
3. ใบที่นำเข้าจาก BigSeller ต้องไม่ถูก sync เขียนทับเป็น "ยังไม่รับ" (sync ไม่แตะคอลัมน์ recv/received_*) — Task 2 upsert ระบุคอลัมน์
4. คำขอคืนถูกปิด/ปฏิเสธหลังเข้าตารางแล้ว → state `not_needed` ซ่อนจากหน้า ยกเว้นรับแล้ว — Task 1 mapping + Task 5 query
5. ส่งออก CSV ภาษาไทยเปิดใน Excel ไม่เพี้ยน + ค่าที่มี `,` `"` ขึ้นบรรทัด → ใส่เครื่องหมายคำพูดถูก — เทสต์ใน Task 1

---

### Task 1: ตาราง + ฟังก์ชันล้วน

**Files:**
- Create: `supabase/069_returns.sql`
- Create: `lib/returns.js`
- Test: `lib/returns.test.mjs`

**Interfaces:**
- Produces (lib/returns.js, ไม่มี import ฝั่งเซิร์ฟเวอร์ ใช้ได้ทั้ง client/server):
  - `RET_STATES = ['waiting','transit','arrived','failed','lost','not_needed']` · `STATE_LABEL` {waiting:'รอคืนสินค้า', transit:'อยู่ระหว่างคืนสินค้า', arrived:'คืนสินค้าแล้ว', failed:'การคืนสินค้าล้มเหลว', lost:'สูญหาย', not_needed:'ไม่ต้องส่งคืน'}
  - `RECV_LABEL` {null→'ยังไม่รับ', full:'รับครบ', partial:'รับไม่ครบ'} (ใช้ key `'none'` แทน null)
  - `KIND_LABEL` {failed:'ส่งไม่สำเร็จ/ตีกลับ', buyer:'ลูกค้าขอคืน'}
  - `normCode(s: string): string` — ตัดช่องว่าง/ขึ้นบรรทัด, แปลงตัวไทยที่มาจากปืนยิงตอนแป้นเป็นไทย กลับเป็นปุ่มอังกฤษ (แป้นเกษมณี ทั้งไม่กด Shift และกด Shift), แล้วตัวพิมพ์ใหญ่
  - `tiktokReturnState(r: {return_status, return_type}) : state|null` (null = ไม่ต้องเก็บ)
  - `shopeeReturnState(r: {status, needs_logistics, return_solution}) : state|null`
  - `tiktokTrackingState(events: [{action_code, update_time_millis}]) : {state, at}|null` — มี `80101` → arrived (เวลา event นั้น)
  - `shopeeTrackingState(info: [{logistics_status, update_time}]) : {state, at}|null` — `RETURNED` → arrived · `LOST` → lost · `RETURN_STARTED`/`RETURN_INITIATED` → transit
  - `lazadaOrderState(raw_status) : state|null` — `shipped_back_success`/`returned` → arrived · `shipped_back_failed` → failed · `lost_by_3pl`/`damaged_by_3pl` → lost · `shipped_back` → transit
  - `toCsv(rows: object[], cols: [{key,label}]) : string` — ขึ้นต้นด้วย `﻿` คั่น `,` ขึ้นบรรทัด `\r\n`
  - `CSV_COLS` ตามสเปก (แพลตฟอร์ม · ร้าน · ประเภท · เลขออเดอร์ · ID คืนสินค้า · เลขพัสดุ · SKU · ชื่อสินค้า · จำนวน · สาเหตุ · สถานะการคืน · สถานะรับ · เวลาถึงร้าน · เวลารับ · คนรับ · หมายเหตุ)

- [ ] **Step 1: เขียน `supabase/069_returns.sql`**
  ตาราง `os_returns`: `id bigserial pk` · `platform text not null` · `shop text not null` · `order_id text not null` · `kind text not null check (kind in ('failed','buyer'))` · `return_id text` · `ret_key text not null` · `tracking_no text` · `carrier text` · `items jsonb not null default '[]'` · `reason text` · `state text not null default 'transit' check (state in RET_STATES)` · `platform_status text` · `started_at timestamptz` · `arrived_at timestamptz` · `recv text check (recv in ('full','partial'))` · `received_at timestamptz` · `received_by text` · `receive_note text` · `missing jsonb` · `checked_at timestamptz` · `created_at/updated_at timestamptz default now()`
  unique `(platform, shop, ret_key)` · index `upper(tracking_no)` · index `(order_id)` · index `(recv, state)` · `alter table os_returns enable row level security;` (ไม่มี policy = อ่านได้เฉพาะ service role แบบตารางอื่น)

- [ ] **Step 2: เขียนเทสต์ `lib/returns.test.mjs`** (node:test แบบ rounds.test.mjs)
  - `normCode(' jtth209880627935\n') === 'JTTH209880627935'`
  - แป้นไทย (ปืนยิงตัวใหญ่ = กด Shift): `normCode('๋ธธ็/จต') === 'JTTH209'` · ตัวเล็กไม่กด Shift: `normCode('่ะะ้') === 'JTTH'`
  - `tiktokReturnState({return_status:'AWAITING_BUYER_SHIP', return_type:'RETURN_AND_REFUND'}) === 'waiting'`, `BUYER_SHIPPED_ITEM → 'transit'`, `return_type:'REFUND'` → `null`, `RETURN_OR_REFUND_REQUEST_CANCEL → 'not_needed'`
  - `shopeeReturnState({status:'ACCEPTED', needs_logistics:true}) === 'transit'` · `needs_logistics:false → null` · `CANCELLED → 'not_needed'`
  - `tiktokTrackingState([{action_code:80101, update_time_millis:1795591591000}, {action_code:70207,…}])` → `{state:'arrived', at:'2026-11-25T07:26:31.000Z'}`
  - `shopeeTrackingState([{logistics_status:'RETURNED', update_time:1795492607}])` → arrived ที่ `2026-11-24T03:56:47.000Z`
  - `toCsv([{a:'x,"y"'}], [{key:'a',label:'ก'}])` → `'﻿ก\r\n"x,""y"""'`

- [ ] **Step 3: เขียน `lib/returns.js` ให้ผ่านเทสต์** — mapping TikTok `return_status`: PENDING/REQUEST_PENDING → null (ยังเจรจา) · AWAITING_BUYER_SHIP → waiting · BUYER_SHIPPED_ITEM → transit · REJECT_RECEIVE_PACKAGE → arrived · *_CANCEL/*_REJECT → not_needed · COMPLETE → transit (TikTok คืนเงินเร็วก่อนของถึง — ให้การยิงรับเป็นตัวตั้ง arrived) · return_type ที่ไม่ใช่ RETURN_AND_REFUND → null

- [ ] **Step 4: ตรวจ** — รันไม่ได้ในเครื่อง; อ่านทวนเทียบเทสต์ทีละข้อ แล้ว commit
  `git add supabase/069_returns.sql lib/returns.js lib/returns.test.mjs && git commit`

### Task 2: ดึงข้อมูลเข้า os_returns

**Files:**
- Create: `lib/returnsSync.js`
- Create: `app/api/sync/returns/route.js`
- Create: `netlify/functions/sync-returns.mjs`
- Modify: `netlify.toml` (schedule `40 * * * *`)
- Modify: `lib/tiktok.js` (เพิ่ม `searchReturns`, `getTracking`) · `lib/shopee.js` (เพิ่ม `listReturns`, `getTrackingInfo`) · `lib/lazada.js` (เพิ่ม `listReverseOrders` — ถ้า API ใช้ไม่ได้ให้คืน [] พร้อมเหตุผลในผล sync)

**Interfaces:**
- Consumes: Task 1 mapping functions
- Produces: `runReturnsSync({ days = 90, checkLimit = 40, deadline }) : Promise<{seeded, tiktok, shopee, lazada, checked, errors[]}>`
- upsert ใช้ `onConflict: 'platform,shop,ret_key'` และ**ส่งเฉพาะคอลัมน์ฝั่งแพลตฟอร์ม** (kind, return_id, tracking_no, carrier, items, reason, state, platform_status, started_at, arrived_at, updated_at) — ห้ามส่ง recv/received_*/receive_note/missing
- state ที่ได้จากแพลตฟอร์มห้ามถอยหลัง: ถ้าแถวมี arrived_at แล้ว อย่าเขียน state กลับเป็น transit (อ่านแถวเดิมก่อน upsert แบบ keepRtsAt ใน lib/ingest.js)

- [ ] **Step 1: seedFailed** — อ่าน os_orders `status='cancelled'`, `collected_at not null`, `cancelled_at >= now-days` (เลือก order_id, platform, shop, tracking_no, carrier, cancel_reason, cancelled_at, raw_status, os_order_items(sku,product_name,qty,image_url)) แบ่งหน้า 1,000 → แถว `kind='failed'`, `ret_key=order_id`, state = lazadaOrderState(raw_status) ถ้าเป็น lazada ไม่งั้น 'transit' · ข้าม Shopee raw_status `TO_RETURN` (เป็นลูกค้าคืน ได้จาก returns API)
- [ ] **Step 2: TikTok** — `POST /return_refund/202309/returns/search` body `{update_time_ge, update_time_lt}` ทีละหน้า (`page_size=50`, `page_token`) ตั้งแต่ checked ล่าสุด (เก็บใน os_sync_log platform `returns:tiktok`, shop) รอบแรก 90 วัน · แถว `kind='buyer'`, `ret_key=return_id`, tracking_no=`return_tracking_number`, items จาก `return_line_items` (seller_sku, product_name, qty 1 ต่อ line, product_image.url)
- [ ] **Step 3: Shopee** — `GET /api/v2/returns/get_return_list` `update_time_from/to` (ช่วงละ ≤14 วัน), `page_size=50` · items จาก `item[]` (`variation_sku`/`item_sku`, `name`, `amount`, `images[0]`) · ข้ามร้านที่ไม่มีโทเคน (Shopee MVP)
- [ ] **Step 4: Lazada** — ลอง `/reverse/getreverseordersforseller` ถ้า error ให้บันทึกใน errors แล้วไปต่อ
- [ ] **Step 5: checkArrivals** — แถวที่ `state in ('transit','waiting')`, `recv is null`, kind='failed' (และ Shopee buyer) เรียง `checked_at nulls first` limit checkLimit · TikTok: `GET /fulfillment/202309/orders/{order_id}/tracking` · Shopee: `GET /api/v2/logistics/get_tracking_info` (`order_sn`) สำหรับตีกลับ / สำหรับลูกค้าคืนลอง `GET /api/v2/returns/get_return_detail` แล้วดูฟิลด์ที่บอกถึงร้าน (ถ้าไม่มี ปล่อยให้การยิงเป็นตัวตั้ง) · อัปเดต state/arrived_at/checked_at · หยุดเมื่อเลย deadline
- [ ] **Step 6: route** — GET ต้อง `?key=SYNC_SECRET` · POST จากหน้าเว็บ (middleware ระดับ 2) · `maxDuration=60`, งบเวลา 20 วินาที · ตอบ JSON ผลแต่ละขั้น · `sync-returns.mjs` แบบ sync-orders.mjs (ตัดที่ 20 วินาที)
- [ ] **Step 7: commit**

### Task 3: รับของ (API)

**Files:**
- Create: `app/api/returns/receive/route.js`

**Interfaces:**
- POST JSON `{ code?: string, id?: number, by: string, missing?: [{sku, qty}], note?: string, undo?: boolean }`
- ตอบ `{ ok, rows: [{id, platform, shop, order_id, kind, return_id, items, reason, state, recv, received_at, received_by, already: boolean}], notFound?: true }`

- [ ] **Step 1:** `code` → `normCode` แล้วหาใน os_returns `upper(tracking_no) = code` หรือ `order_id = code` หรือ `return_id = code` (ทุกแถวที่ตรง) · ไม่เจอ → หา os_orders `tracking_no`/`order_id` แล้วถ้าเป็นใบตีกลับ (cancelled + collected) สร้างแถว failed ให้เลย ไม่งั้น `notFound`
- [ ] **Step 2:** แถวที่ยังไม่รับ → `recv = missing?.length ? 'partial' : 'full'`, received_at=now, received_by=by, receive_note, missing, state='arrived', arrived_at = coalesce(arrived_at, now) · แถวที่รับแล้ว → ไม่แก้ ตอบ `already:true` (ยกเว้นส่ง `id` + missing/note มา = แก้เป็นรับไม่ครบ)
- [ ] **Step 3:** `undo` + `id` → ล้าง recv/received_*/missing/receive_note (ไม่ถอย state)
- [ ] **Step 4:** ต้องมี `by` ถ้าไม่ใช่ undo · commit

### Task 4: หน้า /returns

**Files:**
- Create: `app/returns/page.js` (server) · `app/returns/ScanBox.js` (client) · `app/returns/ReturnsTable.js` (client: ติ๊กเลือก, ส่งออก, ปุ่มรับ/ของไม่ครบ/ยกเลิก) · `app/returns/loading.js`
- Modify: `app/Nav.js` (เพิ่ม `{ key:'returns', href:'/returns', label:'ของคืน' }` หลัง orders) · `app/orders/page.js:304-309` (ใส่ลิงก์ "ไปหน้ารับของคืน →" ในกล่อง note ของแท็บ returning) · `app/globals.css` (เพิ่มคลาสที่จำเป็น)

**Interfaces:**
- Consumes: Task 1 labels/`toCsv`/`CSV_COLS` · Task 3 API · Task 2 POST `/api/sync/returns`
- searchParams: `recv` = `none`(ค่าเริ่ม)|`full`|`partial`|`all` · `state` · `kind` · `chan` (`platform:shop`) · `q`

- [ ] **Step 1: page.js** — โหลดแถว os_returns ตามตัวกรอง (`state <> 'not_needed' or recv is not null`, `coalesce(started_at, created_at) >= now-90d`) เรียงตาม: ยังไม่รับ → arrived ก่อน แล้ว started_at เก่าสุดก่อน · นับตัวเลขต่อแท็บสถานะรับ และต่อสถานะการคืน (ใต้ตัวกรองอื่น) · กล่องเตือน "⚠️ คืนสินค้าแล้ว แต่ยังไม่รับ N ใบ" + "อยู่ระหว่างคืนเกิน 7 วัน N ใบ" (กดแล้วกรอง) · ปุ่ม "ดึงสถานะใหม่"
- [ ] **Step 2: ScanBox** — input autofocus, Enter ส่ง POST receive (ปืนยิง), ปุ่ม 📷 ใช้ html5-qrcode แบบ app/orders/Scanner.js (ถ้าแยกส่วนอ่านโค้ดออกมาใช้ร่วมได้ง่ายให้แยก ไม่งั้นเขียนตัวเล็กในหน้า) · ชื่อคนยิงเก็บ localStorage key `order-sync:staff-name` (ตัวเดียวกับ PullForm) · ผล: เขียว (รับแล้ว + สินค้า + รูป + ปุ่ม "ของไม่ครบ") / เหลือง (รับไปแล้วเมื่อ… โดย…) / แดง (ไม่เจอ) · หลังยิงเคลียร์ช่องและโฟกัสกลับ · `router.refresh()`
  · รายการ "ยิงรอบนี้" (state ในหน้า ล่าสุดบน) แต่ละใบมีปุ่มยกเลิก · วางหลายบรรทัด = ส่งทีละเลขตามลำดับ
- [ ] **Step 3: ReturnsTable** — คอลัมน์: ☐ · ออเดอร์ (เลข, ร้าน, ประเภท, เลขพัสดุ) · สินค้า (รูป SKU × qty) · สถานะการคืน + เวลาถึงร้าน · สถานะรับ (คน/เวลา/ที่ขาด) · จัดการ (รับ / ของไม่ครบ / ยกเลิกการรับ) · ติ๊กหัวตาราง = เลือกทั้งหน้า · ปุ่ม "ส่งออก (N)" สร้าง CSV จากแถวที่เลือก (ไม่เลือก = ทุกแถวที่แสดง) ดาวน์โหลดชื่อ `returns-YYYYMMDD-HHmm.csv`
- [ ] **Step 4:** Nav + ลิงก์จากหน้าออเดอร์ · commit

### Task 5: นำเข้าประวัติ BigSeller (ครั้งเดียว)

**Files:**
- Create: `scripts/import-bigseller-returns.py`

- [ ] **Step 1:** อ่าน xlsx (openpyxl) ตามคอลัมน์ในสเปก · รวมแถวเป็นกล่อง key = (ร้าน, ID คำสั่งซื้อหลังการขาย หรือ เลขออเดอร์) · map ร้านตามสเปก · kind = 'buyer' ถ้ามี ID หลังการขาย · tracking_no = เลขแทร็คกิ้งคืนสินค้า ถ้าว่างใช้เลขแทร็คกิ้ง · เวลาไทย "24 พ.ย. 2026 19:00" → ISO (+07:00)
- [ ] **Step 2:** upsert ผ่าน REST `Prefer: resolution=merge-duplicates` on_conflict `platform,shop,ret_key` ด้วย state='arrived', recv='full', received_at=เวลา Stock-In, received_by='BigSeller', arrived_at=เวลาถึงคลัง · โหมด `--dry-run` พิมพ์จำนวนต่อร้าน/ประเภท (ต้องได้ 1,050 กล่อง)
- [ ] **Step 3:** ไม่ทับแถวที่ recv ไม่ว่างอยู่แล้ว (อ่านก่อน กรองออก) · commit

### Task 6: ส่งขึ้น + ทดสอบบน preview

- [ ] push branch `returns-receive` · เปิด PR · รอ deploy-preview SUCCESS
- [ ] ผู้ใช้รัน 069 → เรียก `/api/sync/returns?key=…&days=90` บน preview จนครบ → รันสคริปต์นำเข้า (ไม่ใช่ dry-run) หลังผู้ใช้ตกลง
- [ ] เทียบกับ BigSeller: นับ "ยังไม่รับ" เทียบ 80 (ณ เวลาเทียบ) + รายใบที่ต่าง พร้อมเหตุผล
- [ ] ทดลองยิงรับ 1 ใบบน preview แล้วกดยกเลิกการรับ (ข้อมูลจริง ย้อนได้) · ลองส่งออก CSV

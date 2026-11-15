# Studio page (/studio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Studio prototype (artifact) into order-sync as `/studio`, reading TikTok baskets (cover, title, id) straight from `os_listings`.

**Architecture:** Server page `app/studio/page.js` loads clips/shoots/folders + TikTok SOLID listings from Supabase (service role, like every page). Client component `app/studio/Studio.js` renders the 4 tabs and writes via `POST /api/studio` (whitelisted columns), then `router.refresh()`. Pure logic in `lib/studio.js` (node:test). New tables in `supabase/067_studio.sql` (Mos runs it).

**Tech Stack:** Next 15 App Router, React 19, @supabase/supabase-js, node:test.

**Spec:** Project doc `claude/studio-design.md` (approach C) + prototype `/home/claude/studio` (logic.js, app.js).

## Global Constraints
- Thai UI, works at 360px, 44px tap targets.
- Statuses: idea → need_footage → queued → cut → approved → posted. Only `approved` (date ≤ today Bangkok) shows in วันนี้โพสต์, overdue first. Low footage `< 5`.
- Must not slow other pages: Nav link for Studio uses `prefetch={false}`; nothing else in shared code queries Studio tables.
- Baskets: platform `tiktok`, shop `SOLID`, from `os_listings` (product_id, title, thumb_url). Never copy images into our tables.
- Writes go through `/api/studio` only (middleware level 2 Origin check applies; no PIN).
- Seniorsoft/stock tables untouched.

## Added after plan review (Mos, 2026-11-15)
- PIN: page + writes gated by existing SALES_PIN (`salesUnlocked()`, PinBox); middleware `needsPin` adds `/api/studio/`.
- Shops: SOLID · REAL · MVP · PACE. Folder has `shops text[]` and `baskets jsonb` `{SOLID:{platform:'tiktok',id}, REAL:{platform:'shopee',id}, MVP:{platform:'shopee',id}, PACE:{url}}`. Clip has `shop`. Basket candidates per shop from `os_listings` (tiktok/SOLID, shopee/REAL, shopee/MVP); PACE = pasted URL.
- Live Drive counts: `lib/studioDrive.js` lists folders/videos under `ฟุตเทจแยกสินค้า` (id 1Cdrcxybu6nmfpU_Vv4tKDUlVCJC60IT5) with the existing service account (scope drive.readonly; `accessToken(scope)` exported from lib/video.js), cached 5 min; pure `buildFolders(cats, subs, files)` tested. Fallback to seeded counts if Drive API fails.

## Review Focus
1. 067 not yet run → `/studio` shows "ยังไม่ได้รัน supabase/067_studio.sql" instead of a 500.
2. Opening `/orders` must not request `/studio` (prefetch off).
3. Folder with no basket picked → post card shows "ยังไม่ผูกตะกร้า", copy button hidden.
4. Clip moved approved → cut disappears from วันนี้โพสต์ after refresh.
5. Long Thai titles wrap at 360px.

---

### Task 1: lib/studio.js + tests
**Files:** Create `lib/studio.js`, `lib/studio.test.mjs`
**Produces:** port of prototype exports `STATUSES, statusLabel, nextStatus, prevStatus, weekDays, addDays, postQueue, cutQueue, lowFootage, captionText, folderKey` + `todayBkk(): string`, `basketCandidates(key, listings) -> listing[]` (prototype Chrome regex rules, max 8), `basketOf(clip, folders, listingsById) -> {id,title,thumb_url,url}|null` (clip.basket_id wins, else folder.basket_id), `tiktokUrl(id)`.
- [ ] Port prototype tests (`/home/claude/studio/test/logic.test.mjs`) + new: `basketCandidates('กางเกงวอร์ม/Flyhawk b516-b517', [{product_id:'1',title:'กางเกงวอร์ม Flyhawk [b516 b517]'},{product_id:'2',title:'เสื้อ'}])` → ids `['1']`; `basketOf` clip override / folder fallback / null.
- [ ] `node --test lib/studio.test.mjs` FAIL → implement → PASS. Commit.

### Task 2: SQL + API route
**Files:** Create `supabase/067_studio.sql`, `app/api/studio/route.js`
- [ ] 067: `os_studio_clips(id uuid pk default gen_random_uuid(), date date, slot int, product text, folder text, angle text, length_s int, status text check in 6 statuses, caption text, hashtags text[], basket_id text, file text, note text, posted_url text, updated_at timestamptz default now())`; `os_studio_shoots(id uuid pk, product, folder, drive_url, shots text[], got boolean[], due date, done boolean default false, updated_at)`; `os_studio_folders(key text pk, cat, sub, n int, drive_url, basket_id text, sort int)` + insert of the 47 folders (counts + Drive links from prototype seed) `on conflict do nothing`; RLS enable, no policies. Re-runnable.
- [ ] route: `POST {kind:'clip'|'shoot'|'folder', op:'upsert'|'delete', row}` → whitelist per kind, validate status, `upsert`/`delete` by id/key; JSON `{ok, row}`; errors `{ok:false,error}` 400/500.
- [ ] Verify: `node --check` both files; `npm run build` passes (after Task 3). Commit.

### Task 3: Page + client + Nav
**Files:** Create `app/studio/page.js`, `app/studio/Studio.js`, `app/studio/studio.css`; Modify `app/Nav.js`
- [ ] page.js: `force-dynamic`; Promise.all load 3 tables + `os_listings` (tiktok/SOLID, cols product_id,title,thumb_url,status) ; table-missing error (code 42P01) → message box. Pass plain JSON to `<Studio>`.
- [ ] Studio.js ('use client'): port prototype UI (week board, cut queue + approve/return, shoots w/ shot checklist + Drive button, post list w/ copy caption/copy basket link + posted URL), folder dialog lists `basketCandidates` with thumbs → pick saves `basket_id`. Writes → POST → `router.refresh()`; refresh on window focus. Delete with 5 s undo.
- [ ] Nav: add `{ key:'studio', href:'/studio', label:'Studio', prefetch:false }`, render `prefetch={p.prefetch !== false}`.
- [ ] `npm ci && npm run build` PASS; `node --test lib/*.test.mjs` PASS. Commit.

### Task 4: Ship
- [ ] Push branch `studio`, open PR (Mos merges → Netlify deploys). Tell Mos to run 067 in Supabase SQL editor first.
- [ ] Update project doc status.

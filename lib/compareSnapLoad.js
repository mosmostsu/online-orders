// ผลสำเร็จรูปของหน้า /compare (os_compare_snap, supabase/053) — โหลด/สร้างใหม่ ใช้ร่วมกับหน้า /discount/compare
// ย้ายมาจาก app/compare/page.js (ไฟล์ page ส่งออกฟังก์ชันอื่นนอกจากที่ Next กำหนดไม่ได้)
import { unstable_cache } from 'next/cache';
import { after } from 'next/server';
import { db } from './supabase.js';
// คำนวณทั้งกลุ่มครั้งเดียว กรอง/แบ่งหน้าในเซิร์ฟเวอร์
const SNAP_MAX_MS = 20 * 60 * 1000;   // เก่ากว่านี้ → ใช้ก้อนเดิมไปก่อน แล้วสร้างใหม่เบื้องหลัง
const snapMem = new Map();             // ก้อนที่โหลดแล้วในหน่วยความจำของเครื่องนี้ (เทียบ built_at ก่อนใช้ซ้ำ)

// การสร้างก้อนของกลุ่ม REAL ใช้ 5–13 วินาที ชนเพดานเวลาคิวรีของ Supabase (~10 วินาที) เป็นพักๆ
// → สร้างไม่เสร็จ แล้วหน้าเว็บเคยถอยไปทางช้า (คำนวณในเซิร์ฟเวอร์) จนเกินเวลาของ Netlify (30 วิ) = "Connection closed"
// ตอนนี้: เครื่องเดียวกันสร้างชุดเดียวกันพร้อมกันครั้งเดียว · สร้างไม่ได้ → ตอบข้อความให้รอ แล้วลองใหม่เบื้องหลัง
const building = new Map();
export function buildSnap(group, thr, hs, hr) {
  const key = `${group}|${thr}|${hs}|${hr}`;
  if (building.has(key)) return building.get(key);
  const p = (async () => {
    const { data, error } = await db().rpc('os_compare_build', { p_group: group, p_thr: thr, p_hide_skus: hs, p_hide_rows: hr });
    if (error) throw new Error(error.message);
    return data;   // เวลาที่สร้าง
  })().finally(() => building.delete(key));
  building.set(key, p);
  return p;
}
export const SNAP_BUILDING = 'SNAP_BUILDING';

export async function loadSnap(group, thr, hs, hr, fresh, mark = () => {}) {
  const sb = db();
  const where = (qb) => qb.eq('grp', group).eq('thr', thr).eq('hide_skus', hs).eq('hide_rows', hr);
  const { data: head0, error } = await where(sb.from('os_compare_snap').select('built_at')).maybeSingle();
  if (error) throw new Error(error.message);   // ยังไม่มีตาราง/ฟังก์ชัน → ผู้เรียกถอยไปทางเดิม
  mark('snap-head');
  let head = head0;
  if (!head || fresh) {
    try {
      head = { built_at: await buildSnap(group, thr, hs, hr) };   // ครั้งแรกของชุดนี้ ต้องรอ ~4-13 วินาที
    } catch (e) {
      // สร้างไม่เสร็จ (มักชนเพดานเวลาคิวรี) — ไม่ถอยไปทางช้า ให้ลองใหม่เบื้องหลังแล้วบอกผู้ใช้ให้รอ
      after(async () => { try { await buildSnap(group, thr, hs, hr); } catch { /* รอบหน้าลองใหม่ */ } });
      if (head0) head = head0;   // fresh แต่สร้างใหม่ไม่ได้ — ใช้ก้อนเดิมที่มีอยู่ไปก่อน
      else throw new Error(SNAP_BUILDING);
    }
  } else if (Date.now() - new Date(head.built_at).getTime() > SNAP_MAX_MS) {
    // ก้อนเก่า (หรือถูกทำให้เก่าหลังโคลน — lib/compareSnap.js) → ใช้ก้อนเดิมไปก่อน แล้วสร้างใหม่เบื้องหลัง
    // "จอง" ก่อนสร้าง: ขยับ built_at ให้ดูใหม่อีก 2 นาที เฉพาะเมื่อยังเป็นค่าเดิม → คำขอ/เครื่องอื่นไม่สร้างซ้ำพร้อมกัน
    // (เคยชนกันหลายตัวในฐานข้อมูลจนหน้าเว็บขาด "Connection closed")
    after(async () => {
      try {
        const claim = new Date(Date.now() - SNAP_MAX_MS + 120000).toISOString();
        const { data: got } = await where(sb.from('os_compare_snap').update({ built_at: claim })).eq('built_at', head.built_at).select('grp');
        if (got?.length) await buildSnap(group, thr, hs, hr);
      } catch { /* ใช้ก้อนเดิมต่อไป */ }
    });
  }
  const key = `${group}|${thr}|${hs}|${hr}`;
  const hit = snapMem.get(key);
  if (hit && hit.built_at === head.built_at) return hit.data;
  const sd = await snapData(group, thr, hs, hr, head.built_at);
  mark('snap-blob');
  snapMem.set(key, { built_at: head.built_at, data: sd });
  return sd;
}

// ก้อนสำเร็จรูปใหญ่ราว 1 MB — เครื่องเซิร์ฟเวอร์ที่เพิ่งตื่น/เครื่องใหม่ต้องดึงจาก Supabase ทั้งก้อนก่อนวาดหน้า (~1-2 วินาที
// และสลับแท็บกลุ่ม = ก้อนใหม่ทุกครั้ง) อ่านผ่านที่จำร่วมของ Next แทน ใช้ร่วมกันทุกเครื่อง
// กุญแจรวม built_at → สร้างก้อนใหม่เมื่อไหร่ก็ได้ก้อนใหม่เอง · ถูกล้างพร้อมรอบดึงสินค้า (tag allsite)
const snapData = unstable_cache(async (group, thr, hs, hr, builtAt) => {
  const { data, error } = await db().from('os_compare_snap').select('data')
    .eq('grp', group).eq('thr', thr).eq('hide_skus', hs).eq('hide_rows', hr).single();
  if (error) throw new Error(error.message);
  return data.data;
}, ['compare-snap-data'], { revalidate: 86400, tags: ['allsite'] });

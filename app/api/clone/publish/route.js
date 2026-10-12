// เปิดขาย (ขึ้นชั้น) ตะกร้า ThisShop ที่มีอยู่แล้วแต่ปิดขายอยู่ — ปุ่ม "เปิดขาย" ในแผงโคลน
// เปลี่ยนสถานะอย่างเดียว (thisshop.goods.publish.update typPublish=1) ไม่แก้ข้อมูลอื่นของสินค้า
// รับ { spuId } — ต้องเป็นตะกร้าที่ระบบรู้จัก (os_listings ของ ThisShop) และตอนนี้ไม่ได้ขายอยู่
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { db } from '@/lib/supabase';
import * as thisshop from '@/lib/thisshop';
import { inListingTab } from '@/lib/listings';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const spuId = String(b.spuId || '');
    if (!/^\d+$/.test(spuId)) return NextResponse.json({ ok: false, error: 'เลขตะกร้าไม่ถูกต้อง' }, { status: 400 });

    const sb = db();
    const { data: row, error } = await sb.from('os_listings').select('product_id, title, status')
      .eq('platform', 'thisshop').eq('product_id', spuId).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ ok: false, error: 'ไม่พบตะกร้านี้ในรายการ ThisShop ของระบบ' }, { status: 404 });
    if (inListingTab({ status: row.status }, 'live')) {
      return NextResponse.json({ ok: true, already: true, spuId });
    }

    const token = await thisshop.getToken();
    await thisshop.call(token, 'thisshop.goods.publish.update', { spuId, typPublish: 1 }, String(Math.floor(Math.random() * 1e6)).padStart(6, '0'));

    // บันทึกสถานะใหม่ทันที ไม่ต้องรอรอบดึงสินค้า (รอบถัดไปจะยืนยันซ้ำเอง)
    await sb.from('os_listings').update({ status: 'ONSHELF' }).eq('platform', 'thisshop').eq('product_id', spuId);
    revalidateTag('listings');
    revalidateTag('allsite');
    return NextResponse.json({ ok: true, spuId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

"""นำเข้าประวัติ "รับของคืนแล้ว" จาก BigSeller ครั้งเดียว ตอนเปิดใช้หน้า /returns

ไฟล์ = ปุ่ม "ส่งออก" ในหน้า การคืนสินค้า Stock-In ของ BigSeller (1 แถว = 1 SKU)
ทุกกล่องในไฟล์ถือว่า "รับครบ" (ร้านกด "ไม่ Stock-In" = รับแล้วแต่ไม่ให้ BigSeller นับสต็อก)
ไม่เก็บชื่อผู้ซื้อ / อีเมลคนกด — ใส่ received_by = 'BigSeller'
ไม่ทับกล่องที่ยิงรับในระบบเราไปแล้ว

    python -I scripts/import-bigseller-returns.py ไฟล์.xlsx --env ../../.env.local --dry-run
    python -I scripts/import-bigseller-returns.py ไฟล์.xlsx --env ../../.env.local
"""
import argparse
import collections
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request

import openpyxl

SHOPS = {
    'TT Solidsports': ('tiktok', 'SOLID'),
    'MVP': ('tiktok', 'MVP'),
    'SP Solid': ('shopee', 'SOLID'),
    'SP Realsports': ('shopee', 'REAL'),
    'SP MVP': ('shopee', 'MVP'),
    'LZD Solid Sport': ('lazada', 'SOLID'),
}
TH_MONTH = {'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
            'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12}
RECEIVED = {'ไม่ Stock-In', 'Stock-In ทั้งหมด'}
BKK = dt.timezone(dt.timedelta(hours=7))


def th_time(s):
    """'24 พ.ย. 2026 19:00' (ค.ศ. เวลาไทย) → ISO"""
    s = (s or '').strip()
    if not s:
        return None
    d, m, y, hm = s.split(' ')
    hh, mm = hm.split(':')
    return dt.datetime(int(y), TH_MONTH[m], int(d), int(hh), int(mm), tzinfo=BKK).isoformat()


def load_env(path):
    env = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k] = v.strip().strip('"')
    return env


def boxes_from(path):
    ws = openpyxl.load_workbook(path).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    head = [str(h or '').strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(head)}
    need = ['ร้านค้า BigSeller', 'หมายเลขคำสั่งซื้อ', 'ID คำสั่งซื้อหลังการขาย', 'หมายเลขแทร็คกิ้ง',
            'หมายเลขแทร็คกิ้งคืนสินค้า', 'SKU ร้านค้า', 'ชื่อสินค้า', 'จำนวน', 'สถานะ Stock-In',
            'สาเหตุการคืนสินค้า', 'เวลาถึงคลัง', 'เวลา Stock-In', 'เวลาจัดส่ง', 'เวลายื่นบริการหลังการขาย', 'โลจิสติกส์']
    miss = [n for n in need if n not in col]
    if miss:
        sys.exit('ไฟล์ไม่มีคอลัมน์: ' + ', '.join(miss))
    g = lambda r, n: r[col[n]] if r[col[n]] is not None else ''

    boxes, skipped = {}, collections.Counter()
    for r in rows[1:]:
        shop_name = str(g(r, 'ร้านค้า BigSeller')).strip()
        if shop_name not in SHOPS:
            skipped['ร้านไม่รู้จัก: ' + shop_name] += 1
            continue
        if str(g(r, 'สถานะ Stock-In')).strip() not in RECEIVED:
            skipped['ยังไม่ Stock-In'] += 1
            continue
        platform, shop = SHOPS[shop_name]
        order_id = str(g(r, 'หมายเลขคำสั่งซื้อ')).strip()
        ret_id = str(g(r, 'ID คำสั่งซื้อหลังการขาย')).strip()
        key = (platform, shop, ret_id or order_id)
        b = boxes.get(key)
        if not b:
            stock_in = th_time(str(g(r, 'เวลา Stock-In')))
            b = boxes[key] = {
                'platform': platform, 'shop': shop, 'order_id': order_id,
                'kind': 'buyer' if ret_id else 'failed',
                'return_id': ret_id or None, 'ret_key': ret_id or order_id,
                'tracking_no': (str(g(r, 'หมายเลขแทร็คกิ้งคืนสินค้า')).strip() or str(g(r, 'หมายเลขแทร็คกิ้ง')).strip()) or None,
                'carrier': str(g(r, 'โลจิสติกส์')).strip() or None,
                'items': [],
                'reason': str(g(r, 'สาเหตุการคืนสินค้า')).strip() or None,
                'state': 'arrived', 'platform_status': 'BigSeller',
                'started_at': th_time(str(g(r, 'เวลายื่นบริการหลังการขาย'))) or th_time(str(g(r, 'เวลาจัดส่ง'))) or stock_in,
                'arrived_at': th_time(str(g(r, 'เวลาถึงคลัง'))) or stock_in,
                'recv': 'full', 'received_at': stock_in, 'received_by': 'BigSeller',
            }
        b['items'].append({'sku': str(g(r, 'SKU ร้านค้า')).strip() or None,
                           'name': str(g(r, 'ชื่อสินค้า')).strip() or None,
                           'qty': int(float(g(r, 'จำนวน') or 1)), 'image': None})
    return list(boxes.values()), skipped


def rest(env, method, path, body=None, headers=None):
    url = env['NEXT_PUBLIC_SUPABASE_URL'] + '/rest/v1/' + path
    h = {'apikey': env['SUPABASE_SERVICE_KEY'], 'Authorization': 'Bearer ' + env['SUPABASE_SERVICE_KEY'],
         'content-type': 'application/json', **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h)) as res:
        txt = res.read().decode()
        return json.loads(txt) if txt else None


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--env', required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    boxes, skipped = boxes_from(a.xlsx)
    print('กล่อง', len(boxes), '· ข้าม', dict(skipped))
    print(collections.Counter((b['platform'], b['shop'], b['kind']) for b in boxes))
    if a.dry_run:
        return

    env = load_env(a.env)
    # ไม่ทับกล่องที่ยิงรับในระบบเราแล้ว
    done = set()
    for i in range(0, 100000, 1000):
        part = rest(env, 'GET', f'os_returns?select=platform,shop,ret_key&recv=not.is.null&offset={i}&limit=1000')
        done |= {(x['platform'], x['shop'], x['ret_key']) for x in part}
        if len(part) < 1000:
            break
    todo = [b for b in boxes if (b['platform'], b['shop'], b['ret_key']) not in done]
    print('รับไปแล้วในระบบ', len(boxes) - len(todo), '· จะเขียน', len(todo))
    for i in range(0, len(todo), 200):
        rest(env, 'POST', 'os_returns?on_conflict=platform,shop,ret_key', todo[i:i + 200],
             {'Prefer': 'resolution=merge-duplicates,return=minimal'})
    print('เสร็จ')


if __name__ == '__main__':
    main()

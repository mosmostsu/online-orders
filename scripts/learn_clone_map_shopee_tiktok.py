# เรียนรู้ "แผนที่โคลน" Shopee → TikTok จากตะกร้าที่ลงทั้งสองร้านอยู่แล้ว (รหัส SKU ตรงกัน) — อ่านอย่างเดียว
# รัน: python scripts/learn_clone_map_shopee_tiktok.py [ร้าน=SOLID]
# ได้ไฟล์ lib/cloneMaps/shopee-tiktok-<ร้าน>.json ที่ lib/cloneTiktok.js ใช้:
#   categories:  category_id ของ Shopee → หมวด leaf ของ TikTok (โหวตจากคู่จริง) + ชื่อหมวดทั้งสองฝั่ง
#   brands:      ชื่อแบรนด์ (ตัดวงเล็บ ตัวเล็ก) ทั้งชื่อฝั่ง Shopee และ TikTok → { id, name } แบรนด์ของ TikTok
#   required:    หมวด TikTok → แอตทริบิวต์บังคับ (ค่าที่ร้านใช้บ่อยสุดในหมวดนั้น หรือ null ถ้าร้านไม่เคยกรอก) + บังคับตารางไซส์ไหม
#   sizeCharts:  "<หมวด TikTok>|<แบรนด์>" → รูปตารางไซส์ (uri) ที่ร้านใช้บ่อยสุดกับแบรนด์นั้นในหมวดนั้น
#   warehouseId: คลังหลักของร้าน TikTok
import hashlib, hmac, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, '.env.local'), encoding='utf-8'):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m:
        ENV[m.group(1)] = m.group(2).strip('"')
SB_URL, SB_KEY = ENV['NEXT_PUBLIC_SUPABASE_URL'], ENV['SUPABASE_SERVICE_KEY']
SHOP = sys.argv[1] if len(sys.argv) > 1 else 'SOLID'
LIVE = {'NORMAL', 'ACTIVATE', 'ONSHELF'}
low = lambda s: (s or '').strip().lower()
norm = lambda s: re.sub(r'[^a-z0-9฀-๿]', '', re.sub(r'[(（][^)）]*[)）]', '', (s or '').lower()))


def sb(table, params):
    out, start = [], 0
    while True:
        req = urllib.request.Request(f"{SB_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}",
                                     headers={'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Range': f'{start}-{start + 999}'})
        d = json.loads(urllib.request.urlopen(req, timeout=180).read())
        out += d
        if len(d) < 1000:
            return out
        start += 1000


def tt_call(path, tok):
    for _ in range(3):
        try:
            q = {'app_key': ENV['TIKTOK_APP_KEY'], 'timestamp': str(int(time.time())), 'shop_cipher': tok['shop_cipher']}
            sec = ENV['TIKTOK_APP_SECRET']
            base = path + ''.join(k + str(q[k]) for k in sorted(q))
            q['sign'] = hmac.new(sec.encode(), (sec + base + sec).encode(), hashlib.sha256).hexdigest()
            req = urllib.request.Request(ENV.get('TIKTOK_API_BASE', 'https://open-api.tiktokglobalshop.com') + path + '?' + urllib.parse.urlencode(q),
                                         headers={'content-type': 'application/json', 'x-tts-access-token': tok['access_token']})
            r = json.loads(urllib.request.urlopen(req, timeout=60).read())
            if r.get('code') == 0:
                return r.get('data') or {}
        except Exception:
            pass
        time.sleep(1)
    return None


def sp_call(row, path, params):
    pid, key = str(row.get('partner_id') or ENV['SHOPEE_PARTNER_ID']), row.get('partner_key') or ENV['SHOPEE_PARTNER_KEY']
    ts = int(time.time())
    sign = hmac.new(key.encode(), f"{pid}{path}{ts}{row['access_token']}{row['shop_id']}".encode(), hashlib.sha256).hexdigest()
    q = {'partner_id': pid, 'timestamp': ts, 'access_token': row['access_token'], 'shop_id': row['shop_id'], 'sign': sign, **params}
    return json.loads(urllib.request.urlopen(ENV.get('SHOPEE_API_BASE', 'https://partner.shopeemobile.com') + path + '?' + urllib.parse.urlencode(q), timeout=60).read())


def main():
    def load(pl):
        ls = {x['product_id']: x for x in sb('os_listings', {'select': 'product_id,status', 'platform': f'eq.{pl}', 'shop': f'eq.{SHOP}'})}
        b = defaultdict(set)
        for r in sb('os_listing_skus', {'select': 'product_id,seller_sku', 'platform': f'eq.{pl}', 'shop': f'eq.{SHOP}'}):
            if low(r['seller_sku']):
                b[r['product_id']].add(low(r['seller_sku']))
        return ls, b
    tl, tb = load('tiktok')
    _, sbk = load('shopee')
    sku2sp = {}
    for p, ks in sbk.items():
        for k in ks:
            sku2sp.setdefault(k, p)
    pairs = {}
    for p, x in tl.items():
        hits = Counter(sku2sp[k] for k in tb[p] if k in sku2sp)
        if x['status'] in LIVE and hits:
            pairs[p] = hits.most_common(1)[0][0]
    print('คู่ TikTok↔Shopee:', len(pairs))

    tok = sb('os_shop_tokens', {'select': 'shop_cipher,access_token', 'platform': 'eq.tiktok', 'shop': f'eq.{SHOP}'})[0]
    row = sb('os_shop_tokens', {'select': '*', 'platform': 'eq.shopee', 'shop': f'eq.{SHOP}'})[0]
    with ThreadPoolExecutor(6) as ex:
        tt = dict(zip(pairs, ex.map(lambda pid: tt_call(f'/product/202309/products/{pid}', tok), list(pairs))))
    spids = sorted(set(pairs.values()))
    sp = {}
    for i in range(0, len(spids), 50):
        for it in (sp_call(row, '/api/v2/product/get_item_base_info', {'item_id_list': ','.join(spids[i:i + 50])}).get('response') or {}).get('item_list', []):
            sp[str(it['item_id'])] = it
    print('อ่าน TikTok', sum(1 for v in tt.values() if v), '| Shopee', len(sp))

    # หมวด: Shopee → TikTok
    votes, ttname = defaultdict(Counter), {}
    for tp, s in pairs.items():
        d, it = tt.get(tp), sp.get(s)
        if not d or not it or not d.get('category_chains'):
            continue
        leaf = str(d['category_chains'][-1]['id'])
        votes[str(it['category_id'])][leaf] += 1
        ttname[leaf] = ' › '.join(c.get('local_name') or c.get('name') or '' for c in d['category_chains'])
    tree = (sp_call(row, '/api/v2/product/get_category', {'language': 'th'}).get('response') or {}).get('category_list', [])
    by_id = {c['category_id']: c for c in tree}
    def sp_path(cid):
        parts, c = [], by_id.get(int(cid))
        while c and len(parts) < 6:
            parts.insert(0, c.get('display_category_name') or c.get('original_category_name') or str(c['category_id']))
            c = by_id.get(c.get('parent_category_id'))
        return ' › '.join(parts)
    categories = {}
    for c, v in votes.items():
        leaf, n = v.most_common(1)[0]
        categories[c] = {'tiktok': leaf, 'tiktokName': ttname.get(leaf, ''), 'votes': n, 'of': sum(v.values()), 'name': sp_path(c)}

    # แบรนด์: ชื่อฝั่ง Shopee และชื่อฝั่ง TikTok → แบรนด์ TikTok
    bvotes = defaultdict(Counter)
    for tp, s in pairs.items():
        d, it = tt.get(tp), sp.get(s)
        b = (d or {}).get('brand') or {}
        if not b.get('id'):
            continue
        val = json.dumps({'id': b['id'], 'name': b.get('name') or ''}, ensure_ascii=False)
        bvotes[norm(b.get('name'))][val] += 1
        sb_name = ((it or {}).get('brand') or {}).get('original_brand_name')
        if sb_name and norm(sb_name) not in ('nobrand', ''):
            bvotes[norm(sb_name)][val] += 1
    brands = {k: json.loads(v.most_common(1)[0][0]) for k, v in bvotes.items() if k}

    # แอตทริบิวต์บังคับ + ตารางไซส์ ของหมวด TikTok ที่ใช้
    used = defaultdict(lambda: defaultdict(Counter))
    charts = defaultdict(Counter)
    for tp, d in tt.items():
        if not d or not d.get('category_chains'):
            continue
        leaf = str(d['category_chains'][-1]['id'])
        for a in d.get('product_attributes') or []:
            vals = [{'id': v['id'], 'name': v.get('name') or ''} if v.get('id') else {'name': v.get('name') or ''} for v in a.get('values') or []]
            if vals:
                used[leaf][str(a['id'])][json.dumps(vals, ensure_ascii=False)] += 1
        uri = ((d.get('size_chart') or {}).get('image') or {}).get('uri')
        if uri:
            charts[f"{leaf}|{norm((d.get('brand') or {}).get('name'))}"][uri] += 1
    required = {}
    for leaf in sorted({c['tiktok'] for c in categories.values()}):
        attrs = (tt_call(f'/product/202309/categories/{leaf}/attributes', tok) or {}).get('attributes') or []
        rules = tt_call(f'/product/202309/categories/{leaf}/rules', tok) or {}
        need = {}
        for a in attrs:
            if a.get('type') == 'PRODUCT_PROPERTY' and a.get('is_requried'):
                cnt = used[leaf][str(a['id'])]
                need[str(a['id'])] = {'name': a.get('name') or '', 'values': json.loads(cnt.most_common(1)[0][0]) if cnt else None}
        required[leaf] = {'attrs': need, 'sizeChart': bool((rules.get('size_chart') or {}).get('is_required'))}
    size_charts = {k: v.most_common(1)[0][0] for k, v in charts.items()}

    wh = (tt_call('/logistics/202309/warehouses', tok) or {}).get('warehouses') or []
    sales_wh = [w for w in wh if w.get('type') == 'SALES_WAREHOUSE' and w.get('effect_status') == 'ENABLED']
    default = next((w for w in sales_wh if w.get('is_default')), sales_wh[0] if sales_wh else None)

    out = {'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'shop': SHOP, 'pairs': len(pairs),
           'categories': categories, 'brands': brands, 'required': required, 'sizeCharts': size_charts,
           'warehouseId': default['id'] if default else None}
    dst = os.path.join(ROOT, 'lib', 'cloneMaps', f'shopee-tiktok-{SHOP.lower()}.json')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('เขียน', dst, '| หมวด Shopee', len(categories), '| หมวด TikTok', len(required), '| แบรนด์', len(brands),
          '| ตารางไซส์', len(size_charts), '| คลัง', out['warehouseId'])
    print('หมวดที่บังคับตารางไซส์:', [k for k, v in required.items() if v['sizeChart']])
    print('แอตทริบิวต์บังคับที่ร้านไม่เคยกรอก:', {k: [a['name'] for a in v['attrs'].values() if a['values'] is None] for k, v in required.items() if any(a['values'] is None for a in v['attrs'].values())})


if __name__ == '__main__':
    main()

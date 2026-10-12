# เรียนรู้ "แผนที่โคลน" TikTok → Shopee จากตะกร้าที่ลงทั้งสองร้านอยู่แล้ว (รหัส SKU ตรงกัน) — อ่านอย่างเดียว
# รัน: python scripts/learn_clone_map.py [ร้าน TikTok=SOLID] [ร้าน Shopee=SOLID]
# ได้ไฟล์ lib/cloneMaps/tiktok-shopee-<ร้าน>.json ที่ lib/cloneShopee.js ใช้:
#   categories:   หมวด leaf ของ TikTok → category_id ของ Shopee (โหวตจากคู่จริง)
#   brands:       ชื่อแบรนด์ (ตัดวงเล็บ ตัวเล็ก ไม่มีช่องว่าง) → { brand_id, original_brand_name } ที่ร้านเคยใช้
#   attrDefaults: หมวด Shopee → แอตทริบิวต์ → ค่าที่ร้านใช้บ่อยสุด (ไว้เติมแอตทริบิวต์บังคับ)
#   logistics:    ช่องขนส่งที่ตะกร้าส่วนใหญ่ของร้านเปิด
# หมวด/แบรนด์ไม่ค่อยเปลี่ยน — รันใหม่เมื่อร้านลงหมวดใหม่ ๆ แล้วโคลนขึ้นว่า "ไม่รู้หมวด"
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
TT_SHOP = sys.argv[1] if len(sys.argv) > 1 else 'SOLID'
SP_SHOP = sys.argv[2] if len(sys.argv) > 2 else 'SOLID'
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
    q = {'app_key': ENV['TIKTOK_APP_KEY'], 'timestamp': str(int(time.time())), 'shop_cipher': tok['shop_cipher']}
    sec = ENV['TIKTOK_APP_SECRET']
    base = path + ''.join(k + str(q[k]) for k in sorted(q))
    q['sign'] = hmac.new(sec.encode(), (sec + base + sec).encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(ENV.get('TIKTOK_API_BASE', 'https://open-api.tiktokglobalshop.com') + path + '?' + urllib.parse.urlencode(q),
                                 headers={'content-type': 'application/json', 'x-tts-access-token': tok['access_token']})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def sp_call(row, path, params):
    pid, key = str(row.get('partner_id') or ENV['SHOPEE_PARTNER_ID']), row.get('partner_key') or ENV['SHOPEE_PARTNER_KEY']
    ts = int(time.time())
    sign = hmac.new(key.encode(), f"{pid}{path}{ts}{row['access_token']}{row['shop_id']}".encode(), hashlib.sha256).hexdigest()
    q = {'partner_id': pid, 'timestamp': ts, 'access_token': row['access_token'], 'shop_id': row['shop_id'], 'sign': sign, **params}
    return json.loads(urllib.request.urlopen(ENV.get('SHOPEE_API_BASE', 'https://partner.shopeemobile.com') + path + '?' + urllib.parse.urlencode(q), timeout=60).read())


def main():
    def load(pl, sh):
        ls = {x['product_id']: x for x in sb('os_listings', {'select': 'product_id,status', 'platform': f'eq.{pl}', 'shop': f'eq.{sh}'})}
        b = defaultdict(set)
        for r in sb('os_listing_skus', {'select': 'product_id,seller_sku', 'platform': f'eq.{pl}', 'shop': f'eq.{sh}'}):
            if low(r['seller_sku']):
                b[r['product_id']].add(low(r['seller_sku']))
        return ls, b
    tl, tb = load('tiktok', TT_SHOP)
    _, sbk = load('shopee', SP_SHOP)
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

    tok = sb('os_shop_tokens', {'select': 'shop_cipher,access_token', 'platform': 'eq.tiktok', 'shop': f'eq.{TT_SHOP}'})[0]
    row = sb('os_shop_tokens', {'select': '*', 'platform': 'eq.shopee', 'shop': f'eq.{SP_SHOP}'})[0]

    def one(pid):
        for _ in range(3):
            try:
                r = tt_call(f'/product/202309/products/{pid}', tok)
                if r.get('code') == 0:
                    return pid, r['data']
            except Exception:
                pass
            time.sleep(1)
        return pid, None
    with ThreadPoolExecutor(6) as ex:
        tt = dict(ex.map(one, list(pairs)))
    spids = sorted(set(pairs.values()))
    sp = {}
    for i in range(0, len(spids), 50):
        for it in (sp_call(row, '/api/v2/product/get_item_base_info', {'item_id_list': ','.join(spids[i:i + 50])}).get('response') or {}).get('item_list', []):
            sp[str(it['item_id'])] = it
    print('อ่าน TikTok', sum(1 for v in tt.values() if v), '| Shopee', len(sp))

    votes, names = defaultdict(Counter), {}
    for tp, s in pairs.items():
        d, it = tt.get(tp), sp.get(s)
        if not d or not it or not d.get('category_chains'):
            continue
        leaf = str(d['category_chains'][-1]['id'])
        votes[leaf][it['category_id']] += 1
        names[leaf] = ' / '.join(c.get('local_name') or c.get('name') or '' for c in d['category_chains'])
    # ชื่อหมวด Shopee (ภาษาไทย) แบบเส้นทาง แม่ › ลูก — ไว้โชว์ในหน้าโคลน
    tree = (sp_call(row, '/api/v2/product/get_category', {'language': 'th'}).get('response') or {}).get('category_list', [])
    by_id = {c['category_id']: c for c in tree}
    def sp_path(cid):
        parts, c = [], by_id.get(cid)
        while c and len(parts) < 6:
            parts.insert(0, c.get('display_category_name') or c.get('original_category_name') or str(c['category_id']))
            c = by_id.get(c.get('parent_category_id'))
        return ' › '.join(parts)
    categories = {k: {'shopee': v.most_common(1)[0][0], 'shopeeName': sp_path(v.most_common(1)[0][0]), 'votes': v.most_common(1)[0][1], 'of': sum(v.values()), 'name': names[k]} for k, v in votes.items()}

    brands = {}
    for it in sp.values():
        b = it.get('brand') or {}
        if b.get('brand_id'):
            brands[norm(b['original_brand_name'])] = {'brand_id': b['brand_id'], 'original_brand_name': b['original_brand_name'].strip()}

    attrs = defaultdict(lambda: defaultdict(Counter))
    for it in sp.values():
        for a in it.get('attribute_list') or []:
            for v in a.get('attribute_value_list') or []:
                attrs[it['category_id']][a['attribute_id']][json.dumps({'value_id': v.get('value_id') or 0, 'original_value_name': v.get('original_value_name') or '', 'value_unit': v.get('value_unit') or ''}, ensure_ascii=False)] += 1
    attr_defaults = {str(c): {str(a): json.loads(cnt.most_common(1)[0][0]) for a, cnt in am.items()} for c, am in attrs.items()}

    lc = Counter(l['logistic_id'] for it in sp.values() for l in it.get('logistic_info', []) if l.get('enabled'))
    logistics = sorted(k for k, n in lc.items() if n > len(sp) / 2)

    out = {'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'tiktokShop': TT_SHOP, 'shopeeShop': SP_SHOP,
           'pairs': len(pairs), 'categories': categories, 'brands': brands, 'attrDefaults': attr_defaults, 'logistics': logistics}
    dst = os.path.join(ROOT, 'lib', 'cloneMaps', f'tiktok-shopee-{SP_SHOP.lower()}.json')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('เขียน', dst, '| หมวด', len(categories), '| แบรนด์', len(brands), '| หมวดที่มีค่าแอตทริบิวต์', len(attr_defaults), '| ขนส่ง', logistics)


if __name__ == '__main__':
    main()

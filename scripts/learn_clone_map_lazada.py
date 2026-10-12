# เรียนรู้ "แผนที่โคลน" TikTok → Lazada จากตะกร้าที่ลงทั้งสองร้านอยู่แล้ว (รหัส SKU ตรงกัน) — อ่านอย่างเดียว
# รัน: python scripts/learn_clone_map_lazada.py [ร้าน=SOLID]
# อ่าน Lazada ผ่าน /api/debug/lazada-call บนเว็บจริง (คีย์แอป Lazada อยู่ที่ Netlify ไม่ใช่ในเครื่อง) — ต้องมี SYNC_SECRET ใน .env.local
# ได้ไฟล์ lib/cloneMaps/tiktok-lazada-<ร้าน>.json ที่ lib/cloneLazada.js ใช้:
#   categories:   หมวด leaf ของ TikTok → primary_category ของ Lazada (โหวตจากคู่จริง) + ชื่อหมวด
#   mandatory:    หมวด Lazada → แอตทริบิวต์บังคับแบบ normal (ไม่รวม name/description/brand) → ค่าที่ร้านใช้บ่อยสุด
#   brands:       ชื่อแบรนด์ (ตัดวงเล็บ ตัวเล็ก) → ชื่อแบรนด์ตามที่ Lazada รู้จัก
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
SITE = ENV.get('SITE_URL', 'https://order-sync-solid.netlify.app')
SHOP = sys.argv[1] if len(sys.argv) > 1 else 'SOLID'
LIVE = {'NORMAL', 'ACTIVATE', 'ONSHELF'}
SKIP_ATTR = {'name', 'description', 'brand', 'short_description', 'name_en', 'description_en'}
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


def lz(path, **params):
    q = {'key': ENV['SYNC_SECRET'], 'path': path, 'shop': SHOP, **params}
    for _ in range(3):
        try:
            r = json.loads(urllib.request.urlopen(f'{SITE}/api/debug/lazada-call?' + urllib.parse.urlencode(q), timeout=90).read())
            if r.get('ok'):
                return r['response']
        except Exception:
            pass
        time.sleep(2)
    return {}


def tt_call(path, tok):
    q = {'app_key': ENV['TIKTOK_APP_KEY'], 'timestamp': str(int(time.time())), 'shop_cipher': tok['shop_cipher']}
    sec = ENV['TIKTOK_APP_SECRET']
    base = path + ''.join(k + str(q[k]) for k in sorted(q))
    q['sign'] = hmac.new(sec.encode(), (sec + base + sec).encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(ENV.get('TIKTOK_API_BASE', 'https://open-api.tiktokglobalshop.com') + path + '?' + urllib.parse.urlencode(q),
                                 headers={'content-type': 'application/json', 'x-tts-access-token': tok['access_token']})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def main():
    def load(pl):
        ls = {x['product_id']: x for x in sb('os_listings', {'select': 'product_id,status', 'platform': f'eq.{pl}', 'shop': f'eq.{SHOP}'})}
        b = defaultdict(set)
        for r in sb('os_listing_skus', {'select': 'product_id,seller_sku', 'platform': f'eq.{pl}', 'shop': f'eq.{SHOP}'}):
            if low(r['seller_sku']):
                b[r['product_id']].add(low(r['seller_sku']))
        return ls, b
    tl, tb = load('tiktok')
    _, lb = load('lazada')
    sku2lz = {}
    for p, ks in lb.items():
        for k in ks:
            sku2lz.setdefault(k, p)
    pairs = {}
    for p, x in tl.items():
        hits = Counter(sku2lz[k] for k in tb[p] if k in sku2lz)
        if x['status'] in LIVE and hits:
            pairs[p] = hits.most_common(1)[0][0]
    print('คู่ TikTok↔Lazada:', len(pairs))

    tok = sb('os_shop_tokens', {'select': 'shop_cipher,access_token', 'platform': 'eq.tiktok', 'shop': f'eq.{SHOP}'})[0]

    def tt_one(pid):
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
        tt = dict(ex.map(tt_one, list(pairs)))

    def lz_one(item):
        return item, (lz('/product/item/get', item_id=item).get('data') or None)
    with ThreadPoolExecutor(5) as ex:
        lzd = dict(ex.map(lz_one, sorted(set(pairs.values()))))
    print('อ่าน TikTok', sum(1 for v in tt.values() if v), '| Lazada', sum(1 for v in lzd.values() if v))

    votes, names = defaultdict(Counter), {}
    for tp, li in pairs.items():
        d, z = tt.get(tp), lzd.get(li)
        if not d or not z or not d.get('category_chains') or not z.get('primary_category'):
            continue
        leaf = str(d['category_chains'][-1]['id'])
        votes[leaf][int(z['primary_category'])] += 1
        names[leaf] = ' / '.join(c.get('local_name') or c.get('name') or '' for c in d['category_chains'])

    # ชื่อหมวด Lazada (เส้นทาง)
    tree = lz('/category/tree/get', language_code='th_TH').get('data') or []
    lzname = {}
    def walk(nodes, path):
        for n in nodes or []:
            p = path + [n.get('name') or str(n.get('category_id'))]
            lzname[int(n['category_id'])] = ' › '.join(p)
            walk(n.get('children'), p)
    walk(tree, [])
    categories = {k: {'lazada': v.most_common(1)[0][0], 'lazadaName': lzname.get(v.most_common(1)[0][0], ''), 'votes': v.most_common(1)[0][1],
                      'of': sum(v.values()), 'name': names[k]} for k, v in votes.items()}

    # แอตทริบิวต์บังคับ (normal) ของแต่ละหมวดที่ใช้ → ค่าที่ร้านใช้บ่อยสุดในหมวดนั้น
    used = defaultdict(lambda: defaultdict(Counter))
    for z in lzd.values():
        if not z:
            continue
        for k, v in (z.get('attributes') or {}).items():
            if k not in SKIP_ATTR and isinstance(v, (str, int, float)) and str(v).strip():
                used[int(z['primary_category'])][k][str(v)] += 1
    mandatory = {}
    for cat in sorted({c['lazada'] for c in categories.values()}):
        attrs = lz('/category/attributes/get', primary_category_id=cat, language_code='th_TH').get('data') or []
        need = [a['name'] for a in attrs if a.get('is_mandatory') and a.get('attribute_type') == 'normal' and a['name'] not in SKIP_ATTR]
        mandatory[str(cat)] = {n: (used[cat][n].most_common(1)[0][0] if used[cat][n] else None) for n in need}

    brands = {}
    for z in lzd.values():
        b = ((z or {}).get('attributes') or {}).get('brand')
        if b and norm(b) not in ('nobrand',):
            brands[norm(b)] = b

    out = {'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'shop': SHOP, 'pairs': len(pairs),
           'categories': categories, 'mandatory': mandatory, 'brands': brands}
    dst = os.path.join(ROOT, 'lib', 'cloneMaps', f'tiktok-lazada-{SHOP.lower()}.json')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    miss = {c: [k for k, v in m.items() if v is None] for c, m in mandatory.items() if any(v is None for v in m.values())}
    print('เขียน', dst, '| หมวด', len(categories), '| หมวด Lazada', len(mandatory), '| แบรนด์', len(brands))
    print('หมวดที่แอตทริบิวต์บังคับยังไม่มีค่าจากร้าน:', miss)


if __name__ == '__main__':
    main()

# แลก auth code -> access_token แล้วเขียนกลับลง .env.local
# รัน: python scripts/tiktok_auth.py "<code หรือ URL เต็มที่ TikTok เด้งกลับมา>"
import json, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, ".env.local")


def read_env():
    env = {}
    for line in open(ENV, encoding="utf-8"):
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env


def write_env(updates):
    lines = open(ENV, encoding="utf-8").read().splitlines()
    keys = set(updates)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in updates:
            out.append("%s=%s" % (m.group(1), updates[m.group(1)]))
            keys.discard(m.group(1))
        else:
            out.append(line)
    for k in keys:
        out.append("%s=%s" % (k, updates[k]))
    open(ENV, "w", encoding="utf-8").write("\n".join(out) + "\n")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("ใส่ code หรือ URL ที่ TikTok เด้งกลับมาเป็นอาร์กิวเมนต์ด้วย")

    arg = sys.argv[1].strip()
    # รับได้ทั้ง code ล้วนๆ และ URL เต็ม
    code = arg
    if "code=" in arg:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(arg).query)
        code = (q.get("code") or q.get("auth_code") or [""])[0]
    if not code:
        raise SystemExit("หา code ในสิ่งที่ใส่มาไม่เจอ")

    env = read_env()
    url = (
        "%s/api/v2/token/get?app_key=%s&app_secret=%s&auth_code=%s&grant_type=authorized_code"
        % (
            env.get("TIKTOK_AUTH_BASE", "https://auth.tiktok-shops.com"),
            env["TIKTOK_APP_KEY"],
            env["TIKTOK_APP_SECRET"],
            urllib.parse.quote(code),
        )
    )
    with urllib.request.urlopen(url, timeout=30) as r:
        res = json.loads(r.read())

    if res.get("code") != 0:
        raise SystemExit("แลกโทเคนไม่สำเร็จ: %s" % json.dumps(res, ensure_ascii=False))

    d = res["data"]
    write_env({
        "TIKTOK_ACCESS_TOKEN": d["access_token"],
        "TIKTOK_REFRESH_TOKEN": d.get("refresh_token", ""),
    })
    print("สำเร็จ - เขียนโทเคนลง .env.local แล้ว")
    print("  access_token :", d["access_token"][:24] + "...")
    print("  หมดอายุ      :", d.get("access_token_expire_in"))
    print("  ร้าน         :", ", ".join(s.get("shop_name", "?") for s in d.get("seller_shops", [])) or "(ไม่ได้ส่งมา)")


main()

import ipywidgets as widgets
from IPython.display import display, clear_output

# ตารางให้ติ๊กว่า SKU ไหน "ของหมดจริง" — ที่ติ๊กไว้จะถูก push เป็น 0 ทุกแพลตฟอร์ม
# ตัวที่ไม่ติ๊ก = ขนส่งลืมยิงเฉยๆ ของออกไปแล้ว ปล่อยให้คิดตาม ST ปกติ
# รายการที่ติ๊กถูกเก็บลง force_zero_skus.json อยู่ข้ามรอบจนกว่าจะเอาติ๊กออกเอง

_picked = set()


def _load_stuck():
    try:
        with open(STUCK_ORDERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {'scanned_at': None, 'rows': []}


def _st_snapshot():
    """ST ปัจจุบัน + ชื่อสินค้า เอาไว้โชว์ข้างๆ ว่าตอนนี้ระบบกำลังจะขายเท่าไหร่"""
    try:
        df = pd.read_excel(f'{GDRIVE}/product_image/STlatest.XLSX', index_col=None)
    except Exception:
        return {}, {}
    st, name = {}, {}
    for _, row in df.iterrows():
        sku = str(row['cf_itemid']).strip()
        q = pd.to_numeric(row['cf_quantity'], errors='coerce')
        st[sku] = 0 if pd.isna(q) else int(q)
        name[sku] = str(row.get('cf_itemname', ''))[:38]
    return st, name


def _aggregate(rows, min_hours):
    agg = {}
    for r in rows:
        h = r.get('hours')
        if min_hours and (h is None or h < min_hours):
            continue
        a = agg.setdefault(r['sku'], {'qty': 0, 'orders': set(), 'platforms': set(), 'hours': 0.0})
        a['qty'] += int(r.get('qty') or 0)
        a['orders'].add(r['order_id'])
        a['platforms'].add(r['platform'])
        if h is not None:
            a['hours'] = max(a['hours'], h)
    return agg


def render_stuck_picker(min_hours=0):
    """โชว์ตาราง SKU ที่ค้างส่ง ให้ติ๊กเลือกตัวที่ของหมดจริง
    ปรับตัวกรองชั่วโมงได้ในตัว ไม่ต้องสแกนใหม่ (ติ๊กที่เลือกไว้ไม่หาย)"""
    global _picked
    data = _load_stuck()
    rows = data.get('rows') or []
    saved = load_force_zero()
    _picked = set(saved)

    st_qty, st_name = _st_snapshot()
    try:
        with open(TOTAL_TOSHIP_FILE, 'r') as f:
            toship = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        toship = {}

    all_skus = {r['sku'] for r in rows}
    total_orders = len({r['order_id'] for r in rows})
    total_pcs = sum(int(r.get('qty') or 0) for r in rows)

    hours_w = widgets.BoundedIntText(value=min_hours, min=0, max=720, step=6,
                                     description='ค้างเกิน (ชม.):',
                                     style={'description_width': '110px'},
                                     layout=widgets.Layout(width='210px'))
    info = widgets.HTML()
    # ไม่ใช้ Output ซ้อนใน Output (out1b ของปุ่ม 1.5) — Colab เรนเดอร์ตัวในไม่ออก
    # เปลี่ยน children ของ VBox ตรงๆ แทน
    table_box = widgets.VBox(layout=widgets.Layout(max_height='420px', overflow_y='auto'))
    out_save = widgets.Output()

    def _on_tick(sku):
        def _h(change):
            (_picked.add if change['new'] else _picked.discard)(sku)
        return _h

    def _draw(*_):
        agg = _aggregate(rows, hours_w.value)
        hidden = sorted(all_skus - set(agg))
        # ตัวที่ติ๊กไว้ต้องโผล่เสมอ แม้จะโดนกรองหรือออเดอร์ค้างหายไปแล้ว จะได้เอาติ๊กออกได้
        for sku in _picked:
            agg.setdefault(sku, {'qty': 0, 'orders': set(), 'platforms': set(), 'hours': 0.0})

        ui = [widgets.HTML(
            '<div style="font-family:monospace;font-weight:700;border-bottom:2px solid #999;padding:4px 0">'
            '&nbsp;&nbsp;&nbsp;&nbsp;ของหมด | SKU / ชื่อสินค้า | ค้างส่ง | ค้างมา | ร้าน &nbsp;||&nbsp; '
            'ST − จองไว้ = ขายได้ &nbsp;→&nbsp; ถ้าติ๊ก</div>')]

        for sku, a in sorted(agg.items(), key=lambda kv: (-kv[1]['hours'], -kv[1]['qty'])):
            cur_st = st_qty.get(sku, 0)
            resv = toship.get(sku, 0)
            sellable = max(0, cur_st - resv)
            age = f'{a["hours"]:.0f} ชม.' if a['hours'] else '-'
            plats = ', '.join(sorted(a['platforms'])) or '(ติ๊กค้างไว้จากรอบก่อน)'
            # เหลืองเมื่อ ST ยังมีของทั้งที่มีออเดอร์ค้าง = ตัวที่ ST น่าจะไม่ตรงความจริงที่สุด
            warn = ' style="background:#fff3cd"' if sellable > 0 and a['qty'] > 0 else ''
            st_txt = (f'ST=<b style="font-size:1.05em">{cur_st}</b>'
                      + (f' − จอง {resv}' if resv else '')
                      + f' = ขายได้ <b style="font-size:1.05em">{sellable}</b>')
            after = ('<span style="color:#c00"> → ติ๊กแล้วเป็น <b>0</b></span>'
                     if sku in _picked or sellable > 0 else '')
            cb = widgets.Checkbox(value=(sku in _picked), indent=False,
                                  layout=widgets.Layout(width='28px', margin='0'))
            cb.observe(_on_tick(sku), 'value')
            ui.append(widgets.HBox([cb, widgets.HTML(
                f'<div{warn} style="font-family:monospace;padding:2px 0">'
                f'<b>{sku}</b> {st_name.get(sku, "")} &nbsp;|&nbsp; '
                f'ค้าง <b>{a["qty"]}</b> ชิ้น / {len(a["orders"])} ออเดอร์ &nbsp;|&nbsp; '
                f'{age} &nbsp;|&nbsp; {plats} &nbsp;||&nbsp; {st_txt}{after}</div>')]))

        if len(ui) == 1:
            ui.append(widgets.HTML('<i>ไม่มีรายการ — กดอัพเดทสต็อกต่อได้เลย</i>'))

        hidden_txt = ''
        if hidden:
            hidden_txt = (f'<div style="color:#c00">🚫 ซ่อนอยู่ <b>{len(hidden)}</b> SKU '
                          f'เพราะค้างไม่ถึง {hours_w.value} ชม. → {", ".join(hidden[:12])}'
                          f'{" ..." if len(hidden) > 12 else ""} '
                          f'<b>(ตั้งเป็น 0 เพื่อดูทั้งหมด)</b></div>')
        risky = [s for s, a in agg.items()
                 if a['qty'] > 0 and max(0, st_qty.get(s, 0) - toship.get(s, 0)) > 0]
        risky_txt = ''
        if risky:
            risky_txt = (f'<div style="color:#b26a00">⚠️ <b>{len(risky)}</b> SKU ที่ ST ยังมีของ '
                         f'ทั้งที่มีออเดอร์ค้างส่ง (แถวเหลือง) — ตรวจของจริงบนชั้นก่อนตัดสินใจ</div>')
        info.value = (
            f'<div>สแกนล่าสุด: <b>{data.get("scanned_at") or "(ยังไม่เคยสแกน)"}</b> &nbsp;|&nbsp; '
            f'ค้างส่งทั้งหมด <b>{total_orders}</b> ออเดอร์ / <b>{len(all_skus)}</b> SKU / '
            f'<b>{total_pcs}</b> ชิ้น &nbsp;|&nbsp; แสดง <b>{len(agg)}</b> SKU &nbsp;|&nbsp; '
            f'ติ๊กไว้ <b>{len(_picked)}</b></div>{hidden_txt}{risky_txt}')

        table_box.children = ui

    def _draw_safe(*_):
        try:
            _draw()
        except Exception as e:
            info.value = f'<div style="color:#c00">❌ วาดตารางไม่สำเร็จ: {e}</div>'

    hours_w.observe(_draw_safe, 'value')

    btn_save = widgets.Button(description='💾 บันทึกรายการของหมด', button_style='danger',
                              layout=widgets.Layout(width='240px'))
    btn_none = widgets.Button(description='ล้างติ๊กทั้งหมด', layout=widgets.Layout(width='160px'))

    def _on_save(b):
        save_force_zero(sorted(_picked))
        with out_save:
            clear_output()
            if _picked:
                print(f'✅ บันทึกแล้ว {len(_picked)} SKU จะถูก push เป็น 0 ทุกแพลตฟอร์ม:')
                for s in sorted(_picked):
                    print(f'   ⛔ {s}  {st_name.get(s, "")}')
            else:
                print('✅ ล้างรายการของหมดแล้ว — ทุก SKU กลับไปคิดตาม ST ปกติ')
            print(f'📄 {FORCE_ZERO_FILE}')
        _draw_safe()

    def _on_none(b):
        _picked.clear()
        _draw_safe()

    btn_save.on_click(_on_save)
    btn_none.on_click(_on_none)

    _draw_safe()
    display(widgets.VBox([widgets.HTML(
        '<h3>🚨 SKU ที่ติดอยู่ในออเดอร์ค้างส่ง</h3>'
        '<div style="color:#666">ติ๊ก = ยืนยันว่าของหมดจริง หาไม่เจอ → push 0 &nbsp;|&nbsp; '
        'ไม่ติ๊ก = ขนส่งลืมยิง ของออกไปแล้ว → คิดตาม ST ปกติ</div>'
        '<div style="color:#b26a00">แถวพื้นเหลือง = ยังขายได้อยู่ทั้งที่มีของค้าง เสี่ยงขายเกินที่สุด</div>'),
        hours_w, info, widgets.HTML('<hr>'), table_box,
        widgets.HTML('<hr>'), widgets.HBox([btn_save, btn_none]), out_save]))

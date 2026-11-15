"""Creates the upload test files in tests/data/. Orders, lines and reviews in these files are invented for testing
(IDs MVDEMO..., SAFE..., ALIAS..., REPL...); a few rows reuse existing keys on purpose to test duplicates and updates.
06_raw_sheets.xlsx holds the workbook's raw sheets, to test that the dashboard's cleaning reproduces the clean tables."""
import json
from pathlib import Path

import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "data"; OUT.mkdir(parents=True, exist_ok=True)
C = lambda n: pd.read_csv(ROOT / "data" / "clean" / f"{n}.csv", dtype=str, keep_default_na=False)
orders, items, reviews, products, customers = C("orders"), C("order_items"), C("reviews"), C("products"), C("customers")
OCOLS = list(orders.columns); ICOLS = list(items.columns)
cust = customers.customer_id.tolist()[:10]
sellers = products.groupby("seller_id").product_id.first()


def wb(path, sheets):
    w = openpyxl.Workbook(); w.remove(w.active)
    for name, (cols, rows) in sheets.items():
        ws = w.create_sheet(name); ws.append(cols)
        for r in rows:
            ws.append([r.get(c, "") for c in cols])
            for cell in ws[ws.max_row]:          # text that starts with "=" is stored as text, not as an Excel formula
                if isinstance(cell.value, str) and cell.value.startswith("="): cell.data_type = "s"

    w.save(path)


def new_order(i, seller, product, status="delivered", late=False, d=5):
    p = products.set_index("product_id").loc[product]; unit = int(int(p.list_price_ngn_2024) * 1.5); q = 1 + i % 2
    o = {c: "" for c in OCOLS}
    o.update(order_id=f"MVDEMO{i:03d}", cart_id=f"CTDEMO{i:03d}", customer_id=cust[i], seller_id=seller, order_purchase_ts=f"2026-01-{d:02d} 10:15:00", payment_method="Card",
             payment_confirmed_ts=f"2026-01-{d:02d} 10:20:00", items_subtotal_ngn=unit * q, voucher_discount_ngn=0, shipping_fee_ngn=1500, order_total_ngn=unit * q + 1500, order_status=status,
             estimated_delivery_date=f"2026-01-{d + 4:02d}", ship_from_state="Lagos", ship_to_state="Lagos")
    if status == "delivered":
        o.update(shipped_ts=f"2026-01-{d + 1:02d} 09:00:00", delivered_ts=f"2026-01-{d + (7 if late else 3):02d} 15:00:00")
    if status == "cancelled":
        o.update(cancelled_ts=f"2026-01-{d:02d} 18:00:00", cancelled_by="customer", cancellation_reason="Changed mind")
    line = {"order_id": o["order_id"], "order_item_seq": 1, "product_id": product, "seller_id": seller, "quantity": q, "unit_price_ngn": unit, "item_discount_ngn": 0, "line_total_ngn": unit * q}
    return o, line


# ---------- 01 append: 6 new orders (+ lines, reviews), 1 exact duplicate, 1 update of an open order, 1 invalid, 1 test order, 1 orphan line
O, I, R = [], [], []
for i, (s, p) in enumerate(list(sellers.items())[:6]):
    o, l = new_order(i, s, p, status="cancelled" if i == 4 else "delivered", late=(i % 3 == 0), d=3 + i)
    O.append(o); I.append(l)
    if o["order_status"] == "delivered":
        R.append({"review_id": f"RVDEMO{i}", "order_id": o["order_id"], "review_score": "2 stars" if i % 3 == 0 else 5, "review_date": f"2026-01-{min(28, 12 + i):02d}",
                  "review_comment": "Delivery took too long." if i % 3 == 0 else "Works well."})
O[1].update(payment_method="POD", ship_to_state="Lagos State", order_purchase_ts="04/01/2026 10:15")      # raw-style labels -> rules R3, R4?, R5, R6
O.append(orders.iloc[0].to_dict())                                                                       # exact copy of an existing order
upd = orders[orders.order_status == "shipped"].iloc[0].to_dict(); upd.update(order_status="delivered", delivered_ts="2026-01-02 16:00:00"); O.append(upd)
bad = dict(O[0]); bad.update(order_id="MVDEMO999", cart_id="CTDEMO999", order_status="lost in transit"); O.append(bad)
test = dict(O[0]); test.update(order_id="MVTEST999", cart_id="CTTEST999", customer_id="CU_TEST"); O.append(test)
I.append({**I[0], "order_id": "MVTEST999"}); I.append({**I[0], "order_id": "MVDEMO404"})
wb(OUT / "01_append_orders_lines_reviews.xlsx", {"orders": (OCOLS, O), "order_items": (ICOLS, I), "reviews": (["review_id", "order_id", "review_score", "review_date", "review_comment"], R)})
json.dump({"update_order": upd["order_id"], "duplicate_order": orders.iloc[0].order_id}, open(OUT / "01_expected.json", "w"))

# ---------- 02 missing required column, 03 wrong type
orders.head(3).drop(columns=["order_status"]).to_csv(OUT / "02_missing_required_column.csv", index=False)
(OUT / "03_wrong_type.txt").write_text("not a data file\n")

# ---------- 04 JSON with two tables and alternative column names
o4 = [{"Order ID": f"ALIAS{i}", "Customer ID": cust[i], "Seller ID": list(sellers.index)[i], "Order Date": f"2026-01-1{i} 12:00:00", "Subtotal": 20000 + i, "Status": "Completed" if i else "in_transit",
       "Delivery State": "Abuja" if i == 0 else "Rivers", "Promised Date": f"2026-01-1{i + 4}", "Delivered Date": "" if i == 0 else f"2026-01-1{i + 3} 11:00:00"} for i in range(3)]
i4 = [{"Order ID": f"ALIAS{i}", "Line Number": 1, "Product ID": list(sellers.values)[i], "Qty": 1, "Unit Price": 20000 + i, "Line Total": 20000 + i} for i in range(3)]
json.dump({"orders": o4, "order_items": i4}, open(OUT / "04_alias_two_tables.json", "w"), indent=1)

# ---------- 05 reviews: two versions of one review (keep latest), a text score, an out-of-range score
no_rev = orders[(orders.order_status == "delivered") & ~orders.order_id.isin(reviews.order_id) & (orders.delivered_ts != "")].head(3)
a, b, c = no_rev.order_id.tolist(); da = no_rev.delivered_ts.iloc[0][:10]
pd.DataFrame([{"review_id": "RVT1", "order_id": a, "review_score": "2", "review_date": da, "review_comment": "first version"},
              {"review_id": "RVT2", "order_id": a, "review_score": "4", "review_date": (pd.Timestamp(da) + pd.Timedelta(days=2)).strftime("%Y-%m-%d"), "review_comment": " edited version "},
              {"review_id": "RVT3", "order_id": b, "review_score": "4/5", "review_date": "2025-12-31", "review_comment": ""},
              {"review_id": "RVT4", "order_id": c, "review_score": "7", "review_date": "2025-12-31", "review_comment": ""}]).to_csv(OUT / "05_reviews_versions.csv", index=False)
json.dump({"a": a, "b": b, "c": c}, open(OUT / "05_expected.json", "w"))

# ---------- 06 raw sheets of the source workbook
raw = pd.read_excel(ROOT / "data" / "raw" / "marketvale_marketplace_data.xlsx", sheet_name=["raw_orders", "raw_order_items", "raw_reviews", "raw_customers"], dtype=str, keep_default_na=False)
with pd.ExcelWriter(OUT / "06_raw_sheets.xlsx") as xw:
    for k, v in raw.items(): v.to_excel(xw, sheet_name=k, index=False)

# ---------- 07 security: HTML and spreadsheet formulas in text fields
s7 = []; l7 = []
for i, cid in enumerate(['<img src=x onerror=alert(1)>', '=HYPERLINK("http://example.com")']):
    o, l = new_order(i, list(sellers.index)[i], list(sellers.values)[i], d=20); o.update(order_id=f"SAFE{i}", cart_id=f"CTSAFE{i}", customer_id=cid); l["order_id"] = f"SAFE{i}"; s7.append(o); l7.append(l)
wb(OUT / "07_security.xlsx", {"orders": (OCOLS, s7), "order_items": (ICOLS, l7)})

# ---------- 08 replace: 40 invented orders over two months
O8, I8 = [], []
for i in range(40):
    s, p = list(sellers.items())[i % 30]; o, l = new_order(i % 10, s, p, d=3 + i % 20)
    o.update(order_id=f"REPL{i:03d}", cart_id=f"CTREPL{i:03d}"); l["order_id"] = o["order_id"]; O8.append(o); I8.append(l)
wb(OUT / "08_replace_forty_orders.xlsx", {"orders": (OCOLS, O8), "order_items": (ICOLS, I8)})
print(sorted(p.name for p in OUT.iterdir()))

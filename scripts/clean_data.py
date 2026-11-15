"""Independent cleaning pipeline for the Marketvale marketplace data.

The workbook ships both RAW sheets (as exported, with data-quality problems) and CLEAN sheets. This script rebuilds the
clean tables from the raw sheets with explicitly coded rules (the same rules the dashboard applies to uploaded files),
then reconciles the result with the workbook's clean sheets, cell by cell. The dashboard analyses the clean tables.

Run from the repository root:  python scripts/clean_data.py
Outputs:  data/clean/*.csv (the clean tables), data/processed/cleaning_log.csv, data/processed/reconciliation.json
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "marketvale_marketplace_data.xlsx"
CLEAN = ROOT / "data" / "clean"
PROC = ROOT / "data" / "processed"

STATUS = {"delivered": "delivered", "completed": "delivered", "returned": "returned", "return_completed": "returned",
          "cancelled": "cancelled", "canceled": "cancelled", "delivery_failed": "delivery_failed", "failed delivery": "delivery_failed",
          "delivery failed": "delivery_failed", "shipped": "shipped", "in_transit": "shipped", "in transit": "shipped",
          "processing": "processing", "pending": "processing"}
PAYMENT = {"card": "Card", "debit card": "Card", "credit card": "Card", "bank transfer": "Bank transfer", "bank_transfer": "Bank transfer",
           "transfer": "Bank transfer", "pay on delivery": "Pay on delivery", "pod": "Pay on delivery", "cash on delivery": "Pay on delivery",
           "wallet": "Wallet", "marketvale wallet": "Wallet"}
STATE_ALIAS = {"abuja": "FCT", "f.c.t": "FCT", "fct abuja": "FCT", "fct": "FCT", "federal capital territory": "FCT",
               "ibadan": "Oyo", "port harcourt": "Rivers", "ph": "Rivers"}
TS_COLS = ["payment_confirmed_ts", "shipped_ts", "delivered_ts", "delivery_failed_ts", "return_requested_ts", "cancelled_ts"]
KOBO_RATIO = 20      # a unit price above 20x the product's 2024 list price is taken to be recorded in kobo (x100)


def blank(s):
    return s.isna() | (s.astype(str).str.strip() == "")


def std_state(v, valid):
    lookup = {s.lower(): s for s in valid}
    s = str(v).strip()
    k = re.sub(r"\s+state$", "", s, flags=re.I).strip().lower()
    k = STATE_ALIAS.get(k, k)
    return lookup.get(k.lower(), lookup.get(str(k).lower(), None)) if k not in valid else k


def parse_ts(s):
    """ISO 'yyyy-mm-dd HH:MM[:SS]' or day-first 'dd/mm/yyyy HH:MM' -> Timestamp."""
    s = s.astype(str).str.strip()
    out = pd.to_datetime(s.where(~s.str.match(r"^\d{2}/\d{2}/\d{4}")), format="ISO8601", errors="coerce")
    dayfirst = s.str.match(r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$")
    out[dayfirst] = pd.to_datetime(s[dayfirst], format="%d/%m/%Y %H:%M")
    return out, int(dayfirst.sum())


def clean_orders(raw, states, log):
    o = raw.copy()
    n = len(o); o = o.drop_duplicates(); log.append(("R1", "orders", "Exact duplicate order rows (re-exported batch)", "Removed duplicates", n - len(o)))
    test = o.order_id.str.upper().str.startswith("MVTEST") | (o.customer_id == "CU_TEST") | (o.cancellation_reason.str.strip().str.lower() == "test order")
    log.append(("R2", "orders", "Internal test orders", "Removed", int(test.sum())))
    removed_ids = set(o.order_id[test]); o = o[~test].copy()
    o["order_purchase_ts"], k = parse_ts(o.order_purchase_ts)
    log.append(("R3", "orders", "Purchase time stored as day-first text 'dd/mm/yyyy hh:mm' (seconds lost)", "Parsed to a timestamp", k))
    for c in TS_COLS:
        o[c] = pd.to_datetime(o[c].where(~blank(o[c])), format="ISO8601", errors="coerce")
    o["estimated_delivery_date"] = pd.to_datetime(o.estimated_delivery_date, format="ISO8601")
    st = o.order_status.str.strip().str.lower().map(STATUS)
    assert st.notna().all(), set(o.order_status[st.isna()])
    log.append(("R4", "orders", "Order status labels in several spellings", "Mapped to 6 standard statuses", int((st != o.order_status).sum())))
    o["order_status"] = st
    pm = o.payment_method.str.strip().str.lower().map(PAYMENT)
    assert pm.notna().all(), set(o.payment_method[pm.isna()])
    log.append(("R5", "orders", "Payment method labels in several spellings", "Mapped to 4 standard methods", int((pm != o.payment_method).sum())))
    o["payment_method"] = pm
    valid = set(states.state)
    for col, rule in [("ship_to_state", "R6"), ("ship_from_state", "R6b")]:
        new = o[col].map(lambda v: std_state(v, valid))
        assert new.notna().all(), set(o[col][new.isna()])
        changed = int((new != o[col]).sum()); o[col] = new
        if col == "ship_to_state" or changed:
            log.append((rule, "orders", f"{col} written in several ways", "Mapped to the standard state name", changed))
    note = pd.Series("", index=o.index, dtype=object)
    sw = o.delivered_ts.notna() & o.shipped_ts.notna() & (o.delivered_ts < o.shipped_ts)
    o.loc[sw, ["shipped_ts", "delivered_ts"]] = o.loc[sw, ["delivered_ts", "shipped_ts"]].values
    note[sw] = "shipped_delivered_swapped_fixed"
    log.append(("R7", "orders", "Delivered time earlier than shipped time (scan fields swapped)", "Swapped back", int(sw.sum())))
    for c in ["items_subtotal_ngn", "voucher_discount_ngn", "shipping_fee_ngn", "order_total_ngn"]:
        o[c] = pd.to_numeric(o[c]).astype("int64")
    neg = o.shipping_fee_ngn < 0
    o.loc[neg, "shipping_fee_ngn"] = -o.loc[neg, "shipping_fee_ngn"]; note[neg] = "shipping_fee_sign_fixed"
    log.append(("R8", "orders", "Negative shipping fee (sign error)", "Made positive; order_total already used the positive fee", int(neg.sum())))
    miss = o.order_status.isin(["delivered", "returned"]) & o.delivered_ts.isna(); note[miss] = "delivered_ts_missing"
    log.append(("R9", "orders", "Delivered order without a delivery timestamp (missing carrier scan)", "Kept; delivered_ts left blank and flagged. Excluded from delivery-time metrics", int(miss.sum())))
    for c in ["cancelled_by", "cancellation_reason"]:
        o[c] = o[c].where(~blank(o[c]))
    o["data_quality_note"] = note.replace("", np.nan)
    return o, removed_ids


def clean_items(raw, removed_ids, products, log):
    it = raw.copy()
    n = len(it); it = it.drop_duplicates(); log.append(("I1", "order_items", "Duplicate item lines", "Removed duplicates", n - len(it)))
    orph = it.order_id.isin(removed_ids); it = it[~orph].copy()
    log.append(("I2", "order_items", "Lines belonging to removed test orders (orphans)", "Removed", int(orph.sum())))
    for c in ["order_item_seq", "quantity", "unit_price_ngn", "item_discount_ngn", "line_total_ngn"]:
        it[c] = pd.to_numeric(it[c].where(~blank(it[c])))
    lp = it.product_id.map(products.set_index("product_id").list_price_ngn_2024)
    kobo = it.unit_price_ngn > KOBO_RATIO * lp
    for c in ["unit_price_ngn", "item_discount_ngn", "line_total_ngn"]:
        it.loc[kobo, c] = it.loc[kobo, c] / 100
    log.append(("I3", "order_items", f"Prices recorded in kobo (x100): unit price above {KOBO_RATIO}x the product's 2024 list price", "Divided price, discount and line total by 100", int(kobo.sum())))
    neg = it.quantity < 0; it.loc[neg, "quantity"] = -it.loc[neg, "quantity"]
    log.append(("I4", "order_items", "Negative quantity with a positive line total (sign error)", "Made positive", int(neg.sum())))
    mp = it.unit_price_ngn.isna()
    it.loc[mp, "unit_price_ngn"] = (it.loc[mp, "line_total_ngn"] + it.loc[mp, "item_discount_ngn"]) / it.loc[mp, "quantity"]
    log.append(("I5", "order_items", "Unit price missing", "Recalculated as (line total + discount) / quantity", int(mp.sum())))
    for c in ["order_item_seq", "quantity", "unit_price_ngn", "item_discount_ngn", "line_total_ngn"]:
        it[c] = it[c].round().astype("int64")
    return it


def clean_reviews(raw, orders, log):
    r = raw.copy()
    r["review_date"] = pd.to_datetime(r.review_date, format="ISO8601")
    # V1: an edited review exported twice -> keep the latest version per order
    r = r.sort_values(["order_id", "review_date", "review_id"])
    dup = r.order_id.duplicated(keep="last")
    log.append(("V1", "reviews", "Edited reviews exported twice (older version kept alongside the new one)", "Kept the latest version per order", int(dup.sum())))
    r = r[~dup].copy()
    txt = r.review_score.str.contains(r"[^\d\s]")          # '4 stars', '4/5' (padding alone is not counted)
    r["review_score"] = r.review_score.str.extract(r"^\s*(\d+)")[0].astype(int)
    log.append(("V2", "reviews", "Score stored as text ('4 stars', '4/5')", "Extracted the number", int(txt.sum())))
    bad = ~r.review_score.between(1, 5)
    log.append(("V3", "reviews", "Score outside 1-5 (0, 6, 10)", "Removed (true score unknown)", int(bad.sum())))
    r = r[~bad].copy()
    o = orders.set_index("order_id")
    ref = o.delivered_ts.fillna(o.cancelled_ts).fillna(o.delivery_failed_ts).dt.normalize()
    rd = r.order_id.map(ref)
    early = rd.notna() & (r.review_date < rd)
    r.loc[early, "review_date"] = rd[early]
    r["review_date_corrected"] = early.astype(int)
    log.append(("V4", "reviews", "Review dated before the delivery (device clock)", "Set to the delivery date; flagged", int(early.sum())))
    c = r.review_comment.fillna("").astype(str); trimmed = c.str.strip()
    log.append(("V5", "reviews", "Leading or trailing spaces in comments", "Trimmed", int((c != trimmed).sum())))
    r["review_comment"] = trimmed.replace("", np.nan)
    return r.sort_values("review_id")


def clean_customers(raw, orders, states, log):
    c = raw.copy()
    n = len(c); c = c.drop_duplicates(); log.append(("C1", "customers", "Exact duplicate customer rows", "Removed duplicates", n - len(c)))
    valid = set(states.state)
    new = c.customer_state.map(lambda v: std_state(v, valid)); assert new.notna().all()
    log.append(("C2", "customers", "State written in several ways (e.g. 'Lagos State', 'Abuja', 'Port Harcourt')", "Mapped to the standard state name", int((new != c.customer_state).sum())))
    c["customer_state"] = new
    bc = blank(c.acquisition_channel); c.loc[bc, "acquisition_channel"] = "Unknown"
    log.append(("C3", "customers", "Acquisition channel blank", "Set to 'Unknown'", int(bc.sum())))
    c["signup_date"] = pd.to_datetime(c.signup_date.where(~blank(c.signup_date)), format="ISO8601")
    first = orders.groupby("customer_id").order_purchase_ts.min().dt.normalize()
    miss = c.signup_date.isna(); fill = c.customer_id.map(first)
    c["signup_date_imputed"] = (miss & fill.notna()).astype(int)
    c.loc[miss, "signup_date"] = fill[miss]
    log.append(("C4", "customers", "Signup date missing", "Imputed as the date of the first order (upper bound); flagged. Left blank if no orders", int(miss.sum())))
    c["customer_zone"] = c.customer_state.map(states.set_index("state").zone)
    return c[["customer_id", "signup_date", "signup_date_imputed", "customer_state", "customer_zone", "acquisition_channel"]]


def compare(mine, given, key, name):
    """Cell-by-cell comparison of two tables on a key. Returns a summary dict."""
    a = mine.set_index(key).sort_index(); b = given.set_index(key).sort_index()
    out = {"table": name, "rows_mine": len(a), "rows_workbook": len(b), "keys_only_mine": len(a.index.difference(b.index)), "keys_only_workbook": len(b.index.difference(a.index))}
    common = a.index.intersection(b.index); cols = [c for c in b.columns if c in a.columns]
    diffs = {}
    for c in cols:
        x, y = a.loc[common, c], b.loc[common, c]
        if pd.api.types.is_datetime64_any_dtype(y) or pd.api.types.is_datetime64_any_dtype(x):
            x, y = pd.to_datetime(x), pd.to_datetime(y)
        eq = (x == y) | (x.isna() & y.isna())
        if (~eq).sum():
            diffs[c] = int((~eq).sum())
    out["columns_compared"] = len(cols); out["cells_compared"] = len(common) * len(cols); out["cells_different"] = sum(diffs.values()); out["differences"] = diffs
    return out


def main():
    CLEAN.mkdir(parents=True, exist_ok=True); PROC.mkdir(parents=True, exist_ok=True)
    X = pd.read_excel(RAW, sheet_name=None, dtype=str, keep_default_na=False)
    W = pd.read_excel(RAW, sheet_name=["orders", "order_items", "reviews", "customers", "sellers", "products", "categories", "states", "calendar"])
    states, products = W["states"], W["products"]
    log = []
    orders, removed = clean_orders(X["raw_orders"], states, log)
    customers = clean_customers(X["raw_customers"], orders, states, log)
    items = clean_items(X["raw_order_items"], removed, products, log)
    reviews = clean_reviews(X["raw_reviews"], orders, log)
    order = ["C1", "C2", "C3", "R1", "R2", "R3", "R4", "R5", "R6", "R6b", "R7", "R8", "R9", "C4", "I1", "I2", "I3", "I4", "I5", "V1", "V2", "V3", "V4", "V5"]
    log = sorted(log, key=lambda r: order.index(r[0]))
    pd.DataFrame(log, columns=["rule", "table", "issue", "action", "rows_affected"]).to_csv(PROC / "cleaning_log.csv", index=False)

    rec = [compare(orders, W["orders"], "order_id", "orders"), compare(items, W["order_items"], ["order_id", "order_item_seq"], "order_items"),
           compare(reviews, W["reviews"], "review_id", "reviews"), compare(customers, W["customers"], "customer_id", "customers")]
    wb_log = pd.read_excel(RAW, sheet_name="cleaning_log").set_index("rule").rows_affected.to_dict()
    log_cmp = {r[0]: {"mine": r[4], "workbook": wb_log.get(r[0])} for r in log}
    (PROC / "reconciliation.json").write_text(json.dumps({"tables": rec, "cleaning_log": log_cmp}, indent=1, default=str))

    # write the clean tables: the four rebuilt tables (reconciled above) and the reference tables from the workbook
    def fmt(df, dates=()):
        df = df.copy()
        for c in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[c]):
                df[c] = df[c].dt.strftime("%Y-%m-%d" if c in dates else "%Y-%m-%d %H:%M:%S")
        return df
    D = ("estimated_delivery_date", "review_date", "signup_date", "join_date", "deactivated_date", "listed_date", "date", "week_start_date")
    tables = {"orders": orders.sort_values("order_id"), "order_items": items.sort_values(["order_id", "order_item_seq"]), "reviews": reviews,
              "customers": customers.sort_values("customer_id")}
    tables.update({k: W[k] for k in ["sellers", "products", "categories", "states", "calendar"]})
    tables["sellers"] = tables["sellers"].assign(deactivated_date=pd.to_datetime(tables["sellers"].deactivated_date))
    for name, df in tables.items():
        fmt(df, D).to_csv(CLEAN / f"{name}.csv", index=False)
    for r in rec:
        print(f"{r['table']:12s} rows {r['rows_mine']} vs {r['rows_workbook']}; keys only mine {r['keys_only_mine']}, only workbook {r['keys_only_workbook']}; "
              f"{r['cells_different']} of {r['cells_compared']} cells differ {r['differences']}")
    print({k: v for k, v in log_cmp.items() if v["mine"] != v["workbook"]})


if __name__ == "__main__":
    main()

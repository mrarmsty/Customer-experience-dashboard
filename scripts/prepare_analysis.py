"""Reference analysis for the Marketvale dashboard (pandas / SciPy / statsmodels).

Builds the order-level analysis table from the clean tables with the same definitions as the dashboard
(assets/js/analytics.js), the summary tables, and reference_values.json, which the automated tests compare the
dashboard against. It also fits a logistic regression of low ratings, reported in the technical report only.

Run after clean_data.py:  python scripts/prepare_analysis.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
CLEAN = ROOT / "data" / "clean"
OUT = ROOT / "data" / "processed"
MIN_SELLER_ORDERS = 30          # sellers need at least this many delivered (or reviewed) orders to be ranked
LOW = 2                         # a low rating is 1 or 2 stars
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def load():
    r = lambda n, **k: pd.read_csv(CLEAN / f"{n}.csv", keep_default_na=False, na_values=[""], **k)
    o = r("orders"); it = r("order_items"); rv = r("reviews"); cu = r("customers"); se = r("sellers"); pr = r("products")
    ca = r("categories"); st = r("states"); cal = r("calendar")
    for c in ["order_purchase_ts", "payment_confirmed_ts", "shipped_ts", "delivered_ts", "delivery_failed_ts", "return_requested_ts", "cancelled_ts", "estimated_delivery_date"]:
        o[c] = pd.to_datetime(o[c])
    return o, it, rv, cu, se, pr, ca, st, cal


def wilson(k, n, z=1.959963984540054):
    if n == 0: return (np.nan, np.nan)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def build_orders(o, it, rv, cu, se, pr, ca, st, cal):
    p = pr.merge(ca, on="category_id", how="left")
    i = it.merge(p[["product_id", "category_id", "category_name", "category_group", "list_price_ngn_2024", "is_bulky"]], on="product_id", how="left")
    i["list_value"] = i.quantity * i.list_price_ngn_2024
    i["gross_value"] = i.quantity * i.unit_price_ngn
    agg = i.groupby("order_id").agg(category_id=("category_id", "first"), category_name=("category_name", "first"), category_group=("category_group", "first"),
                                    lines=("order_item_seq", "size"), units=("quantity", "sum"), item_discount=("item_discount_ngn", "sum"),
                                    list_value=("list_value", "sum"), gross_value=("gross_value", "sum"), is_bulky=("is_bulky", "max"))
    d = o.merge(agg, left_on="order_id", right_index=True, how="left")
    d = d.merge(se[["seller_id", "seller_name", "seller_state", "seller_tier", "fulfilment_model"]], on="seller_id", how="left")
    zone = st.set_index("state").zone
    d["zone"] = d.ship_to_state.map(zone)
    ts = d.order_purchase_ts
    d["date"] = ts.dt.strftime("%Y-%m-%d"); d["month"] = ts.dt.strftime("%Y-%m"); d["year"] = ts.dt.year
    d["quarter"] = ts.dt.year.astype(str) + "-Q" + ts.dt.quarter.astype(str)
    d["weekday"] = ts.dt.day_name(); d["hour"] = ts.dt.hour
    c = cal.set_index("date")
    d["sales_event"] = d.date.map(c.sales_event).fillna("None")
    d["peak_logistics"] = d.date.map(c.is_peak_logistics).fillna(0).astype(int)
    s = d.order_status
    d["cancelled"] = (s == "cancelled").astype(int); d["open"] = s.isin(["shipped", "processing"]).astype(int)
    d["delivered"] = s.isin(["delivered", "returned"]).astype(int); d["returned"] = (s == "returned").astype(int); d["failed"] = (s == "delivery_failed").astype(int)
    d["gmv"] = np.where(d.cancelled == 0, d.items_subtotal_ngn, 0)
    has = d.delivered_ts.notna()
    d["delivery_days"] = np.where(has, (d.delivered_ts - d.order_purchase_ts).dt.total_seconds() / 86400, np.nan)
    late_days = (d.delivered_ts.dt.normalize() - d.estimated_delivery_date).dt.days
    d["late"] = np.where(has, (late_days > 0).astype(float), np.nan)
    d["days_late"] = np.where(has, late_days.clip(lower=0), np.nan)
    d["promised_days"] = (d.estimated_delivery_date - d.order_purchase_ts.dt.normalize()).dt.days
    d["intra_state"] = (d.ship_from_state == d.ship_to_state).astype(int)
    r = rv.set_index("order_id")
    d["review_score"] = d.order_id.map(r.review_score)
    d["reviewed"] = d.review_score.notna().astype(int)
    d["low_rating"] = np.where(d.reviewed == 1, (d.review_score <= LOW).astype(float), np.nan)
    d["review_comment"] = d.order_id.map(r.review_comment)
    return d.sort_values(["order_purchase_ts", "order_id"]).reset_index(drop=True), i


def theme(c):
    """Rule-based theme of a review comment (same keyword rules as the dashboard)."""
    if not isinstance(c, str) or not c.strip(): return "No comment"
    t = c.lower()
    rules = [("Late delivery", ["late", "delayed", "took too long", "after the promised", "slow"]),
             ("Failed delivery", ["delivery failed", "never showed", "could not reach", "rider"]),
             ("Damaged item", ["damaged", "broken", "crushed", "scratch", "dent"]),
             ("Not as described / wrong item", ["not as described", "wrong size", "different from", "fake", "not original", "pictures"]),
             ("Product quality", ["stopped working", "poor", "average quality"]),
             ("Cancellation / refund", ["cancel", "refund", "out of stock"]),
             ("Positive", ["works well", "good value", "great seller", "exactly as described", "neatly packaged", "very satisfied", "will buy again", "nice quality", "fast delivery", "earlier than expected"]),
             ("Neutral", ["okay", "fine", "average"])]
    for name, keys in rules:
        if any(k in t for k in keys): return name
    return "Other"


def kruskal(groups):
    g = [x for x in groups if len(x)]
    h, p = stats.kruskal(*g); n = sum(map(len, g)); k = len(g)
    return {"H": float(h), "p": float(p), "df": k - 1, "epsilon_sq": float((h - k + 1) / (n - k))}


def main():
    o, it, rv, cu, se, pr, ca, st, cal = load()
    d, items = build_orders(o, it, rv, cu, se, pr, ca, st, cal)
    d["theme"] = np.where(d.reviewed == 1, d.review_comment.map(theme), None)
    keep = ["order_id", "cart_id", "customer_id", "seller_id", "seller_name", "seller_tier", "fulfilment_model", "order_purchase_ts", "date", "month", "quarter", "year", "weekday", "hour",
            "category_id", "category_name", "category_group", "payment_method", "order_status", "cancelled", "open", "delivered", "returned", "failed", "lines", "units",
            "items_subtotal_ngn", "item_discount", "voucher_discount_ngn", "shipping_fee_ngn", "order_total_ngn", "gmv", "list_value", "ship_from_state", "ship_to_state", "zone", "intra_state",
            "is_bulky", "sales_event", "peak_logistics", "promised_days", "delivery_days", "late", "days_late", "review_score", "low_rating", "theme", "data_quality_note"]
    d[keep].assign(order_purchase_ts=d.order_purchase_ts.dt.strftime("%Y-%m-%d %H:%M:%S")).to_csv(OUT / "orders_analysis.csv", index=False)

    nc = d[d.cancelled == 0]
    dl = d[d.delivered_ts.notna()]
    rvw = d[d.reviewed == 1]
    # price index by month (selling price vs 2024 list price, non-cancelled orders) and real GMV
    ix = nc.groupby("month").apply(lambda g: g.gross_value.sum() / g.list_value.sum() if "gross_value" in g else np.nan, include_groups=False) if False else None
    it2 = items.merge(d[["order_id", "month", "cancelled"]], on="order_id")
    it2 = it2[it2.cancelled == 0]
    pidx = it2.groupby("month").gross_value.sum() / it2.groupby("month").list_value.sum()
    nc = nc.assign(real_gmv=nc.gmv / nc.month.map(pidx))

    # -------- summaries
    month = d.groupby("month").agg(orders=("order_id", "size"), cancelled=("cancelled", "sum")).join(
        nc.groupby("month").agg(gmv=("gmv", "sum"), real_gmv=("real_gmv", "sum"), units=("units", "sum"), customers=("customer_id", "nunique"))).join(
        dl.groupby("month").agg(late_rate=("late", "mean"), avg_delivery_days=("delivery_days", "mean"))).join(
        rvw.groupby("month").agg(avg_score=("review_score", "mean"), low_rate=("low_rating", "mean")))
    month["aov"] = month.gmv / (month.orders - month.cancelled); month["price_index"] = pidx
    month.to_csv(OUT / "summary_by_month.csv")
    cat = d.groupby("category_name").agg(group=("category_group", "first"), orders=("order_id", "size"), cancelled=("cancelled", "sum"), returned=("returned", "sum"), delivered=("delivered", "sum")).join(
        nc.groupby("category_name").agg(gmv=("gmv", "sum"), units=("units", "sum"))).join(
        dl.groupby("category_name").agg(late_rate=("late", "mean"), avg_delivery_days=("delivery_days", "mean"))).join(
        rvw.groupby("category_name").agg(reviews=("review_score", "size"), avg_score=("review_score", "mean"), low_rate=("low_rating", "mean")))
    cat["gmv_share"] = cat.gmv / cat.gmv.sum(); cat["aov"] = cat.gmv / (cat.orders - cat.cancelled); cat["cancel_rate"] = cat.cancelled / cat.orders
    cat["return_rate"] = cat.returned / cat.delivered
    ontime = rvw[(rvw.late == 0)]
    cat["low_rate_on_time"] = ontime.groupby("category_name").low_rating.mean()
    cat = cat.sort_values("gmv", ascending=False); cat.to_csv(OUT / "summary_by_category.csv")
    stt = d.groupby("ship_to_state").agg(zone=("zone", "first"), orders=("order_id", "size")).join(
        nc.groupby("ship_to_state").agg(gmv=("gmv", "sum"), customers=("customer_id", "nunique"))).join(
        dl.groupby("ship_to_state").agg(avg_delivery_days=("delivery_days", "mean"), late_rate=("late", "mean"), delivered_n=("late", "size")))
    stt["spend_per_customer"] = stt.gmv / stt.customers; stt = stt.sort_values("orders", ascending=False); stt.to_csv(OUT / "summary_by_state.csv")
    zone = d.groupby("zone").agg(orders=("order_id", "size")).join(nc.groupby("zone").agg(gmv=("gmv", "sum"), customers=("customer_id", "nunique"), nc_orders=("order_id", "size"))).join(
        dl.groupby("zone").agg(avg_delivery_days=("delivery_days", "mean"), late_rate=("late", "mean")))
    zone["spend_per_customer"] = zone.gmv / zone.customers; zone["aov"] = zone.gmv / zone.nc_orders; zone.to_csv(OUT / "summary_by_zone.csv")
    sel = d.groupby(["seller_id"]).agg(seller_name=("seller_name", "first"), tier=("seller_tier", "first"), fulfilment=("fulfilment_model", "first"), category=("category_name", lambda x: x.mode().iat[0]),
                                       orders=("order_id", "size"), cancelled=("cancelled", "sum"), seller_cancelled=("cancelled_by", lambda x: (x == "seller").sum())).join(
        nc.groupby("seller_id").agg(gmv=("gmv", "sum"))).join(
        dl.groupby("seller_id").agg(delivered_n=("late", "size"), late_n=("late", "sum"), late_rate=("late", "mean"), avg_delivery_days=("delivery_days", "mean"), avg_days_late=("days_late", "mean"))).join(
        rvw.groupby("seller_id").agg(reviews=("review_score", "size"), avg_score=("review_score", "mean"), low_n=("low_rating", "sum"), low_rate=("low_rating", "mean")))
    sel = sel.fillna({"delivered_n": 0, "late_n": 0, "reviews": 0, "low_n": 0})
    late_all, low_all = dl.late.mean(), rvw.low_rating.mean()
    sel["late_lo"] = [wilson(k, n)[0] for k, n in zip(sel.late_n, sel.delivered_n)]
    sel["low_lo"] = [wilson(k, n)[0] for k, n in zip(sel.low_n, sel.reviews)]
    sel["flag_late"] = ((sel.delivered_n >= MIN_SELLER_ORDERS) & (sel.late_lo > late_all)).astype(int)
    sel["flag_low"] = ((sel.reviews >= MIN_SELLER_ORDERS) & (sel.low_lo > low_all)).astype(int)
    sel.sort_values("gmv", ascending=False).to_csv(OUT / "seller_scorecard.csv")

    # -------- customers (purchases = distinct checkouts (cart_id) among non-cancelled orders)
    pur = nc.groupby("customer_id").cart_id.nunique()
    first = nc.groupby("customer_id").order_purchase_ts.min()
    # cohort: quarter of first purchase; share purchasing again in a later quarter
    cq = first.dt.year.astype(str) + "-Q" + first.dt.quarter.astype(str)
    nq = nc.assign(cohort=nc.customer_id.map(cq))
    qi = lambda q: int(q[:4]) * 4 + int(q[-1]) - 1
    nq["k"] = nq.quarter.map(qi) - nq.cohort.map(qi)
    coh = nq.groupby(["cohort", "k"]).customer_id.nunique().unstack(fill_value=0)
    coh = coh.div(coh[0], axis=0); coh.to_csv(OUT / "cohort_retention.csv")

    # -------- tests
    x = rvw[rvw.late.notna()]
    ct = pd.crosstab(x.late, x.low_rating)
    chi2, p, dof, _ = stats.chi2_contingency(ct, correction=False)
    a = ct.loc[1.0, 1.0]; b = ct.loc[1.0].sum(); c_ = ct.loc[0.0, 1.0]; e = ct.loc[0.0].sum()
    rr = (a / b) / (c_ / e); se_ = np.sqrt(1 / a - 1 / b + 1 / c_ - 1 / e)
    sp = stats.spearmanr(x.days_late, x.review_score)
    bucket = pd.cut(x.days_late, [-1, 0, 1, 2, 1000], labels=["On time", "1 day late", "2 days late", "3+ days late"])
    by_bucket = x.groupby(bucket, observed=True).agg(n=("review_score", "size"), avg_score=("review_score", "mean"), low_rate=("low_rating", "mean"))
    kw_cat = kruskal([g.review_score.values for _, g in rvw.groupby("category_name")])
    ct2 = pd.crosstab(d.category_name, d.cancelled); chi_c, p_c, df_c, _ = stats.chi2_contingency(ct2, correction=False)
    ct3 = pd.crosstab(rvw.category_name, rvw.low_rating); chi_l, p_l, df_l, _ = stats.chi2_contingency(ct3, correction=False)
    ct4 = pd.crosstab(x[x.late == 0].category_name, x[x.late == 0].low_rating); chi_l2, p_l2, df_l2, _ = stats.chi2_contingency(ct4, correction=False)
    kw_state = kruskal([g.delivery_days.values for _, g in dl.groupby("ship_to_state")])
    fm = dl.groupby("fulfilment_model").agg(late=("late", "mean"), days=("delivery_days", "mean"), n=("late", "size"))
    ct5 = pd.crosstab(dl.fulfilment_model, dl.late); chi_f, p_f, _, _ = stats.chi2_contingency(ct5, correction=False)
    # monthly trend of orders (OLS on month index)
    m = month.reset_index(); xi = np.arange(len(m))
    lr = stats.linregress(xi, m.orders)
    y24, y25 = nc[nc.year == 2024], nc[nc.year == 2025]
    # logistic regression (report only): low rating ~ late + days_late + bulky + intra_state + fulfilment + category
    import statsmodels.formula.api as smf
    lg = x.assign(low=x.low_rating.astype(int), mf=(x.fulfilment_model == "Marketplace Fulfilled").astype(int))
    fit = smf.logit("low ~ late + is_bulky + intra_state + mf + C(category_name, Treatment('Phones & Tablets'))", data=lg).fit(disp=0)
    logit = {k: {"or": float(np.exp(v)), "p": float(fit.pvalues[k]), "lo": float(np.exp(fit.conf_int().loc[k, 0])), "hi": float(np.exp(fit.conf_int().loc[k, 1]))} for k, v in fit.params.items()}

    closed = d[d.open == 0]
    ref = {
        "orders": len(d), "orders_non_cancelled": len(nc), "gmv": float(nc.gmv.sum()), "real_gmv": float(nc.real_gmv.sum()), "aov": float(nc.gmv.mean()), "units": int(nc.units.sum()),
        "net_delivered_gmv": float(d[d.order_status == "delivered"].items_subtotal_ngn.sum()),
        "cancel_rate": float(d.cancelled.mean() * 100), "return_rate": float(d.returned.sum() / d.delivered.sum() * 100),
        "customers_ordering": int(d.customer_id.nunique()), "customers_purchasing": int(len(pur)), "repeat_rate": float((pur >= 2).mean() * 100),
        "orders_per_customer": float(nc.cart_id.nunique() / len(pur)), "spend_per_customer": float(nc.gmv.sum() / len(pur)),
        "registered_customers": len(cu), "never_ordered": int(len(cu) - d.customer_id.nunique()),
        "delivered_of_closed": float(closed.delivered.mean() * 100), "delivery_success": float(d.delivered.sum() / (d.delivered.sum() + d.failed.sum()) * 100),
        "avg_delivery_days": float(dl.delivery_days.mean()), "median_delivery_days": float(dl.delivery_days.median()), "late_rate": float(dl.late.mean() * 100),
        "avg_days_late_when_late": float(dl[dl.late == 1].days_late.mean()), "delivery_ts_missing": int((d.data_quality_note == "delivered_ts_missing").sum()),
        "reviews": len(rvw), "review_rate": float(len(rvw) / len(d) * 100), "avg_score": float(rvw.review_score.mean()), "low_rate": float(rvw.low_rating.mean() * 100),
        "score_dist": rvw.review_score.value_counts().sort_index().astype(int).to_dict(),
        "gmv_2024": float(y24.gmv.sum()), "gmv_2025": float(y25.gmv.sum()), "real_gmv_2024": float(y24.real_gmv.sum()), "real_gmv_2025": float(y25.real_gmv.sum()),
        "orders_2024": int((d.year == 2024).sum()), "orders_2025": int((d.year == 2025).sum()), "aov_2024": float(y24.gmv.mean()), "aov_2025": float(y25.gmv.mean()),
        "price_index_first": float(pidx.iloc[0]), "price_index_last": float(pidx.iloc[-1]),
        "trend_orders_slope": float(lr.slope), "trend_orders_p": float(lr.pvalue),
        "category_gmv": cat.gmv.to_dict(), "category_orders": cat.orders.astype(int).to_dict(), "category_units": cat.units.astype(int).to_dict(),
        "category_aov": cat.aov.to_dict(), "category_cancel_rate": (cat.cancel_rate * 100).to_dict(), "category_avg_score": cat.avg_score.to_dict(), "category_low_rate": (cat.low_rate * 100).to_dict(),
        "category_low_rate_on_time": (cat.low_rate_on_time * 100).to_dict(), "category_late_rate": (cat.late_rate * 100).to_dict(),
        "zone_orders": zone.orders.astype(int).to_dict(), "zone_spend_per_customer": zone.spend_per_customer.to_dict(), "zone_avg_delivery_days": zone.avg_delivery_days.to_dict(),
        "state_avg_delivery_days": stt.avg_delivery_days.to_dict(), "state_late_rate": (stt.late_rate * 100).to_dict(), "state_orders": stt.orders.astype(int).to_dict(),
        "month_orders": month.orders.astype(int).to_dict(), "month_gmv": month.gmv.to_dict(), "price_index": pidx.to_dict(),
        "weekday_orders": d.weekday.value_counts().reindex(DAYS).astype(int).to_dict(),
        "late_vs_low": {"chi2": float(chi2), "p": float(p), "low_late": float(a / b * 100), "low_on_time": float(c_ / e * 100), "rr": float(rr), "rr_lo": float(np.exp(np.log(rr) - 1.959963984540054 * se_)), "rr_hi": float(np.exp(np.log(rr) + 1.959963984540054 * se_)), "n": int(len(x))},
        "spearman_days_late_score": {"rho": float(sp.statistic), "p": float(sp.pvalue)}, "score_by_lateness": {k: {"n": int(v.n), "avg": float(v.avg_score), "low": float(v.low_rate * 100)} for k, v in by_bucket.iterrows()},
        "kw_score_by_category": kw_cat, "chi2_cancel_by_category": {"chi2": float(chi_c), "p": float(p_c), "df": int(df_c)},
        "chi2_low_by_category": {"chi2": float(chi_l), "p": float(p_l), "df": int(df_l)}, "chi2_low_by_category_on_time": {"chi2": float(chi_l2), "p": float(p_l2), "df": int(df_l2)},
        "kw_delivery_days_by_state": kw_state, "fulfilment": {k: {"late": float(v.late * 100), "days": float(v.days), "n": int(v.n)} for k, v in fm.iterrows()}, "chi2_late_by_fulfilment_p": float(p_f),
        "sellers_ranked_late": int((sel.delivered_n >= MIN_SELLER_ORDERS).sum()), "sellers_flag_late": sorted(sel.index[sel.flag_late == 1].tolist()),
        "sellers_flag_low": sorted(sel.index[sel.flag_low == 1].tolist()), "themes_low": rvw[rvw.low_rating == 1].theme.value_counts().astype(int).to_dict(),
        "logit_low_rating": logit, "logit_n": int(fit.nobs), "logit_pseudo_r2": float(fit.prsquared),
    }
    (OUT / "reference_values.json").write_text(json.dumps(ref, indent=1, default=lambda v: v.item() if hasattr(v, "item") else str(v)))
    show = {k: v for k, v in ref.items() if not isinstance(v, dict) or k in ("late_vs_low", "spearman_days_late_score", "score_by_lateness", "kw_score_by_category", "chi2_cancel_by_category",
            "chi2_low_by_category", "chi2_low_by_category_on_time", "fulfilment", "themes_low", "kw_delivery_days_by_state")}
    print(json.dumps(show, indent=1, default=str))
    print(cat[["gmv", "gmv_share", "orders", "units", "aov", "cancel_rate", "avg_score", "low_rate", "low_rate_on_time", "late_rate", "return_rate"]].round(3).to_string())
    print(zone.round(2).to_string()); print(stt.head(12).round(2).to_string())
    print(coh.round(3).to_string())
    print({k: (round(v["or"], 2), round(v["p"], 4)) for k, v in logit.items()})


if __name__ == "__main__":
    main()

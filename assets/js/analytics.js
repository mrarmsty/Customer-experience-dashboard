/* analytics.js - every number the dashboard shows is calculated here from the orders currently in view.
   Insights and recommendations come from fixed, documented rules applied to those numbers; none are pre-written. */
(function () {
  'use strict';
  const U = window.MvUtils;
  const { RULES } = window.MvConfig;
  const { isNum, mean, median } = U;
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const sum = (arr, f) => { let s = 0; for (const r of arr) { const v = f(r); if (isNum(v)) s += v; } return s; };
  const groupBy = (rows, key) => { const m = new Map(); rows.forEach((r) => { const k = typeof key === 'function' ? key(r) : r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
  const sig = (t) => t && isNum(t.p) && t.p < RULES.alpha;

  // ---------------------------------------------------------------- filters
  const inSet = (sel, v) => !sel.length || sel.includes(v);
  function applyFilters(all, f) {
    return all.filter((r) => r.month >= f.monthFrom && r.month <= f.monthTo && inSet(f.categories, r.category_name) && inSet(f.zones, r.zone)
      && inSet(f.tiers, r.seller_tier) && inSet(f.fulfilment, r.fulfilment_model) && inSet(f.payments, r.payment_method));
  }
  // Monthly price index for the whole marketplace: selling value / value at 2024 list prices (orders not cancelled).
  // Used to express GMV at constant January 2024 prices. Computed on all data so filters do not change the deflator.
  function priceIndex(all) {
    const g = new Map();
    all.forEach((r) => { if (r.cancelled || !isNum(r.list_value)) return; const x = g.get(r.month) || [0, 0]; x[0] += r.gross_value; x[1] += r.list_value; g.set(r.month, x); });
    return new Map([...g.entries()].map(([m, [a, b]]) => [m, b ? a / b : null]));
  }

  // ---------------------------------------------------------------- core statistics for a set of orders
  function stats(rows, pidx) {
    const nc = rows.filter((r) => !r.cancelled), dl = rows.filter((r) => isNum(r.delivery_days)), lt = dl.filter((r) => isNum(r.late)), rv = rows.filter((r) => r.reviewed);
    const gmv = sum(nc, (r) => r.gmv), closed = rows.filter((r) => !r.open);
    const delivered = sum(rows, (r) => r.delivered), failed = sum(rows, (r) => r.failed);
    return {
      orders: rows.length, nc_orders: nc.length, gmv, real_gmv: pidx ? sum(nc, (r) => (pidx.get(r.month) ? r.gmv / pidx.get(r.month) : null)) : null,
      aov: nc.length ? gmv / nc.length : null, units: sum(nc, (r) => r.units), cancel_rate: pct(sum(rows, (r) => r.cancelled), rows.length),
      return_rate: pct(sum(rows, (r) => r.returned), delivered), delivered_of_closed: pct(sum(closed, (r) => r.delivered), closed.length), delivery_success: pct(delivered, delivered + failed),
      net_delivered_gmv: sum(rows.filter((r) => r.order_status === 'delivered'), (r) => r.items_subtotal_ngn),
      delivered_n: dl.length, avg_days: mean(dl.map((r) => r.delivery_days)), late_n: sum(lt, (r) => r.late), late_rate: pct(sum(lt, (r) => r.late), lt.length),
      reviews: rv.length, review_rate: pct(rv.length, rows.length), avg_score: mean(rv.map((r) => r.review_score)), low_n: sum(rv, (r) => r.low_rating), low_rate: pct(sum(rv, (r) => r.low_rating), rv.length),
      customers: new Set(nc.map((r) => r.customer_id)).size,
    };
  }

  // ---------------------------------------------------------------- summaries
  function monthStats(rows, months, pidx) {
    const g = groupBy(rows, 'month');
    return months.map((m) => ({ month: m, ...stats(g.get(m) || [], pidx), price_index: pidx.get(m) ?? null }));
  }
  function categoryStats(rows, pidx) {
    const g = groupBy(rows, 'category_name'); const totalGmv = sum(rows, (r) => r.gmv);
    return [...g.entries()].map(([name, rs]) => { const s = stats(rs, pidx); const ot = rs.filter((r) => r.reviewed && r.late === 0);
      return { category: name, group: rs[0].category_group, ...s, gmv_share: pct(s.gmv, totalGmv), low_rate_on_time: pct(sum(ot, (r) => r.low_rating), ot.length), on_time_reviews: ot.length }; })
      .sort((a, b) => b.gmv - a.gmv);
  }
  function geoStats(rows, key, pidx) {
    const g = groupBy(rows, key);
    return [...g.entries()].map(([name, rs]) => { const s = stats(rs, pidx); return { name, zone: rs[0].zone, ...s, spend_per_customer: s.customers ? s.gmv / s.customers : null }; })
      .sort((a, b) => b.orders - a.orders);
  }
  function sellerStats(rows, overall) {
    const g = groupBy(rows, 'seller_id');
    return [...g.entries()].map(([id, rs]) => {
      const s = stats(rs, null); const cats = groupBy(rs, 'category_name'); const mainCat = [...cats.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
      const ltN = rs.filter((r) => isNum(r.late)).length;
      const [lateLo, lateHi] = U.wilson(s.late_n, ltN); const [lowLo, lowHi] = U.wilson(s.low_n, s.reviews);
      return { seller_id: id, seller_name: rs[0].seller_name, tier: rs[0].seller_tier, fulfilment: rs[0].fulfilment_model, category: mainCat, ...s,
        seller_cancelled: rs.filter((r) => r.cancelled_by === 'seller').length, avg_days_late: mean(rs.filter((r) => isNum(r.days_late)).map((r) => r.days_late)),
        late_lo: lateLo, late_hi: lateHi, late_eval_n: ltN, low_lo: lowLo, low_hi: lowHi,
        flag_late: ltN >= RULES.minSellerN && lateLo > overall.late_rate / 100 ? 1 : 0,
        flag_low: s.reviews >= RULES.minSellerN && lowLo > overall.low_rate / 100 ? 1 : 0 };
    }).sort((a, b) => b.gmv - a.gmv);
  }
  function factorStats(rows) {
    const dl = rows.filter((r) => isNum(r.late));
    return [
      ['Fulfilment', 'Marketplace Fulfilled', 'Seller Fulfilled', (r) => r.fulfilment_model === 'Marketplace Fulfilled', (r) => r.fulfilment_model === 'Seller Fulfilled'],
      ['Item size', 'Bulky items', 'Standard items', (r) => r.is_bulky === 1, (r) => r.is_bulky !== 1],
      ['Route', 'Same state', 'Between states', (r) => r.intra_state === 1, (r) => r.intra_state !== 1],
      ['Season', 'Peak logistics (20 Nov - 24 Dec)', 'Rest of year', (r) => r.peak_logistics === 1, (r) => r.peak_logistics !== 1],
    ].map(([factor, la, lb, pa, pb]) => {
      const a = dl.filter(pa), b = dl.filter(pb);
      const t = U.chiSquare([[sum(a, (r) => r.late), a.length - sum(a, (r) => r.late)], [sum(b, (r) => r.late), b.length - sum(b, (r) => r.late)]]);
      return { factor, a: { label: la, n: a.length, late_rate: pct(sum(a, (r) => r.late), a.length), avg_days: mean(a.map((r) => r.delivery_days)) },
        b: { label: lb, n: b.length, late_rate: pct(sum(b, (r) => r.late), b.length), avg_days: mean(b.map((r) => r.delivery_days)) }, p: t.p };
    });
  }
  function customerStats(rows, all, customers) {
    const nc = rows.filter((r) => !r.cancelled);
    const carts = new Map(); nc.forEach((r) => { if (!carts.has(r.customer_id)) carts.set(r.customer_id, new Set()); carts.get(r.customer_id).add(r.cart_id); });
    const counts = [...carts.values()].map((s) => s.size);
    const dist = [1, 2, 3, 4, 5].map((k) => ({ label: k === 5 ? '5+' : String(k), n: counts.filter((c) => (k === 5 ? c >= 5 : c === k)).length }));
    // first-ever purchase month (all data) -> new vs returning customers each month
    const firstAll = new Map(); all.forEach((r) => { if (r.cancelled) return; const f = firstAll.get(r.customer_id); if (!f || r.order_purchase_ts < f) firstAll.set(r.customer_id, r.order_purchase_ts); });
    const byMonth = groupBy(nc, 'month');
    const newRet = [...byMonth.keys()].sort().map((m) => { const cs = new Set(byMonth.get(m).map((r) => r.customer_id)); let nw = 0; cs.forEach((c) => { if ((firstAll.get(c) || '').slice(0, 7) === m) nw++; }); return { month: m, new: nw, returning: cs.size - nw }; });
    // cohorts: quarter of first purchase within the view; share buying again k quarters later
    const first = new Map(); nc.forEach((r) => { const f = first.get(r.customer_id); if (!f || r.order_purchase_ts < f) first.set(r.customer_id, r.order_purchase_ts); });
    const qi = (q) => +q.slice(0, 4) * 4 + +q.slice(-1) - 1; const qOf = (t) => `${t.slice(0, 4)}-Q${Math.ceil(+t.slice(5, 7) / 3)}`;
    const coh = new Map();
    nc.forEach((r) => { const cq = qOf(first.get(r.customer_id)); const k = qi(r.quarter) - qi(cq); if (!coh.has(cq)) coh.set(cq, new Map()); const m = coh.get(cq); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(r.customer_id); });
    const cohorts = [...coh.keys()].sort().map((q) => { const m = coh.get(q); const size = m.get(0).size; const maxK = Math.max(...m.keys());
      return { cohort: q, size, rates: Array.from({ length: maxK + 1 }, (_, k) => (m.has(k) ? m.get(k).size / size * 100 : 0)) }; });
    const lastQ = Math.max(...[...coh.keys()].map(qi));
    cohorts.forEach((c) => { c.observed = lastQ - qi(c.cohort); });
    // repeat rate by acquisition channel and by zone
    const cust = new Map(customers.map((c) => [c.customer_id, c]));
    const byChannel = groupBy([...carts.entries()], ([id]) => (cust.get(id) ? cust.get(id).acquisition_channel : 'Not in customer list'));
    const channels = [...byChannel.entries()].map(([ch, list]) => ({ group: ch, customers: list.length, repeat_rate: pct(list.filter(([, s]) => s.size >= 2).length, list.length), small: list.length < RULES.minCategoryN })).sort((a, b) => b.customers - a.customers);
    const pay = [...groupBy(rows, 'payment_method').entries()].map(([m, rs]) => ({ group: m, orders: rs.length, share: pct(rs.length, rows.length), aov: mean(rs.filter((r) => !r.cancelled).map((r) => r.gmv)), cancel_rate: pct(sum(rs, (r) => r.cancelled), rs.length) })).sort((a, b) => b.orders - a.orders);
    const heat = DAYS.map(() => new Array(24).fill(0)); rows.forEach((r) => { heat[r.weekday_num - 1][r.hour]++; });
    return { purchasing: carts.size, ordering: new Set(rows.map((r) => r.customer_id)).size, repeat_rate: pct(counts.filter((c) => c >= 2).length, counts.length),
      checkouts_per_customer: counts.length ? sum(counts, (c) => c) / counts.length : null, dist, newRet, cohorts, channels, pay, heat,
      spend_per_customer: carts.size ? sum(nc, (r) => r.gmv) / carts.size : null };
  }
  function deliveryHist(rows) {
    const d = rows.filter((r) => isNum(r.delivery_days)); const bins = [];
    const top = Math.min(21, Math.max(10, Math.ceil(Math.max(0, ...d.map((r) => r.delivery_days)))));
    for (let i = 0; i < top; i++) bins.push({ label: `${i}-${i + 1}`, lo: i, count: 0, late: 0 });
    bins.push({ label: `${top}+`, lo: top, count: 0, late: 0 });
    d.forEach((r) => { const i = Math.max(0, Math.min(top, Math.floor(r.delivery_days))); bins[i].count++; if (r.late) bins[i].late++; });
    while (bins.length && bins[bins.length - 1].count === 0) bins.pop();
    return bins;
  }
  function lateness(rows) {
    const x = rows.filter((r) => r.reviewed && isNum(r.late));
    const b = [['On time', (r) => r.days_late === 0], ['1 day late', (r) => r.days_late === 1], ['2 days late', (r) => r.days_late === 2], ['3+ days late', (r) => r.days_late >= 3]];
    return b.map(([label, f]) => { const rs = x.filter(f); return { group: label, n: rs.length, avg_score: mean(rs.map((r) => r.review_score)), low_rate: pct(sum(rs, (r) => r.low_rating), rs.length) }; });
  }
  function themes(rows) {
    const low = rows.filter((r) => r.low_rating === 1); const g = groupBy(low, 'theme');
    return [...g.entries()].map(([t, rs]) => ({ group: t, n: rs.length, share: pct(rs.length, low.length) })).sort((a, b) => b.n - a.n);
  }

  // ---------------------------------------------------------------- statistical tests
  function tests(rows, months) {
    const x = rows.filter((r) => r.reviewed && isNum(r.late));
    const lateLow = sum(x, (r) => r.late && r.low_rating), lateN = sum(x, (r) => r.late), otLow = sum(x, (r) => !r.late && r.low_rating), otN = x.length - lateN;
    const chiLate = U.chiSquare([[lateLow, lateN - lateLow], [otLow, otN - otLow]]);
    const rr = U.relRisk(lateLow, lateN, otLow, otN);
    const ct = (rs, key, ev) => { const g = groupBy(rs, key); return U.chiSquare([...g.values()].map((a) => { const k = sum(a, ev); return [k, a.length - k]; })); };
    const rv = rows.filter((r) => r.reviewed); const dl = rows.filter((r) => isNum(r.delivery_days)); const lt = rows.filter((r) => isNum(r.late));
    const mo = months.filter((m) => m.orders > 0);
    const tr = mo.length >= 4 ? U.pearson(mo.map((_, i) => i), mo.map((m) => m.orders)) : { r: null, p: null };
    return {
      lateLow: { ...chiLate, low_late: pct(lateLow, lateN), low_on_time: pct(otLow, otN), rr: rr.rr, rr_lo: rr.lo, rr_hi: rr.hi, n: x.length },
      spearmanLate: { ...U.spearman(x.map((r) => r.days_late), x.map((r) => r.review_score)) },
      kwScoreCategory: U.kruskal([...groupBy(rv, 'category_name').values()].map((a) => a.map((r) => r.review_score))),
      cancelCategory: ct(rows, 'category_name', (r) => r.cancelled),
      lowCategory: ct(rv, 'category_name', (r) => r.low_rating), lowCategoryOnTime: ct(x.filter((r) => !r.late), 'category_name', (r) => r.low_rating),
      kwDaysState: U.kruskal([...groupBy(dl, 'ship_to_state').values()].map((a) => a.map((r) => r.delivery_days))),
      lateFulfilment: ct(lt.filter((r) => r.fulfilment_model !== 'Unknown'), 'fulfilment_model', (r) => r.late),
      trend: { slope: mo.length >= 2 ? U.slope(mo.map((_, i) => i), mo.map((m) => m.orders)) : null, p: tr.p },
    };
  }

  // ---------------------------------------------------------------- KPIs with period comparisons
  function kpis(rows, months, pidx) {
    const s = stats(rows, pidx);
    const md = months.filter((m) => m.orders > 0); const last = md[md.length - 1] || null; const prev = last ? months[months.indexOf(last) - 1] || null : null;
    const ch = (a, b) => (isNum(a) && isNum(b) && b ? (a / b - 1) * 100 : null), df = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
    // year on year: same months of the year in the last two calendar years in view
    const years = [...new Set(md.map((m) => m.month.slice(0, 4)))].sort(); let yoy = null;
    if (years.length >= 2) {
      const [y1, y2] = years.slice(-2); const moy = (y) => new Set(md.filter((m) => m.month.startsWith(y)).map((m) => m.month.slice(5)));
      const a = moy(y1), b = moy(y2); const common = [...a].filter((m) => b.has(m)).sort();
      if (common.length) {
        const pick = (y) => stats(rows.filter((r) => r.year === +y && common.includes(r.month.slice(5))), pidx);
        const s1 = pick(y1), s2 = pick(y2);
        yoy = { y1, y2, months: common.length, first: common[0], lastM: common[common.length - 1], gmv: ch(s2.gmv, s1.gmv), real_gmv: ch(s2.real_gmv, s1.real_gmv), orders: ch(s2.orders, s1.orders),
          aov: ch(s2.aov, s1.aov), customers: ch(s2.customers, s1.customers), late: df(s2.late_rate, s1.late_rate), s1, s2 };
      }
    }
    return { ...s, last, prev, yoy, d_gmv: last && prev ? ch(last.gmv, prev.gmv) : null, d_orders: last && prev ? ch(last.orders, prev.orders) : null,
      d_aov: last && prev ? ch(last.aov, prev.aov) : null, d_cancel: last && prev ? df(last.cancel_rate, prev.cancel_rate) : null, d_late: last && prev ? df(last.late_rate, prev.late_rate) : null,
      d_score: last && prev ? df(last.avg_score, prev.avg_score) : null, d_low: last && prev ? df(last.low_rate, prev.low_rate) : null,
      median_days: median(rows.filter((r) => isNum(r.delivery_days)).map((r) => r.delivery_days)),
      avg_days_late: mean(rows.filter((r) => r.late === 1).map((r) => r.days_late)) };
  }

  // ---------------------------------------------------------------- areas needing attention
  function attention(k, c) {
    const S = RULES.status;
    const lvl = (v, t, lowerIsWorse) => (!isNum(v) ? 'na' : lowerIsWorse ? (v < t.crit ? 'crit' : v < t.warn ? 'warn' : 'ok') : (v > t.crit ? 'crit' : v > t.warn ? 'warn' : 'ok'));
    const worstCat = c.cats.filter((x) => x.reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate - a.low_rate)[0];
    return [
      { area: 'Delivery punctuality', measure: 'Deliveries after the promised date', value: U.fmtPct(k.late_rate), level: lvl(k.late_rate, S.lateRate, false), rule: `over ${S.lateRate.crit}% critical, over ${S.lateRate.warn}% warning` },
      { area: 'Customer satisfaction', measure: 'Reviews with 1-2 stars', value: U.fmtPct(k.low_rate), level: lvl(k.low_rate, S.lowRate, false), rule: `over ${S.lowRate.crit}% critical, over ${S.lowRate.warn}% warning` },
      { area: 'Worst category experience', measure: worstCat ? `${worstCat.category}: 1-2 star reviews` : 'n/a', value: worstCat ? U.fmtPct(worstCat.low_rate) : 'n/a', level: worstCat ? lvl(worstCat.low_rate, S.lowRate, false) : 'na', rule: 'same thresholds as customer satisfaction' },
      { area: 'Order cancellations', measure: 'Orders cancelled', value: U.fmtPct(k.cancel_rate), level: lvl(k.cancel_rate, S.cancelRate, false), rule: `over ${S.cancelRate.crit}% critical, over ${S.cancelRate.warn}% warning` },
      { area: 'Customer loyalty', measure: 'Purchasing customers who bought again', value: U.fmtPct(c.cust.repeat_rate), level: lvl(c.cust.repeat_rate, S.repeatRate, true), rule: `under ${S.repeatRate.crit}% critical, under ${S.repeatRate.warn}% warning` },
      { area: 'Delivery reliability', measure: 'Shipped orders delivered (not failed)', value: U.fmtPct(k.delivery_success), level: lvl(k.delivery_success, S.deliverySuccess, true), rule: `under ${S.deliverySuccess.crit}% critical, under ${S.deliverySuccess.warn}% warning` },
      { area: 'Seller performance', measure: 'Sellers flagged for late delivery or low ratings', value: `${c.sellers.filter((s) => s.flag_late || s.flag_low).length} of ${c.sellers.filter((s) => s.late_eval_n >= RULES.minSellerN).length} ranked`, level: c.sellers.some((s) => s.flag_late || s.flag_low) ? 'warn' : 'ok', rule: 'any flagged seller = warning' },
    ];
  }

  // ---------------------------------------------------------------- rule-based insights
  function insights(c) {
    const { k, t, cats, zones, sellers, cust } = c; const out = []; if (!k.orders) return out;
    const add = (type, text, rule) => out.push({ type, text, rule });
    const top = cats.slice(0, 2); const top2 = sum(top, (x) => x.gmv_share);
    add('Category sales', `${top.map((x) => x.category).join(' and ')} generate ${U.fmtPct(top2)} of GMV (${U.fmtNgn(sum(top, (x) => x.gmv))} of ${U.fmtNgn(k.gmv)}). ${cats.slice().sort((a, b) => b.orders - a.orders)[0].category} has the most orders (${U.fmtNum(cats.slice().sort((a, b) => b.orders - a.orders)[0].orders)}).`,
      'Categories ranked by GMV (orders not cancelled) and by orders placed.');
    if (k.yoy) add('Growth', `${k.yoy.y2} vs ${k.yoy.y1} (same ${k.yoy.months} months): GMV ${U.fmtSignedPct(k.yoy.gmv)} in naira but ${U.fmtSignedPct(k.yoy.real_gmv)} at constant prices; orders ${U.fmtSignedPct(k.yoy.orders)}; average order value ${U.fmtSignedPct(k.yoy.aov)}.${isNum(k.yoy.gmv) && isNum(k.yoy.real_gmv) && k.yoy.gmv - k.yoy.real_gmv > 10 ? ' Much of the naira growth is price inflation.' : ''}`,
      'Year on year on months present in both years; constant prices use the monthly selling-price index against January 2024 list prices.');
    const hiCancel = cats.filter((x) => x.orders >= RULES.minCategoryN).sort((a, b) => b.cancel_rate - a.cancel_rate)[0];
    if (hiCancel) add('Cancellations', `${U.fmtPct(k.cancel_rate)} of orders were cancelled. ${hiCancel.category} has the highest cancellation rate (${U.fmtPct(hiCancel.cancel_rate)}); rates ${sig(t.cancelCategory) ? 'differ significantly' : 'do not differ significantly'} between categories (chi-square ${U.pText(t.cancelCategory.p)}).`,
      'Cancelled orders / orders placed by category; chi-square test of independence.');
    add('Customers', `${U.fmtNum(cust.purchasing)} customers bought in the period; ${U.fmtPct(cust.repeat_rate)} made more than one separate purchase (checkout).${cust.cohorts.length > 2 ? ` On average ${U.fmtPct(mean(cust.cohorts.filter((x) => x.observed >= 1).map((x) => x.rates[1])))} of each quarter's new customers bought again the next quarter.` : ''}`,
      'Repeat = 2 or more distinct cart_id among orders not cancelled; cohorts by quarter of first purchase in view.');
    const zs = zones.filter((z) => z.nc_orders >= RULES.minCategoryN).sort((a, b) => b.spend_per_customer - a.spend_per_customer);
    if (zs.length > 1) add('Geography', `${zones[0].name} places the most orders (${U.fmtPct(pct(zones[0].orders, k.orders))}). Spend per customer ranges from ${U.fmtNgn(zs[zs.length - 1].spend_per_customer)} (${zs[zs.length - 1].name}) to ${U.fmtNgn(zs[0].spend_per_customer)} (${zs[0].name}).`,
      'Orders and GMV per purchasing customer by geopolitical zone of the delivery address.');
    add('Delivery', `${U.fmtPct(k.delivered_of_closed)} of closed orders were delivered (delivery success ${U.fmtPct(k.delivery_success)} of shipped orders). Average delivery time ${U.fmtDays(k.avg_days)}; ${U.fmtPct(k.late_rate)} arrived after the promised date (by ${U.fmtDays(k.avg_days_late, 1)} on average when late).`,
      'Closed = not still shipped or processing; late = delivery date after the estimated delivery date.');
    const zl = zones.filter((z) => z.delivered_n >= RULES.minStateN).sort((a, b) => b.avg_days - a.avg_days);
    if (zl.length > 1) add('Slowest regions', `${zl[0].name} has the longest deliveries (${U.fmtDays(zl[0].avg_days)}, ${U.fmtPct(zl[0].late_rate)} late) and ${zl[zl.length - 1].name} the shortest (${U.fmtDays(zl[zl.length - 1].avg_days)}). Delivery times differ significantly by state (Kruskal-Wallis ${U.pText(t.kwDaysState.p)}).`,
      `Zones with at least ${RULES.minStateN} delivered orders; Kruskal-Wallis test of delivery days across states.`);
    const fz = c.factors.find((f) => f.factor === 'Fulfilment');
    if (fz && fz.a.n && fz.b.n) add('Fulfilment model', `Marketplace-fulfilled orders arrive late ${U.fmtPct(fz.a.late_rate)} of the time vs ${U.fmtPct(fz.b.late_rate)} for seller-fulfilled (${U.pText(fz.p)}), and ${U.fmtDays(fz.b.avg_days - fz.a.avg_days)} faster on average.`,
      'Late rate and delivery days by the seller\'s fulfilment model; chi-square test.');
    const ll = t.lateLow;
    if (isNum(ll.rr)) add('Late delivery and reviews', `Late orders receive a 1-2 star review ${U.fmtPct(ll.low_late)} of the time vs ${U.fmtPct(ll.low_on_time)} when on time: ${ll.rr.toFixed(1)} times as likely (95% CI ${ll.rr_lo.toFixed(1)}-${ll.rr_hi.toFixed(1)}, ${U.pText(ll.p)}). The longer the delay, the lower the score (Spearman rho = ${t.spearmanLate.r.toFixed(2)}).`,
      'Reviewed orders with a delivery timestamp; relative risk with 95% CI, chi-square test, Spearman correlation of days late and score.');
    const cr = cats.filter((x) => x.reviews >= RULES.minCategoryN && isNum(x.low_rate_on_time)).sort((a, b) => b.low_rate - a.low_rate);
    if (cr.length) {
      const w = cr[0]; const intrinsic = cr.filter((x) => x.on_time_reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate_on_time - a.low_rate_on_time)[0];
      const delivDriven = cr.filter((x) => x.on_time_reviews >= RULES.minCategoryN && x.low_rate - x.low_rate_on_time >= 0.4 * x.low_rate && x.low_rate >= k.low_rate).map((x) => x.category);
      add('Poor experiences by category', `${w.category} has the highest share of 1-2 star reviews (${U.fmtPct(w.low_rate)}).${intrinsic ? ` Even when delivered on time, ${intrinsic.category} keeps the highest rate (${U.fmtPct(intrinsic.low_rate_on_time)}), pointing to the products themselves.` : ''}${delivDriven.length ? ` For ${delivDriven.join(', ')} the rate falls by 40% or more when delivery is on time, so late delivery drives much of the dissatisfaction.` : ''}`,
        'Low-rating share by category, overall and among on-time deliveries only; categories with 30+ reviews.');
    }
    const th = c.themes.filter((x) => x.group !== 'No comment');
    if (th.length) add('Complaint themes', `Among commented 1-2 star reviews the most common themes are ${th.slice(0, 3).map((x) => `${x.group.toLowerCase()} (${x.n})`).join(', ')}.`, 'Keyword rules on review comments (Methodology tab).');
    const fl = sellers.filter((s) => s.flag_late), fw = sellers.filter((s) => s.flag_low);
    add('Sellers', `${fl.length} sellers have late-delivery rates significantly above the marketplace and ${fw.length} have significantly more 1-2 star reviews (${sellers.filter((s) => s.flag_late && s.flag_low).length} on both lists).`,
      `Sellers with ${RULES.minSellerN}+ delivered (or reviewed) orders whose 95% Wilson lower bound is above the marketplace rate.`);
    return out;
  }

  // ---------------------------------------------------------------- rule-based recommendations (each with its evidence)
  function recommendations(c) {
    const { k, t, cats, zones, sellers, cust, factors } = c; const out = []; if (!k.orders) return out;
    const add = (horizon, area, text, evidence) => out.push({ horizon, area, text, evidence });
    const fl = sellers.filter((s) => s.flag_late);
    if (isNum(t.lateLow.rr) && sig(t.lateLow) && t.lateLow.rr > 1.5) add('Immediate', 'Delivery', 'Treat on-time delivery as the main lever for review scores: alert customers proactively when an order will miss its promised date, and review promised dates on slow routes.',
      `Late orders are ${t.lateLow.rr.toFixed(1)}x as likely to get 1-2 stars (${U.fmtPct(t.lateLow.low_late)} vs ${U.fmtPct(t.lateLow.low_on_time)}).`);
    if (fl.length) add('Immediate', 'Sellers', `Put the ${fl.length} sellers flagged for late delivery on a performance plan (dispatch deadlines, carrier choice), and escalate those also flagged for low ratings.`,
      `Flagged sellers: ${fl.slice(0, 6).map((s) => s.seller_name).join(', ')}${fl.length > 6 ? '...' : ''}; marketplace late rate ${U.fmtPct(k.late_rate)}.`);
    const peak = factors.find((f) => f.factor === 'Season');
    if (peak && isNum(peak.a.late_rate) && peak.a.late_rate > 1.3 * peak.b.late_rate) add('Short term', 'Delivery', 'Add carrier capacity and lengthen promised dates for the 20 November - 24 December peak, when late deliveries rise sharply.',
      `Late rate ${U.fmtPct(peak.a.late_rate)} in the peak vs ${U.fmtPct(peak.b.late_rate)} the rest of the year.`);
    const fz = factors.find((f) => f.factor === 'Fulfilment');
    if (fz && isNum(fz.a.late_rate) && isNum(fz.b.late_rate) && fz.b.late_rate > fz.a.late_rate && fz.p < RULES.alpha) add('Short term', 'Sellers', 'Encourage high-volume seller-fulfilled sellers to move to Marketplace Fulfilled, starting with those flagged for delays.',
      `Late rate ${U.fmtPct(fz.b.late_rate)} seller-fulfilled vs ${U.fmtPct(fz.a.late_rate)} marketplace-fulfilled; ${U.fmtDays(fz.b.avg_days - fz.a.avg_days)} slower.`);
    const zl = zones.filter((z) => z.delivered_n >= RULES.minStateN).sort((a, b) => b.avg_days - a.avg_days);
    if (zl.length > 1 && zl[0].avg_days > 1.3 * k.avg_days) add('Longer term', 'Delivery', `Improve logistics coverage for ${zl[0].name} (regional carrier partner or pick-up points), or set more realistic promised dates there.`,
      `${zl[0].name}: ${U.fmtDays(zl[0].avg_days)} average delivery and ${U.fmtPct(zl[0].late_rate)} late vs ${U.fmtDays(k.avg_days)} overall.`);
    const cr = cats.filter((x) => x.on_time_reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate_on_time - a.low_rate_on_time);
    if (cr.length && cr[0].low_rate_on_time > 1.5 * t.lateLow.low_on_time) add('Short term', 'Assortment', `Review listings and sellers in ${cr[0].category}: tighten product descriptions, size guides and photos, and audit sellers with repeated "not as described" complaints.`,
      `${cr[0].category}: ${U.fmtPct(cr[0].low_rate_on_time)} of on-time orders still get 1-2 stars vs ${U.fmtPct(t.lateLow.low_on_time)} across the marketplace; return rate ${U.fmtPct(cr[0].return_rate)}.`);
    const top = cats.slice(0, 2);
    if (top.length === 2) add('Longer term', 'Assortment', `Protect and grow ${top[0].category} and ${top[1].category}, which carry most of the GMV: secure stock with Official Stores and keep their cancellation rates down.`,
      `${U.fmtPct(top[0].gmv_share + top[1].gmv_share)} of GMV; cancellation rates ${U.fmtPct(top[0].cancel_rate)} and ${U.fmtPct(top[1].cancel_rate)}.`);
    if (isNum(cust.repeat_rate) && cust.repeat_rate < RULES.status.repeatRate.warn) add('Short term', 'Customers', 'Launch a second-purchase programme (post-delivery voucher, reminders for consumables) to lift the repeat rate.',
      `${U.fmtPct(cust.repeat_rate)} of purchasing customers bought again in the period.`);
    if (isNum(k.cancel_rate) && k.cancel_rate > RULES.status.cancelRate.warn) add('Short term', 'Sellers', 'Reduce seller-side cancellations (out-of-stock, price errors) with stock syncing and penalties for repeated cancellations.',
      `${U.fmtPct(k.cancel_rate)} of orders cancelled.`);
    const order = { Immediate: 0, 'Short term': 1, 'Longer term': 2 };
    return out.sort((a, b) => order[a.horizon] - order[b.horizon]);
  }

  // ---------------------------------------------------------------- one call that builds the full analysis context
  function analyse(rows, all, filters, pidx, customers) {
    const months = [...new Set(all.map((r) => r.month))].sort().filter((m) => m >= filters.monthFrom && m <= filters.monthTo);
    const mstats = monthStats(rows, months, pidx);
    const k = kpis(rows, mstats, pidx);
    const c = { rows, months: mstats, k };
    if (!rows.length) return { ...c, cats: [], zones: [], states: [], sellers: [], factors: [], cust: null, t: null, insights: [], recs: [], attention: [] };
    c.cats = categoryStats(rows, pidx); c.zones = geoStats(rows, 'zone', pidx); c.states = geoStats(rows, 'ship_to_state', pidx);
    c.sellers = sellerStats(rows, k); c.factors = factorStats(rows); c.cust = customerStats(rows, all, customers);
    c.hist = deliveryHist(rows); c.lateness = lateness(rows); c.themes = themes(rows);
    c.scoreDist = [1, 2, 3, 4, 5].map((s) => { const n = rows.filter((r) => r.review_score === s).length; return { score: s, n, pct: pct(n, k.reviews) }; });
    c.t = tests(rows, mstats);
    c.insights = insights(c); c.recs = recommendations(c); c.attention = attention(k, c);
    return c;
  }

  window.MvAnalytics = { applyFilters, priceIndex, stats, monthStats, categoryStats, geoStats, sellerStats, factorStats, customerStats, deliveryHist, lateness, themes, tests, kpis, attention, insights, recommendations, analyse, sig, DAYS };
})();

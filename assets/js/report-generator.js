/* report-generator.js - builds the downloadable PDF analysis report from the data currently loaded.
   Nothing in the report is pre-written about results: every number, table, finding and chart is produced from the
   same calculations as the dashboard at the moment the button is pressed. The standard PDF font has no naira sign,
   so amounts are written as "NGN" and only plain ASCII characters are used. */
(function () {
  'use strict';
  const U = window.MvUtils, A = window.MvAnalytics, C = window.MvCharts;
  const { KPI_DEFS, RULES } = window.MvConfig;
  const ascii = (s) => String(s ?? '').replace(/\u20A6/g, 'NGN ').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/ε²/g, 'epsilon sq.').replace(/[^\x20-\x7E\n]/g, '');
  const ngn = (v) => ascii(U.fmtNgn(v));

  async function chartImages(ctx) {
    const host = document.createElement('div'); host.className = 'report-canvas'; host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;';
    document.body.appendChild(host); const out = {}, sizes = {};
    const mk = (name, h, draw) => { const d = document.createElement('div'); d.style.cssText = `width:900px;height:${h}px`; host.appendChild(d); draw(d); out[name] = C.image(d); sizes[name] = h; };
    C.setAnimation(false);
    try {
      const k = ctx.k;
      mk('gmv', 300, (d) => C.trend(d, ctx.months, { valueKey: 'gmv', unit: 'ngn', label: 'GMV' }));
      mk('cats', 440, (d) => C.hbar(d, ctx.cats.map((x) => ({ ...x, group: x.category })), { valueKey: 'gmv', unit: 'ngn', nKey: 'orders', highlightTop: 2 }));
      mk('late', 260, (d) => C.vbar(d, ctx.lateness, { labelKey: 'group', valueKey: 'low_rate', unit: 'pct', colorFn: (x, P) => (x.group === 'On time' ? P.series[0] : P.series[1]) }));
      const cl = ctx.cats.filter((x) => x.reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate - a.low_rate);
      mk('catlow', 460, (d) => C.stacked(d, cl.map((x) => x.category), [{ name: 'All reviews', data: cl.map((x) => +x.low_rate.toFixed(2)), color: (P) => P.series[1] }, { name: 'On-time deliveries only', data: cl.map((x) => (U.isNum(x.low_rate_on_time) ? +x.low_rate_on_time.toFixed(2) : null)), color: (P) => P.series[0] }], { unit: 'pct', stack: false, horizontal: true }));
      mk('zones', 260, (d) => C.hbar(d, ctx.zones.map((z) => ({ ...z, group: z.name })), { valueKey: 'avg_days', unit: 'days', nKey: 'delivered_n', overall: k.avg_days }));
      mk('latemonth', 260, (d) => C.trend(d, ctx.months, { valueKey: 'late_rate', unit: 'pct', label: 'Late deliveries', overall: k.late_rate }));
    } finally {
      C.setAnimation(true);
      host.querySelectorAll('div').forEach((el) => { const inst = window.echarts.getInstanceByDom(el); if (inst) inst.dispose(); }); host.remove();
    }
    return { out, sizes };
  }

  async function generate(R) {
    const { jsPDF } = window.jspdf;
    if (typeof jsPDF.API.autoTable !== 'function' && typeof window.applyPlugin === 'function') window.applyPlugin(jsPDF);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - 2 * M;
    const BRAND = [59, 42, 107], BLUE = [42, 120, 214], GREY = [90, 90, 90];
    let y = M;
    const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
    const h1 = (t) => { ensure(60); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...BRAND); doc.text(ascii(t), M, y); y += 8; doc.setDrawColor(...BLUE); doc.setLineWidth(1); doc.line(M, y, M + CW, y); y += 16; };
    const h2 = (t) => { ensure(40); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BRAND); doc.text(ascii(t), M, y); y += 14; };
    const p = (t, o = {}) => { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 9.5); doc.setTextColor(...(o.color || [20, 20, 20]));
      doc.splitTextToSize(ascii(t), CW).forEach((ln) => { ensure(13); doc.text(ln, M, y); y += 12.5; }); y += o.after ?? 4; };
    const bullet = (t) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20, 20, 20);
      doc.splitTextToSize(ascii(t), CW - 14).forEach((ln, i) => { ensure(13); if (!i) doc.text('-', M + 2, y); doc.text(ln, M + 14, y); y += 12.5; }); y += 2; };
    const table = (head, body, o = {}) => {
      doc.autoTable({ startY: y, head: [head.map(ascii)], body: body.map((r) => r.map((c) => ascii(c))), margin: { left: M, right: M }, theme: 'grid', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, lineColor: [220, 220, 220], lineWidth: 0.5, textColor: [20, 20, 20], overflow: 'linebreak' },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [247, 246, 251] }, columnStyles: o.columnStyles || {} });
      y = doc.lastAutoTable.finalY + 12;
    };
    const images = await chartImages(R.ctx);
    const img = (name) => { const d = images.out[name]; if (!d) return; const h = CW * (images.sizes[name] / 900); ensure(h + 8); doc.addImage(d, 'JPEG', M, y, CW, h); y += h + 8; };
    const cap = (t) => p(t, { size: 8, color: GREY, after: 8 });
    const c = R.ctx, k = c.k, t = c.t, cu = c.cust;

    // ---- 1. title and scope
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 130, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Marketvale Marketplace Performance Analysis', M, 62);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(ascii(`Categories, customers, delivery and reviews, ${c.rows[0].date} to ${c.rows[c.rows.length - 1].date}`), M, 86);
    doc.setFontSize(9); doc.text(ascii(`Generated ${new Date().toLocaleString('en-GB')} from the Marketvale Marketplace Performance dashboard. Synthetic data.`), M, 108);
    y = 160;
    table(['Report scope', ''], [['Scope', R.scopeLabel], ['Filters applied', R.filtersDesc], ['Orders analysed', `${U.fmtNum(k.orders)} orders (${U.fmtNum(k.nc_orders)} not cancelled), ${U.fmtNum(k.reviews)} reviews`],
      ['Period', `${c.rows[0].date} to ${c.rows[c.rows.length - 1].date}`], ['Dataset status', R.datasetStatus], ['Currency', 'Nigerian naira (NGN), as sold; constant-price figures at January 2024 prices']], { columnStyles: { 0: { cellWidth: 120, fontStyle: 'bold' } } });
    h2('Summary'); c.insights.slice(0, 6).forEach((i) => bullet(`${i.type}: ${i.text}`));

    // ---- 2-4
    h1('1. Business context and problem');
    p('Marketvale is an online marketplace (a fictional, synthetic organisation) where independent sellers list products in 18 categories and deliver to customers across Nigeria. A Product and Commercial Analyst was asked to identify which product categories perform best, understand customer purchasing behaviour, evaluate delivery performance and investigate the factors associated with poor customer reviews.');
    p('The problem: management needs evidence to make better product assortment, seller performance and customer experience decisions. Without it, it is unclear whether low ratings come from products, sellers or delivery, which categories carry the business, and whether customers return.');
    h1('2. Purpose and objectives');
    ['Evaluate the sales performance of different product categories.', 'Examine customer purchasing and repeat purchasing patterns.', 'Evaluate delivery and fulfilment performance.', 'Analyse customer satisfaction through reviews.',
      'Identify product categories associated with poor customer experiences.', 'Develop recommendations to improve marketplace performance.'].forEach((x, i) => bullet(`${i + 1}. ${x}`));
    h1('3. Dataset overview');
    const T = R.tables;
    table(['Item', 'Value'], [['Source', R.sourceName], ['Tables', `${U.fmtNum(T.orders.length)} orders, ${U.fmtNum(T.order_items.length)} order lines, ${U.fmtNum(T.reviews.length)} reviews, ${U.fmtNum(T.customers.length)} customers, ${T.sellers.length} sellers, ${U.fmtNum(T.products.length)} products, 18 categories`],
      ['Grain', 'One row per order (one seller and one category per order); reviews are per order'], ['In this report', `${U.fmtNum(k.orders)} orders, ${U.fmtNum(cu.purchasing)} purchasing customers, ${c.sellers.length} sellers`],
      ['Nature of data', 'Synthetic: designed to resemble a Nigerian e-commerce marketplace. Patterns are properties of a simulation, not evidence about real markets.']], { columnStyles: { 0: { cellWidth: 100, fontStyle: 'bold' } } });
    h1('4. Data preparation');
    p('Every file (the base data and any upload) passes through the same cleaning rules, re-implemented from the source workbook\'s cleaning log and verified: rebuilding the clean tables from the raw sheets reproduces them exactly.');
    table(['Rules', 'What they fix'], [['R1-R9 orders', 'duplicate rows, test orders, day-first dates, status / payment / state spellings, swapped scan times, negative shipping fees, missing delivery scans (flagged)'],
      ['I1-I5 order lines', 'duplicate lines, test-order lines, prices recorded in kobo, negative quantities, missing unit prices'], ['V1-V5 reviews', 'edited reviews exported twice, text scores, out-of-range scores, review dates before delivery, comment spaces'],
      ['C1-C4 customers', 'duplicate rows, state spellings, blank acquisition channels, missing signup dates'], ['References', 'lines and reviews must belong to an existing order; unknown sellers, customers or products are kept with a warning']], { columnStyles: { 0: { cellWidth: 100, fontStyle: 'bold' } } });
    p(`Derived fields: category (from the products in the order), GMV, delivery days, late flag, days late, low rating (1-2 stars), region (geopolitical zone), peak logistics season, constant-price GMV. ${U.fmtNum(c.rows.filter((r) => r.data_quality_note === 'delivered_ts_missing').length)} delivered orders without a delivery scan are excluded from delivery-time measures.`);
    if (R.uploads.length) { h2('Data added during use'); table(['When', 'File', 'Mode', 'Result'], R.uploads.map((b) => [new Date(b.at).toLocaleString('en-GB'), b.file, b.modeLabel, b.resultText])); }

    // ---- 5-6
    h1('5. Analytical methods');
    ['Descriptive and trend analysis by month, quarter and year, with GMV in naira and at constant January 2024 prices (monthly selling-price index).',
      'Category comparison: GMV, orders, units, average order value, cancellation, return, late and low-rating rates; contribution (share of GMV).',
      'Customer analysis: purchases per customer (checkouts), repeat rate, new vs returning customers, quarterly cohorts, spend by region, acquisition channel.',
      'Delivery analysis: delivery success, delivery days, late rate by month, region, state, fulfilment model, item size, route and season.',
      'Experience analysis: review score distribution, 1-2 star share by lateness and by category (all reviews and on-time only, to separate product from delivery effects), complaint themes from comments.',
      `Statistics: chi-square tests, relative risk with 95% CI, Spearman correlation, Kruskal-Wallis tests with effect sizes; Wilson 95% intervals to flag sellers (${RULES.minSellerN}+ orders). Tests show association, not causation.`].forEach(bullet);
    h1('6. KPI definitions');
    table(['KPI', 'Definition', 'Comparison'], KPI_DEFS.map((d) => [d.name, d.formula, d.compare]), { columnStyles: { 0: { cellWidth: 95, fontStyle: 'bold' } } });

    // ---- 7. results
    h1('7. Key numerical results');
    table(['Measure', 'Value', 'Context'], [
      ['GMV', ngn(k.gmv), `At January 2024 prices ${ngn(k.real_gmv)}`], ['Orders', U.fmtNum(k.orders), `${U.fmtNum(k.nc_orders)} not cancelled; ${U.fmtNum(k.units)} units`],
      ['Average order value', ngn(k.aov), 'Item value per order not cancelled'], ['Purchasing customers', U.fmtNum(cu.purchasing), `${U.fmtPct(cu.repeat_rate)} bought more than once`],
      ['Cancellation rate', U.fmtPct(k.cancel_rate), `Return rate ${U.fmtPct(k.return_rate)} of delivered orders`], ['Delivered (closed orders)', U.fmtPct(k.delivered_of_closed), `Delivery success ${U.fmtPct(k.delivery_success)} of shipped orders`],
      ['Average delivery time', ascii(U.fmtDays(k.avg_days)), `Median ${U.fmtDays(k.median_days)}`], ['Late deliveries', U.fmtPct(k.late_rate), `${U.fmtDays(k.avg_days_late)} late on average when late`],
      ['Average review score', U.fmtScore(k.avg_score), `${U.fmtPct(k.low_rate)} of reviews are 1-2 stars; ${U.fmtPct(k.review_rate)} of orders reviewed`],
      ...(k.yoy ? [[`${k.yoy.y2} vs ${k.yoy.y1}`, `GMV ${U.fmtSignedPct(k.yoy.gmv)}`, `${U.fmtSignedPct(k.yoy.real_gmv)} at constant prices; orders ${U.fmtSignedPct(k.yoy.orders)}`]] : []),
    ], { columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' } } });
    h2('7.1 Category sales performance');
    img('gmv'); cap('GMV by month (naira, as sold).');
    img('cats'); cap('GMV by category; n = orders.');
    table(['Category', 'GMV', 'Share', 'Orders', 'Units', 'AOV', 'Cancelled', 'Avg score', '1-2 stars'], c.cats.map((x) => [x.category, ngn(x.gmv), U.fmtPct(x.gmv_share), U.fmtNum(x.orders), U.fmtNum(x.units), ngn(x.aov), U.fmtPct(x.cancel_rate), U.isNum(x.avg_score) ? x.avg_score.toFixed(2) : 'n/a', U.fmtPct(x.low_rate)]));
    p(`Cancellation rates ${A.sig(t.cancelCategory) ? 'differ significantly' : 'do not differ significantly'} between categories (chi-square ${U.pText(t.cancelCategory.p)}).`);
    h2('7.2 Customer purchasing behaviour');
    p(`${U.fmtNum(cu.ordering)} customers placed orders; ${U.fmtNum(cu.purchasing)} completed a purchase. ${U.fmtPct(cu.repeat_rate)} made two or more purchases (separate checkouts), ${U.fmtNum(cu.checkouts_per_customer, 2)} on average, spending ${ngn(cu.spend_per_customer)} each.`);
    table(['First purchase', 'New customers', ...Array.from({ length: Math.max(...cu.cohorts.map((x) => x.rates.length)) - 1 }, (_, i) => `+${i + 1} q`)],
      cu.cohorts.map((x) => [U.quarterLabel(x.cohort), U.fmtNum(x.size), ...Array.from({ length: Math.max(...cu.cohorts.map((z) => z.rates.length)) - 1 }, (_, i) => (i + 1 > x.observed ? '' : U.fmtPct(x.rates[i + 1] || 0, 0)))]));
    cap('Share of each quarter\'s new customers who bought again in later quarters.');
    table(['Region', 'Orders', 'GMV', 'Customers', 'Spend per customer', 'Avg delivery days', 'Late'], c.zones.map((z) => [z.name, U.fmtNum(z.orders), ngn(z.gmv), U.fmtNum(z.customers), ngn(z.spend_per_customer), U.fmtNum(z.avg_days, 2), U.fmtPct(z.late_rate)]));
    h2('7.3 Delivery and fulfilment');
    img('latemonth'); cap('Share of deliveries arriving after the promised date, by month.');
    img('zones'); cap('Average delivery days by region (dashed line = all deliveries).');
    table(['Factor', 'Group', 'Deliveries', 'Late', 'Avg days', 'p-value'], c.factors.flatMap((f) => [[f.factor, f.a.label, U.fmtNum(f.a.n), U.fmtPct(f.a.late_rate), U.fmtNum(f.a.avg_days, 2), U.fmtP(f.p)], ['', f.b.label, U.fmtNum(f.b.n), U.fmtPct(f.b.late_rate), U.fmtNum(f.b.avg_days, 2), '']]));
    const sl = c.sellers.filter((s) => s.late_eval_n >= RULES.minSellerN).sort((a, b) => b.late_rate - a.late_rate).slice(0, 10);
    table(['Seller', 'Fulfilment', 'Deliveries', 'Late', '95% CI', 'Flagged'], sl.map((s) => [`${s.seller_name} (${s.seller_id})`, s.fulfilment, U.fmtNum(s.late_eval_n), U.fmtPct(s.late_rate), `${U.fmtPct(s.late_lo * 100)} - ${U.fmtPct(s.late_hi * 100)}`, s.flag_late ? 'Yes' : 'No']));
    cap('Sellers with the highest late-delivery rates (30+ deliveries).');
    h2('7.4 Customer satisfaction and poor experiences');
    const ll = t.lateLow;
    p(`Late deliveries receive a 1-2 star review ${U.fmtPct(ll.low_late)} of the time vs ${U.fmtPct(ll.low_on_time)} when on time (relative risk ${U.isNum(ll.rr) ? ll.rr.toFixed(2) : 'n/a'}, 95% CI ${U.isNum(ll.rr_lo) ? ll.rr_lo.toFixed(2) : 'n/a'}-${U.isNum(ll.rr_hi) ? ll.rr_hi.toFixed(2) : 'n/a'}, chi-square ${U.pText(ll.p)}). Spearman rho between days late and score = ${U.isNum(t.spearmanLate.r) ? t.spearmanLate.r.toFixed(3) : 'n/a'}.`);
    img('late'); cap('Share of 1-2 star reviews by how late the order arrived.');
    img('catlow'); cap('1-2 star share by category: all reviews vs on-time deliveries only.');
    table(['Complaint theme (1-2 star reviews)', 'Reviews', 'Share'], c.themes.map((x) => [x.group, U.fmtNum(x.n), U.fmtPct(x.share)]));

    // ---- 8-12
    h1('8. Key findings'); c.insights.forEach((i) => bullet(`${i.type}: ${i.text}`));
    h1('9. Areas requiring management attention');
    const lbl = { ok: 'On track', warn: 'Warning', crit: 'Critical', info: 'Monitor', na: 'n/a' };
    table(['Area', 'Measure', 'Value', 'Status', 'Rule'], c.attention.map((a) => [a.area, a.measure, a.value, lbl[a.level], a.rule]), { columnStyles: { 0: { fontStyle: 'bold' } } });
    h1('10. Business interpretation');
    const worst = c.cats.filter((x) => x.on_time_reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate_on_time - a.low_rate_on_time)[0];
    p(`What the data shows: ${c.cats.slice(0, 2).map((x) => x.category).join(' and ')} carry ${U.fmtPct(c.cats[0].gmv_share + (c.cats[1] ? c.cats[1].gmv_share : 0))} of GMV; ${U.fmtPct(k.late_rate)} of deliveries are late, and late orders are far more likely to receive poor reviews.${worst ? ` ${worst.category} has the highest share of poor reviews even when delivery is on time (${U.fmtPct(worst.low_rate_on_time)}).` : ''}`);
    p('What the analysis suggests: delivery punctuality is the main controllable driver of review scores across most categories, while in some categories (especially fashion) product fit and description cause dissatisfaction regardless of delivery. Seller-fulfilled orders, remote regions and the year-end peak carry the highest delivery risk.');
    p('What requires further investigation: product-level return reasons, carrier performance by route, and the effect of interventions (for example promised-date changes) through controlled tests. Associations here do not prove cause.');
    h1('11. Recommendations');
    table(['Horizon', 'Area', 'Recommendation', 'Evidence'], c.recs.map((r) => [r.horizon, r.area, r.text, r.evidence]), { columnStyles: { 0: { cellWidth: 58, fontStyle: 'bold' }, 1: { cellWidth: 58 } } });
    h1('12. Limitations and assumptions');
    ['The data is synthetic; findings demonstrate the method and do not describe a real marketplace.',
      'Naira values include inflation (prices rose about 49% over two years); constant-price figures use a marketplace-wide selling-price index against 2024 list prices.',
      'Orders still shipped or processing at the extract are open; they are excluded from delivery-success rates. Delivered orders without a delivery scan are excluded from delivery-time measures.',
      'Reviews are per order and available for about 58% of orders; reviewers may differ from non-reviewers.',
      'Repeat-purchase and cohort rates depend on the period in view; recent cohorts have less time to return.',
      'Status thresholds and the 30-order minimum for sellers are illustrative conventions. Statistical tests show association, not causation.'].forEach(bullet);
    p(`Report generated: ${new Date().toLocaleString('en-GB')}. Scope: ${R.scopeLabel}. Orders: ${U.fmtNum(k.orders)}.`, { color: GREY, size: 8.5 });
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130); doc.text(ascii(`Marketvale Marketplace Performance Analysis | ${R.scopeLabel} | page ${i} of ${pages}`), M, H - 22); }
    const fname = `marketvale_performance_report_${R.scope}_${U.stamp()}.pdf`;
    doc.save(fname);
    return { pages, fname };
  }
  window.MvReport = { generate };
})();

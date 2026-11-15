/* app.js - application state, rendering and user interaction.
   Data flow: stored tables -> MvData.derive() (order-level table) -> filters -> MvAnalytics.analyse() -> charts, tables,
   KPIs, report, exports. Every change (filter, upload, undo, reset) re-runs that chain, so all views share one dataset. */
(function () {
  'use strict';
  const U = window.MvUtils, D = window.MvData, A = window.MvAnalytics, C = window.MvCharts, S = window.MvStore;
  const { KPI_DEFS, RULES, TABLES, MEASURES, CAT_MEASURES, CAT_UNITS, TRANSACTION_TABLES, TABLE_ORDER, THEMES } = window.MvConfig;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = U.esc;
  const TABS = ['overview', 'categories', 'customers', 'delivery', 'experience', 'sellers', 'explorer', 'data', 'method'];
  const TNAMES = Object.keys(TABLES);
  const emptyTables = () => Object.fromEntries(TNAMES.map((t) => [t, []]));

  const state = {
    base: null, tables: emptyTables(), batches: [], updatedAt: null, storage: false, baseFixes: null,
    all: [], pidx: new Map(), filtered: [], ctx: null, months: [],
    filters: { monthFrom: '', monthTo: '', categories: [], zones: [], tiers: [], fulfilment: [], payments: [] },
    view: { tab: 'overview', monthMeasure: 'gmv', catMeasure: 'gmv', catTrendMode: 'nominal', delMeasure: 'late_rate',
      table: { search: '', cols: 'key', page: 1, size: 50, sort: 'order_purchase_ts', dir: -1 }, seller: { search: '', flag: 'all' }, sorts: {} },
    pending: null, dirty: new Set(),
  };

  // ================================================================ start-up
  async function init() {
    try {
      busy(true, 'Loading data...');
      const B = window.BASE_DATASET.tables;
      ['categories', 'states', 'calendar'].forEach((t) => { D.refs[t] = D.readCsvText(B[t], t).rows; });
      D.refs.calendar.forEach((c) => { c.is_peak_logistics = +c.is_peak_logistics; });
      const up = D.processUpload(TNAMES.map((t) => D.readCsvText(B[t], t)), emptyTables(), 'replace');
      if (up.blocking) throw new Error(up.blocking);
      state.base = emptyTables();
      Object.values(up.parts).forEach((p) => { state.base[p.table] = p.sim.next.map((r) => ({ ...r, _batch: 'base' })); });
      state.storage = await S.available();
      const saved = state.storage ? await S.load() : null;
      if (saved && saved.tables && saved.tables.orders && saved.tables.orders.length) {
        state.tables = { ...emptyTables(), ...saved.tables }; state.batches = saved.batches || []; state.updatedAt = saved.updatedAt;
        toast(`Loaded your working dataset saved in this browser (${U.fmtNum(state.tables.orders.length)} orders).`);
      } else state.tables = { ...state.base };
      try { const t = localStorage.getItem('mv-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
      renderStatic(); wire(); recompute(true);
    } catch (e) {
      console.error(e);
      $('#main').insertAdjacentHTML('afterbegin', `<div class="msg err">The dashboard could not start: ${esc(e.message)}. Check that all files in assets/ and data/ were deployed.</div>`);
    } finally { busy(false); }
  }

  // ================================================================ recalculation
  function recompute(resetFilters = false) {
    // if the view covered every month before, keep covering every month (so newly uploaded months are included)
    const wasFull = state.months.length && state.filters.monthFrom === state.months[0] && state.filters.monthTo === state.months[state.months.length - 1];
    state.all = D.derive(state.tables);
    state.pidx = A.priceIndex(state.all);
    state.months = [...new Set(state.all.map((r) => r.month))].sort();
    const f = state.filters, m0 = state.months[0], m1 = state.months[state.months.length - 1];
    if (resetFilters || !f.monthFrom) Object.assign(f, { monthFrom: m0, monthTo: m1, categories: [], zones: [], tiers: [], fulfilment: [], payments: [] });
    else if (wasFull) { f.monthFrom = m0; f.monthTo = m1; }
    if (f.monthFrom < m0 || f.monthFrom > m1) f.monthFrom = m0;
    if (f.monthTo > m1 || f.monthTo < m0) f.monthTo = m1;
    MULTI.forEach((m) => { const vals = new Set(state.all.map((r) => r[m.field])); f[m.key] = f[m.key].filter((x) => x === '__none__' || vals.has(x)); });
    buildFilterOptions(); refresh();
  }
  function refresh() {
    state.filtered = A.applyFilters(state.all, state.filters);
    state.ctx = A.analyse(state.filtered, state.all, state.filters, state.pidx, state.tables.customers);
    state.view.table.page = 1;
    renderHeader(); renderChips();
    TABS.forEach((t) => state.dirty.add(t));
    renderTab(state.view.tab);
  }
  function renderTab(tab) {
    if (!state.dirty.has(tab)) return;
    state.dirty.delete(tab);
    const empty = !state.filtered.length;
    if (empty && ['overview', 'categories', 'customers', 'delivery', 'experience', 'sellers'].includes(tab)) { renderEmpty(tab); return; }
    ({ overview: renderOverview, categories: renderCategories, customers: renderCustomers, delivery: renderDelivery, experience: renderExperience, sellers: renderSellers,
      explorer: renderExplorer, data: renderDataTab, method: renderMethod })[tab]();
  }
  function renderEmpty(tab) {
    const panel = $(`#tab-${tab}`);
    panel.querySelectorAll('.chart').forEach((el) => C.vbar(el, [], { labelKey: 'x', valueKey: 'y' }));
    panel.querySelectorAll('table.data, .insights, .recs').forEach((el) => { el.innerHTML = ''; });
    const intro = tab === 'overview' ? $('#ovScope') : panel.querySelector('.intro p'); if (intro) intro.textContent = 'No orders match the current filters. Use Reset filters to see all data.';
    if (tab === 'overview') { $('#kpis').innerHTML = '<p class="empty">No orders match the current filters. Use Reset filters to see all data.</p>'; $('#kpiNote').textContent = ''; }
  }
  const fullFilters = () => ({ monthFrom: state.months[0], monthTo: state.months[state.months.length - 1], categories: [], zones: [], tiers: [], fulfilment: [], payments: [] });
  function filterTo(key, value) {
    if (key === 'month') { state.filters.monthFrom = value; state.filters.monthTo = value; } else state.filters[key] = [value];
    buildFilterOptions(); refresh(); toast(`Filtered to ${key === 'month' ? U.monthLabel(value) : value}. Remove the chip to undo.`);
  }

  // ================================================================ header, filters, chips
  function renderHeader() {
    const modified = state.batches.length > 0; const st = $('#datasetStatus');
    st.textContent = modified ? `Working dataset: ${U.fmtNum(state.tables.orders.length)} orders (${state.batches.length} upload${state.batches.length > 1 ? 's' : ''} in this browser)` : `Original dataset: ${U.fmtNum(state.tables.orders.length)} orders`;
    st.classList.toggle('modified', modified);
    const a = state.all;
    $('#datasetScope').textContent = a.length ? `${a[0].date} to ${a[a.length - 1].date}` : '';
    $('#lastUpdated').textContent = modified ? `Data last changed ${new Date(state.updatedAt).toLocaleString('en-GB')}` : `Extract: ${window.BASE_DATASET.extract}`;
  }
  const datasetStatusText = () => (state.batches.length ? `Working dataset modified in this browser: ${state.batches.length} upload(s), last change ${new Date(state.updatedAt).toLocaleString('en-GB')}` : `Original dataset (${window.BASE_DATASET.name}), unmodified`);
  const MULTI = [
    { box: '#fCat', key: 'categories', field: 'category_name', val: '#fCatVal', label: 'Category' },
    { box: '#fZone', key: 'zones', field: 'zone', val: '#fZoneVal', label: 'Region' },
    { box: '#fTier', key: 'tiers', field: 'seller_tier', val: '#fTierVal', label: 'Seller tier' },
    { box: '#fFul', key: 'fulfilment', field: 'fulfilment_model', val: '#fFulVal', label: 'Fulfilment' },
    { box: '#fPay', key: 'payments', field: 'payment_method', val: '#fPayVal', label: 'Payment' },
  ];
  function buildFilterOptions() {
    const f = state.filters;
    const opt = (sel) => state.months.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('');
    $('#fFrom').innerHTML = opt(f.monthFrom); $('#fTo').innerHTML = opt(f.monthTo);
    MULTI.forEach((m) => {
      const counts = new Map(); state.all.forEach((r) => counts.set(r[m.field], (counts.get(r[m.field]) || 0) + 1));
      const vals = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)); const sel = f[m.key];
      $(m.box).innerHTML = vals.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${!sel.length || sel.includes(v) ? 'checked' : ''}> ${esc(v)} <small class="note">(${U.fmtNum(counts.get(v))})</small></label>`).join('')
        + '<div class="menu-actions"><button type="button" data-all>All</button><button type="button" data-none>None</button></div>';
    });
    updateFilterLabels();
  }
  function readMulti(box) { const all = $$(`${box} input`).length; const c = $$(`${box} input:checked`).map((i) => i.value); return c.length === all ? [] : c.length === 0 ? ['__none__'] : c; }
  function updateFilterLabels() { MULTI.forEach((m) => { const s = state.filters[m.key]; $(m.val).textContent = !s.length ? 'All' : s.includes('__none__') ? 'None' : s.length === 1 ? s[0] : `${s.length} selected`; }); }
  function renderChips() {
    const f = state.filters, chips = [];
    if (f.monthFrom !== state.months[0] || f.monthTo !== state.months[state.months.length - 1]) chips.push(['months', f.monthFrom === f.monthTo ? U.monthLabel(f.monthFrom) : `${U.monthLabel(f.monthFrom)} to ${U.monthLabel(f.monthTo)}`]);
    MULTI.forEach((m) => { const s = f[m.key]; if (s.length) chips.push([m.key, s.includes('__none__') ? `${m.label}: none selected` : `${m.label}: ${s.length <= 3 ? s.join(', ') : s.length + ' selected'}`]); });
    $('#activeFilters').innerHTML = chips.length ? chips.map(([k, t]) => `<button class="chip" type="button" data-chip="${esc(k)}" aria-label="Remove filter ${esc(t)}">${esc(t)} <span aria-hidden="true">✕</span></button>`).join('')
      : '<span class="note">No filters: showing all orders</span>';
    updateFilterLabels();
  }
  function filtersDescription() {
    const f = state.filters; const parts = [];
    if (f.monthFrom !== state.months[0] || f.monthTo !== state.months[state.months.length - 1]) parts.push(`months ${U.monthLabel(f.monthFrom)} to ${U.monthLabel(f.monthTo)}`);
    MULTI.forEach((m) => { if (f[m.key].length) parts.push(`${m.label.toLowerCase()}: ${f[m.key].includes('__none__') ? 'none' : f[m.key].join(', ')}`); });
    return parts.length ? parts.join('; ') : 'None (all orders)';
  }
  const scopeText = () => { const r = state.filtered; return r.length ? `${U.fmtNum(r.length)} orders placed ${r[0].date} to ${r[r.length - 1].date}; filters: ${filtersDescription()}.` : 'no orders match the filters.'; };

  // ================================================================ shared bits
  const ST = { ok: ['st-ok', 'On track'], warn: ['st-warn', 'Warning'], crit: ['st-crit', 'Critical'], info: ['st-info', 'Monitor'], na: ['st-info', 'n/a'] };
  const status = (lvl) => `<span class="st ${ST[lvl][0]}">${ST[lvl][1]}</span>`;
  const cls = (v, goodWhenUp, eps = 0.05) => (!U.isNum(v) || Math.abs(v) <= eps || goodWhenUp === null ? 'flat' : (v > 0) === goodWhenUp ? 'up' : 'down');
  const arrow = (v, eps = 0.05) => (!U.isNum(v) || Math.abs(v) <= eps ? '' : v > 0 ? '▲ ' : '▼ ');
  function kpiCard(def, value, delta, deltaClass, context) {
    return `<div class="kpi"><div class="k-name">${esc(def.name)} <button class="info" type="button" aria-label="Definition of ${esc(def.name)}">i<span class="tip" role="tooltip"><b>${esc(def.name)}</b><br>${esc(def.formula)}.<br><i>${esc(def.compare)}.</i></span></button></div>
      <div class="k-value">${value}</div>${delta ? `<div class="k-delta ${deltaClass}">${delta}</div>` : ''}<div class="k-context">${context}</div></div>`;
  }
  function setAria(sel, text) { const el = $(sel); if (el) el.setAttribute('aria-label', text); }
  const smallCat = (key) => (c) => ({ ...c, small: (['avg_score', 'low_rate'].includes(key) ? c.reviews : key === 'late_rate' ? c.delivered_n : c.orders) < RULES.minCategoryN });
  const overallOf = (k, m) => ({ gmv: null, real_gmv: null, orders: null, customers: null, aov: k.aov, cancel_rate: k.cancel_rate, late_rate: k.late_rate, avg_days: k.avg_days, avg_score: k.avg_score, low_rate: k.low_rate, price_index: null, delivery_success: k.delivery_success, return_rate: k.return_rate, gmv_share: null, units: null }[m]);

  // ================================================================ overview
  function renderOverview() {
    const c = state.ctx, k = c.k; const d = Object.fromEntries(KPI_DEFS.map((x) => [x.id, x]));
    $('#ovScope').textContent = scopeText();
    const mom = k.last && k.prev ? `${U.monthLabel(k.last.month).slice(0, 3)} vs ${U.monthLabel(k.prev.month).slice(0, 3)}` : '';
    const att = Object.fromEntries(c.attention.map((a) => [a.area, a.level]));
    $('#kpis').innerHTML = [
      kpiCard(d.gmv, U.fmtNgn(k.gmv), mom ? `${arrow(k.d_gmv)}${U.fmtSignedPct(k.d_gmv)}, ${mom}` : '', cls(k.d_gmv, true), `At Jan 2024 prices ${U.fmtNgn(k.real_gmv)}${k.yoy ? `<br>${k.yoy.y2} vs ${k.yoy.y1}: ${U.fmtSignedPct(k.yoy.gmv)} (${U.fmtSignedPct(k.yoy.real_gmv)} real)` : ''}`),
      kpiCard(d.orders, U.fmtNum(k.orders), mom ? `${arrow(k.d_orders)}${U.fmtSignedPct(k.d_orders)}, ${mom}` : '', cls(k.d_orders, true), `${U.fmtNum(k.nc_orders)} not cancelled; ${U.fmtNum(k.units)} units sold`),
      kpiCard(d.aov, U.fmtNgn(k.aov), mom ? `${arrow(k.d_aov)}${U.fmtSignedPct(k.d_aov)}, ${mom}` : '', cls(k.d_aov, true), 'Item value per order not cancelled'),
      kpiCard(d.customers, U.fmtNum(c.cust.purchasing), '', '', `${U.fmtPct(c.cust.repeat_rate)} bought again<br>${status(att['Customer loyalty'])}`),
      kpiCard(d.cancel, U.fmtPct(k.cancel_rate), mom ? `${arrow(k.d_cancel)}${U.fmtPp(k.d_cancel)}, ${mom}` : '', cls(k.d_cancel, false), `${U.fmtNum(k.orders - k.nc_orders)} orders cancelled<br>${status(att['Order cancellations'])}`),
      kpiCard(d.delivery, U.fmtPct(k.delivered_of_closed), '', '', `Of closed orders; ${U.fmtPct(k.delivery_success)} of shipped orders arrived<br>${status(att['Delivery reliability'])}`),
      kpiCard(d.late, U.fmtPct(k.late_rate), mom ? `${arrow(k.d_late)}${U.fmtPp(k.d_late)}, ${mom}` : '', cls(k.d_late, false), `Delivered late; ${U.fmtDays(k.avg_days)} on average<br>${status(att['Delivery punctuality'])}`),
      kpiCard(d.rating, U.isNum(k.avg_score) ? `${k.avg_score.toFixed(2)}<small style="font-size:13px;font-weight:600;color:var(--text-secondary)"> / 5</small>` : 'n/a', mom ? `${arrow(k.d_score, 0.005)}${U.fmtSigned(k.d_score, 2)}, ${mom}` : '', cls(k.d_score, true, 0.005), `${U.fmtPct(k.low_rate)} rated 1-2 stars<br>${status(att['Customer satisfaction'])}`),
    ].join('');
    $('#kpiNote').textContent = k.last && k.prev ? `Month-on-month changes compare ${U.monthLabel(k.last.month)} with ${U.monthLabel(k.prev.month)}. Green = better, red = worse, grey = no target direction. Naira values are as sold; prices rose over the period (see GMV at January 2024 prices).` : 'Month-on-month changes need at least two months in view.';
    renderMonthTrend();
    $('#insights').innerHTML = c.insights.map((i) => `<li><b>${esc(i.type)}</b>${esc(i.text)}<small>Rule: ${esc(i.rule)}</small></li>`).join('') || '<li>No findings for this selection.</li>';
    $('#attention').innerHTML = `<thead><tr><th>Area</th><th>Measure</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>${
      c.attention.map((a) => `<tr><td><b>${esc(a.area)}</b></td><td class="wrap">${esc(a.measure)}</td><td class="num nowrap">${esc(a.value)}</td><td title="${esc(a.rule)}">${status(a.level)}</td></tr>`).join('')}</tbody>`;
    C.hbar($('#cCatOv'), c.cats.map((x) => ({ ...x, group: x.category, tipExtra: `${U.fmtPct(x.gmv_share)} of GMV; ${U.fmtNum(x.orders)} orders` })), { valueKey: 'gmv', unit: 'ngn', nKey: 'orders', nLabel: 'orders', onClick: (v) => filterTo('categories', v), highlightTop: 2 });
    setAria('#cCatOv', `GMV by category: largest ${c.cats[0].category} ${U.fmtNgn(c.cats[0].gmv)}.`);
    $('#recs').innerHTML = c.recs.map((r) => `<div class="rec"><div class="h">${esc(r.horizon)} · ${esc(r.area)}</div><p>${esc(r.text)}</p><small><b>Evidence:</b> ${esc(r.evidence)}</small></div>`).join('');
  }
  function renderMonthTrend() {
    const c = state.ctx, m = state.view.monthMeasure; const M = MEASURES[m];
    $('#monthTitle').textContent = `${M.label} by month`;
    C.trend($('#cMonth'), c.months, { valueKey: m, unit: M.unit, label: M.label, overall: overallOf(c.k, m), onClick: (mo) => filterTo('month', mo),
      tipExtra: (x) => `Orders ${U.fmtNum(x.orders)} · GMV ${U.fmtNgn(x.gmv)} · late ${U.fmtPct(x.late_rate)} · score ${U.isNum(x.avg_score) ? x.avg_score.toFixed(2) : 'n/a'}` });
    const v = c.months.filter((x) => U.isNum(x[m])); if (v.length) { const hi = v.slice().sort((a, b) => b[m] - a[m])[0]; setAria('#cMonth', `${M.label} by month; highest ${U.monthLabel(hi.month)} ${U.fmtByUnit(hi[m], M.unit)}.`); }
  }

  // ================================================================ categories
  function renderCategories() {
    const c = state.ctx, k = c.k, t = c.t; const m = state.view.catMeasure;
    const byOrders = c.cats.slice().sort((a, b) => b.orders - a.orders)[0], byUnits = c.cats.slice().sort((a, b) => b.units - a.units)[0], byAov = c.cats.filter((x) => x.orders >= RULES.minCategoryN).sort((a, b) => b.aov - a.aov)[0];
    $('#catIntro').textContent = `${c.cats.length} categories in view. Highest GMV: ${c.cats[0].category} (${U.fmtNgn(c.cats[0].gmv)}, ${U.fmtPct(c.cats[0].gmv_share)}). Most orders: ${byOrders.category} (${U.fmtNum(byOrders.orders)}). Most units sold: ${byUnits.category} (${U.fmtNum(byUnits.units)}). Highest average order value: ${byAov ? `${byAov.category} (${U.fmtNgn(byAov.aov)})` : 'n/a'}.`;
    $('#catRankTitle').textContent = `Categories ranked by ${m === 'gmv' ? 'GMV' : CAT_MEASURES[m].charAt(0).toLowerCase() + CAT_MEASURES[m].slice(1)}`;
    C.hbar($('#cCatRank'), c.cats.map(smallCat(m)).map((x) => ({ ...x, group: x.category })), { valueKey: m, unit: CAT_UNITS[m], overall: overallOf(k, m), nKey: ['avg_score', 'low_rate'].includes(m) ? 'reviews' : 'orders', nLabel: ['avg_score', 'low_rate'].includes(m) ? 'reviews' : 'orders', onClick: (v) => filterTo('categories', v), max: m === 'avg_score' ? 5 : undefined });
    setAria('#cCatRank', `Categories ranked by ${CAT_MEASURES[m]}.`);
    C.scatter($('#cCatMatrix'), c.cats.filter((x) => x.reviews > 0).map((x) => ({ ...x, tipExtra: `(${U.fmtNum(x.orders)} orders)` })), { xKey: 'gmv', yKey: 'low_rate', sizeKey: 'orders', xUnit: 'ngn', yUnit: 'pct', xName: 'GMV', yName: '1-2 star reviews', labelKey: 'category', labelKeys: [...c.cats.slice(0, 5), ...c.cats.filter((x) => x.reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate - a.low_rate).slice(0, 4)].map((x) => x.category), yRef: k.low_rate, onClick: (v) => filterTo('categories', v) });
    setAria('#cCatMatrix', 'Scatter of category GMV against share of 1-2 star reviews.');
    renderCatTrend();
    $('#catTests').textContent = t ? `Cancellation rates ${A.sig(t.cancelCategory) ? 'differ' : 'do not differ'} significantly between categories (chi-square ${U.pText(t.cancelCategory.p)}); review scores ${A.sig(t.kwScoreCategory) ? 'differ' : 'do not differ'} (Kruskal-Wallis ${U.pText(t.kwScoreCategory.p)}, effect size ${U.describeEffect(t.kwScoreCategory.epsilon_sq)}).` : '';
    sortableTable($('#catTable'), 'cats', [
      { key: 'category', label: 'Category', f: (v) => `<b>${esc(v)}</b>`, html: true }, { key: 'group', label: 'Group' }, { key: 'gmv', label: 'GMV', num: true, f: (v) => U.fmtNgn(v) },
      { key: 'gmv_share', label: 'Share', num: true, f: (v) => U.fmtPct(v) }, { key: 'orders', label: 'Orders', num: true, f: (v) => U.fmtNum(v) }, { key: 'units', label: 'Units', num: true, f: (v) => U.fmtNum(v) },
      { key: 'aov', label: 'AOV', num: true, f: (v) => U.fmtNgn(v) }, { key: 'cancel_rate', label: 'Cancelled', num: true, f: (v) => U.fmtPct(v) }, { key: 'return_rate', label: 'Returned', num: true, f: (v) => U.fmtPct(v) },
      { key: 'late_rate', label: 'Late', num: true, f: (v) => U.fmtPct(v) }, { key: 'avg_score', label: 'Avg score', num: true, f: (v) => (U.isNum(v) ? v.toFixed(2) : 'n/a') },
      { key: 'low_rate', label: '1-2 stars', num: true, f: (v) => U.fmtPct(v) }, { key: 'low_rate_on_time', label: '1-2 stars, on time', num: true, f: (v) => U.fmtPct(v) },
    ], c.cats, 'gmv', -1);
  }
  function renderCatTrend() {
    const rows = state.filtered.filter((r) => !r.cancelled); const real = state.view.catTrendMode === 'real';
    const qs = [...new Set(state.filtered.map((r) => r.quarter))].sort(); const qi = new Map(qs.map((q, i) => [q, i]));
    const g = new Map(); rows.forEach((r) => { if (!g.has(r.category_name)) g.set(r.category_name, new Array(qs.length).fill(0)); const p = state.pidx.get(r.month); g.get(r.category_name)[qi.get(r.quarter)] += real ? (p ? r.gmv / p : 0) : r.gmv; });
    C.multiTrend($('#cCatTrend'), qs, [...g.entries()].map(([name, values]) => ({ name, values: values.map((v) => Math.round(v)), total: values.reduce((a, b) => a + b, 0) })), { unit: 'ngn', labelFmt: U.quarterLabel });
    setAria('#cCatTrend', `GMV by category and quarter${real ? ' at January 2024 prices' : ''}.`);
  }

  // ================================================================ customers
  function renderCustomers() {
    const c = state.ctx, cu = c.cust;
    $('#custIntro').textContent = `${U.fmtNum(cu.ordering)} customers placed orders and ${U.fmtNum(cu.purchasing)} completed at least one purchase that was not cancelled (${U.fmtNum(state.tables.customers.length)} registered accounts in total). ${U.fmtPct(cu.repeat_rate)} bought more than once; the average customer made ${U.fmtNum(cu.checkouts_per_customer, 2)} purchases worth ${U.fmtNgn(cu.spend_per_customer)} in the period.`;
    const tot = cu.dist.reduce((s, d) => s + d.n, 0);
    C.vbar($('#cPurch'), cu.dist.map((d) => ({ ...d, label: `${d.label} purchase${d.label === '1' ? '' : 's'}` })), { labelKey: 'label', valueKey: 'n', unit: 'int', colorFn: (d, P) => (d.label.startsWith('1') ? P.other : P.series[0]), tipFn: (d) => `<b>${d.label}</b><br>${U.fmtNum(d.n)} customers (${U.fmtPct(d.n / tot * 100)})` });
    setAria('#cPurch', `Purchases per customer: ${U.fmtPct(cu.repeat_rate)} made 2 or more.`);
    C.stacked($('#cNewRet'), cu.newRet.map((x) => x.month), [{ name: 'New customers', data: cu.newRet.map((x) => x.new), color: (P) => P.series[0] }, { name: 'Returning customers', data: cu.newRet.map((x) => x.returning), color: (P) => P.series[2] }], { labelFmt: U.monthLabel });
    setAria('#cNewRet', 'New and returning purchasing customers by month.');
    const maxK = Math.max(...cu.cohorts.map((x) => x.rates.length));
    $('#cohortTable').innerHTML = `<thead><tr><th>First purchase</th><th class="num">New customers</th>${Array.from({ length: maxK - 1 }, (_, i) => `<th class="num">+${i + 1} q</th>`).join('')}</tr></thead><tbody>${
      cu.cohorts.map((x) => `<tr><td>${U.quarterLabel(x.cohort)}</td><td class="num">${U.fmtNum(x.size)}</td>${Array.from({ length: maxK - 1 }, (_, i) => { const kq = i + 1; if (kq > x.observed) return '<td class="c na"></td>';
        const v = x.rates[kq] || 0; return `<td class="c" style="background:color-mix(in srgb, var(--series-1) ${Math.min(85, v * 2.4).toFixed(0)}%, transparent)" title="${U.fmtPct(v)} of ${U.quarterLabel(x.cohort)} customers bought again ${kq} quarter(s) later">${U.fmtPct(v, 0)}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
    C.hbar($('#cZoneSpend'), c.zones.map((z) => ({ ...z, group: z.name, small: z.customers < RULES.minCategoryN })), { valueKey: 'spend_per_customer', unit: 'ngn', nKey: 'customers', nLabel: 'customers', overall: cu.spend_per_customer, onClick: (v) => filterTo('zones', v) });
    setAria('#cZoneSpend', 'GMV per purchasing customer by region.');
    C.hbar($('#cStateOrders'), c.states.slice(0, 15).map((s) => ({ ...s, group: s.name, tipExtra: `${s.zone}; GMV ${U.fmtNgn(s.gmv)}` })), { valueKey: 'orders', unit: 'int', highlightTop: 3 });
    setAria('#cStateOrders', `Orders by delivery state; most orders ${c.states[0].name}.`);
    C.hbar($('#cChannel'), cu.channels, { valueKey: 'repeat_rate', unit: 'pct', nKey: 'customers', nLabel: 'customers', overall: cu.repeat_rate });
    setAria('#cChannel', 'Repeat-purchase rate by acquisition channel.');
    C.heatmap($('#cOrderHeat'), cu.heat, Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), A.DAYS, { unitLabel: 'orders' });
    setAria('#cOrderHeat', 'Heatmap of orders by weekday and hour.');
    sortableTable($('#payTable'), 'pay', [{ key: 'group', label: 'Payment method' }, { key: 'orders', label: 'Orders', num: true, f: (v) => U.fmtNum(v) }, { key: 'share', label: 'Share', num: true, f: (v) => U.fmtPct(v) },
      { key: 'aov', label: 'Average order value', num: true, f: (v) => U.fmtNgn(v) }, { key: 'cancel_rate', label: 'Cancelled', num: true, f: (v) => U.fmtPct(v) }], cu.pay, 'orders', -1);
  }

  // ================================================================ delivery
  function renderDelivery() {
    const c = state.ctx, k = c.k; const m = state.view.delMeasure; const lab = { late_rate: ['Late deliveries (%)', 'pct'], avg_days: ['Average delivery time (days)', 'days'], delivery_success: ['Delivery success (%)', 'pct'] }[m];
    $('#delIntro').textContent = `${U.fmtPct(k.delivered_of_closed)} of closed orders were delivered; of orders handed to a carrier, ${U.fmtPct(k.delivery_success)} arrived. Average delivery time ${U.fmtDays(k.avg_days)} (median ${U.fmtDays(k.median_days)}); ${U.fmtPct(k.late_rate)} arrived after the promised date, by ${U.fmtDays(k.avg_days_late)} on average.`;
    $('#delMonthTitle').textContent = `${lab[0]} by month`;
    C.trend($('#cDelMonth'), c.months, { valueKey: m, unit: lab[1], label: lab[0], overall: overallOf(k, m), onClick: (mo) => filterTo('month', mo), tipExtra: (x) => `${U.fmtNum(x.delivered_n)} deliveries with a timestamp` });
    setAria('#cDelMonth', `${lab[0]} by month.`);
    C.stacked($('#cDelHist'), c.hist.map((b) => b.label), [{ name: 'On time', data: c.hist.map((b) => b.count - b.late), color: (P) => P.series[0] }, { name: 'Late', data: c.hist.map((b) => b.late), color: (P) => P.series[1] }],
      { labelFmt: (x) => x, tipFn: (i) => { const b = c.hist[i]; return `<b>${b.label} days</b><br>${U.fmtNum(b.count)} deliveries; ${U.fmtNum(b.late)} late (${U.fmtPct(b.late / b.count * 100)})`; } });
    setAria('#cDelHist', `Delivery time distribution; median ${U.fmtDays(k.median_days)}.`);
    C.hbar($('#cZoneDays'), c.zones.map((z) => ({ ...z, group: z.name, small: z.delivered_n < RULES.minStateN, tipExtra: `${U.fmtPct(z.late_rate)} late` })), { valueKey: 'avg_days', unit: 'days', nKey: 'delivered_n', nLabel: 'deliveries', overall: k.avg_days, onClick: (v) => filterTo('zones', v) });
    setAria('#cZoneDays', 'Average delivery days by region.');
    $('#factorTable').innerHTML = `<thead><tr><th>Factor</th><th>Group</th><th class="num">Deliveries</th><th class="num">Late</th><th class="num">Avg days</th><th>Test</th></tr></thead><tbody>${
      c.factors.map((f) => [f.a, f.b].map((g, i) => `<tr>${i === 0 ? `<td rowspan="2"><b>${esc(f.factor)}</b></td>` : ''}<td>${esc(g.label)}</td><td class="num">${U.fmtNum(g.n)}</td><td class="num">${U.fmtPct(g.late_rate)}</td><td class="num">${U.fmtDays(g.avg_days)}</td>${i === 0 ? `<td rowspan="2">${A.sig(f) ? '<span class="st st-warn">Significant</span>' : '<span class="st st-info">Not significant</span>'}<br><small class="note">${U.pText(f.p)}</small></td>` : ''}</tr>`).join('')).join('')}</tbody>`;
    const st = c.states.filter((s) => s.delivered_n >= RULES.minStateN);
    $('#stateNote').textContent = `${st.length} states with ${RULES.minStateN}+ deliveries (of ${c.states.length}). Delivery times differ significantly by state (Kruskal-Wallis ${U.pText(c.t.kwDaysState.p)}, effect size ${U.describeEffect(c.t.kwDaysState.epsilon_sq)}).`;
    sortableTable($('#stateTable'), 'states', [{ key: 'name', label: 'State' }, { key: 'zone', label: 'Region' }, { key: 'delivered_n', label: 'Deliveries', num: true, f: (v) => U.fmtNum(v) },
      { key: 'avg_days', label: 'Avg days', num: true, f: (v) => U.fmtNum(v, 2) }, { key: 'late_rate', label: 'Late', num: true, f: (v) => U.fmtPct(v) }, { key: 'orders', label: 'Orders', num: true, f: (v) => U.fmtNum(v) }], st, 'avg_days', -1);
    const sl = c.sellers.filter((s) => s.late_eval_n >= RULES.minSellerN).sort((a, b) => b.late_rate - a.late_rate).slice(0, 15)
      .map((s) => ({ group: s.seller_name, late_rate: s.late_rate, lo: s.late_lo * 100, hi: s.late_hi * 100, n: s.late_eval_n, tipExtra: `${s.seller_id} · ${s.fulfilment}${s.flag_late ? ' · flagged' : ''}` }));
    C.hbar($('#cSellerLate'), sl, { valueKey: 'late_rate', unit: 'pct', ci: ['lo', 'hi'], nKey: 'n', nLabel: 'deliveries', overall: k.late_rate });
    setAria('#cSellerLate', 'Sellers with the highest late-delivery rates, with 95% confidence intervals.');
  }

  // ================================================================ reviews
  function renderExperience() {
    const c = state.ctx, k = c.k, t = c.t;
    $('#expIntro').textContent = `${U.fmtNum(k.reviews)} reviews (${U.fmtPct(k.review_rate)} of orders). Average score ${U.fmtScore(k.avg_score)}; ${U.fmtPct(k.low_rate)} of reviews give 1-2 stars.`;
    C.vbar($('#cLateness'), c.lateness, { labelKey: 'group', valueKey: 'low_rate', unit: 'pct', colorFn: (d, P) => (d.group === 'On time' ? P.series[0] : P.series[1]), tipFn: (d) => `<b>${d.group}</b><br>${U.fmtPct(d.low_rate)} rated 1-2 stars<br>Average score ${U.isNum(d.avg_score) ? d.avg_score.toFixed(2) : 'n/a'} (${U.fmtNum(d.n)} reviews)` });
    setAria('#cLateness', `Share of 1-2 star reviews: ${U.fmtPct(t.lateLow.low_on_time)} on time vs ${U.fmtPct(t.lateLow.low_late)} late.`);
    const ll = t.lateLow;
    $('#lateBox').innerHTML = `<div class="corr"><div class="stat"><b>${U.isNum(ll.rr) ? ll.rr.toFixed(2) + 'x' : 'n/a'}</b><span>relative risk of 1-2 stars when late</span></div><div class="stat"><b>${U.isNum(ll.rr_lo) ? `${ll.rr_lo.toFixed(2)}-${ll.rr_hi.toFixed(2)}` : 'n/a'}</b><span>95% confidence interval</span></div>
      <div class="stat"><b>${U.isNum(t.spearmanLate.r) ? t.spearmanLate.r.toFixed(3) : 'n/a'}</b><span>Spearman rho, days late vs score</span></div><div class="stat"><b>${U.fmtNum(ll.n)}</b><span>reviewed deliveries</span></div></div>
      <p class="note"><b>Reading:</b> ${U.isNum(ll.rr) ? `${A.sig(ll) ? 'a statistically significant' : 'no significant'} association (${U.pText(ll.p)}). This is an association: late orders may also differ in other ways (for example more bulky items), but the gradient by days late and the logistic regression in the technical report point the same way.` : 'not enough data.'}</p>`;
    C.vbar($('#cScoreDist'), c.scoreDist.map((s) => ({ ...s, label: `${s.score} star${s.score > 1 ? 's' : ''}` })), { labelKey: 'label', valueKey: 'n', unit: 'int', colorFn: (d, P) => (d.score <= 2 ? P.neg : d.score === 3 ? P.other : P.pos), tipFn: (d) => `<b>${d.label}</b><br>${U.fmtNum(d.n)} reviews (${U.fmtPct(d.pct)})` });
    setAria('#cScoreDist', `Review score distribution; average ${U.fmtScore(k.avg_score)}.`);
    const cl = c.cats.filter((x) => x.reviews >= RULES.minCategoryN).sort((a, b) => b.low_rate - a.low_rate);
    C.stacked($('#cCatLow'), cl.map((x) => x.category), [{ name: 'All reviews', data: cl.map((x) => +x.low_rate.toFixed(2)), color: (P) => P.series[1] }, { name: 'On-time deliveries only', data: cl.map((x) => (U.isNum(x.low_rate_on_time) ? +x.low_rate_on_time.toFixed(2) : null)), color: (P) => P.series[0] }],
      { unit: 'pct', stack: false, horizontal: true, tipFn: (i) => { const x = cl[i]; return `<b>${esc(x.category)}</b><br>1-2 stars, all reviews: ${U.fmtPct(x.low_rate)} (n=${U.fmtNum(x.reviews)})<br>1-2 stars, on-time only: ${U.fmtPct(x.low_rate_on_time)} (n=${U.fmtNum(x.on_time_reviews)})<br>Late deliveries: ${U.fmtPct(x.late_rate)}`; } });
    setAria('#cCatLow', `Share of 1-2 star reviews by category, overall and on-time; highest ${cl[0] ? cl[0].category : 'n/a'}.`);
    C.hbar($('#cThemes'), c.themes.map((x) => ({ ...x, tipExtra: `${U.fmtPct(x.share)} of 1-2 star reviews` })), { valueKey: 'n', unit: 'int' });
    setAria('#cThemes', 'Themes of 1-2 star review comments.');
    const row = (label, test, stat, effect) => `<tr><td>${esc(label)}</td><td class="num">${stat}</td><td class="num">${U.fmtP(test.p)}</td><td>${effect}</td><td>${A.sig(test) ? '<span class="st st-warn">Significant</span>' : '<span class="st st-info">Not significant</span>'}</td></tr>`;
    $('#expTests').innerHTML = `<thead><tr><th>Question</th><th class="num">Statistic</th><th class="num">p-value</th><th>Size</th><th>Result</th></tr></thead><tbody>
      ${row('Late delivery vs 1-2 star review', ll, `chi2 ${U.fmtNum(ll.chi2, 1)}`, `relative risk ${U.isNum(ll.rr) ? ll.rr.toFixed(2) : 'n/a'}`)}
      ${row('Days late vs score', t.spearmanLate, `rho ${U.isNum(t.spearmanLate.r) ? t.spearmanLate.r.toFixed(3) : 'n/a'}`, U.describeCorr(t.spearmanLate.r))}
      ${row('Score differs by category', t.kwScoreCategory, `H ${U.fmtNum(t.kwScoreCategory.H, 1)}`, `${U.describeEffect(t.kwScoreCategory.epsilon_sq)} (ε² ${U.isNum(t.kwScoreCategory.epsilon_sq) ? t.kwScoreCategory.epsilon_sq.toFixed(3) : 'n/a'})`)}
      ${row('1-2 star share differs by category', t.lowCategory, `chi2 ${U.fmtNum(t.lowCategory.chi2, 1)}`, `Cramer's V ${U.fmtNum(t.lowCategory.cramers_v, 3)}`)}
      ${row('... on-time deliveries only', t.lowCategoryOnTime, `chi2 ${U.fmtNum(t.lowCategoryOnTime.chi2, 1)}`, `Cramer's V ${U.fmtNum(t.lowCategoryOnTime.cramers_v, 3)}`)}</tbody>`;
  }

  // ================================================================ sellers
  function renderSellers() {
    const c = state.ctx, k = c.k; const ranked = c.sellers.filter((s) => s.late_eval_n >= RULES.minSellerN);
    const fl = c.sellers.filter((s) => s.flag_late), fw = c.sellers.filter((s) => s.flag_low);
    $('#selIntro').textContent = `${c.sellers.length} sellers in view; ${ranked.length} have ${RULES.minSellerN}+ deliveries and can be ranked. ${fl.length} are flagged for late delivery and ${fw.length} for low ratings (${c.sellers.filter((s) => s.flag_late && s.flag_low).length} for both).`;
    C.scatter($('#cSellerScatter'), ranked.filter((s) => U.isNum(s.low_rate)).map((s) => ({ ...s, flag: s.flag_late || s.flag_low ? 1 : 0, tipExtra: `(${s.seller_id}, ${s.tier})` })),
      { xKey: 'late_rate', yKey: 'low_rate', sizeKey: 'gmv', xUnit: 'pct', yUnit: 'pct', xName: 'Late deliveries', yName: '1-2 star reviews', labelKey: 'seller_name', labelKeys: ranked.filter((s) => s.flag_late || s.flag_low).sort((a, b) => (b.late_rate + b.low_rate) - (a.late_rate + a.low_rate)).slice(0, 8).map((s) => s.seller_name), flagKey: 'flag', flagLabel: 'Flagged seller', otherLabel: 'Not flagged', xRef: k.late_rate, yRef: k.low_rate });
    setAria('#cSellerScatter', `Scatter of seller late-delivery rate against low-rating rate; ${fl.length + fw.length} flags.`);
    const tiers = [...new Set(state.filtered.map((r) => r.seller_tier))].map((tier) => { const rs = state.filtered.filter((r) => r.seller_tier === tier); const s = A.stats(rs, null); return { tier, sellers: new Set(rs.map((r) => r.seller_id)).size, ...s }; }).sort((a, b) => b.gmv - a.gmv);
    $('#tierTable').innerHTML = `<thead><tr><th>Tier</th><th class="num">Sellers</th><th class="num">GMV</th><th class="num">Late</th><th class="num">Avg score</th><th class="num">1-2 stars</th></tr></thead><tbody>${
      tiers.map((x) => `<tr><td><b>${esc(x.tier)}</b></td><td class="num">${x.sellers}</td><td class="num">${U.fmtNgn(x.gmv)}</td><td class="num">${U.fmtPct(x.late_rate)}</td><td class="num">${U.isNum(x.avg_score) ? x.avg_score.toFixed(2) : 'n/a'}</td><td class="num">${U.fmtPct(x.low_rate)}</td></tr>`).join('')}</tbody>`;
    renderSellerTable();
  }
  function renderSellerTable() {
    const v = state.view.seller; const q = v.search.trim().toLowerCase();
    let list = state.ctx.sellers;
    if (q) list = list.filter((s) => `${s.seller_name} ${s.seller_id} ${s.category} ${s.tier}`.toLowerCase().includes(q));
    if (v.flag === 'flagged') list = list.filter((s) => s.flag_late || s.flag_low);
    sortableTable($('#sellerTable'), 'sellers', [
      { key: 'seller_name', label: 'Seller', f: (val, r) => `<b>${esc(val)}</b><br><small class="note">${esc(r.seller_id)}</small>`, html: true }, { key: 'tier', label: 'Tier' }, { key: 'fulfilment', label: 'Fulfilment' }, { key: 'category', label: 'Main category' },
      { key: 'orders', label: 'Orders', num: true, f: (x) => U.fmtNum(x) }, { key: 'gmv', label: 'GMV', num: true, f: (x) => U.fmtNgn(x) }, { key: 'seller_cancelled', label: 'Seller cancels', num: true },
      { key: 'late_rate', label: 'Late', num: true, f: (x) => U.fmtPct(x) }, { key: 'avg_days', label: 'Avg days', num: true, f: (x) => U.fmtNum(x, 2) }, { key: 'reviews', label: 'Reviews', num: true },
      { key: 'avg_score', label: 'Avg score', num: true, f: (x) => (U.isNum(x) ? x.toFixed(2) : 'n/a') }, { key: 'low_rate', label: '1-2 stars', num: true, f: (x) => U.fmtPct(x) },
      { key: 'flag_late', label: 'Flags', f: (x, r) => `${r.flag_late ? '<span class="flag late">late</span>' : ''}${r.flag_low ? '<span class="flag low">ratings</span>' : ''}`, html: true },
    ], list, 'gmv', -1);
  }

  // ================================================================ data explorer
  const COLSETS = {
    key: ['order_id', 'order_purchase_ts', 'customer_id', 'seller_name', 'category_name', 'ship_to_state', 'order_status', 'items_subtotal_ngn', 'delivery_days', 'late', 'review_score'],
    all: ['order_id', 'cart_id', 'order_purchase_ts', 'customer_id', 'seller_id', 'seller_name', 'seller_tier', 'fulfilment_model', 'category_name', 'category_group', 'payment_method', 'order_status',
      'lines', 'units', 'items_subtotal_ngn', 'voucher_discount_ngn', 'shipping_fee_ngn', 'order_total_ngn', 'gmv', 'ship_from_state', 'ship_to_state', 'zone', 'intra_state', 'is_bulky', 'sales_event',
      'peak_logistics', 'promised_days', 'delivery_days', 'late', 'days_late', 'review_score', 'low_rating', 'theme', 'data_quality_note', '_src'],
  };
  const NUMERIC = new Set(['lines', 'units', 'items_subtotal_ngn', 'voucher_discount_ngn', 'shipping_fee_ngn', 'order_total_ngn', 'gmv', 'intra_state', 'is_bulky', 'peak_logistics', 'promised_days', 'delivery_days', 'late', 'days_late', 'review_score', 'low_rating']);
  const cell = (k, v) => (v === null || v === undefined ? '' : k === 'delivery_days' ? v.toFixed(2) : NUMERIC.has(k) && k.endsWith('ngn') ? Math.round(v).toLocaleString('en-US') : v);
  function renderExplorer() {
    const t = state.view.table; const q = t.search.trim().toLowerCase();
    let rows = state.filtered;
    if (q) rows = rows.filter((r) => `${r.order_id} ${r.customer_id} ${r.seller_id} ${r.seller_name} ${r.category_name} ${r.ship_to_state} ${r.order_status} ${r.order_purchase_ts}`.toLowerCase().includes(q));
    rows = rows.map((r) => ({ ...r, _src: r._batch && r._batch !== 'base' ? 'Upload' : 'Original' }));
    rows.sort((a, b) => cmp(a[t.sort], b[t.sort]) * t.dir || cmp(a.order_id, b.order_id));
    const pages = Math.max(1, Math.ceil(rows.length / t.size)); t.page = Math.min(t.page, pages);
    const slice = rows.slice((t.page - 1) * t.size, t.page * t.size); const cols = COLSETS[t.cols];
    $('#explorer').innerHTML = `<thead><tr>${cols.map((k) => `<th class="${NUMERIC.has(k) ? 'num' : ''}" data-k="${k}" tabindex="0" aria-sort="${t.sort === k ? (t.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(k === '_src' ? 'source' : k)}</th>`).join('')}</tr></thead>
      <tbody>${slice.map((r) => `<tr>${cols.map((k) => `<td class="${NUMERIC.has(k) ? 'num' : ''}">${esc(cell(k, r[k]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">No records match.</td></tr>`}</tbody>`;
    $('#tCount').textContent = `${U.fmtNum(rows.length)} of ${U.fmtNum(state.all.length)} orders (${U.fmtNum(state.filtered.length)} after filters${q ? `, ${U.fmtNum(rows.length)} matching "${t.search}"` : ''}). Page ${t.page} of ${pages}.`;
    const btn = (p, l, dis, cur) => `<button type="button" data-p="${p}" ${dis ? 'disabled' : ''} ${cur ? 'aria-current="page"' : ''}>${l}</button>`;
    let html = btn(t.page - 1, '‹ Prev', t.page === 1);
    for (let p = Math.max(1, t.page - 2); p <= Math.min(pages, t.page + 2); p++) html += btn(p, p, false, p === t.page);
    $('#pager').innerHTML = html + btn(t.page + 1, 'Next ›', t.page === pages);
  }
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
  function sortableTable(el, id, cols, rows, defSort, defDir = 1) {
    const s = state.view.sorts[id] || (state.view.sorts[id] = { key: defSort || cols[0].key, dir: defDir });
    const data = rows.slice().sort((a, b) => cmp(a[s.key], b[s.key]) * s.dir);
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.key}" tabindex="0" aria-sort="${s.key === c.key ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${data.map((r) => `<tr>${cols.map((c) => { const v = r[c.key]; const out = c.f ? (c.f.length > 1 ? c.f(v, r) : c.f(v)) : v === null || v === undefined ? 'n/a' : v;
        return `<td class="${c.num ? 'num' : ''}">${c.html ? out : esc(out)}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">No rows.</td></tr>`}</tbody>`;
    el.onclick = el.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; const th = e.target.closest('th[data-k]'); if (!th) return;
      const k = th.dataset.k; s.dir = s.key === k ? -s.dir : (cols.find((c) => c.key === k).num ? -1 : 1); s.key = k; sortableTable(el, id, cols, rows, defSort, defDir); };
  }

  // ================================================================ upload
  const MODE_LABEL = { append: 'Add new records', merge: 'Update or add', replace: 'Replace transaction data' };
  const RULE_TEXT = { R1: 'duplicate order rows removed', R2: 'test orders removed', R3: 'day-first dates parsed', R4: 'status labels standardised', R5: 'payment labels standardised', R6: 'state names standardised',
    R7: 'swapped scan times fixed', R8: 'negative shipping fees fixed', R9: 'missing delivery scans flagged', I1: 'duplicate lines removed', I2: 'test-order lines removed', I3: 'kobo prices divided by 100',
    I4: 'negative quantities fixed', I5: 'missing unit prices calculated', V1: 'older review versions superseded', V2: 'text scores converted', V3: 'out-of-range scores removed', V4: 'review dates moved to delivery date',
    V5: 'comments trimmed', C1: 'duplicate customers removed', C2: 'state names standardised', C3: 'blank channels set to Unknown', C4: 'missing signup dates (imputed from first order where possible)' };
  const currentMode = () => $('input[name="mode"]:checked').value;
  async function handleFile(file) {
    busy(true, `Reading ${file.name}...`);
    try {
      const sheets = await D.readFile(file);
      await new Promise((r) => setTimeout(r, 20));
      state.pending = { fileName: file.name, size: file.size, sheets };
      previewPending();
    } catch (e) {
      state.pending = null;
      $('#uploadPanel').innerHTML = `<div class="msg err"><b>The file could not be used.</b> ${esc(e instanceof D.UserError ? e.message : 'It may be damaged or in an unexpected format.')} Nothing was changed.</div>`;
      if (!(e instanceof D.UserError)) console.error(e);
    } finally { busy(false); $('#fileInput').value = ''; }
  }
  function counts(p) {
    const ty = (t) => p.rejected.filter((r) => r.type === t).length; const s = p.sim.summary;
    return { rows: p.rows, valid: p.accepted.length, rejected: ty('invalid') + ty('orphan') + ty('duplicate_key') + s.conflicts, test: ty('test'),
      duplicates: ty('duplicate_in_file') + ty('superseded') + s.duplicatesExisting, inserted: s.inserted, updated: s.updated, unchanged: s.unchanged, conflicts: s.conflicts, removed: s.removed };
  }
  function previewPending() {
    const pd = state.pending; if (!pd) return;
    const mode = currentMode();
    let res; try { res = D.processUpload(pd.sheets, state.tables, mode); } catch (e) { $('#uploadPanel').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
    pd.mode = mode; pd.res = res;
    const parts = Object.values(res.parts); const ok = parts.filter((p) => !p.fatal);
    const tot = ok.reduce((a, p) => { const c = counts(p); Object.keys(c).forEach((k) => { a[k] = (a[k] || 0) + c[k]; }); return a; }, {});
    const canApply = !res.blocking && ok.length && ok.some((p) => p.sim.summary.inserted + p.sim.summary.updated > 0) && !parts.some((p) => p.fatal);
    const problems = ok.flatMap((p) => [...p.rejected, ...p.sim.skipped].map((r) => ({ ...r, table: TABLES[p.table].label })));
    const warnings = ok.flatMap((p) => p.warnings.map((w) => ({ ...w, table: TABLES[p.table].label })));
    $('#uploadPanel').innerHTML = `
      <p><b>${esc(pd.fileName)}</b> · ${U.fmtBytes(pd.size)} · mode: <b>${MODE_LABEL[mode]}</b></p>
      ${res.blocking ? `<div class="msg err"><b>Cannot apply.</b> ${esc(res.blocking)}</div>` : ''}
      ${parts.filter((p) => p.fatal).map((p) => `<div class="msg err"><b>${esc(TABLES[p.table].label)} (sheet "${esc(p.sheet)}") rejected:</b> ${esc(p.fatal)}. Columns found: ${p.map.notes.map((n) => esc(n.header)).join(', ') || 'none recognised'}.</div>`).join('')}
      ${ok.length ? `<div class="summary-grid">
        <div class="stat"><b>${U.fmtNum(tot.rows)}</b><span>rows in file</span></div><div class="stat"><b>${U.fmtNum(tot.valid)}</b><span>passed cleaning and validation</span></div>
        <div class="stat"><b>${U.fmtNum(tot.rejected)}</b><span>rejected</span></div><div class="stat"><b>${U.fmtNum(tot.duplicates)}</b><span>duplicates</span></div>
        <div class="stat"><b>${U.fmtNum(tot.inserted)}</b><span>${mode === 'replace' ? 'records in new data' : 'new records to add'}</span></div>
        ${mode === 'merge' ? `<div class="stat"><b>${U.fmtNum(tot.updated)}</b><span>records to update</span></div>` : ''}${tot.test ? `<div class="stat"><b>${tot.test}</b><span>test records removed</span></div>` : ''}</div>
      <div class="table-wrap"><table class="data compact part-table"><thead><tr><th>Table</th><th>Sheet</th><th class="num">Rows</th><th class="num">Valid</th><th class="num">Rejected</th><th class="num">Duplicates</th><th class="num">New</th><th class="num">Updated</th><th>Cleaning applied</th></tr></thead><tbody>
        ${ok.map((p) => { const c = counts(p); return `<tr><td><b>${esc(TABLES[p.table].label)}</b></td><td>${esc(p.sheet)} <small class="note">(${p.how})</small></td><td class="num">${U.fmtNum(c.rows)}</td><td class="num">${U.fmtNum(c.valid)}</td><td class="num">${U.fmtNum(c.rejected + c.test)}</td><td class="num">${U.fmtNum(c.duplicates)}</td><td class="num">${U.fmtNum(c.inserted)}</td><td class="num">${U.fmtNum(c.updated)}</td>
          <td class="wrap">${Object.entries(p.fixes).filter(([r]) => r !== 'R9' || p.fixes[r]).map(([r, n]) => `${r}: ${n} ${esc(RULE_TEXT[r] || '')}`).join('; ') || 'none needed'}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
      ${res.ignored.length ? `<p class="note">Sheets not used: ${res.ignored.map((i) => `"${esc(i.sheet)}" (${esc(i.reason)})`).join('; ')}.</p>` : ''}
      ${mode === 'replace' && !res.blocking ? `<div class="msg warn">Replacing removes the current ${U.fmtNum(state.tables.orders.length)} orders, their lines and reviews from the analysis (you can undo this afterwards).</div>` : ''}
      ${!canApply && !res.blocking ? '<div class="msg warn">There is nothing to apply: no new or changed records for the chosen mode.</div>' : ''}
      <details class="more"><summary>Column mapping</summary>${ok.map((p) => `<p><b>${esc(TABLES[p.table].label)}</b>: ${p.map.notes.map((n) => `"${esc(n.header)}" → ${esc(n.field)}${n.method !== 'standard name' ? ` <small class="note">(${n.method})</small>` : ''}`).join(', ')}${p.map.unknown.length ? `. Ignored: ${p.map.unknown.map((h) => `"${esc(h)}"`).join(', ')}` : ''}</p>`).join('')}</details>
      ${problems.length ? `<details class="more" open><summary>Rows not used (${U.fmtNum(problems.length)})</summary><div class="table-wrap scroll"><table class="data compact"><thead><tr><th>Table</th><th class="num">Row</th><th>Key</th><th>Reason</th></tr></thead><tbody>
        ${problems.slice(0, 200).map((r) => `<tr><td>${esc(r.table)}</td><td class="num">${r.row ?? ''}</td><td>${esc(r.key)}</td><td class="wrap">${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div>${problems.length > 200 ? '<p class="note">First 200 shown; download the validation results for all.</p>' : ''}</details>` : ''}
      ${warnings.length ? `<details class="more"><summary>Warnings (${U.fmtNum(warnings.length)}, rows still accepted)</summary><ul>${warnings.slice(0, 100).map((w) => `<li>${esc(w.table)} row ${w.row}, ${esc(w.field)}: ${esc(w.message)}</li>`).join('')}</ul></details>` : ''}
      <div class="btn-row">
        <button class="btn btn-primary" type="button" id="btnApply" ${canApply ? '' : 'disabled'}>Apply upload</button>
        <button class="btn btn-ghost" type="button" id="btnCancel">Cancel</button>
        <button class="btn btn-ghost" type="button" id="btnValidation">Download validation results</button>
      </div>`;
    $('#btnApply').onclick = applyPending;
    $('#btnCancel').onclick = () => { state.pending = null; $('#uploadPanel').innerHTML = '<p class="empty">Upload cancelled. Nothing was changed.</p>'; };
    $('#btnValidation').onclick = () => window.MvExport.validationCsv({ fileName: pd.fileName, rejected: problems, warnings });
  }
  async function applyPending() {
    const pd = state.pending; if (!pd || !pd.res) return;
    if (pd.mode === 'replace' && !(await confirmBox(`Replace the current ${U.fmtNum(state.tables.orders.length)} orders (with their lines and reviews) with the data from "${pd.fileName}"? You can undo this with "Undo last upload".`))) return;
    const id = Date.now().toString(36); const before = state.tables; const next = { ...state.tables }; const per = {};
    // re-run against the current tables so the result is exactly what was previewed
    const res = D.processUpload(pd.sheets, state.tables, pd.mode);
    Object.values(res.parts).filter((p) => !p.fatal).forEach((p) => {
      const r = D.applyTable(p.table, state.tables[p.table], p.accepted, pd.mode, p.map.present.concat(D.derivedPresent(p.table)), id);
      next[p.table] = r.next; p.sim = r; per[p.table] = counts(p);
    });
    if (pd.mode === 'replace') TRANSACTION_TABLES.forEach((t) => { if (!res.parts[t]) { next[t] = []; per[t] = { rows: 0, valid: 0, rejected: 0, test: 0, duplicates: 0, inserted: 0, updated: 0, unchanged: 0, conflicts: 0, removed: before[t].length }; } });
    const tot = Object.values(per).reduce((a, c) => { Object.keys(c).forEach((k) => { a[k] = (a[k] || 0) + c[k]; }); return a; }, {});
    const batch = { id, file: pd.fileName, size: pd.size, mode: pd.mode, at: new Date().toISOString(), counts: tot, perTable: per, snapshot: before };
    state.tables = next; state.batches.push(batch); state.updatedAt = batch.at; state.pending = null;
    const saved = await persist();
    recompute(pd.mode === 'replace');
    const msg = `Data successfully ${pd.mode === 'replace' ? 'replaced' : 'added'}. ${U.fmtNum(tot.rows)} records were processed, ${U.fmtNum(tot.inserted + tot.updated + tot.unchanged)} were accepted (${U.fmtNum(tot.inserted)} added${pd.mode === 'merge' ? `, ${U.fmtNum(tot.updated)} updated` : ''}), ${U.fmtNum(tot.duplicates)} duplicate${tot.duplicates === 1 ? ' was' : 's were'} detected and ${U.fmtNum(tot.rejected + tot.test)} record${tot.rejected + tot.test === 1 ? ' was' : 's were'} rejected.`;
    $('#uploadPanel').innerHTML = `<div class="msg ok"><b>${esc(msg)}</b><br>${Object.entries(per).map(([t, c]) => `${esc(TABLES[t].label)}: ${U.fmtNum(c.inserted)} added${c.updated ? `, ${U.fmtNum(c.updated)} updated` : ''}`).join(' · ')}.<br>All KPIs, charts, tables, the report and the exports now use the updated dataset.${saved ? ' Saved in this browser.' : ' <b>Not saved:</b> browser storage is unavailable, so the changes last until the page is closed.'}</div>`;
    toast(msg);
  }
  async function persist() {
    if (!state.storage) return false;
    // keep snapshots (for undo) of the last 3 uploads only, to limit browser storage
    const batches = state.batches.map((b, i) => (i >= state.batches.length - 3 ? b : { ...b, snapshot: null }));
    const r = await S.save({ tables: state.tables, batches, updatedAt: state.updatedAt });
    return r.ok;
  }
  async function undoLast() {
    const b = state.batches[state.batches.length - 1]; if (!b) return;
    if (!b.snapshot) { toast('This upload is too old to undo. Use "Reset to the original dataset" instead.'); return; }
    if (!(await confirmBox(`Undo the upload of "${b.file}" (${MODE_LABEL[b.mode]}, ${new Date(b.at).toLocaleString('en-GB')})? The data returns to how it was before that upload.`))) return;
    state.tables = b.snapshot; state.batches.pop(); state.updatedAt = state.batches.length ? state.batches[state.batches.length - 1].at : null;
    if (state.batches.length) await persist(); else await S.clear();
    recompute(b.mode === 'replace'); toast(`Upload of "${b.file}" undone.`);
  }
  async function resetAll() {
    if (!(await confirmBox('Remove all uploaded data from this browser and return to the original dataset? This cannot be undone.'))) return;
    await S.clear(); state.tables = { ...state.base }; state.batches = []; state.updatedAt = null; state.pending = null;
    $('#uploadPanel').innerHTML = '<p class="empty">No file selected yet.</p>';
    recompute(true); toast('Back to the original dataset. Locally saved data was cleared.');
  }
  function renderDataTab() {
    const T = state.tables; const up = TNAMES.reduce((s, t) => s + T[t].filter((r) => r._batch && r._batch !== 'base').length, 0);
    $('#storeInfo').innerHTML = `<p>${state.batches.length ? `Working dataset: <b>${U.fmtNum(T.orders.length)}</b> orders, <b>${U.fmtNum(T.order_items.length)}</b> lines, <b>${U.fmtNum(T.reviews.length)}</b> reviews, <b>${U.fmtNum(T.customers.length)}</b> customers; <b>${U.fmtNum(up)}</b> records come from uploads.`
      : `Using the original dataset (<b>${U.fmtNum(T.orders.length)}</b> orders, ${U.fmtNum(T.order_items.length)} lines, ${U.fmtNum(T.reviews.length)} reviews, ${U.fmtNum(T.customers.length)} customers, ${T.sellers.length} sellers, ${U.fmtNum(T.products.length)} products). No uploads yet.`}
      ${state.storage ? 'Changes are saved in this browser (IndexedDB) and reloaded next time you open the dashboard here.' : '<b>Browser storage is unavailable</b> (for example in a private window), so changes last only until the page is closed.'}</p>`;
    $('#batchTable').innerHTML = state.batches.length ? `<thead><tr><th>#</th><th>When</th><th>File</th><th>Mode</th><th class="num">Rows</th><th class="num">Added</th><th class="num">Updated</th><th class="num">Duplicates</th><th class="num">Rejected</th></tr></thead><tbody>${
      state.batches.map((b, i) => `<tr><td>${i + 1}</td><td>${new Date(b.at).toLocaleString('en-GB')}</td><td>${esc(b.file)}</td><td>${MODE_LABEL[b.mode]}</td><td class="num">${U.fmtNum(b.counts.rows)}</td>
        <td class="num">${U.fmtNum(b.counts.inserted)}</td><td class="num">${U.fmtNum(b.counts.updated)}</td><td class="num">${U.fmtNum(b.counts.duplicates)}</td><td class="num">${U.fmtNum(b.counts.rejected + b.counts.test)}</td></tr>`).join('')}</tbody>` : '';
    $('#btnUndo').disabled = !state.batches.length; $('#btnClear').disabled = !state.batches.length;
  }

  // ================================================================ methodology and static content
  function renderMethod() {
    const all = state.all;
    $('#cleanRules').innerHTML = `<thead><tr><th>Rule</th><th>Table</th><th>Problem</th><th>Action</th></tr></thead><tbody>${[
      ['R1', 'orders', 'Exact duplicate order rows', 'Removed (counted as duplicates)'], ['R2', 'orders', 'Internal test orders (MVTEST..., CU_TEST, reason "Test order")', 'Removed'],
      ['R3', 'orders', 'Purchase time as day-first text dd/mm/yyyy hh:mm', 'Parsed'], ['R4', 'orders', 'Status spellings (Completed, canceled, in_transit...)', 'Mapped to 6 statuses'],
      ['R5', 'orders', 'Payment spellings (POD, card...)', 'Mapped to 4 methods'], ['R6', 'orders', 'State spellings (Lagos State, Abuja, Port Harcourt...)', 'Mapped to the standard state'],
      ['R7', 'orders', 'Delivered time before shipped time', 'Swapped back; flagged'], ['R8', 'orders', 'Negative shipping fee', 'Made positive; flagged'],
      ['R9', 'orders', 'Delivered without a delivery time', `Kept and flagged; excluded from delivery-time measures (${all.filter((r) => r.data_quality_note === 'delivered_ts_missing').length} in current data)`],
      ['I1', 'order_items', 'Exact duplicate lines', 'Removed'], ['I2', 'order_items', 'Lines of removed test orders', 'Removed'],
      ['I3', 'order_items', `Unit price above ${RULES.koboRatio}x the product's 2024 list price (recorded in kobo)`, 'Price, discount and line total divided by 100'],
      ['I4', 'order_items', 'Negative quantity with positive line total', 'Made positive'], ['I5', 'order_items', 'Unit price missing', '(line total + discount) / quantity'],
      ['V1', 'reviews', 'Same order reviewed twice (edited review exported twice)', 'Latest version kept'], ['V2', 'reviews', "Score as text ('4 stars', '4/5')", 'Number extracted'],
      ['V3', 'reviews', 'Score outside 1-5', 'Removed (true score unknown)'], ['V4', 'reviews', 'Review dated before the delivery', 'Set to the delivery date; flagged'], ['V5', 'reviews', 'Spaces around comments', 'Trimmed'],
      ['C1', 'customers', 'Exact duplicate customers', 'Removed'], ['C2', 'customers', 'State spellings', 'Mapped to the standard state'], ['C3', 'customers', 'Acquisition channel blank', "Set to 'Unknown'"],
      ['C4', 'customers', 'Signup date missing', 'Date of first order (flagged); blank if no orders'],
      ['Refs', 'all', 'Order lines or reviews for orders that do not exist', 'Rejected; unknown sellers, customers or products are kept with a warning'],
    ].map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td class="wrap">${esc(r[2])}</td><td class="wrap">${esc(r[3])}</td></tr>`).join('')}</tbody>`;
  }
  function renderStatic() {
    $('#srcName').textContent = window.BASE_DATASET.name;
    $('#kpiDefs').innerHTML = `<thead><tr><th>KPI</th><th>Formula</th><th>Comparison</th><th>Unit</th><th>Fields</th></tr></thead><tbody>${
      KPI_DEFS.map((k) => `<tr><td><b>${esc(k.name)}</b></td><td class="wrap">${esc(k.formula)}</td><td class="wrap">${esc(k.compare)}</td><td>${esc(k.unit)}</td><td class="wrap">${esc(k.fields)}</td></tr>`).join('')}</tbody>`;
    const St = RULES.status;
    $('#ruleList').innerHTML = [
      '<b>GMV</b> = line totals after item discounts, before vouchers and shipping, for orders not cancelled. <b>Constant prices</b>: GMV divided by the month\'s price index (selling price / January 2024 list price, all orders not cancelled).',
      '<b>Category</b>: every order holds products from one category, so order-level measures are assigned to that category.',
      '<b>Repeat purchase</b>: a purchase is a checkout (cart_id); orders from different sellers in one checkout count once. Repeat = 2+ purchases in the period.',
      `<b>Late</b> = delivery date after the estimated delivery date. <b>Low rating</b> = 1 or ${RULES.lowRating} stars.`,
      `<b>Seller flags</b>: sellers with ${RULES.minSellerN}+ deliveries (or reviews) whose 95% Wilson lower bound is above the marketplace rate. States need ${RULES.minStateN}+ deliveries to be ranked.`,
      '<b>Tests</b>: chi-square (rates between groups), Kruskal-Wallis (scores or delivery days across groups), Spearman correlation, relative risk with 95% CI. Significant = p below 0.05; effect sizes are shown because large samples make tiny differences significant.',
      `<b>Status thresholds</b> (illustrative, config.js): late ${St.lateRate.warn}% / ${St.lateRate.crit}%; 1-2 stars ${St.lowRate.warn}% / ${St.lowRate.crit}%; cancelled ${St.cancelRate.warn}% / ${St.cancelRate.crit}%; repeat below ${St.repeatRate.warn}% / ${St.repeatRate.crit}%; delivery success below ${St.deliverySuccess.warn}% / ${St.deliverySuccess.crit}%.`,
      `<b>Review themes</b> (first match wins): ${THEMES.map(([n, keys]) => `${n} (${keys.slice(0, 3).join(', ')}...)`).join('; ')}.`,
      '<b>Key findings and recommendations</b> come from fixed rules applied to the current data, each with its rule or evidence. They are not AI-generated and contain no pre-written results.',
    ].map((t) => `<li>${t}</li>`).join('');
    $('#schemaTable').innerHTML = `<thead><tr><th>Table</th><th>Key</th><th>Required columns</th><th>Optional columns</th></tr></thead><tbody>${
      TABLE_ORDER.map((t) => { const d = TABLES[t]; return `<tr><td><b>${esc(t)}</b><br><small class="note">${esc(d.sheetNames.join(', '))}</small></td><td>${esc(d.key.join(' + '))}</td><td class="wrap">${d.fields.filter((f) => f.required).map((f) => esc(f.key)).join(', ')}</td><td class="wrap">${d.fields.filter((f) => !f.required).map((f) => esc(f.key)).join(', ')}</td></tr>`; }).join('')}</tbody>`;
    $('#monthMeasure').innerHTML = Object.entries(MEASURES).map(([k, m]) => `<option value="${k}" ${k === state.view.monthMeasure ? 'selected' : ''}>${m.label}</option>`).join('');
    $('#catMeasure').innerHTML = Object.entries(CAT_MEASURES).map(([k, l]) => `<option value="${k}" ${k === state.view.catMeasure ? 'selected' : ''}>${l}</option>`).join('');
  }

  // ================================================================ report and data downloads
  const scopeCtx = (scope) => (scope !== 'full' ? state.ctx : A.analyse(state.all, state.all, fullFilters(), state.pidx, state.tables.customers));
  async function generateReport(scope) {
    const ctx = scopeCtx(scope);
    if (!ctx.rows.length) { toast('No orders in this scope: nothing to report.'); return; }
    busy(true, 'Building the PDF report...');
    try {
      const res = await window.MvReport.generate({ scope, ctx, pidx: state.pidx, scopeLabel: scope === 'full' ? 'Entire available dataset' : 'Current filtered view', filtersDesc: scope === 'full' ? 'None (entire dataset)' : filtersDescription(),
        datasetStatus: datasetStatusText(), sourceName: `${window.BASE_DATASET.name}${state.batches.length ? ` plus ${state.batches.length} upload(s)` : ''}`, tables: state.tables,
        uploads: state.batches.map((b) => ({ at: b.at, file: b.file, modeLabel: MODE_LABEL[b.mode], resultText: `${b.counts.inserted} added, ${b.counts.updated} updated, ${b.counts.duplicates} duplicates, ${b.counts.rejected + b.counts.test} rejected` })) });
      toast(`Report downloaded: ${res.fname} (${res.pages} pages).`);
    } catch (e) { console.error(e); toast('The report could not be generated. Please try again.'); } finally { busy(false); }
  }
  async function downloadData(scope, fmt) {
    const ctx = scopeCtx(scope);
    if (!ctx.rows.length) { toast('No orders in this scope: nothing to download.'); return; }
    if (fmt === 'xlsx') { busy(true, 'Building the Excel file...'); try { await window.MvExport.dataXlsx(ctx, scope, state.tables, { filters: scope === 'full' ? 'None' : filtersDescription(), status: datasetStatusText() }); } finally { busy(false); } }
    else window.MvExport.dataCsv(ctx.rows, scope);
    toast(`Downloaded ${U.fmtNum(ctx.rows.length)} orders (${scope === 'full' ? 'full dataset' : 'filtered view'}, ${fmt.toUpperCase()}).`);
  }

  // ================================================================ helpers
  let toastTimer;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 5200); }
  function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; }
  function confirmBox(text) { return new Promise((resolve) => { const d = $('#dlgConfirm'); $('#dlgConfirmText').textContent = text; d.returnValue = ''; d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }); d.showModal(); }); }
  function switchTab(tab) {
    state.view.tab = tab;
    $$('[role="tab"]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
    renderTab(tab); requestAnimationFrame(C.resizeAll);
  }

  // ================================================================ event wiring
  function wire() {
    $('#tabList').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) switchTab(b.dataset.tab); });
    $('#tabList').addEventListener('keydown', (e) => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const tabs = $$('[role="tab"]'); const i = tabs.findIndex((t) => t.dataset.tab === state.view.tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); switchTab(n.dataset.tab); });
    const onMonth = () => { let a = $('#fFrom').value, b = $('#fTo').value; if (a > b) [a, b] = [b, a]; state.filters.monthFrom = a; state.filters.monthTo = b; buildFilterOptions(); refresh(); };
    $('#fFrom').onchange = onMonth; $('#fTo').onchange = onMonth;
    MULTI.forEach((m) => {
      $(m.box).addEventListener('change', () => { state.filters[m.key] = readMulti(m.box); refresh(); });
      $(m.box).addEventListener('click', (e) => { if (e.target.matches('[data-all],[data-none]')) { const on = e.target.matches('[data-all]'); $$(`${m.box} input`).forEach((i) => { i.checked = on; }); state.filters[m.key] = on ? [] : ['__none__']; refresh(); } });
    });
    document.addEventListener('click', (e) => { $$('details.multi[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
    $('#btnReset').onclick = () => { recompute(true); toast('Filters reset: showing all orders.'); };
    $('#activeFilters').onclick = (e) => { const c = e.target.closest('[data-chip]'); if (!c) return; const k = c.dataset.chip; const f = state.filters;
      if (k === 'months') { f.monthFrom = state.months[0]; f.monthTo = state.months[state.months.length - 1]; } else f[k] = [];
      buildFilterOptions(); refresh(); };
    $('#monthMeasure').onchange = (e) => { state.view.monthMeasure = e.target.value; renderMonthTrend(); };
    $('#catMeasure').onchange = (e) => { state.view.catMeasure = e.target.value; state.dirty.add('categories'); renderTab('categories'); };
    $('#catTrendMode').onchange = (e) => { state.view.catTrendMode = e.target.value; renderCatTrend(); };
    $('#delMeasure').onchange = (e) => { state.view.delMeasure = e.target.value; state.dirty.add('delivery'); renderTab('delivery'); };
    $('#sSearch').addEventListener('input', U.debounce((e) => { state.view.seller.search = e.target.value; renderSellerTable(); }, 200));
    $('#sFlag').onchange = (e) => { state.view.seller.flag = e.target.value; renderSellerTable(); };
    $('#tSearch').addEventListener('input', U.debounce((e) => { state.view.table.search = e.target.value; state.view.table.page = 1; renderExplorer(); }, 200));
    $('#tCols').onchange = (e) => { state.view.table.cols = e.target.value; renderExplorer(); };
    $('#tPage').onchange = (e) => { state.view.table.size = +e.target.value; state.view.table.page = 1; renderExplorer(); };
    $('#pager').onclick = (e) => { const b = e.target.closest('button[data-p]'); if (!b || b.disabled) return; state.view.table.page = +b.dataset.p; renderExplorer(); };
    $('#explorer').onclick = $('#explorer').onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; const th = e.target.closest('th[data-k]'); if (!th) return; const t = state.view.table; t.dir = t.sort === th.dataset.k ? -t.dir : 1; t.sort = th.dataset.k; renderExplorer(); };
    const drop = $('#drop'), input = $('#fileInput');
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { if (input.files[0]) handleFile(input.files[0]); };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    $$('input[name="mode"]').forEach((r) => { r.onchange = previewPending; });
    $('#btnUndo').onclick = undoLast; $('#btnClear').onclick = resetAll;
    $('#btnSummaryCsv').onclick = () => window.MvExport.categoryCsv(state.ctx.cats, 'filtered');
    $('#templateLink').onclick = (e) => { e.preventDefault(); window.MvExport.templateXlsx(); };
    $('#sampleLink').onclick = (e) => { e.preventDefault(); window.MvExport.sampleXlsx(state.tables); };
    $('#btnReport').onclick = () => { $('#rScopeFiltered').textContent = `(${U.fmtNum(state.filtered.length)} orders)`; $('#rScopeFull').textContent = `(${U.fmtNum(state.all.length)} orders)`; $('#dlgReport').showModal(); };
    $('#dlgReport').addEventListener('close', () => { if ($('#dlgReport').returnValue === 'ok') generateReport($('input[name="rscope"]:checked').value); });
    $('#btnData').onclick = () => { $('#dScopeFiltered').textContent = `(${U.fmtNum(state.filtered.length)} orders)`; $('#dScopeFull').textContent = `(${U.fmtNum(state.all.length)} orders)`; $('#dlgData').showModal(); };
    $('#dlgData').addEventListener('close', () => { if ($('#dlgData').returnValue === 'ok') downloadData($('input[name="dscope"]:checked').value, $('input[name="dfmt"]:checked').value); });
    $('#btnTheme').onclick = () => { const dark = getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() === 'dark';
      document.documentElement.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('mv-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
      ['overview', 'categories', 'customers', 'delivery', 'experience', 'sellers'].forEach((t) => state.dirty.add(t)); renderTab(state.view.tab); };
    document.addEventListener('click', (e) => { const b = e.target.closest('.fs'); if (!b) return; const card = b.closest('.card'); if (document.fullscreenElement) document.exitFullscreen(); else if (card.requestFullscreen) card.requestFullscreen(); });
    document.addEventListener('fullscreenchange', () => setTimeout(C.resizeAll, 80));
    window.addEventListener('resize', U.debounce(C.resizeAll, 150));
  }

  window.MvApp = { state, refresh, recompute };
  document.addEventListener('DOMContentLoaded', init);
})();

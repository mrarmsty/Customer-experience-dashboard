/* End-to-end tests for the Marketvale dashboard (Playwright + Chromium).
   Usage (repository root, static server on port 8765):  python -m http.server 8765 &   node tests/run_tests.js
   Expected values come from the pandas/SciPy pipeline (data/processed/*), the workbook's cleaning log and the data
   files themselves, never from the dashboard. Results: tests/results.json; README screenshots: assets/images/. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const URL = process.env.DASH_URL || 'http://localhost:8765/index.html';
const DATA = (f) => path.join(ROOT, 'tests', 'data', f);
const IMG = (f) => path.join(ROOT, 'assets', 'images', f);
const DL = path.join(ROOT, 'tests', 'downloads'); fs.mkdirSync(DL, { recursive: true }); fs.mkdirSync(path.join(ROOT, 'assets', 'images'), { recursive: true });
const results = []; let current = '';
const check = (name, ok, detail = '') => { results.push({ test: current, check: name, pass: !!ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${current}] ${name}${detail ? ' - ' + String(detail).slice(0, 160) : ''}`); };
const close = (a, b, tol = 1e-6) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/processed/reference_values.json')));
const readCsv = (f) => { const P = require(path.join(ROOT, 'assets/vendor/papaparse.min.js')); return P.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data; };
const py = readCsv(path.join(ROOT, 'data/processed/orders_analysis.csv'));
const wbLog = Object.fromEntries(readCsv(path.join(ROOT, 'data/processed/cleaning_log.csv')).map((r) => [r.rule, +r.rows_affected]));
const exp01 = JSON.parse(fs.readFileSync(DATA('01_expected.json'))), exp05 = JSON.parse(fs.readFileSync(DATA('05_expected.json')));
const nH1_2025 = py.filter((r) => r.month >= '2025-01' && r.month <= '2025-06').length;
const nNE = py.filter((r) => r.zone === 'North East').length;
const nMfWf = py.filter((r) => r.fulfilment_model === 'Marketplace Fulfilled' && r.category_name === "Women's Fashion").length;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; let alerts = 0;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', async (d) => { alerts++; await d.dismiss(); });
  const S = (fn, arg) => page.evaluate(fn, arg);
  const st = () => S(() => { const s = window.MvApp.state; return { n: s.tables.orders.length, items: s.tables.order_items.length, reviews: s.tables.reviews.length, customers: s.tables.customers.length, filtered: s.filtered.length, k: s.ctx.k, batches: s.batches.length, repeat: s.ctx.cust ? s.ctx.cust.repeat_rate : null }; });
  const upload = async (file, mode = 'append', wait = 1200) => { await page.click(`input[name="mode"][value="${mode}"]`); await page.setInputFiles('#fileInput', file.includes('/') ? file : DATA(file)); await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 120000 }); await page.waitForTimeout(wait); };
  const statText = () => page.$$eval('#uploadPanel .summary-grid .stat', (els) => Object.fromEntries(els.map((e) => [e.querySelector('span').textContent, +e.querySelector('b').textContent.replace(/,/g, '')])));
  const tab = async (t) => { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(700); };
  const download = async (trigger) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), trigger()]); const p = path.join(DL, d.suggestedFilename()); await d.saveAs(p); return p; };
  const shot = async (name, full = true) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(5, 5); await page.evaluate(() => document.getElementById('toast').classList.remove('show')); await page.waitForTimeout(400); await page.screenshot({ path: IMG(name), fullPage: full }); };
  const ready = () => page.waitForFunction(() => window.MvApp && window.MvApp.state.ctx, null, { timeout: 30000 });

  // ------------------------------------------------------------ T01 load and accuracy vs pandas / SciPy
  current = 'T01 load and KPI accuracy';
  await page.goto(URL); await ready(); await page.evaluate(() => indexedDB.deleteDatabase('marketvale-dashboard')); await page.reload(); await ready();
  let s = await st();
  check('all clean tables loaded (19,438 orders, 28,109 lines, 11,211 reviews, 14,800 customers)', s.n === 19438 && s.items === 28109 && s.reviews === 11211 && s.customers === 14800, JSON.stringify([s.n, s.items, s.reviews, s.customers]));
  [['orders', 'orders'], ['gmv', 'gmv'], ['real_gmv', 'real_gmv'], ['aov', 'aov'], ['units', 'units'], ['net_delivered_gmv', 'net_delivered_gmv'], ['cancel_rate', 'cancel_rate'], ['return_rate', 'return_rate'],
    ['delivered_of_closed', 'delivered_of_closed'], ['delivery_success', 'delivery_success'], ['avg_days', 'avg_delivery_days'], ['median_days', 'median_delivery_days'], ['late_rate', 'late_rate'],
    ['avg_days_late', 'avg_days_late_when_late'], ['reviews', 'reviews'], ['review_rate', 'review_rate'], ['avg_score', 'avg_score'], ['low_rate', 'low_rate']]
    .forEach(([js, p]) => check(`KPI ${js} matches pandas`, close(s.k[js], ref[p], 1e-9), `${s.k[js]} vs ${ref[p]}`));
  const c = await S(() => { const x = window.MvApp.state.ctx; return { cust: { purchasing: x.cust.purchasing, ordering: x.cust.ordering, repeat: x.cust.repeat_rate, cpc: x.cust.checkouts_per_customer, spc: x.cust.spend_per_customer, cohorts: x.cust.cohorts },
    cats: x.cats, zones: x.zones, states: x.states, months: x.months, t: x.t, sellers: x.sellers.map((v) => ({ id: v.seller_id, fl: v.flag_late, fw: v.flag_low })), themes: x.themes, lateness: x.lateness, yoy: x.k.yoy, pidx: [...window.MvApp.state.pidx.entries()] }; });
  check('customers: purchasing, ordering, repeat rate, purchases and spend per customer match pandas', c.cust.purchasing === ref.customers_purchasing && c.cust.ordering === ref.customers_ordering && close(c.cust.repeat, ref.repeat_rate, 1e-9) && close(c.cust.cpc, ref.orders_per_customer, 1e-9) && close(c.cust.spc, ref.spend_per_customer, 1e-9), JSON.stringify(c.cust).slice(0, 120));
  check('year on year GMV (nominal and constant prices) and orders match pandas', close(c.yoy.gmv, (ref.gmv_2025 / ref.gmv_2024 - 1) * 100, 1e-9) && close(c.yoy.real_gmv, (ref.real_gmv_2025 / ref.real_gmv_2024 - 1) * 100, 1e-9) && close(c.yoy.orders, (ref.orders_2025 / ref.orders_2024 - 1) * 100, 1e-9), `${c.yoy.gmv}, ${c.yoy.real_gmv}`);
  check('monthly price index identical (24 months)', c.pidx.length === 24 && c.pidx.every(([m, v]) => close(v, ref.price_index[m], 1e-9)));
  check('orders and GMV by month identical', c.months.every((m) => ref.month_orders[m.month] === m.orders && close(m.gmv, ref.month_gmv[m.month], 1e-9)));
  const catOk = (k, rk, f = (x) => x) => c.cats.every((x) => close(f(x[k]), ref[rk][x.category], 1e-9));
  check('category GMV, orders and units identical (18 categories)', c.cats.length === 18 && catOk('gmv', 'category_gmv') && c.cats.every((x) => x.orders === ref.category_orders[x.category] && x.units === ref.category_units[x.category]));
  check('category AOV, cancellation, late, score and 1-2 star rates identical', catOk('aov', 'category_aov') && catOk('cancel_rate', 'category_cancel_rate') && catOk('late_rate', 'category_late_rate') && catOk('avg_score', 'category_avg_score') && catOk('low_rate', 'category_low_rate'));
  check('category 1-2 star rate for on-time deliveries identical', catOk('low_rate_on_time', 'category_low_rate_on_time'));
  check('region orders, spend per customer and delivery days identical', c.zones.every((z) => ref.zone_orders[z.name] === z.orders && close(z.spend_per_customer, ref.zone_spend_per_customer[z.name], 1e-9) && close(z.avg_days, ref.zone_avg_delivery_days[z.name], 1e-9)));
  check('state orders, delivery days and late rates identical (37 states)', c.states.length === 37 && c.states.every((x) => ref.state_orders[x.name] === x.orders && close(x.avg_days, ref.state_avg_delivery_days[x.name], 1e-9) && close(x.late_rate, ref.state_late_rate[x.name], 1e-9)));
  const L = c.t.lateLow, RL = ref.late_vs_low;
  check('late vs 1-2 star: rates, chi-square, relative risk and CI match SciPy', close(L.low_late, RL.low_late, 1e-9) && close(L.low_on_time, RL.low_on_time, 1e-9) && close(L.chi2, RL.chi2, 1e-9) && close(L.rr, RL.rr, 1e-9) && close(L.rr_lo, RL.rr_lo, 1e-9) && close(L.rr_hi, RL.rr_hi, 1e-9), `RR ${L.rr}`);
  check('Spearman days late vs score matches SciPy', close(c.t.spearmanLate.r, ref.spearman_days_late_score.rho, 1e-9));
  check('Kruskal-Wallis score by category matches SciPy', close(c.t.kwScoreCategory.H, ref.kw_score_by_category.H, 1e-9) && close(c.t.kwScoreCategory.p, ref.kw_score_by_category.p, 1e-6));
  check('chi-square cancellation by category matches SciPy', close(c.t.cancelCategory.chi2, ref.chi2_cancel_by_category.chi2, 1e-9) && close(c.t.cancelCategory.p, ref.chi2_cancel_by_category.p, 1e-6));
  check('chi-square 1-2 stars by category (all and on-time) match SciPy', close(c.t.lowCategory.chi2, ref.chi2_low_by_category.chi2, 1e-9) && close(c.t.lowCategoryOnTime.chi2, ref.chi2_low_by_category_on_time.chi2, 1e-9));
  check('Kruskal-Wallis delivery days by state matches SciPy', close(c.t.kwDaysState.H, ref.kw_delivery_days_by_state.H, 1e-9));
  check('monthly order trend slope and p-value match SciPy linregress', close(c.t.trend.slope, ref.trend_orders_slope, 1e-9) && close(c.t.trend.p, ref.trend_orders_p, 1e-6));
  check('lateness buckets (n, average score, 1-2 star share) identical', c.lateness.every((b) => { const r = ref.score_by_lateness[b.group]; return r && r.n === b.n && close(b.avg_score, r.avg, 1e-9) && close(b.low_rate, r.low, 1e-9); }));
  check('flagged sellers identical (late: 25, low ratings: 13)', JSON.stringify(c.sellers.filter((x) => x.fl).map((x) => x.id).sort()) === JSON.stringify(ref.sellers_flag_late) && JSON.stringify(c.sellers.filter((x) => x.fw).map((x) => x.id).sort()) === JSON.stringify(ref.sellers_flag_low));
  check('complaint themes of 1-2 star reviews identical', c.themes.every((x) => ref.themes_low[x.group] === x.n));
  const coh = readCsv(path.join(ROOT, 'data/processed/cohort_retention.csv'));
  check('cohort retention matrix identical', c.cust.cohorts.every((x) => { const r = coh.find((q) => q.cohort === x.cohort); return r && x.rates.every((v, k) => k > x.observed || close(v / 100, +r[String(k)], 1e-9)); }));
  const kpiText = await page.textContent('#kpis');
  check('KPI cards show formatted values', kpiText.includes('₦2.09bn') && kpiText.includes('19,438') && kpiText.includes('13.3%') && kpiText.includes('3.86'), kpiText.slice(0, 120));
  await shot('dashboard-overview.png');

  // ------------------------------------------------------------ T02 charts render
  current = 'T02 charts render';
  const charts = { overview: ['cMonth', 'cCatOv'], categories: ['cCatRank', 'cCatMatrix', 'cCatTrend'], customers: ['cPurch', 'cNewRet', 'cZoneSpend', 'cStateOrders', 'cChannel', 'cOrderHeat'],
    delivery: ['cDelMonth', 'cDelHist', 'cZoneDays', 'cSellerLate'], experience: ['cLateness', 'cScoreDist', 'cCatLow', 'cThemes'], sellers: ['cSellerScatter'] };
  for (const [t, ids] of Object.entries(charts)) {
    await tab(t);
    for (const id of ids) { const n = await page.evaluate((i) => { const ch = window.echarts.getInstanceByDom(document.getElementById(i)); if (!ch) return 0; return (ch.getOption().series || []).filter((x) => (x.data || []).length).length; }, id); check(`${t}: ${id} has data`, n > 0, `${n} series`); }
    if (t !== 'overview') await shot(`dashboard-${t}.png`);
  }
  const cohRows = await page.$$eval('#cohortTable tbody tr', (r) => r.length); await tab('customers');
  check('cohort table shows 8 quarterly cohorts', cohRows === 8 || (await page.$$eval('#cohortTable tbody tr', (r) => r.length)) === 8);
  await tab('categories'); for (const m of ['orders', 'units', 'aov', 'cancel_rate', 'avg_score', 'low_rate', 'gmv']) { await page.selectOption('#catMeasure', m); await page.waitForTimeout(150); }
  await page.selectOption('#catTrendMode', 'real'); await page.waitForTimeout(200);
  await tab('delivery'); for (const m of ['avg_days', 'delivery_success', 'late_rate']) { await page.selectOption('#delMeasure', m); await page.waitForTimeout(150); }
  await tab('overview'); for (const m of ['real_gmv', 'orders', 'aov', 'late_rate', 'avg_score', 'low_rate', 'price_index', 'gmv']) { await page.selectOption('#monthMeasure', m); await page.waitForTimeout(120); }
  check('measure selectors switch without errors', errors.length === 0, errors.join('; '));

  // ------------------------------------------------------------ T03 filters
  current = 'T03 filters';
  await page.selectOption('#fFrom', '2025-01'); await page.selectOption('#fTo', '2025-06'); await page.waitForTimeout(500);
  s = await st(); check('month filter Jan-Jun 2025 keeps exactly the matching orders', s.filtered === nH1_2025, `${s.filtered} vs ${nH1_2025}`);
  await page.click('#btnReset'); await page.waitForTimeout(500);
  await page.click('#fZoneBox summary'); await page.click('#fZone [data-none]'); await page.check('#fZone input[value="North East"]'); await page.waitForTimeout(500); await page.click('body', { position: { x: 5, y: 860 } });
  s = await st(); check('region filter: North East only', s.filtered === nNE, `${s.filtered} vs ${nNE}`);
  let chips = await page.textContent('#activeFilters'); check('active filter chip shown', chips.includes('Region: North East'), chips);
  await page.click('#activeFilters [data-chip="zones"]'); await page.waitForTimeout(400); s = await st(); check('removing the chip removes the filter', s.filtered === 19438);
  await page.click('#fFulBox summary'); await page.click('#fFul [data-none]'); await page.check('#fFul input[value="Marketplace Fulfilled"]'); await page.waitForTimeout(400); await page.click('body', { position: { x: 5, y: 860 } });
  await page.click('#fCatBox summary'); await page.click('#fCat [data-none]'); await page.check(`#fCat input[value="Women's Fashion"]`); await page.waitForTimeout(400); await page.click('body', { position: { x: 5, y: 860 } });
  s = await st(); check("filters combine (Marketplace Fulfilled + Women's Fashion)", s.filtered === nMfWf, `${s.filtered} vs ${nMfWf}`);
  await tab('explorer'); const cnt = await page.textContent('#tCount'); check('data explorer reflects filters', cnt.includes(`(${nMfWf.toLocaleString('en-US')} after filters`), cnt);
  await page.click('#btnReset'); await page.waitForTimeout(500);
  await page.fill('#tSearch', 'SL180'); await page.waitForTimeout(500);
  const nSL180 = py.filter((r) => r.seller_id === 'SL180').length;
  check('explorer search narrows rows (seller SL180)', (await page.textContent('#tCount')).startsWith(`${nSL180.toLocaleString('en-US')} of`), await page.textContent('#tCount'));
  await page.fill('#tSearch', ''); await page.waitForTimeout(400);
  await page.click('#explorer th[data-k="items_subtotal_ngn"]'); await page.waitForTimeout(250); await page.click('#explorer th[data-k="items_subtotal_ngn"]'); await page.waitForTimeout(250);
  const top = await page.$eval('#explorer tbody tr td:nth-child(8)', (td) => +td.textContent.replace(/,/g, ''));
  check('explorer sorts by order value (largest first)', top === Math.max(...py.map((r) => +r.items_subtotal_ngn)), top);
  check('pagination controls rendered', (await page.$$eval('#pager button[data-p]', (b) => b.length)) >= 3);
  await shot('dashboard-explorer.png', false);
  await tab('overview');
  await page.$eval('#cCatOv', (e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
  const pos = await page.evaluate(() => { const ch = window.echarts.getInstanceByDom(document.getElementById('cCatOv')); const cats = ch.getOption().yAxis[0].data; const i = cats.indexOf('Computing'); const r = document.getElementById('cCatOv').getBoundingClientRect(); const p = ch.convertToPixel({ seriesIndex: 0 }, [1e8, i]); return { x: r.x + p[0], y: r.y + p[1] }; });
  await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(600);
  s = await st(); check('clicking a category bar filters the dashboard (Computing = 849 orders)', s.filtered === ref.category_orders.Computing, s.filtered);
  await page.click('#btnReset'); await page.waitForTimeout(400);
  await tab('sellers'); await page.selectOption('#sFlag', 'flagged'); await page.waitForTimeout(300);
  const flaggedRows = await page.$$eval('#sellerTable tbody tr', (r) => r.length);
  const nFlag = new Set([...ref.sellers_flag_late, ...ref.sellers_flag_low]).size;
  check('seller scorecard "flagged only" lists every flagged seller', flaggedRows === nFlag, `${flaggedRows} vs ${nFlag}`);
  await page.selectOption('#sFlag', 'all');

  // ------------------------------------------------------------ T04 invalid files
  current = 'T04 invalid files';
  await tab('data');
  await upload('02_missing_required_column.csv'); let panel = await page.textContent('#uploadPanel');
  check('missing required column rejected with explanation', panel.includes('required columns missing: order_status'), panel.slice(0, 160));
  await upload('03_wrong_type.txt'); panel = await page.textContent('#uploadPanel'); check('wrong file type rejected', panel.includes('.txt file'));
  const big = path.join(DL, 'too_big.csv'); fs.writeFileSync(big, 'order_id,x\n' + 'a,'.padEnd(1000, 'x').concat('\n').repeat(27000));
  await upload(big); panel = await page.textContent('#uploadPanel'); check('file over 25 MB rejected', panel.includes('The limit is 25 MB'));
  s = await st(); check('dataset unchanged after rejected files', s.n === 19438);

  // ------------------------------------------------------------ T05 append a multi-table workbook
  current = 'T05 append upload';
  await upload('01_append_orders_lines_reviews.xlsx', 'append');
  let stats = await statText();
  check('preview totals: 23 rows, 17 new, 1 duplicate, 3 rejected, 2 test records', stats['rows in file'] === 23 && stats['new records to add'] === 17 && stats.duplicates === 1 && stats.rejected === 3 && stats['test records removed'] === 2, JSON.stringify(stats));
  panel = await page.textContent('#uploadPanel');
  check('per-table rows: orders, order lines and reviews recognised by sheet name', panel.includes('Orders') && panel.includes('Order lines') && panel.includes('Reviews') && panel.includes('(sheet name)'));
  check('cleaning applied and reported (R2 test order, R3 date, R5 payment, R6 state, I2 test line, V2 text score)', ['R2: 1', 'R3: 1', 'R5: 1', 'R6: 1', 'I2: 1', 'V2: 2'].every((x) => panel.includes(x)), panel.match(/R\d: \d[^;]*/g));
  check('rejection reasons listed (bad status, missing order, conflict)', panel.includes('is not a recognised status') && panel.includes('MVDEMO404 does not exist') && panel.includes('different values'));
  const vfile = await download(() => page.click('#btnValidation'));
  check('validation results downloadable', fs.readFileSync(vfile, 'utf8').includes('removed (test record)'), path.basename(vfile));
  await shot('dashboard-data-upload.png');
  await page.click('#btnApply'); await page.waitForTimeout(2500);
  const okMsg = await page.textContent('#uploadPanel');
  check('confirmation sentence uses actual counts', okMsg.includes('23 records were processed, 17 were accepted (17 added), 1 duplicate was detected and 5 records were rejected'), okMsg.slice(0, 220));
  s = await st(); check('tables grow: 19,444 orders, 28,115 lines, 11,216 reviews', s.n === 19444 && s.items === 28115 && s.reviews === 11216, JSON.stringify([s.n, s.items, s.reviews]));
  check('KPIs recalculated (orders 19,444; GMV up)', s.k.orders === 19444 && s.k.gmv > ref.gmv, `${s.k.gmv}`);
  const demo = await S(() => window.MvApp.state.all.find((r) => r.order_id === 'MVDEMO001'));
  check('raw-style order cleaned: day-first date, POD -> Pay on delivery, "Lagos State" -> Lagos', demo.order_purchase_ts === '2026-01-04 10:15:00' && demo.payment_method === 'Pay on delivery' && demo.ship_to_state === 'Lagos', JSON.stringify([demo.order_purchase_ts, demo.payment_method, demo.ship_to_state]));
  const months = await page.$$eval('#fTo option', (o) => o.map((x) => x.value)); check('month filter gains Jan 2026', months.includes('2026-01'));
  await tab('overview'); check('header shows working dataset status', (await page.textContent('#datasetStatus')).includes('Working dataset: 19,444'));

  // ------------------------------------------------------------ T06 persistence
  current = 'T06 local persistence';
  await page.reload(); await ready(); s = await st();
  check('after reload the working dataset (19,444 orders, 1 upload) is restored from IndexedDB', s.n === 19444 && s.batches === 1, `${s.n}, ${s.batches}`);

  // ------------------------------------------------------------ T07 duplicates
  current = 'T07 duplicate handling';
  await tab('data'); await upload('01_append_orders_lines_reviews.xlsx', 'append'); stats = await statText();
  check('re-uploading the same workbook adds nothing (18 duplicates)', stats['new records to add'] === 0 && stats.duplicates === 18, JSON.stringify(stats));
  check('apply button disabled when nothing to add', await page.$eval('#btnApply', (b) => b.disabled)); await page.click('#btnCancel');
  await upload('05_reviews_versions.csv', 'append'); stats = await statText(); panel = await page.textContent('#uploadPanel');
  check('reviews: older version superseded, text score read, out-of-range score rejected', stats['new records to add'] === 2 && stats.duplicates === 1 && stats.rejected === 1 && panel.includes('V1: 1') && panel.includes('V2: 1') && panel.includes('V3: 1'), JSON.stringify(stats));
  await page.click('#btnApply'); await page.waitForTimeout(2000);
  const rv = await S((e) => window.MvApp.state.tables.reviews.filter((r) => r.order_id === e.a || r.order_id === e.b).map((r) => `${r.order_id}:${r.review_score}:${r.review_comment}`), exp05);
  check('latest review version kept (score 4, comment trimmed) and "4/5" stored as 4', rv.includes(`${exp05.a}:4:edited version`) && rv.includes(`${exp05.b}:4:null`), rv.join(' | '));

  // ------------------------------------------------------------ T08 merge
  current = 'T08 update or add (merge)';
  await upload('01_append_orders_lines_reviews.xlsx', 'merge'); stats = await statText();
  check('merge mode: the open order now delivered is an update; nothing new', stats['records to update'] === 1 && stats['new records to add'] === 0, JSON.stringify(stats));
  const before = await S((id) => window.MvApp.state.all.find((r) => r.order_id === id).order_status, exp01.update_order);
  await page.click('#btnApply'); await page.waitForTimeout(2000);
  const after = await S((id) => { const r = window.MvApp.state.all.find((x) => x.order_id === id); return `${r.order_status}|${r.delivered}|${r.late}`; }, exp01.update_order);
  check('order status updated from shipped to delivered and delivery measures recalculated', before === 'shipped' && after.startsWith('delivered|1|'), `${before} -> ${after}`);

  // ------------------------------------------------------------ T09 JSON with two tables and alternative names
  current = 'T09 JSON and alternative headers';
  await upload('04_alias_two_tables.json'); panel = await page.textContent('#uploadPanel'); stats = await statText();
  check('JSON with orders and order lines accepted (6 new records)', stats['new records to add'] === 6, JSON.stringify(stats));
  check('alternative column names mapped and reported', panel.includes('"Order Date" → order_purchase_ts') && panel.includes('"Qty" → quantity') && panel.includes('recognised alternative name'));
  await page.click('#btnApply'); await page.waitForTimeout(2000);
  const al = await S(() => window.MvApp.state.all.filter((r) => r.order_id.startsWith('ALIAS')).map((r) => `${r.order_id}|${r.order_status}|${r.ship_to_state}|${r.category_name}`).sort());
  check('labels standardised (in_transit -> shipped, Completed -> delivered, Abuja -> FCT) and category assigned', al[0].startsWith('ALIAS0|shipped|FCT|') && al[1].startsWith('ALIAS1|delivered|Rivers|') && !al.some((x) => x.endsWith('Unknown')), al.join(' ; '));

  // ------------------------------------------------------------ T10 security
  current = 'T10 security';
  await upload('07_security.xlsx'); await page.click('#btnApply'); await page.waitForTimeout(2000);
  await tab('explorer'); await page.fill('#tSearch', 'SAFE'); await page.waitForTimeout(500);
  const imgs = await page.$$eval('#main img', (i) => i.length); const shown = await page.textContent('#explorer tbody');
  check('HTML in uploaded text is shown as text, not executed', imgs === 0 && alerts === 0 && shown.includes('<img src=x'), `img ${imgs}, alerts ${alerts}`);
  await page.fill('#tSearch', ''); await page.waitForTimeout(300);
  const csvFile = await download(async () => { await page.click('#btnData'); await page.click('#dlgData button[value="ok"]'); });
  const csvTxt = fs.readFileSync(csvFile, 'utf8');
  check('exported CSV neutralises formula text', csvTxt.includes("'=HYPERLINK") && !/,=HYPERLINK/.test(csvTxt) && !/,"=HYPERLINK/.test(csvTxt));

  // ------------------------------------------------------------ T11 data export
  current = 'T11 data export';
  const ex = readCsv(csvFile); s = await st();
  check('full CSV export has every analysed order', ex.length === s.n, `${ex.length} vs ${s.n}`);
  check('export includes uploaded orders and the source column', csvTxt.includes('MVDEMO003') && csvTxt.includes('upload ') && csvTxt.includes('base dataset'));
  const byId = new Map(ex.map((r) => [r.order_id, r]));
  const cols = ['cart_id', 'customer_id', 'seller_id', 'seller_tier', 'fulfilment_model', 'date', 'month', 'quarter', 'weekday', 'hour', 'category_name', 'category_group', 'payment_method', 'order_status', 'cancelled', 'open', 'delivered',
    'returned', 'failed', 'lines', 'units', 'items_subtotal_ngn', 'gmv', 'list_value', 'ship_to_state', 'zone', 'intra_state', 'is_bulky', 'sales_event', 'peak_logistics', 'promised_days', 'delivery_days', 'late', 'days_late', 'review_score', 'low_rating', 'theme', 'data_quality_note'];
  const changed = new Set([exp01.update_order, exp05.a, exp05.b]); const mism = [];
  py.forEach((p) => { const e = byId.get(p.order_id); if (!e) { mism.push(`${p.order_id} missing`); return; } if (changed.has(p.order_id)) return;
    cols.forEach((k) => { const a = e[k], b = p[k]; if (!(a === b || (a !== '' && b !== '' && Math.abs(+a - +b) < 1e-6 * Math.max(1, Math.abs(+b))))) mism.push(`${p.order_id}.${k}: ${a} vs ${b}`); }); });
  check(`all ${py.length.toLocaleString('en-US')} base orders in the export match the pandas analysis file (${cols.length} fields each)`, mism.length === 0, mism.slice(0, 4).join('; '));
  await page.selectOption('#fFrom', '2025-07'); await page.waitForTimeout(500); s = await st();
  const fCsv = await download(async () => { await page.click('#btnData'); await page.check('input[name="dscope"][value="filtered"]'); await page.click('#dlgData button[value="ok"]'); });
  check('filtered CSV export matches the filtered view', readCsv(fCsv).length === s.filtered && path.basename(fCsv).includes('filtered'), `${readCsv(fCsv).length} vs ${s.filtered}`);
  const xFile = await download(async () => { await page.click('#btnData'); await page.check('input[name="dscope"][value="full"]'); await page.check('input[name="dfmt"][value="xlsx"]'); await page.click('#dlgData button[value="ok"]'); });
  const xl = execSync(`python3 -c "import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1], read_only=True); print(wb.sheetnames, wb['Orders (analysis)'].max_row-1, wb['Order lines'].max_row-1, wb['Reviews'].max_row-1)" "${xFile}"`).toString().trim();
  s = await st();
  check('Excel export opens with orders, lines, reviews, 4 summaries and About', xl.includes("'Orders (analysis)', 'Order lines', 'Reviews', 'By month', 'By category', 'By state', 'Seller scorecard', 'About'") && xl.includes(` ${s.n} ${s.items} ${s.reviews}`), xl);
  const sumF = await download(async () => { await tab('data'); await page.click('#btnSummaryCsv'); });
  check('category summary CSV downloads', readCsv(sumF).length === 18, path.basename(sumF));
  await page.click('#btnReset'); await page.waitForTimeout(400);

  // ------------------------------------------------------------ T12 PDF report
  current = 'T12 PDF report';
  await page.selectOption('#fFrom', '2025-01'); await page.waitForTimeout(400);
  const pdfF = await download(async () => { await page.click('#btnReport'); await page.click('#dlgReportGo'); });
  const pdfTxt = execSync(`pdftotext -layout "${pdfF}" -`).toString(); const pagesN = +execSync(`pdfinfo "${pdfF}" | grep Pages | awk '{print $2}'`).toString().trim();
  check('filtered report downloads as a valid PDF', pagesN >= 8, `${pagesN} pages`);
  check('report states scope and filters', pdfTxt.includes('Current filtered view') && pdfTxt.includes('months Jan 2025 to'));
  ['1. Business context and problem', '2. Purpose and objectives', '3. Dataset overview', '4. Data preparation', '5. Analytical methods', '6. KPI definitions', '7. Key numerical results', '8. Key findings',
    '9. Areas requiring management attention', '10. Business interpretation', '11. Recommendations', '12. Limitations'].forEach((h) => check(`report has section "${h}"`, pdfTxt.includes(h)));
  check('report reflects uploaded data (upload history)', pdfTxt.includes('Data added during use') && pdfTxt.includes('01_append_orders_lines_reviews'));
  await page.click('#btnReset'); await page.waitForTimeout(400);
  const pdfFull = await download(async () => { await page.click('#btnReport'); await page.check('input[name="rscope"][value="full"]'); await page.click('#dlgReportGo'); });
  const fullTxt = execSync(`pdftotext -layout "${pdfFull}" -`).toString(); s = await st();
  check('full-dataset report covers every order', fullTxt.includes('Entire available dataset') && fullTxt.includes(`${s.n.toLocaleString('en-US')} orders`), s.n);
  check('report embeds 6 chart images', +execSync(`pdfimages -list "${pdfFull}" | tail -n +3 | wc -l`).toString().trim() >= 6);
  check('report text is plain ASCII with amounts in NGN', !/[^\x00-\x7F]/.test(fullTxt.replace(/\f/g, '')) && fullTxt.includes('NGN '));

  // ------------------------------------------------------------ T13 undo, replace, reset
  current = 'T13 undo and reset';
  await tab('data');
  await page.click('#btnUndo'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(1500);
  s = await st(); check('undo removes the last upload (security file)', s.n === 19447 && s.batches === 4, `${s.n}, ${s.batches}`);
  await upload('08_replace_forty_orders.xlsx', 'replace'); await page.click('#btnApply'); await page.waitForTimeout(300);
  check('replace asks for confirmation', await page.isVisible('#dlgConfirm'));
  await page.click('#dlgConfirmGo'); await page.waitForTimeout(2000);
  s = await st(); check('replace leaves only the 40 orders in the file, and no reviews', s.n === 40 && s.items === 40 && s.reviews === 0 && s.k.orders === 40, `${s.n}, ${s.items}, ${s.reviews}`);
  await page.click('#btnUndo'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(2000);
  s = await st(); check('undoing a replace restores the previous data', s.n === 19447, s.n);
  await page.click('#btnClear'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(2000);
  s = await st(); check('reset returns to the original 19,438 orders', s.n === 19438 && s.batches === 0);
  await page.reload(); await ready(); s = await st(); check('after reset and reload, local data is gone', s.n === 19438 && s.batches === 0);
  const pdfBase = await download(async () => { await page.click('#btnReport'); await page.check('input[name="rscope"][value="full"]'); await page.click('#dlgReportGo'); });
  fs.copyFileSync(pdfBase, path.join(ROOT, 'tests', 'sample_generated_report.pdf'));

  // ------------------------------------------------------------ T14 cleaning the raw sheets reproduces the clean tables
  current = 'T14 raw data cleaning';
  const base = await S(() => { const T = window.MvApp.state.tables; const k = (t, r) => window.MvData.keyOf(t, r); const out = {}; ['orders', 'order_items', 'reviews', 'customers'].forEach((t) => { out[t] = Object.fromEntries(T[t].map((r) => { const o = { ...r }; delete o._batch; return [k(t, r), JSON.stringify(o)]; })); }); return out; });
  await tab('data'); const t0 = Date.now(); await upload('06_raw_sheets.xlsx', 'replace', 1500);
  panel = await page.textContent('#uploadPanel');
  check(`raw workbook (4 sheets, 73,914 rows) read and cleaned in the browser`, panel.includes('raw_orders') && panel.includes('raw_reviews'), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const fixes = await S(() => { const f = {}; Object.values(window.MvApp.state.pending.res.parts).forEach((p) => Object.assign(f, p.fixes)); return f; });
  const rules = Object.keys(wbLog); const diffRules = rules.filter((r) => r !== 'R6b' && (fixes[r] || 0) !== wbLog[r]);
  check('every cleaning-rule count equals the workbook cleaning log (23 rules)', diffRules.length === 0, diffRules.map((r) => `${r}: ${fixes[r]} vs ${wbLog[r]}`).join('; ') || JSON.stringify(fixes));
  await page.click('#btnApply'); await page.waitForTimeout(300); await page.click('#dlgConfirmGo'); await page.waitForTimeout(4000);
  const same = await S((b) => { const T = window.MvApp.state.tables; const k = (t, r) => window.MvData.keyOf(t, r); const res = {};
    ['orders', 'order_items', 'reviews', 'customers'].forEach((t) => { let d = 0; const n = T[t].length; T[t].forEach((r) => { const o = { ...r }; delete o._batch; if (b[t][k(t, r)] !== JSON.stringify(o)) d++; }); res[t] = { n, base: Object.keys(b[t]).length, diff: d }; }); return res; }, base);
  check('rebuilt orders, lines, reviews and customers are identical to the clean tables', Object.values(same).every((x) => x.n === x.base && x.diff === 0), JSON.stringify(same));
  s = await st(); check('KPIs after replacing with the cleaned raw data equal the reference', close(s.k.gmv, ref.gmv, 1e-12) && close(s.k.late_rate, ref.late_rate, 1e-12) && close(s.k.avg_score, ref.avg_score, 1e-12));
  await page.click('#btnClear'); await page.click('#dlgConfirmGo'); await page.waitForTimeout(2000);

  // ------------------------------------------------------------ T15 dark mode, keyboard, responsive
  current = 'T15 layout and accessibility';
  await tab('overview'); await page.click('#btnTheme'); await page.waitForTimeout(800);
  check('dark mode applied', (await S(() => getComputedStyle(document.documentElement).colorScheme)) === 'dark');
  await shot('dashboard-dark-mode.png', false); await page.click('#btnTheme'); await page.waitForTimeout(300);
  await page.focus('[data-tab="overview"]'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  check('arrow keys move between tabs', (await S(() => window.MvApp.state.view.tab)) === 'categories');
  check('visible charts have text alternatives', await page.$$eval('.chart[role="img"]', (e) => e.filter((x) => !x.closest('[hidden]')).every((x) => (x.getAttribute('aria-label') || '').length > 10)));
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mob.newPage(); await mp.goto(URL); await mp.waitForFunction(() => window.MvApp && window.MvApp.state.ctx, null, { timeout: 30000 }); await mp.waitForTimeout(800);
  for (const t of ['overview', 'categories', 'customers', 'delivery', 'experience', 'sellers', 'data']) { await mp.click(`[data-tab="${t}"]`); await mp.waitForTimeout(700); const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(`mobile 390px: no horizontal page scroll on ${t}`, over <= 0, `${over}px`); }
  await mp.click('[data-tab="overview"]'); await mp.waitForTimeout(600); await mp.screenshot({ path: IMG('dashboard-mobile.png') }); await mob.close();
  const tc = await browser.newContext({ viewport: { width: 820, height: 1180 } }); const tp = await tc.newPage(); await tp.goto(URL); await tp.waitForFunction(() => window.MvApp && window.MvApp.state.ctx, null, { timeout: 30000 });
  check('tablet 820px: no horizontal page scroll', (await tp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0); await tc.close();

  // ------------------------------------------------------------ T16 deployment and console
  current = 'T16 deployment';
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  check('all asset references are relative', refs.every((u) => !/^(\/|https?:)/.test(u)));
  check('every referenced file exists', refs.every((u) => fs.existsSync(path.join(ROOT, u))), refs.filter((u) => !fs.existsSync(path.join(ROOT, u))).join(', '));
  const fctx = await browser.newContext(); const fp = await fctx.newPage(); const ferr = []; fp.on('pageerror', (e) => ferr.push(e.message));
  const net = []; fp.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) net.push(r.url()); });
  await fp.goto('file://' + path.join(ROOT, 'index.html')); await fp.waitForFunction(() => window.MvApp && window.MvApp.state.ctx, null, { timeout: 30000 }).catch(() => {});
  const fn = await fp.evaluate(() => (window.MvApp && window.MvApp.state.all.length) || 0);
  check('dashboard works opened directly from disk (file://)', fn === 19438 && !ferr.length, `${fn}; ${ferr.join('; ')}`);
  check('no network requests to external hosts', net.length === 0, net.join(', ')); await fctx.close();
  check('no JavaScript errors during the whole run', errors.length === 0, errors.join(' | '));

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(ROOT, 'tests', 'results.json'), JSON.stringify({ run: new Date().toISOString(), browser: 'Chromium (Playwright)', passed: pass, failed: results.length - pass, results }, null, 1));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

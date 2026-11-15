/* data-export.js - downloads of the data the dashboard is actually analysing (full or filtered), summary tables,
   upload validation results, the blank template and a fictional test workbook. CSV text cells are protected
   against spreadsheet formula injection (utils.csvCell). */
(function () {
  'use strict';
  const U = window.MvUtils; const { TABLES, TABLE_ORDER } = window.MvConfig;

  const ORDER_COLS = ['order_id', 'cart_id', 'customer_id', 'seller_id', 'seller_name', 'seller_tier', 'fulfilment_model', 'order_purchase_ts', 'date', 'month', 'quarter', 'year', 'weekday', 'hour',
    'category_id', 'category_name', 'category_group', 'payment_method', 'order_status', 'cancelled', 'open', 'delivered', 'returned', 'failed', 'lines', 'units', 'items_subtotal_ngn', 'item_discount',
    'voucher_discount_ngn', 'shipping_fee_ngn', 'order_total_ngn', 'gmv', 'list_value', 'ship_from_state', 'ship_to_state', 'zone', 'intra_state', 'is_bulky', 'sales_event', 'peak_logistics', 'promised_days',
    'delivery_days', 'late', 'days_late', 'review_score', 'low_rating', 'theme', 'data_quality_note', 'record_source'].map((k) => ({ key: k, label: k }));
  const MONTH_COLS = ['month', 'orders', 'nc_orders', 'gmv', 'real_gmv', 'price_index', 'aov', 'units', 'customers', 'cancel_rate', 'delivery_success', 'avg_days', 'late_rate', 'reviews', 'avg_score', 'low_rate'];
  const CAT_COLS = ['category', 'group', 'gmv', 'gmv_share', 'real_gmv', 'orders', 'nc_orders', 'units', 'aov', 'cancel_rate', 'return_rate', 'delivered_n', 'avg_days', 'late_rate', 'reviews', 'avg_score', 'low_rate', 'low_rate_on_time'];
  const STATE_COLS = ['name', 'zone', 'orders', 'gmv', 'customers', 'spend_per_customer', 'delivered_n', 'avg_days', 'late_rate', 'avg_score', 'low_rate'];
  const SELLER_COLS = ['seller_id', 'seller_name', 'tier', 'fulfilment', 'category', 'orders', 'gmv', 'cancel_rate', 'seller_cancelled', 'late_eval_n', 'late_rate', 'late_lo', 'late_hi', 'avg_days', 'reviews', 'avg_score', 'low_rate', 'low_lo', 'low_hi', 'flag_late', 'flag_low'];
  const cols = (keys) => keys.map((k) => ({ key: k, label: k }));
  const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
  const pick = (rows, keys) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, round(r[k])])));
  const prep = (rows) => rows.map((r) => { const o = {}; ORDER_COLS.forEach((c) => { o[c.key] = round(c.key === 'record_source' ? (r._batch && r._batch !== 'base' ? `upload ${r._batch}` : 'base dataset') : r[c.key]); }); return o; });
  const csvBlob = (csv) => new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function dataCsv(rows, scope) { U.download(csvBlob(U.toCsv(prep(rows), ORDER_COLS)), `marketvale_orders_analysis_${scope}_${U.stamp()}.csv`); }
  function categoryCsv(cats, scope) { U.download(csvBlob(U.toCsv(pick(cats, CAT_COLS), cols(CAT_COLS))), `marketvale_category_summary_${scope}_${U.stamp()}.csv`); }
  function validationCsv(upload) {
    const c = [{ key: 'table', label: 'table' }, { key: 'row', label: 'file_row' }, { key: 'key', label: 'record_key' }, { key: 'outcome', label: 'outcome' }, { key: 'reason', label: 'reason' }];
    const out = { invalid: 'rejected', orphan: 'rejected (reference)', duplicate_key: 'rejected (duplicate key)', test: 'removed (test record)', duplicate_in_file: 'duplicate in file', superseded: 'superseded (older version)', duplicate_existing: 'duplicate of existing record', conflict: 'not added (conflict)' };
    const rows = [...upload.rejected.map((r) => ({ table: r.table, row: r.row, key: r.key, outcome: out[r.type] || r.type, reason: r.reason })),
      ...upload.warnings.map((w) => ({ table: w.table, row: w.row, key: '', outcome: 'accepted with warning', reason: `${w.field}: ${w.message}` }))];
    U.download(csvBlob(U.toCsv(rows, c)), `upload_validation_${(upload.fileName || 'file').replace(/[^\w.-]+/g, '_')}_${U.stamp()}.csv`);
  }
  function addSheet(wb, name, c, data) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = c.map((x) => ({ header: x.label, key: x.key, width: Math.min(28, Math.max(10, x.label.length + 2)) }));
    data.forEach((d) => ws.addRow(d)); ws.getRow(1).font = { bold: true };
    if (c.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: c.length } };
    return ws;
  }
  async function dataXlsx(ctx, scope, tables, meta) {
    const wb = new window.ExcelJS.Workbook(); wb.creator = 'Marketvale Marketplace Performance dashboard'; wb.created = new Date();
    const ids = new Set(ctx.rows.map((r) => r.order_id));
    addSheet(wb, 'Orders (analysis)', ORDER_COLS, prep(ctx.rows));
    addSheet(wb, 'Order lines', cols(TABLES.order_items.fields.map((f) => f.key)), tables.order_items.filter((r) => ids.has(r.order_id)).map((r) => pick([r], TABLES.order_items.fields.map((f) => f.key))[0]));
    addSheet(wb, 'Reviews', cols(TABLES.reviews.fields.map((f) => f.key)), tables.reviews.filter((r) => ids.has(r.order_id)).map((r) => pick([r], TABLES.reviews.fields.map((f) => f.key))[0]));
    addSheet(wb, 'By month', cols(MONTH_COLS), pick(ctx.months, MONTH_COLS));
    addSheet(wb, 'By category', cols(CAT_COLS), pick(ctx.cats, CAT_COLS));
    addSheet(wb, 'By state', cols(STATE_COLS), pick(ctx.states, STATE_COLS));
    addSheet(wb, 'Seller scorecard', cols(SELLER_COLS), pick(ctx.sellers, SELLER_COLS));
    const about = wb.addWorksheet('About');
    [['Export scope', scope === 'full' ? 'Full analysis dataset' : 'Currently filtered dataset'], ['Filters', meta.filters], ['Orders', ctx.rows.length], ['Generated', new Date().toISOString()], ['Dataset status', meta.status],
      ['Data', 'Synthetic data: Marketvale is a fictional marketplace. Amounts in Nigerian naira (NGN).'],
      ['Definitions', 'gmv = items_subtotal_ngn for orders not cancelled (0 if cancelled); late = 1 when the delivery date is after estimated_delivery_date; low_rating = 1 for 1-2 stars; real_gmv = GMV at January 2024 prices; rates in %.'],
      ['More', 'See the Methodology tab of the dashboard and data/data-dictionary.md']].forEach((r) => about.addRow(r));
    about.getColumn(1).width = 18; about.getColumn(2).width = 110; about.getColumn(1).font = { bold: true };
    U.download(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), `marketvale_analysis_${scope}_${U.stamp()}.xlsx`);
  }
  async function templateXlsx() {
    const wb = new window.ExcelJS.Workbook();
    TABLE_ORDER.forEach((t) => addSheet(wb, t, cols(TABLES[t].fields.map((f) => f.key)), []));
    U.download(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), 'marketvale_upload_template.xlsx');
  }
  // Fictional test workbook: 8 invented orders in the month after the data ends (IDs MVDEMO...), with lines and reviews,
  // plus one exact copy of an existing order (duplicate), one existing open order now delivered (update), one invalid
  // order and one order line for an order that does not exist - so validation, duplicates and merging can be seen working.
  async function sampleXlsx(tables) {
    const last = tables.orders.reduce((m, o) => (o.order_purchase_ts > m ? o.order_purchase_ts : m), '');
    const y = +last.slice(0, 4), mo = +last.slice(5, 7); const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1; const p2 = (x) => String(x).padStart(2, '0');
    const day = (d, h = 10) => `${ny}-${p2(nm)}-${p2(d)} ${p2(h)}:15:00`;
    const custs = tables.customers.slice(0, 8);
    const sellers = tables.sellers.filter((s) => tables.products.some((p) => p.seller_id === s.seller_id)).slice(0, 8);
    const O = [], I = [], R = [];
    sellers.forEach((s, i) => {
      const prods = tables.products.filter((p) => p.seller_id === s.seller_id).slice(0, 2); const id = `MVDEMO${String(i + 1).padStart(3, '0')}`;
      const lines = prods.map((p, j) => { const q = 1 + ((i + j) % 2); const unit = Math.round(p.list_price_ngn_2024 * 1.5); return { order_id: id, order_item_seq: j + 1, product_id: p.product_id, seller_id: s.seller_id, quantity: q, unit_price_ngn: unit, item_discount_ngn: 0, line_total_ngn: unit * q }; });
      const sub = lines.reduce((a, l) => a + l.line_total_ngn, 0); const status = i === 6 ? 'cancelled' : i === 7 ? 'processing' : 'delivered'; const late = i % 3 === 0;
      const o = { order_id: id, cart_id: `CTDEMO${String(i + 1).padStart(3, '0')}`, customer_id: custs[i].customer_id, seller_id: s.seller_id, order_purchase_ts: day(2 + i), payment_method: 'Card', payment_confirmed_ts: day(2 + i, 11),
        items_subtotal_ngn: sub, voucher_discount_ngn: 0, shipping_fee_ngn: 1500, order_total_ngn: sub + 1500, order_status: status,
        shipped_ts: status === 'delivered' ? day(3 + i, 9) : '', delivered_ts: status === 'delivered' ? day(5 + i + (late ? 3 : 0), 14) : '', estimated_delivery_date: `${ny}-${p2(nm)}-${p2(6 + i)}`,
        delivery_failed_ts: '', return_requested_ts: '', cancelled_ts: status === 'cancelled' ? day(2 + i, 18) : '', cancelled_by: status === 'cancelled' ? 'customer' : '', cancellation_reason: status === 'cancelled' ? 'Changed mind' : '',
        ship_from_state: s.seller_state || 'Lagos', ship_to_state: custs[i].customer_state, data_quality_note: '' };
      if (i === 1) { o.payment_method = 'POD'; o.ship_to_state = `${custs[i].customer_state} State`; o.order_purchase_ts = `${p2(3)}/${p2(nm)}/${ny} 10:15`; }   // raw-style labels, cleaned on upload
      O.push(o); I.push(...lines);
      if (status === 'delivered') R.push({ review_id: `RVDEMO${i + 1}`, order_id: id, review_score: late ? '2 stars' : 5, review_date: `${ny}-${p2(nm)}-${p2(Math.min(28, 9 + i + (late ? 3 : 0)))}`, review_comment: late ? 'Delivery took too long.' : 'Works well.' });
    });
    const keys = TABLES.orders.fields.map((f) => f.key);
    const asRow = (o) => Object.fromEntries(keys.map((k) => [k, o[k] ?? '']));
    O.push(asRow(tables.orders[0]));                                                                    // exact duplicate of an existing order
    const open = tables.orders.find((o) => o.order_status === 'shipped');
    if (open) O.push({ ...asRow(open), order_status: 'delivered', delivered_ts: day(1, 16) });            // existing open order, now delivered
    O.push({ ...asRow(O[0]), order_id: 'MVDEMO999', cart_id: 'CTDEMO999', order_status: 'lost in transit' });   // invalid status
    I.push({ order_id: 'MVDEMO404', order_item_seq: 1, product_id: tables.products[0].product_id, seller_id: tables.products[0].seller_id, quantity: 1, unit_price_ngn: 1000, item_discount_ngn: 0, line_total_ngn: 1000 });  // order does not exist
    const wb = new window.ExcelJS.Workbook();
    addSheet(wb, 'orders', cols(keys), O);
    addSheet(wb, 'order_items', cols(TABLES.order_items.fields.map((f) => f.key)), I);
    addSheet(wb, 'reviews', cols(['review_id', 'order_id', 'review_score', 'review_date', 'review_comment']), R);
    U.download(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), 'test_upload_fictional_orders.xlsx');
  }

  window.MvExport = { dataCsv, dataXlsx, categoryCsv, validationCsv, templateXlsx, sampleXlsx, ORDER_COLS };
})();

/* data-processing.js - reading files, recognising tables, mapping columns, cleaning and validating rows, checking
   references between tables, applying upload batches and deriving the order-level analysis table.
   The base dataset and every upload go through exactly the same functions, and the cleaning rules are the ones
   documented in the source workbook's cleaning log (R1-R9, I1-I5, V1-V5, C1-C4). */
(function () {
  'use strict';
  const { TABLES, TABLE_ORDER, TRANSACTION_TABLES, STATUS, PAYMENT, STATE_ALIAS, TIERS, FULFILMENT, RULES, THEMES, norm } = window.MvConfig;
  const U = window.MvUtils;
  const { isNum } = U;
  class UserError extends Error {}
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && /^\s*$/.test(v));
  const pad = (x) => String(x).padStart(2, '0');
  const keyOf = (table, r) => TABLES[table].key.map((k) => r[k]).join('|');
  const FIELD_KEYS = Object.fromEntries(Object.entries(TABLES).map(([t, d]) => [t, d.fields.map((f) => f.key)]));
  const REFERENCE_SHEETS = ['readme', 'cleaninglog', 'datadictionary', 'categories', 'states', 'calendar'];

  // ================================================================ reading files
  async function readFile(file) {
    const name = file.name || 'upload';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'xlsx', 'json'].includes(ext)) throw new UserError(`"${name}" is a .${ext} file. Please upload a CSV, Excel (.xlsx) or JSON file.`);
    if (file.size > RULES.maxFileBytes) throw new UserError(`The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${RULES.maxFileBytes / 1048576} MB.`);
    if (file.size === 0) throw new UserError('The file is empty.');
    const base = name.replace(/\.[^.]+$/, '');
    if (ext === 'csv') return [readCsvText(await file.text(), base)];
    if (ext === 'json') return readJson(await file.text(), base);
    return readXlsx(await file.arrayBuffer());
  }
  function readCsvText(text, name) {
    const res = window.Papa.parse(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
    const fatal = res.errors.filter((e) => e.type === 'Delimiter' || e.type === 'Quotes');
    if (fatal.length && !res.data.length) throw new UserError(`The CSV could not be read: ${fatal[0].message}.`);
    return { name, headers: res.meta.fields || [], rows: res.data };
  }
  function readJson(text, name) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new UserError('The JSON file is not valid JSON.'); }
    const asSheet = (arr, nm) => {
      if (!Array.isArray(arr) || arr.some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) throw new UserError(`"${nm}" must be an array of records (objects).`);
      return { name: nm, headers: [...new Set(arr.flatMap((r) => Object.keys(r)))], rows: arr };
    };
    if (Array.isArray(data)) return [asSheet(data, name)];
    if (data && Array.isArray(data.records)) return [asSheet(data.records, name)];
    if (data && typeof data === 'object') {
      const sheets = Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => asSheet(v, k));
      if (sheets.length) return sheets;
    }
    throw new UserError('The JSON must be an array of records, or an object whose keys are table names (orders, order_items, ...) holding arrays of records.');
  }
  const tsString = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  async function readXlsx(buffer) {
    const wb = new window.ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch (e) { throw new UserError('The Excel file could not be opened. Save it as .xlsx and try again.'); }
    const cellValue = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return tsString(v);           // ExcelJS stores the displayed date-time in UTC fields
      if (typeof v === 'object') {
        if ('result' in v) return cellValue(v.result);
        if ('richText' in v) return v.richText.map((t) => t.text).join('');
        if ('text' in v) return v.text;
        if ('error' in v) return '';
      }
      return v;
    };
    const sheets = [];
    wb.worksheets.forEach((ws) => {
      if (ws.rowCount < 2) return;
      const headers = [];
      ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(cellValue(c.value)); });
      const rows = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r); if (!row.hasValues) continue;
        const o = {}; headers.forEach((h, i) => { if (h) o[h] = cellValue(row.getCell(i + 1).value); }); rows.push(o);
      }
      sheets.push({ name: ws.name, headers: headers.filter(Boolean), rows });
    });
    if (!sheets.length) throw new UserError('The workbook has no sheets with data rows.');
    return sheets;
  }

  // ================================================================ recognising tables and mapping columns
  function mapColumns(table, headers) {
    const mapping = {}, notes = [], unknown = [], clashes = []; const used = {};
    headers.forEach((h) => {
      const k = norm(String(h)); if (!k) return;
      const f = TABLES[table].fields.find((x) => x.aliases.includes(k));
      if (!f) { unknown.push(h); return; }
      if (used[f.key]) { clashes.push(`"${h}" and "${used[f.key]}" both map to ${f.key}; "${h}" was ignored`); return; }
      used[f.key] = h; mapping[h] = f.key;
      notes.push({ header: h, field: f.key, method: k === norm(f.key) ? 'standard name' : 'recognised alternative name' });
    });
    const missingRequired = TABLES[table].fields.filter((f) => f.required && !used[f.key]).map((f) => f.key);
    return { mapping, notes, unknown, clashes, missingRequired, present: Object.keys(used) };
  }
  // Which table does a sheet hold? First by sheet name, then by its columns (all required columns of a table present).
  function detectSheets(sheets) {
    const out = [], ignored = [];
    const byName = (nm) => Object.keys(TABLES).find((t) => TABLES[t].sheetNames.includes(norm(nm).replace(/^raw/, 'raw_')) || TABLES[t].sheetNames.map(norm).includes(norm(nm)));
    sheets.forEach((s) => {
      if (REFERENCE_SHEETS.includes(norm(s.name))) { ignored.push({ sheet: s.name, reason: 'reference or documentation sheet (not uploaded)' }); return; }
      let table = byName(s.name), how = 'sheet name';
      if (!table) {
        const fits = Object.keys(TABLES).map((t) => { const m = mapColumns(t, s.headers); return { t, ok: !m.missingRequired.length, n: m.present.length }; }).filter((x) => x.ok).sort((a, b) => b.n - a.n);
        if (fits.length) { table = fits[0].t; how = 'columns'; }
        else {   // closest table (most required columns present) so the user is told exactly which columns are missing
          const part = Object.keys(TABLES).map((t) => { const m = mapColumns(t, s.headers); const req = TABLES[t].fields.filter((f) => f.required).length; return { t, share: (req - m.missingRequired.length) / req }; }).sort((a, b) => b.share - a.share)[0];
          if (part && part.share >= 0.5) { table = part.t; how = 'columns (incomplete)'; }
        }
      }
      if (!table) { ignored.push({ sheet: s.name, reason: 'columns do not match any table (see Upload file format)' }); return; }
      out.push({ ...s, table, how, raw: /^raw/i.test(s.name) });
    });
    // a workbook holding both the clean and the raw version of a table: use the clean one
    const final = [];
    out.forEach((s) => {
      const twin = out.find((x) => x !== s && x.table === s.table);
      if (twin && s.raw && !twin.raw) { ignored.push({ sheet: s.name, reason: `the clean sheet "${twin.name}" for the same table is used instead` }); return; }
      if (twin && !s.raw && !twin.raw && out.indexOf(twin) < out.indexOf(s)) { ignored.push({ sheet: s.name, reason: `a second ${TABLES[s.table].label} sheet ("${twin.name}" is used)` }); return; }
      final.push(s);
    });
    return { sheets: final, ignored };
  }

  // ================================================================ value parsing
  function parseNumber(v) {
    if (blank(v)) return { value: null, ok: true };
    if (typeof v === 'number') return Number.isFinite(v) ? { value: v, ok: true } : { value: null, ok: false };
    const s = String(v).trim().replace(/[,₦]|NGN/gi, '').trim();
    if (/^(na|n\/a|nan|null)$/i.test(s)) return { value: null, ok: true };
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { value: null, ok: false };
    return { value: Number(s), ok: true };
  }
  function realDate(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100; }
  // -> { value: 'YYYY-MM-DD HH:MM:SS', dayFirst } or { error }. Day-first text 'dd/mm/yyyy HH:MM' is rule R3.
  function parseTs(v) {
    if (blank(v)) return { value: null };
    if (v instanceof Date) return { value: tsString(v) };
    if (typeof v === 'number') { if (v < 36526 || v > 73051) return { error: 'is not a date' }; return { value: tsString(new Date(Math.round((v - 25569) * 86400) * 1000)) }; }
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?Z?$/))) {
      if (!realDate(+m[1], +m[2], +m[3]) || +(m[4] || 0) > 23 || +(m[5] || 0) > 59) return { error: 'is not a real calendar date and time' };
      return { value: `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}` };
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
      if (!realDate(+m[3], +m[2], +m[1]) || +(m[4] || 0) > 23) return { error: 'is not a real calendar date and time' };
      return { value: `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}`, dayFirst: true };
    }
    return { error: 'is not in a recognised format (yyyy-mm-dd HH:MM:SS or dd/mm/yyyy HH:MM)' };
  }
  function parseDate(v) { const t = parseTs(v); return t.error || t.value === null ? t : { value: t.value.slice(0, 10), dayFirst: t.dayFirst }; }
  const STATE_LIST = () => (window.MvData.refs.states || []).map((s) => s.state);
  function standardState(v) {
    if (blank(v)) return null;
    const s = String(v).trim(); const list = STATE_LIST();
    if (list.includes(s)) return s;
    let k = s.replace(/\s+state$/i, '').trim().toLowerCase(); k = STATE_ALIAS[k] || k;
    return list.find((x) => x.toLowerCase() === String(k).toLowerCase()) || null;
  }
  const flag = (v) => { if (blank(v)) return null; const s = String(v).trim().toLowerCase(); return ['1', 'true', 'yes', 'y'].includes(s) ? 1 : ['0', 'false', 'no', 'n'].includes(s) ? 0 : undefined; };
  const text = (v, max = 200) => (blank(v) ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

  // ================================================================ row cleaning and validation, per table
  // Each returns { accepted, rejected[{row,key,reason,type}], warnings[{row,field,message}], fixes{rule:count}, extra }
  function cleanTable(table, sheet, colMap, ctx) {
    const res = { accepted: [], rejected: [], warnings: [], fixes: {}, supersededReviews: 0 };
    const fix = (rule, n = 1) => { res.fixes[rule] = (res.fixes[rule] || 0) + n; };
    if (sheet.rows.length > RULES.maxRows) throw new UserError(`Sheet "${sheet.name}" has ${sheet.rows.length.toLocaleString()} rows. The limit is ${RULES.maxRows.toLocaleString()}.`);
    const col = {}; Object.entries(colMap.mapping).forEach(([h, f]) => { col[f] = h; });
    const seenRow = new Map(), seenKey = new Map();
    const exactDupRule = { orders: 'R1', order_items: 'I1', customers: 'C1', reviews: null, sellers: null, products: null }[table];
    sheet.rows.forEach((raw, i) => {
      const rowNo = i + 2; const g = (k) => (col[k] === undefined ? undefined : raw[col[k]]);
      const sig = TABLES[table].fields.map((f) => (col[f.key] === undefined ? '' : String(raw[col[f.key]] ?? ''))).join('\u0001');
      if (seenRow.has(sig)) {
        if (exactDupRule) fix(exactDupRule);
        res.rejected.push({ row: rowNo, key: String(g(TABLES[table].key[0]) ?? ''), reason: `Exact duplicate of row ${seenRow.get(sig)} in this file`, type: 'duplicate_in_file' }); return;
      }
      seenRow.set(sig, rowNo);
      const out = { r: {}, errors: [] };
      const ctxRow = { rowNo, g, out, res, fix, ctx, present: (k) => col[k] !== undefined };
      ({ orders: cleanOrder, order_items: cleanItem, reviews: cleanReview, customers: cleanCustomer, sellers: cleanSeller, products: cleanProduct })[table](ctxRow);
      const r = out.r; FIELD_KEYS[table].forEach((k) => { if (!(k in r)) r[k] = null; });
      const label = keyOf(table, r);
      if (out.test) { res.rejected.push({ row: rowNo, key: label, reason: out.test, type: 'test' }); return; }
      if (out.errors.length) { res.rejected.push({ row: rowNo, key: label, reason: out.errors.join('; '), type: 'invalid' }); return; }
      const k = keyOf(table, r);
      if (seenKey.has(k)) {
        const prevIdx = seenKey.get(k); const prev = res.accepted[prevIdx];
        if (table === 'reviews') {         // V1: an edited review exported twice -> keep the latest version per order
          const newer = r.review_date > prev.review_date || (r.review_date === prev.review_date && String(r.review_id) > String(prev.review_id));
          fix('V1'); res.supersededReviews++;
          const older = newer ? prev : r;
          res.rejected.push({ row: newer ? prev._row : rowNo, key: `${older.review_id} (order ${older.order_id})`, reason: 'Older version of an edited review; the latest version is kept', type: 'superseded' });
          if (newer) { r._row = rowNo; res.accepted[prevIdx] = r; }
          return;
        }
        res.rejected.push({ row: rowNo, key: label, reason: `Same ${TABLES[table].key.join(' + ')} as row ${prev._row} but different values`, type: 'duplicate_key' }); return;
      }
      r._row = rowNo; seenKey.set(k, res.accepted.length); res.accepted.push(r);
    });
    return res;
  }

  function req(c, field, v, label = field) { if (blank(v)) { c.out.errors.push(`${label} is missing`); return false; } return true; }
  function num(c, field, opts = {}) {
    const v = c.g(field); const p = parseNumber(v);
    if (!p.ok) { if (opts.required) c.out.errors.push(`${field} "${String(v).slice(0, 20)}" is not a number`); else { c.res.warnings.push({ row: c.rowNo, field, message: `"${String(v).slice(0, 20)}" is not a number; stored as missing` }); } return null; }
    if (p.value === null) { if (opts.required) c.out.errors.push(`${field} is missing`); return opts.def ?? null; }
    return p.value;
  }
  function ts(c, field, opts = {}) {
    const p = (opts.date ? parseDate : parseTs)(c.g(field));
    if (p.error) { if (opts.required) c.out.errors.push(`${field} "${String(c.g(field)).slice(0, 25)}" ${p.error}`); else c.res.warnings.push({ row: c.rowNo, field, message: `"${String(c.g(field)).slice(0, 25)}" ${p.error}; stored as missing` }); return null; }
    if (p.value === null && opts.required) c.out.errors.push(`${field} is missing`);
    if (p.dayFirst && opts.rule) c.fix(opts.rule);
    return p.value;
  }

  function cleanOrder(c) {
    const r = c.out.r;
    r.order_id = text(c.g('order_id'), 40); req(c, 'order_id', r.order_id);
    r.customer_id = text(c.g('customer_id'), 40); req(c, 'customer_id', r.customer_id);
    r.seller_id = text(c.g('seller_id'), 40); req(c, 'seller_id', r.seller_id);
    r.cart_id = text(c.g('cart_id'), 40) || r.order_id;
    const reason = text(c.g('cancellation_reason'));
    if ((r.order_id && /^MVTEST/i.test(r.order_id)) || r.customer_id === 'CU_TEST' || (reason && reason.toLowerCase() === 'test order')) {
      c.out.test = 'Internal test order (removed, rule R2)'; c.fix('R2'); c.ctx.testOrders.add(r.order_id); return;
    }
    r.order_purchase_ts = ts(c, 'order_purchase_ts', { required: true, rule: 'R3' });
    const st = String(c.g('order_status') ?? '').trim().toLowerCase();
    r.order_status = STATUS[st] || null;
    if (!r.order_status) c.out.errors.push(`order_status "${String(c.g('order_status') ?? '').slice(0, 20)}" is not a recognised status`);
    else if (String(c.g('order_status')) !== r.order_status) c.fix('R4');
    const pm = c.g('payment_method');
    if (!blank(pm)) { r.payment_method = PAYMENT[String(pm).trim().toLowerCase()] || null;
      if (!r.payment_method) { r.payment_method = 'Other'; c.res.warnings.push({ row: c.rowNo, field: 'payment_method', message: `"${String(pm).slice(0, 20)}" not recognised; stored as Other` }); }
      else if (String(pm) !== r.payment_method) c.fix('R5'); }
    ['payment_confirmed_ts', 'shipped_ts', 'delivered_ts', 'delivery_failed_ts', 'return_requested_ts', 'cancelled_ts'].forEach((f) => { r[f] = ts(c, f); });
    r.estimated_delivery_date = ts(c, 'estimated_delivery_date', { date: true });
    r.items_subtotal_ngn = num(c, 'items_subtotal_ngn', { required: true });
    if (isNum(r.items_subtotal_ngn) && r.items_subtotal_ngn < 0) c.out.errors.push('items_subtotal_ngn is negative');
    r.voucher_discount_ngn = num(c, 'voucher_discount_ngn', { def: 0 });
    r.shipping_fee_ngn = num(c, 'shipping_fee_ngn', { def: 0 });
    let note = null;
    if (isNum(r.shipping_fee_ngn) && r.shipping_fee_ngn < 0) { r.shipping_fee_ngn = -r.shipping_fee_ngn; c.fix('R8'); note = 'shipping_fee_sign_fixed'; }
    r.order_total_ngn = num(c, 'order_total_ngn');
    if (r.order_total_ngn === null && isNum(r.items_subtotal_ngn)) r.order_total_ngn = r.items_subtotal_ngn - (r.voucher_discount_ngn || 0) + (r.shipping_fee_ngn || 0);
    r.cancelled_by = text(c.g('cancelled_by')); r.cancellation_reason = reason;
    const to = c.g('ship_to_state'); r.ship_to_state = standardState(to);
    if (!r.ship_to_state) c.out.errors.push(`ship_to_state "${String(to ?? '').slice(0, 25)}" is not a Nigerian state or a recognised variant`);
    else if (String(to) !== r.ship_to_state) c.fix('R6');
    const from = c.g('ship_from_state'); r.ship_from_state = standardState(from);
    if (!blank(from) && !r.ship_from_state) c.res.warnings.push({ row: c.rowNo, field: 'ship_from_state', message: `"${String(from).slice(0, 25)}" not recognised; stored as missing` });
    if (r.delivered_ts && r.shipped_ts && r.delivered_ts < r.shipped_ts) { [r.shipped_ts, r.delivered_ts] = [r.delivered_ts, r.shipped_ts]; c.fix('R7'); note = 'shipped_delivered_swapped_fixed'; }
    if ((r.order_status === 'delivered' || r.order_status === 'returned') && !r.delivered_ts) { c.fix('R9'); note = 'delivered_ts_missing'; }
    if (r.delivered_ts && r.order_purchase_ts && r.delivered_ts < r.order_purchase_ts) c.out.errors.push('delivered_ts is earlier than the purchase time');
    r.data_quality_note = note || text(c.g('data_quality_note'));
  }
  function cleanItem(c) {
    const r = c.out.r;
    r.order_id = text(c.g('order_id'), 40); req(c, 'order_id', r.order_id);
    r.order_item_seq = num(c, 'order_item_seq', { required: true });
    if (isNum(r.order_item_seq) && (!Number.isInteger(r.order_item_seq) || r.order_item_seq < 1)) c.out.errors.push('order_item_seq must be a whole number of 1 or more');
    r.product_id = text(c.g('product_id'), 40); req(c, 'product_id', r.product_id);
    r.seller_id = text(c.g('seller_id'), 40);
    r.quantity = num(c, 'quantity', { required: true });
    r.line_total_ngn = num(c, 'line_total_ngn', { required: true });
    r.item_discount_ngn = num(c, 'item_discount_ngn', { def: 0 });
    r.unit_price_ngn = num(c, 'unit_price_ngn');
    if (isNum(r.quantity) && r.quantity < 0 && isNum(r.line_total_ngn) && r.line_total_ngn > 0) { r.quantity = -r.quantity; c.fix('I4'); }
    if (isNum(r.quantity) && (r.quantity === 0 || !Number.isInteger(r.quantity) || r.quantity < 0)) c.out.errors.push(`quantity ${r.quantity} is not a positive whole number`);
    if (isNum(r.line_total_ngn) && r.line_total_ngn < 0) c.out.errors.push('line_total_ngn is negative');
    if (r.unit_price_ngn === null && isNum(r.line_total_ngn) && isNum(r.quantity) && r.quantity > 0) { r.unit_price_ngn = Math.round((r.line_total_ngn + (r.item_discount_ngn || 0)) / r.quantity); c.fix('I5'); }
  }
  function cleanReview(c) {
    const r = c.out.r;
    r.review_id = text(c.g('review_id'), 40);
    r.order_id = text(c.g('order_id'), 40); req(c, 'order_id', r.order_id);
    if (!r.review_id && r.order_id) r.review_id = `RV-${r.order_id}`;
    const raw = c.g('review_score'); const s = blank(raw) ? '' : String(raw);
    const m = s.match(/^\s*(\d+)/);
    if (!m) c.out.errors.push(blank(raw) ? 'review_score is missing' : `review_score "${s.slice(0, 15)}" has no number`);
    else {
      if (/[^\d\s]/.test(s)) c.fix('V2');
      r.review_score = +m[1];
      if (r.review_score < 1 || r.review_score > 5) { c.out.errors.push(`review_score ${r.review_score} is outside 1-5 (true score unknown, rule V3)`); c.fix('V3'); }
    }
    r.review_date = ts(c, 'review_date', { date: true, required: true });
    const com = c.g('review_comment');
    if (!blank(com) && String(com) !== String(com).trim()) c.fix('V5');
    r.review_comment = blank(com) ? null : String(com).trim().slice(0, 500);
    const f = flag(c.g('review_date_corrected')); r.review_date_corrected = f === undefined ? 0 : (f ?? 0);
  }
  function cleanCustomer(c) {
    const r = c.out.r;
    r.customer_id = text(c.g('customer_id'), 40); req(c, 'customer_id', r.customer_id);
    r.signup_date = ts(c, 'signup_date', { date: true });
    const st = c.g('customer_state'); r.customer_state = standardState(st);
    if (!r.customer_state) c.out.errors.push(`customer_state "${String(st ?? '').slice(0, 25)}" is not a Nigerian state or a recognised variant`);
    else if (String(st) !== r.customer_state) c.fix('C2');
    const ch = text(c.g('acquisition_channel'), 40);
    if (!ch) c.fix('C3');
    r.acquisition_channel = ch || 'Unknown';
    const f = flag(c.g('signup_date_imputed')); r.signup_date_imputed = f === undefined ? 0 : (f ?? 0);
  }
  function cleanSeller(c) {
    const r = c.out.r;
    r.seller_id = text(c.g('seller_id'), 40); req(c, 'seller_id', r.seller_id);
    r.seller_name = text(c.g('seller_name'), 80); req(c, 'seller_name', r.seller_name);
    r.seller_state = standardState(c.g('seller_state'));
    r.primary_category_id = text(c.g('primary_category_id'), 10);
    const tier = TIERS.find((t) => t.toLowerCase() === String(c.g('seller_tier') ?? '').trim().toLowerCase());
    if (!tier) c.out.errors.push(`seller_tier "${String(c.g('seller_tier') ?? '').slice(0, 20)}" is not one of ${TIERS.join(', ')}`); r.seller_tier = tier || null;
    const fm = FULFILMENT.find((t) => t.toLowerCase().replace('fulfilled', 'fulfil') === String(c.g('fulfilment_model') ?? '').trim().toLowerCase().replace('fulfilled', 'fulfil').replace('fulfillment', 'fulfilment'));
    if (!fm) c.out.errors.push(`fulfilment_model "${String(c.g('fulfilment_model') ?? '').slice(0, 25)}" is not one of ${FULFILMENT.join(', ')}`); r.fulfilment_model = fm || null;
    r.join_date = ts(c, 'join_date', { date: true }); r.status = text(c.g('status'), 20) || 'Active'; r.deactivated_date = ts(c, 'deactivated_date', { date: true });
  }
  function cleanProduct(c) {
    const r = c.out.r; const cats = new Set((window.MvData.refs.categories || []).map((x) => x.category_id));
    r.product_id = text(c.g('product_id'), 40); req(c, 'product_id', r.product_id);
    r.product_name = text(c.g('product_name'), 120); r.product_type = text(c.g('product_type'), 80);
    r.category_id = text(c.g('category_id'), 10);
    if (req(c, 'category_id', r.category_id) && !cats.has(r.category_id)) c.out.errors.push(`category_id "${r.category_id}" is not one of the 18 categories (C01-C18)`);
    r.seller_id = text(c.g('seller_id'), 40);
    r.list_price_ngn_2024 = num(c, 'list_price_ngn_2024', { required: true });
    if (isNum(r.list_price_ngn_2024) && r.list_price_ngn_2024 <= 0) c.out.errors.push('list_price_ngn_2024 must be above 0');
    const f = flag(c.g('is_bulky')); r.is_bulky = f === undefined ? 0 : (f ?? 0);
    r.listed_date = ts(c, 'listed_date', { date: true });
  }

  // ================================================================ processing a whole upload (all its tables)
  // current: { orders: [...], order_items: [...], ... } ; mode: append | merge | replace
  function processUpload(sheetsIn, current, mode) {
    const { sheets, ignored } = detectSheets(sheetsIn);
    const ctx = { testOrders: new Set() };
    const parts = {};
    for (const t of TABLE_ORDER) {
      const s = sheets.find((x) => x.table === t); if (!s) continue;
      const map = mapColumns(t, s.headers);
      if (map.missingRequired.length) { parts[t] = { sheet: s.name, table: t, map, fatal: `required columns missing: ${map.missingRequired.join(', ')}` }; continue; }
      parts[t] = { sheet: s.name, table: t, how: s.how, map, rows: s.rows.length, ...cleanTable(t, s, map, ctx) };
    }
    const usable = Object.values(parts).filter((p) => !p.fatal);
    if (mode === 'replace' && !(parts.orders && !parts.orders.fatal && parts.order_items && !parts.order_items.fatal)) {
      return { parts, ignored, blocking: 'Replacing the dataset needs both orders and order lines in the upload (reviews are optional and are cleared if absent).' };
    }
    if (!usable.length) return { parts, ignored, blocking: Object.values(parts).some((p) => p.fatal) ? 'A table in the file is missing required columns (details below).' : 'No sheet in the file matches a marketplace table.' };
    // ---- the tables as they would be after this upload (needed to check references between tables)
    const after = {};
    const keyed = (t, arr) => new Map(arr.map((r) => [keyOf(t, r), r]));
    Object.keys(TABLES).forEach((t) => {
      const up = parts[t] && !parts[t].fatal ? parts[t].accepted : null;
      if (mode === 'replace' && TRANSACTION_TABLES.includes(t)) after[t] = keyed(t, up || []);
      else if (mode === 'replace' && up) after[t] = keyed(t, up);
      else { const m = keyed(t, current[t] || []); (up || []).forEach((r) => { const k = keyOf(t, r); m.set(k, mode === 'append' && m.has(k) ? m.get(k) : { ...(m.get(k) || {}), ...stripNulls(r, mode) }); }); after[t] = m; }
    });
    const products = new Map([...after.products.values()].map((p) => [p.product_id, p]));
    const moveToRejected = (p, pred, reasonFn, type, rule) => {
      const keep = []; p.accepted.forEach((r) => { const why = pred(r); if (why) { p.rejected.push({ row: r._row, key: keyOf(p.table, r), reason: reasonFn(r, why), type }); if (rule) p.fixes[rule] = (p.fixes[rule] || 0) + 1; } else keep.push(r); }); p.accepted = keep;
    };
    // order lines: test-order orphans (I2), unknown orders, kobo prices (I3), unknown products
    if (parts.order_items && !parts.order_items.fatal) {
      const p = parts.order_items;
      moveToRejected(p, (r) => ctx.testOrders.has(r.order_id), () => 'Line of a removed test order (rule I2)', 'test', 'I2');
      moveToRejected(p, (r) => !after.orders.has(r.order_id), (r) => `Order ${r.order_id} does not exist in the data or in this upload`, 'orphan');
      p.accepted.forEach((r) => {
        const prod = products.get(r.product_id);
        if (!prod) { p.warnings.push({ row: r._row, field: 'product_id', message: `Product ${r.product_id} is not in the product list; its category is shown as Unknown` }); return; }
        if (isNum(r.unit_price_ngn) && r.unit_price_ngn > RULES.koboRatio * prod.list_price_ngn_2024) {
          ['unit_price_ngn', 'item_discount_ngn', 'line_total_ngn'].forEach((f) => { if (isNum(r[f])) r[f] = Math.round(r[f] / 100); });
          p.fixes.I3 = (p.fixes.I3 || 0) + 1;
        }
      });
    }
    // reviews: unknown orders; review dated before the delivery (V4)
    if (parts.reviews && !parts.reviews.fatal) {
      const p = parts.reviews;
      moveToRejected(p, (r) => !after.orders.has(r.order_id), (r) => `Order ${r.order_id} does not exist in the data or in this upload`, 'orphan');
      p.accepted.forEach((r) => {
        const o = after.orders.get(r.order_id); const ref = (o.delivered_ts || o.cancelled_ts || o.delivery_failed_ts || '').slice(0, 10);
        if (ref && r.review_date < ref) { r.review_date = ref; r.review_date_corrected = 1; p.fixes.V4 = (p.fixes.V4 || 0) + 1; }
      });
    }
    // orders: unknown sellers or customers are kept, with a warning
    if (parts.orders && !parts.orders.fatal) {
      const p = parts.orders;
      p.accepted.forEach((r) => {
        if (!after.sellers.has(r.seller_id)) p.warnings.push({ row: r._row, field: 'seller_id', message: `Seller ${r.seller_id} is not in the seller list; seller attributes shown as Unknown` });
        if (!after.customers.has(r.customer_id)) p.warnings.push({ row: r._row, field: 'customer_id', message: `Customer ${r.customer_id} is not in the customer list; location taken from ship_to_state` });
      });
    }
    // customers: signup date missing -> date of first order (C4); zone from the state
    if (parts.customers && !parts.customers.fatal) {
      const first = new Map(); after.orders.forEach((o) => { const d = (o.order_purchase_ts || '').slice(0, 10); if (d && (!first.has(o.customer_id) || d < first.get(o.customer_id))) first.set(o.customer_id, d); });
      const zones = new Map((window.MvData.refs.states || []).map((s) => [s.state, s.zone]));
      parts.customers.accepted.forEach((r) => {
        if (!r.signup_date) { parts.customers.fixes.C4 = (parts.customers.fixes.C4 || 0) + 1; const f = first.get(r.customer_id); if (f) { r.signup_date = f; r.signup_date_imputed = 1; } }
        r.customer_zone = zones.get(r.customer_state) || null;
      });
    }
    if (parts.sellers && !parts.sellers.fatal) { const zones = new Map((window.MvData.refs.states || []).map((s) => [s.state, s.zone])); parts.sellers.accepted.forEach((r) => { r.seller_zone = zones.get(r.seller_state) || null; }); }
    // ---- simulate the batch per table
    Object.values(parts).filter((p) => !p.fatal).forEach((p) => { p.sim = applyTable(p.table, current[p.table] || [], p.accepted, mode, p.map.present.concat(derivedPresent(p.table)), 'preview'); });
    return { parts, ignored, blocking: null };
  }
  const derivedPresent = (t) => ({ customers: ['customer_zone', 'signup_date_imputed'], sellers: ['seller_zone'], reviews: ['review_date_corrected'], orders: ['data_quality_note', 'cart_id', 'order_total_ngn'] }[t] || []);
  function stripNulls(r, mode) { if (mode !== 'merge') return r; const o = {}; Object.entries(r).forEach(([k, v]) => { if (v !== null && v !== undefined) o[k] = v; }); return o; }

  // ================================================================ applying a batch to one table
  const internal = (t, r) => { const o = {}; FIELD_KEYS[t].forEach((k) => { o[k] = r[k] ?? null; }); return o; };
  const same = (a, b, keys) => keys.every((k) => (a[k] ?? null) === (b[k] ?? null) || (isNum(a[k]) && isNum(b[k]) && Math.abs(a[k] - b[k]) < 1e-9));
  function applyTable(t, current, accepted, mode, present, batchId) {
    const s = { inserted: 0, updated: 0, unchanged: 0, duplicatesExisting: 0, conflicts: 0, removed: 0 }; const skipped = [];
    if (mode === 'replace' && (accepted.length || TRANSACTION_TABLES.includes(t))) {
      s.removed = current.length; s.inserted = accepted.length;
      return { next: accepted.map((r) => ({ ...internal(t, r), _batch: batchId })), summary: s, skipped };
    }
    const cols = present.filter((k) => FIELD_KEYS[t].includes(k));
    const idx = new Map(current.map((r, i) => [keyOf(t, r), i])); const next = current.slice();
    for (const rec of accepted) {
      const k = keyOf(t, rec); const i = idx.get(k); const clean = internal(t, rec);
      if (i === undefined) { idx.set(k, next.length); next.push({ ...clean, _batch: batchId }); s.inserted++; continue; }
      const old = next[i];
      if (mode === 'append') {
        if (same(old, clean, cols)) { s.duplicatesExisting++; skipped.push({ row: rec._row, key: k, reason: 'Already in the dataset with identical values (not added again)', type: 'duplicate_existing' }); }
        else { s.conflicts++; skipped.push({ row: rec._row, key: k, reason: 'Already exists with different values. Use "Update or add" to overwrite it', type: 'conflict' }); }
        continue;
      }
      const merged = { ...old }; cols.forEach((c) => { if (clean[c] !== null && clean[c] !== undefined) merged[c] = clean[c]; });
      if (same(old, merged, FIELD_KEYS[t])) { s.unchanged++; continue; }
      merged._batch = batchId; next[i] = merged; s.updated++;
    }
    return { next, summary: s, skipped };
  }

  // ================================================================ order-level analysis table
  const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +(t.slice(11, 13) || 0), +(t.slice(14, 16) || 0), +(t.slice(17, 19) || 0));
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function theme(c) {
    if (!c || !String(c).trim()) return 'No comment';
    const t = String(c).toLowerCase(); const hit = THEMES.find(([, keys]) => keys.some((k) => t.includes(k)));
    return hit ? hit[0] : 'Other';
  }
  function derive(tables) {
    const R = window.MvData.refs;
    const cats = new Map(R.categories.map((c) => [c.category_id, c]));
    const products = new Map(tables.products.map((p) => [p.product_id, p]));
    const sellers = new Map(tables.sellers.map((s) => [s.seller_id, s]));
    const zones = new Map(R.states.map((s) => [s.state, s.zone]));
    const cal = new Map(R.calendar.map((c) => [c.date, c]));
    const reviews = new Map(tables.reviews.map((r) => [r.order_id, r]));
    const lines = new Map();
    tables.order_items.forEach((it) => { if (!lines.has(it.order_id)) lines.set(it.order_id, []); lines.get(it.order_id).push(it); });
    const rows = tables.orders.map((o) => {
      const its = lines.get(o.order_id) || [];
      let units = 0, gross = 0, list = 0, bulky = 0, cat = null, disc = 0; let listKnown = true;
      its.forEach((it) => { const p = products.get(it.product_id); units += it.quantity || 0; gross += (it.quantity || 0) * (it.unit_price_ngn || 0); disc += it.item_discount_ngn || 0;
        if (p) { list += (it.quantity || 0) * p.list_price_ngn_2024; bulky = Math.max(bulky, p.is_bulky || 0); if (!cat) cat = p.category_id; } else listKnown = false; });
      const c = cats.get(cat); const s = sellers.get(o.seller_id); const rv = reviews.get(o.order_id);
      const pt = o.order_purchase_ts; const date = pt.slice(0, 10);
      const wd = (new Date(Date.UTC(+pt.slice(0, 4), +pt.slice(5, 7) - 1, +pt.slice(8, 10))).getUTCDay() + 6) % 7;
      const st = o.order_status; const cancelled = st === 'cancelled' ? 1 : 0;
      const hasDel = !!o.delivered_ts;
      const lateDays = hasDel && o.estimated_delivery_date ? Math.round((ms(o.delivered_ts.slice(0, 10)) - ms(o.estimated_delivery_date)) / 86400000) : null;
      const k = cal.get(date); const md = +date.slice(5, 7) * 100 + +date.slice(8, 10);
      return {
        order_id: o.order_id, cart_id: o.cart_id, customer_id: o.customer_id, seller_id: o.seller_id, seller_name: s ? s.seller_name : 'Unknown seller',
        seller_tier: s ? s.seller_tier : 'Unknown', fulfilment_model: s ? s.fulfilment_model : 'Unknown', order_purchase_ts: pt, date, month: pt.slice(0, 7), year: +pt.slice(0, 4),
        quarter: `${pt.slice(0, 4)}-Q${Math.ceil(+pt.slice(5, 7) / 3)}`, weekday: DAYS[wd], weekday_num: wd + 1, hour: +pt.slice(11, 13),
        category_id: cat || 'NA', category_name: c ? c.category_name : 'Unknown', category_group: c ? c.category_group : 'Unknown',
        payment_method: o.payment_method || 'Unknown', order_status: st, cancelled, open: st === 'shipped' || st === 'processing' ? 1 : 0,
        delivered: st === 'delivered' || st === 'returned' ? 1 : 0, returned: st === 'returned' ? 1 : 0, failed: st === 'delivery_failed' ? 1 : 0,
        cancelled_by: o.cancelled_by, cancellation_reason: o.cancellation_reason,
        lines: its.length, units, items_subtotal_ngn: o.items_subtotal_ngn, item_discount: disc, voucher_discount_ngn: o.voucher_discount_ngn, shipping_fee_ngn: o.shipping_fee_ngn,
        order_total_ngn: o.order_total_ngn, gmv: cancelled ? 0 : o.items_subtotal_ngn, gross_value: gross, list_value: listKnown && its.length ? list : null,
        ship_from_state: o.ship_from_state, ship_to_state: o.ship_to_state, zone: zones.get(o.ship_to_state) || 'Unknown', intra_state: o.ship_from_state && o.ship_from_state === o.ship_to_state ? 1 : 0,
        is_bulky: bulky, sales_event: k && k.sales_event ? k.sales_event : 'None',
        peak_logistics: k ? +k.is_peak_logistics || 0 : (md >= 1120 && md <= 1224 ? 1 : 0),
        promised_days: o.estimated_delivery_date ? Math.round((ms(o.estimated_delivery_date) - ms(date)) / 86400000) : null,
        delivery_days: hasDel ? (ms(o.delivered_ts) - ms(pt)) / 86400000 : null,
        late: lateDays === null ? null : lateDays > 0 ? 1 : 0, days_late: lateDays === null ? null : Math.max(0, lateDays),
        review_score: rv ? rv.review_score : null, reviewed: rv ? 1 : 0, low_rating: rv ? (rv.review_score <= RULES.lowRating ? 1 : 0) : null,
        review_comment: rv ? rv.review_comment : null, theme: rv ? theme(rv.review_comment) : null, data_quality_note: o.data_quality_note, _batch: o._batch,
      };
    });
    rows.sort((a, b) => (a.order_purchase_ts < b.order_purchase_ts ? -1 : a.order_purchase_ts > b.order_purchase_ts ? 1 : a.order_id < b.order_id ? -1 : 1));
    return rows;
  }

  // reference tables (categories, states, calendar) are fixed and come with the base data
  window.MvData = { refs: {}, readFile, readCsvText, readJson, detectSheets, mapColumns, cleanTable, processUpload, applyTable, derive, derivedPresent, parseTs, parseDate, parseNumber, standardState, theme, keyOf, FIELD_KEYS, UserError, blank };
})();

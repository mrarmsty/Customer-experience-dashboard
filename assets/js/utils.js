/* utils.js - formatting, safe HTML, statistics (incl. Kruskal-Wallis and chi-square), and file helpers shared by all modules. */
(function () {
  'use strict';

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // ---------- formatting ----------
  const fmtPct = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)}%` : 'n/a');
  const fmtPp = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)} pp` : 'n/a');
  const fmtSignedPct = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : 'n/a');
  const fmtNum = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
  const fmtScore = (v, d = 2) => (isNum(v) ? `${v.toFixed(d)} / 5` : 'n/a');
  const fmtDays = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)} days` : 'n/a');
  const fmtSigned = (v, d = 1, unit = '') => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}${unit}` : 'n/a');
  const fmtP = (p) => (!isNum(p) ? 'n/a' : p < 0.001 ? '< 0.001' : p.toFixed(3));
  const pText = (p) => (!isNum(p) ? 'p n/a' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
  // Nigerian naira. Compact: N2.09bn, N114.1k. The naira sign is used on screen; PDF text replaces it with "NGN ".
  const NAIRA = '\u20A6';
  function fmtNgn(v, compact = true) {
    if (!isNum(v)) return 'n/a';
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (!compact || a < 1e4) return `${sg}${NAIRA}${Math.round(a).toLocaleString('en-US')}`;
    if (a >= 1e9) return `${sg}${NAIRA}${(a / 1e9).toFixed(2)}bn`;
    if (a >= 1e6) return `${sg}${NAIRA}${(a / 1e6).toFixed(1)}m`;
    return `${sg}${NAIRA}${(a / 1e3).toFixed(1)}k`;
  }
  function fmtByUnit(v, unit) {
    switch (unit) {
      case 'pct': return fmtPct(v);
      case 'pp': return fmtPp(v);
      case 'ngn': return fmtNgn(v);
      case 'days': return fmtDays(v);
      case 'score': return isNum(v) ? v.toFixed(2) : 'n/a';
      case 'int': return fmtNum(v, 0);
      case 'idx': return isNum(v) ? v.toFixed(3) : 'n/a';
      default: return fmtNum(v, 1);
    }
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (ym) => (ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '');
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
  const quarterLabel = (q) => (q ? `${q.slice(5)} ${q.slice(0, 4)}` : '');
  function fmtBytes(b) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`; }

  // ---------- safety ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  // CSV formula-injection guard: text cells starting with = + - @ tab or CR are prefixed with an apostrophe.
  // Numbers are written as numbers and are never prefixed.
  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows, columns) {
    const head = columns.map((c) => csvCell(c.label || c.key)).join(',');
    const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
    return [head, ...body].join('\r\n');
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- statistics ----------
  const vals = (arr) => arr.filter(isNum);
  function mean(arr) { const a = vals(arr); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  function median(arr) {
    const a = vals(arr).sort((x, y) => x - y); if (!a.length) return null;
    const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function stdev(arr) {                          // sample standard deviation
    const a = vals(arr); if (a.length < 2) return null; const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  }
  function slope(xs, ys) {                       // OLS slope; needs >= 3 points
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    if (p.length < 3) return null;
    const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
    const den = p.reduce((s, [x]) => s + (x - mx) ** 2, 0);
    return den ? p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / den : null;
  }
  function linreg(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    const b = slope(p.map((q) => q[0]), p.map((q) => q[1])); if (b === null) return null;
    const a = mean(p.map((q) => q[1])) - b * mean(p.map((q) => q[0]));
    return { a, b, n: p.length };
  }
  // Regularised incomplete beta (continued fraction, Numerical Recipes) for Student t p-values.
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  const tTwoSidedP = (t, df) => ibeta(df / 2, 0.5, df / (df + t * t));
  function pearson(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    const n = p.length; if (n < 4) return { r: null, p: null, n };
    const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
    let sxy = 0, sxx = 0, syy = 0;
    p.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    if (!sxx || !syy) return { r: null, p: null, n };
    const r = sxy / Math.sqrt(sxx * syy);
    const t = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
    return { r, p: Number.isFinite(t) ? tTwoSidedP(t, n - 2) : 0, n };
  }
  function ranks(a) {                            // average ranks for ties
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; }
    return r;
  }
  function spearman(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    return pearson(ranks(p.map((q) => q[0])), ranks(p.map((q) => q[1])));
  }
  function describeCorr(r) {
    if (!isNum(r)) return 'not measurable';
    const a = Math.abs(r), dir = r > 0 ? 'positive' : 'negative';
    return a < 0.1 ? 'no meaningful' : a < 0.3 ? `weak ${dir}` : a < 0.5 ? `moderate ${dir}` : `strong ${dir}`;
  }
  // linear-interpolation quantile (same as numpy "linear")
  function quantile(arr, q) {
    const a = vals(arr).sort((x, y) => x - y); if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  // Regularised incomplete gamma P(a, x) and Q(a, x) (Numerical Recipes) for chi-square p-values.
  function gser(a, x) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-14) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  function gcf(a, x) { const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN; c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h; }
  function gammq(a, x) { if (x <= 0) return 1; return x < a + 1 ? 1 - gser(a, x) : gcf(a, x); }
  const chi2P = (stat, df) => (isNum(stat) && df > 0 ? gammq(df / 2, stat / 2) : null);
  // Kruskal-Wallis H test with tie correction (same as scipy.stats.kruskal); groups = arrays of numbers.
  function kruskal(groups) {
    const g = groups.map(vals).filter((a) => a.length > 0); const k = g.length;
    const all = g.flat(); const N = all.length;
    if (k < 2 || N <= k) return { H: null, p: null, df: k - 1, n: N, epsilon_sq: null };
    const r = ranks(all); let off = 0, sum = 0;
    g.forEach((a) => { let rs = 0; for (let i = 0; i < a.length; i++) rs += r[off + i]; off += a.length; sum += (rs * rs) / a.length; });
    let H = (12 / (N * (N + 1))) * sum - 3 * (N + 1);
    const counts = new Map(); all.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let t = 0; counts.forEach((c) => { t += c * c * c - c; });
    const C = 1 - t / (N * N * N - N); if (C > 0) H /= C;
    return { H, p: chi2P(H, k - 1), df: k - 1, n: N, epsilon_sq: (H - k + 1) / (N - k) };
  }
  // Pearson chi-square test of independence for a contingency table (array of rows), no continuity correction.
  function chiSquare(table) {
    const rows = table.filter((r) => r.reduce((s, v) => s + v, 0) > 0);
    const cols = rows.length ? rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0)) : [];
    const keep = cols.map((c) => c > 0);
    const t = rows.map((r) => r.filter((_, j) => keep[j])); const cs = cols.filter((c) => c > 0);
    const N = cs.reduce((s, v) => s + v, 0);
    if (t.length < 2 || cs.length < 2) return { chi2: null, p: null, df: 0, cramers_v: null, n: N, minExpected: null };
    let chi2 = 0, minE = Infinity;
    t.forEach((r) => { const rs = r.reduce((s, v) => s + v, 0); r.forEach((o, j) => { const e = (rs * cs[j]) / N; minE = Math.min(minE, e); chi2 += ((o - e) ** 2) / e; }); });
    const df = (t.length - 1) * (cs.length - 1);
    return { chi2, p: chi2P(chi2, df), df, cramers_v: Math.sqrt(chi2 / (N * (Math.min(t.length, cs.length) - 1))), n: N, minExpected: minE };
  }
  // two-sided 95% critical value of Student t (bisection on the exact p-value)
  function tCrit(df, alpha = 0.05) {
    if (!(df > 0)) return null; let lo = 0, hi = 100;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function meanCI(arr) {
    const a = vals(arr); const n = a.length; const m = mean(a); const sd = stdev(a);
    if (n < 2 || sd === null) return { mean: m, n, lo: null, hi: null, sd };
    const h = tCrit(n - 1) * sd / Math.sqrt(n); return { mean: m, n, lo: m - h, hi: m + h, sd };
  }
  // Wilson score interval for a proportion k / n
  function wilson(k, n, z = 1.959963984540054) {
    if (!n) return [null, null];
    const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return [(c - h) / d, (c + h) / d];
  }
  // relative risk of a (events a of n1) vs b (events b of n2) with a 95% CI (log method)
  function relRisk(a, n1, b, n2) {
    if (!a || !b || !n1 || !n2) return { rr: null, lo: null, hi: null };
    const rr = (a / n1) / (b / n2); const se = Math.sqrt(1 / a - 1 / n1 + 1 / b - 1 / n2);
    return { rr, lo: Math.exp(Math.log(rr) - 1.959963984540054 * se), hi: Math.exp(Math.log(rr) + 1.959963984540054 * se) };
  }
  function describeEffect(eps) { if (!isNum(eps)) return 'n/a'; return eps < 0.01 ? 'negligible' : eps < 0.06 ? 'small' : eps < 0.14 ? 'medium' : 'large'; }

  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  window.MvUtils = { isNum, fmtPct, fmtPp, fmtSignedPct, fmtNum, fmtSigned, fmtScore, fmtDays, fmtNgn, NAIRA, fmtP, pText, fmtByUnit, fmtBytes, monthLabel, hourLabel, quarterLabel, MONTHS, esc, csvCell, toCsv,
    download, stamp, mean, median, stdev, quantile, slope, linreg, pearson, spearman, ranks, describeCorr, describeEffect, tTwoSidedP, chi2P, kruskal, chiSquare, tCrit, meanCI,
    wilson, relRisk, debounce };
})();

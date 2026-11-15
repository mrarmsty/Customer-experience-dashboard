/* charts.js - ECharts builders. Colours come from CSS custom properties so light and dark mode share one code path.
   Rules: one value axis per chart; categorical colours in a fixed order; sequential colour = one hue; diverging =
   two hues with a grey middle; bars start at zero; units in every tooltip; small groups drawn pale. */
(function () {
  'use strict';
  const U = window.MvUtils;
  const instances = new Map();
  let animate = true;
  const setAnimation = (on) => { animate = on; };

  function palette(el) {
    const cs = getComputedStyle(el || document.documentElement); const css = (n) => cs.getPropertyValue(n).trim();
    return { text: css('--text-primary'), text2: css('--text-secondary'), muted: css('--text-muted'), grid: css('--grid'), axis: css('--axis'), surface: css('--surface-1'),
      series: [css('--series-1'), css('--series-2'), css('--series-3')], other: css('--series-other'), pos: css('--div-pos'), neg: css('--div-neg'), mid: css('--div-mid'),
      seqLo: css('--seq-lo'), seqHi: css('--seq-hi') };
  }
  function get(el) { let c = instances.get(el); if (!c || c.isDisposed()) { c = window.echarts.init(el, null, { renderer: 'canvas' }); instances.set(el, c); } return c; }
  function render(el, option, onClick) {
    const c = get(el); c.clear();
    c.setOption({ aria: { enabled: true }, animation: animate, animationDuration: 300, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' }, ...option }, true);
    c.off('click'); if (onClick) c.on('click', (p) => onClick(p));
    return c;
  }
  const ax = (P) => ({ axisLine: { lineStyle: { color: P.axis } }, axisTick: { show: false }, axisLabel: { color: P.text2, fontSize: 11 }, splitLine: { lineStyle: { color: P.grid } }, nameTextStyle: { color: P.text2, fontSize: 11 } });
  const tip = (P) => ({ backgroundColor: P.surface, borderColor: P.axis, textStyle: { color: P.text, fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:8px;' });
  const legend = (P) => ({ top: 0, left: 0, textStyle: { color: P.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8 });
  // axis labels: compact naira, %, days
  const axFmt = (unit) => (v) => (unit === 'pct' ? `${v}%` : unit === 'ngn' ? U.fmtNgn(v).replace('.00bn', 'bn').replace('.0m', 'm').replace('.0k', 'k') : unit === 'days' ? `${v}d` : `${v}`);
  // reference line; on a horizontal-bar chart (vertical line) the label sits above the plot so it never covers bars
  const mark = (P, value, label, axis = 'yAxis') => ({ silent: true, symbol: 'none', lineStyle: { color: P.text2, type: 'dashed', width: 1 }, label: { color: P.text2, fontSize: 10, formatter: label, position: axis === 'xAxis' ? 'end' : 'insideEndTop', rotate: axis === 'xAxis' ? 0 : undefined, backgroundColor: P.surface, padding: [1, 3] }, data: [{ [axis]: value }] });
  function empty(el, msg = 'No data for the current filters') { render(el, { title: { text: msg, left: 'center', top: 'middle', textStyle: { color: palette(el).muted, fontSize: 13, fontWeight: 'normal' } } }); }

  // ---------------------------------------------------------------- one measure over time (line)
  function trend(el, items, { labelKey = 'month', labelFmt = U.monthLabel, valueKey, unit, label, overall, onClick, tipExtra }) {
    const P = palette(el); const data = items.map((x) => (U.isNum(x[valueKey]) ? +x[valueKey].toFixed(4) : null));
    if (!data.some((v) => v !== null)) return empty(el);
    render(el, {
      grid: { left: 64, right: 24, top: 24, bottom: 40 },
      tooltip: { ...tip(P), trigger: 'axis', formatter: (ps) => { const x = items[ps[0].dataIndex]; return `<b>${labelFmt(x[labelKey])}</b><br/>${label}: <b>${U.fmtByUnit(x[valueKey], unit)}</b>${tipExtra ? `<br/>${tipExtra(x)}` : ''}`; } },
      xAxis: { type: 'category', data: items.map((x) => labelFmt(x[labelKey])), boundaryGap: false, ...ax(P), splitLine: { show: false }, axisLabel: { color: P.text2, fontSize: 10, rotate: items.length > 12 ? 40 : 0 } },
      yAxis: { type: 'value', min: unit === 'score' ? 1 : 0, max: unit === 'score' ? 5 : undefined, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(unit) } },
      series: [{ name: label, type: 'line', data, symbol: 'circle', symbolSize: 7, lineStyle: { width: 2, color: P.series[0] }, itemStyle: { color: P.series[0], borderColor: P.surface, borderWidth: 2 },
        markLine: U.isNum(overall) ? mark(P, +overall.toFixed(4), `period ${U.fmtByUnit(overall, unit)}`) : undefined }],
    }, onClick && ((p) => onClick(items[p.dataIndex][labelKey])));
  }

  // ---------------------------------------------------------------- several categories over time; top 3 highlighted, rest grey
  function multiTrend(el, labels, series, { unit, labelFmt = (x) => x }) {
    const P = palette(el); if (!series.length) return empty(el);
    const ranked = series.slice().sort((a, b) => b.total - a.total); const hi = new Map(ranked.slice(0, 3).map((s, i) => [s.name, P.series[i]]));
    render(el, {
      grid: { left: 64, right: 150, top: 16, bottom: 30 },
      tooltip: { ...tip(P), trigger: 'axis', order: 'valueDesc', formatter: (ps) => `<b>${labelFmt(labels[ps[0].dataIndex])}</b><br/>${ps.filter((p) => U.isNum(p.value)).sort((a, b) => b.value - a.value).slice(0, 8).map((p) => `${p.marker}${U.esc(p.seriesName)}: ${U.fmtByUnit(p.value, unit)}`).join('<br/>')}` },
      xAxis: { type: 'category', data: labels.map(labelFmt), boundaryGap: false, ...ax(P), splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(unit) } },
      series: ranked.slice().reverse().map((s) => { const c = hi.get(s.name) || P.other; const isHi = hi.has(s.name);
        return { name: s.name, type: 'line', data: s.values, symbol: isHi ? 'circle' : 'none', symbolSize: 6, z: isHi ? 3 : 1, lineStyle: { width: isHi ? 2.2 : 1, color: c, opacity: isHi ? 1 : 0.55 }, itemStyle: { color: c },
          endLabel: isHi ? { show: true, formatter: s.name, color: P.text, fontSize: 11, distance: 6 } : undefined, emphasis: { focus: 'series' } }; }),
    });
  }

  // ---------------------------------------------------------------- horizontal bars with optional reference line and CI whiskers
  function hbar(el, items, { labelKey = 'group', valueKey, unit = 'pct', overall, overallLabel = 'all', nKey, nLabel = '', onClick, sort = 'desc', ci, max, highlightTop = 0, color }) {
    const P = palette(el);
    let data = items.filter((d) => U.isNum(d[valueKey]));
    if (sort) data = data.slice().sort((a, b) => (sort === 'desc' ? a[valueKey] - b[valueKey] : b[valueKey] - a[valueKey])); else data = data.slice().reverse();
    if (!data.length) return empty(el);
    const top = data.slice().sort((a, b) => b[valueKey] - a[valueKey]).slice(0, highlightTop).map((d) => d[labelKey]);
    const series = [{ type: 'bar', barMaxWidth: 18, data: data.map((d) => ({ value: +d[valueKey].toFixed(4), itemStyle: { color: color || (highlightTop && !top.includes(d[labelKey]) ? P.other : P.series[0]), opacity: d.small ? 0.45 : 1, borderRadius: [0, 4, 4, 0] } })),
      label: ci ? undefined : { show: true, position: 'right', color: P.text2, fontSize: 10, formatter: (p) => `${U.fmtByUnit(p.value, unit)}${nKey ? `  n=${U.fmtNum(data[p.dataIndex][nKey])}` : ''}` },
      markLine: U.isNum(overall) ? mark(P, +overall.toFixed(4), `${overallLabel} ${U.fmtByUnit(overall, unit)}`, 'xAxis') : undefined }];
    if (ci) {
      series.push({ type: 'custom', silent: true, z: 10, data: data.map((d, i) => [i, d[ci[0]], d[ci[1]]]).filter((d) => U.isNum(d[1])),
        renderItem: (params, api) => { const i = api.value(0); const a = api.coord([api.value(1), i]); const b = api.coord([api.value(2), i]); const h = 5; const st = { stroke: P.text, lineWidth: 1.3 };
          return { type: 'group', children: [{ type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: st }, { type: 'line', shape: { x1: a[0], y1: a[1] - h, x2: a[0], y2: a[1] + h }, style: st }, { type: 'line', shape: { x1: b[0], y1: b[1] - h, x2: b[0], y2: b[1] + h }, style: st }] }; } });
      series.push({ type: 'scatter', silent: true, symbolSize: 0, z: 11, data: data.map((d, i) => [Math.max(d[valueKey], U.isNum(d[ci[1]]) ? d[ci[1]] : d[valueKey]), i]),
        label: { show: true, position: 'right', distance: 6, color: P.text2, fontSize: 10, formatter: (p) => `${U.fmtByUnit(data[p.dataIndex][valueKey], unit)}${nKey ? `  n=${U.fmtNum(data[p.dataIndex][nKey])}` : ''}` } });
    }
    render(el, {
      grid: { left: 10, right: 96, top: U.isNum(overall) ? 26 : 16, bottom: 24, containLabel: true },
      tooltip: { ...tip(P), trigger: 'item', formatter: (p) => { const d = data[p.dataIndex]; if (!d) return '';
        return `<b>${U.esc(d[labelKey])}</b><br/>${U.fmtByUnit(d[valueKey], unit)}${ci && U.isNum(d[ci[0]]) ? `<br/>95% CI ${U.fmtByUnit(d[ci[0]], unit)} to ${U.fmtByUnit(d[ci[1]], unit)}` : ''}${nKey ? `<br/>${U.fmtNum(d[nKey])} ${nLabel}` : ''}${d.tipExtra ? `<br/>${d.tipExtra}` : ''}${d.small ? '<br/><i>Small group: treat with caution</i>' : ''}`; } },
      xAxis: { type: 'value', min: 0, max, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(unit) } },
      yAxis: { type: 'category', data: data.map((d) => d[labelKey]), ...ax(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11, width: 150, overflow: 'truncate' } },
      series,
    }, onClick && ((p) => data[p.dataIndex] && onClick(data[p.dataIndex][labelKey])));
  }

  // ---------------------------------------------------------------- vertical bars
  function vbar(el, items, { labelKey, valueKey, unit = 'int', colorFn, labelFmt = (x) => x, tipFn, showLabels = true }) {
    const P = palette(el); if (!items.some((d) => U.isNum(d[valueKey]) && d[valueKey] > 0)) return empty(el);
    render(el, {
      grid: { left: 10, right: 16, top: 24, bottom: 24, containLabel: true },
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => { const d = items[ps[0].dataIndex]; return tipFn ? tipFn(d) : `<b>${U.esc(labelFmt(d[labelKey]))}</b><br/>${U.fmtByUnit(d[valueKey], unit)}`; } },
      xAxis: { type: 'category', data: items.map((d) => labelFmt(d[labelKey])), ...ax(P), splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(unit) } },
      series: [{ type: 'bar', barMaxWidth: 46, data: items.map((d) => ({ value: d[valueKey], itemStyle: { color: colorFn ? colorFn(d, P) : P.series[0], borderRadius: [4, 4, 0, 0] } })),
        label: showLabels ? { show: true, position: 'top', color: P.text2, fontSize: 10, formatter: (p) => U.fmtByUnit(p.value, unit) } : undefined }],
    });
  }

  // ---------------------------------------------------------------- stacked or grouped bars (2-3 series)
  function stacked(el, labels, series, { unit = 'int', stack = true, labelFmt = (x) => x, horizontal = false, tipFn, max }) {
    const P = palette(el); if (!labels.length) return empty(el);
    const cat = { type: 'category', data: labels.map(labelFmt), ...ax(P), splitLine: { show: false }, axisLabel: { color: horizontal ? P.text : P.text2, fontSize: horizontal ? 11 : 10, rotate: !horizontal && labels.length > 12 ? 40 : 0, width: 150, overflow: 'truncate' }, inverse: horizontal };
    const val = { type: 'value', min: 0, max, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(unit) } };
    render(el, {
      grid: { left: 10, right: 24, top: 30, bottom: 24, containLabel: true }, legend: legend(P),
      tooltip: { ...tip(P), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tipFn ? (ps) => tipFn(ps[0].dataIndex) : (ps) => `<b>${U.esc(labelFmt(labels[ps[0].dataIndex]))}</b><br/>${ps.map((p) => `${p.marker}${p.seriesName}: ${U.fmtByUnit(p.value, unit)}`).join('<br/>')}` },
      xAxis: horizontal ? val : cat, yAxis: horizontal ? cat : val,
      series: series.map((s, i) => ({ name: s.name, type: 'bar', stack: stack ? 's' : undefined, barMaxWidth: stack ? 26 : 12, barGap: '15%', data: s.data,
        itemStyle: { color: s.color(P), borderColor: P.surface, borderWidth: stack ? 1 : 0, borderRadius: stack ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } })),
    });
  }

  // ---------------------------------------------------------------- heatmap (sequential single hue from zero)
  function heatmap(el, grid, xLabels, yLabels, { unitLabel = '', fmt = (v) => U.fmtNum(v) } = {}) {
    const P = palette(el); const data = []; let max = 0;
    grid.forEach((row, y) => row.forEach((v, x) => { if (U.isNum(v)) { data.push([x, y, v]); max = Math.max(max, v); } }));
    if (!max) return empty(el);
    render(el, {
      grid: { left: 10, right: 16, top: 8, bottom: 56, containLabel: true },
      tooltip: { ...tip(P), formatter: (p) => `<b>${yLabels[p.value[1]]} ${xLabels[p.value[0]]}</b><br/>${fmt(p.value[2])} ${unitLabel}` },
      xAxis: { type: 'category', data: xLabels, ...ax(P), splitLine: { show: false } },
      yAxis: { type: 'category', data: yLabels, inverse: true, ...ax(P), splitLine: { show: false }, axisLabel: { color: P.text, fontSize: 11 } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, text: [`${fmt(max)} ${unitLabel}`, '0'], textStyle: { color: P.text2, fontSize: 10 }, inRange: { color: [P.seqLo, P.seqHi] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: P.surface, borderWidth: 2, borderRadius: 3 } }],
    });
  }

  // ---------------------------------------------------------------- bubble scatter
  function scatter(el, points, { xKey, yKey, sizeKey, xUnit, yUnit, xName, yName, labelKey, flagKey, flagLabel = 'Flagged', otherLabel = 'Not flagged', xRef, yRef, labelKeys, onClick }) {
    const P = palette(el); if (!points.length) return empty(el);
    const maxS = Math.max(...points.map((p) => p[sizeKey] || 0)) || 1;
    const sz = (v) => 8 + 28 * Math.sqrt((v || 0) / maxS);
    const labelled = new Set(labelKeys || []);
    const mk = (pts, name, color) => ({ name, type: 'scatter', data: pts.map((p) => ({ value: [p[xKey], p[yKey]], symbolSize: sz(p[sizeKey]), p })),
      itemStyle: { color, opacity: 0.8, borderColor: P.surface, borderWidth: 1.5 },
      label: { show: true, formatter: (q) => (labelled.has(q.data.p[labelKey]) ? q.data.p[labelKey] : ''), position: 'right', color: P.text2, fontSize: 10 }, labelLayout: { hideOverlap: true } });
    const series = flagKey ? [mk(points.filter((p) => !p[flagKey]), otherLabel, P.series[0]), mk(points.filter((p) => p[flagKey]), flagLabel, P.series[1])] : [mk(points, '', P.series[0])];
    if (U.isNum(xRef) || U.isNum(yRef)) series[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: P.text2, type: 'dashed' }, label: { color: P.text2, fontSize: 10 },
      data: [U.isNum(xRef) ? { xAxis: +xRef.toFixed(3), label: { formatter: `all ${U.fmtByUnit(xRef, xUnit)}` } } : null, U.isNum(yRef) ? { yAxis: +yRef.toFixed(3), label: { formatter: `all ${U.fmtByUnit(yRef, yUnit)}` } } : null].filter(Boolean) };
    render(el, {
      grid: { left: 10, right: 40, top: 36, bottom: 36, containLabel: true }, legend: flagKey ? { ...legend(P), left: 'auto', right: 0 } : undefined,
      tooltip: { ...tip(P), trigger: 'item', formatter: (q) => { const p = q.data.p; return `<b>${U.esc(p[labelKey])}</b>${p.tipExtra ? ` ${p.tipExtra}` : ''}<br/>${xName}: ${U.fmtByUnit(p[xKey], xUnit)}<br/>${yName}: ${U.fmtByUnit(p[yKey], yUnit)}`; } },
      xAxis: { type: 'value', name: xName, nameLocation: 'middle', nameGap: 26, min: 0, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(xUnit) } },
      yAxis: { type: 'value', name: yName, nameLocation: 'end', min: 0, ...ax(P), axisLabel: { color: P.text2, fontSize: 11, formatter: axFmt(yUnit) } },
      series,
    }, onClick && ((q) => onClick(q.data.p[labelKey])));
  }

  function resizeAll() { instances.forEach((c) => { if (!c.isDisposed()) c.resize(); }); }
  function image(el) { const c = instances.get(el); return c && !c.isDisposed() ? c.getDataURL({ type: 'jpeg', pixelRatio: 2, backgroundColor: '#ffffff' }) : null; }

  window.MvCharts = { trend, multiTrend, hbar, vbar, stacked, heatmap, scatter, resizeAll, image, palette, setAnimation };
})();

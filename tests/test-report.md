# Test report

Automated run: 2026-11-15 22:52:05 UTC in Chromium (Playwright). Result: **150 of 150 checks passed**, 0 failed.

Every check below was executed by `tests/run_tests.js` against the running dashboard; nothing here is marked as passed without being run.
Expected values never come from the dashboard itself: they come from `scripts/prepare_analysis.py` (pandas, SciPy, statsmodels; saved in `data/processed/reference_values.json` and `orders_analysis.csv`), from the source workbook's cleaning log, or are counted directly from the data files by the test script.

## Acceptance checklist

| Requirement | Tests | Checks | Status |
|---|---|---:|---|
| Dashboard loads correctly | T01 | 40 | Passed |
| Charts render correctly | T02 | 22 | Passed |
| KPI calculations match the underlying data | T01 | 40 | Passed |
| Filters work correctly | T03 | 11 | Passed |
| Charts update when filters are applied | T03 | 11 | Passed |
| Tables reflect selected filters | T03 | 11 | Passed |
| Additional data can be uploaded | T05 T09 | 14 | Passed |
| Invalid data is handled correctly | T04 T05 T07 | 19 | Passed |
| Duplicate records are handled appropriately | T07 | 4 | Passed |
| Successful uploads update all dependent metrics | T05 T08 | 13 | Passed |
| Local persistence works | T06 | 1 | Passed |
| Reset functionality works | T13 | 6 | Passed |
| Analysis report downloads successfully | T12 | 18 | Passed |
| Downloaded report reflects current data | T12 | 18 | Passed |
| Dataset export downloads successfully | T11 | 6 | Passed |
| Exported data matches the analysed dataset | T11 | 6 | Passed |
| Mobile and desktop layouts work | T15 | 11 | Passed |
| GitHub Pages deployment paths are valid | T16 | 5 | Passed |
| Cleaning the raw sheets in the browser reproduces the clean tables | T14 | 4 | Passed |

**Not tested:** an actual publish to GitHub Pages. No repository was pushed from this environment. The checks in T16 confirm the conditions GitHub Pages needs: every asset path is relative, every referenced file exists, no server code or external request is used, and the page works when opened directly from disk. Browsers other than Chromium (Firefox, Safari) and screen-reader software were not tested.

## All checks

### T01 load and KPI accuracy

| Check | Result | Detail |
|---|---|---|
| all clean tables loaded (19,438 orders, 28,109 lines, 11,211 reviews, 14,800 customers) | Pass | [19438,28109,11211,14800] |
| KPI orders matches pandas | Pass | 19438 vs 19438 |
| KPI gmv matches pandas | Pass | 2091691150 vs 2091691150 |
| KPI real_gmv matches pandas | Pass | 1621137332.7947738 vs 1621137332.7947817 |
| KPI aov matches pandas | Pass | 114144.12824010914 vs 114144.12824010914 |
| KPI units matches pandas | Pass | 34106 vs 34106 |
| KPI net_delivered_gmv matches pandas | Pass | 1904188530 vs 1904188530 |
| KPI cancel_rate matches pandas | Pass | 5.725897726103509 vs 5.725897726103509 |
| KPI return_rate matches pandas | Pass | 6.787509176125134 vs 6.787509176125134 |
| KPI delivered_of_closed matches pandas | Pass | 92.72698711907006 vs 92.72698711907006 |
| KPI delivery_success matches pandas | Pass | 98.46538782318599 vs 98.46538782318599 |
| KPI avg_days matches pandas | Pass | 4.609128427729323 vs 4.609128427729302 |
| KPI median_days matches pandas | Pass | 4.19587962962963 vs 4.19587962962963 |
| KPI late_rate matches pandas | Pass | 13.281471807393105 vs 13.281471807393105 |
| KPI avg_days_late matches pandas | Pass | 1.7473279179136383 vs 1.7473279179136383 |
| KPI reviews matches pandas | Pass | 11211 vs 11211 |
| KPI review_rate matches pandas | Pass | 57.6756867990534 vs 57.6756867990534 |
| KPI avg_score matches pandas | Pass | 3.8604941575238607 vs 3.8604941575238607 |
| KPI low_rate matches pandas | Pass | 12.701810721612702 vs 12.701810721612702 |
| customers: purchasing, ordering, repeat rate, purchases and spend per customer match pandas | Pass | {"purchasing":11173,"ordering":11673,"repeat":29.911393537993376,"cpc":1.5420209433455652,"spc":187209.44688087353,"coho |
| year on year GMV (nominal and constant prices) and orders match pandas | Pass | 55.848427836744754, 26.408141986344692 |
| monthly price index identical (24 months) | Pass |  |
| orders and GMV by month identical | Pass |  |
| category GMV, orders and units identical (18 categories) | Pass |  |
| category AOV, cancellation, late, score and 1-2 star rates identical | Pass |  |
| category 1-2 star rate for on-time deliveries identical | Pass |  |
| region orders, spend per customer and delivery days identical | Pass |  |
| state orders, delivery days and late rates identical (37 states) | Pass |  |
| late vs 1-2 star: rates, chi-square, relative risk and CI match SciPy | Pass | RR 4.184182869153967 |
| Spearman days late vs score matches SciPy | Pass |  |
| Kruskal-Wallis score by category matches SciPy | Pass |  |
| chi-square cancellation by category matches SciPy | Pass |  |
| chi-square 1-2 stars by category (all and on-time) match SciPy | Pass |  |
| Kruskal-Wallis delivery days by state matches SciPy | Pass |  |
| monthly order trend slope and p-value match SciPy linregress | Pass |  |
| lateness buckets (n, average score, 1-2 star share) identical | Pass |  |
| flagged sellers identical (late: 25, low ratings: 13) | Pass |  |
| complaint themes of 1-2 star reviews identical | Pass |  |
| cohort retention matrix identical | Pass |  |
| KPI cards show formatted values | Pass | GMV iGMVGross merchandise value: sum of line totals (after item discounts, before vouchers and shipping) of orders that  |

### T02 charts render

| Check | Result | Detail |
|---|---|---|
| overview: cMonth has data | Pass | 1 series |
| overview: cCatOv has data | Pass | 1 series |
| categories: cCatRank has data | Pass | 1 series |
| categories: cCatMatrix has data | Pass | 1 series |
| categories: cCatTrend has data | Pass | 18 series |
| customers: cPurch has data | Pass | 1 series |
| customers: cNewRet has data | Pass | 2 series |
| customers: cZoneSpend has data | Pass | 1 series |
| customers: cStateOrders has data | Pass | 1 series |
| customers: cChannel has data | Pass | 1 series |
| customers: cOrderHeat has data | Pass | 1 series |
| delivery: cDelMonth has data | Pass | 1 series |
| delivery: cDelHist has data | Pass | 2 series |
| delivery: cZoneDays has data | Pass | 1 series |
| delivery: cSellerLate has data | Pass | 3 series |
| experience: cLateness has data | Pass | 1 series |
| experience: cScoreDist has data | Pass | 1 series |
| experience: cCatLow has data | Pass | 2 series |
| experience: cThemes has data | Pass | 1 series |
| sellers: cSellerScatter has data | Pass | 2 series |
| cohort table shows 8 quarterly cohorts | Pass |  |
| measure selectors switch without errors | Pass |  |

### T03 filters

| Check | Result | Detail |
|---|---|---|
| month filter Jan-Jun 2025 keeps exactly the matching orders | Pass | 4107 vs 4107 |
| region filter: North East only | Pass | 444 vs 444 |
| active filter chip shown | Pass | Region: North East ✕ |
| removing the chip removes the filter | Pass |  |
| filters combine (Marketplace Fulfilled + Women's Fashion) | Pass | 1128 vs 1128 |
| data explorer reflects filters | Pass | 1,128 of 19,438 orders (1,128 after filters). Page 1 of 23. |
| explorer search narrows rows (seller SL180) | Pass | 1,820 of 19,438 orders (19,438 after filters, 1,820 matching "SL180"). Page 1 of 37. |
| explorer sorts by order value (largest first) | Pass | 3494370 |
| pagination controls rendered | Pass |  |
| clicking a category bar filters the dashboard (Computing = 849 orders) | Pass | 849 |
| seller scorecard "flagged only" lists every flagged seller | Pass | 28 vs 28 |

### T04 invalid files

| Check | Result | Detail |
|---|---|---|
| missing required column rejected with explanation | Pass |        02_missing_required_column.csv · 848 B · mode: Add new records       Cannot apply. A table in the file is missing required columns (d |
| wrong file type rejected | Pass |  |
| file over 25 MB rejected | Pass |  |
| dataset unchanged after rejected files | Pass |  |

### T05 append upload

| Check | Result | Detail |
|---|---|---|
| preview totals: 23 rows, 17 new, 1 duplicate, 3 rejected, 2 test records | Pass | {"rows in file":23,"passed cleaning and validation":19,"rejected":3,"duplicates":1,"new records to add":17,"test records removed":2} |
| per-table rows: orders, order lines and reviews recognised by sheet name | Pass |  |
| cleaning applied and reported (R2 test order, R3 date, R5 payment, R6 state, I2 test line, V2 text score) | Pass | R3: 1 day-first dates parsed,R5: 1 payment labels standardised,R6: 1 state names standardised,R2: 1 test orders removedOrder linesorder_item |
| rejection reasons listed (bad status, missing order, conflict) | Pass |  |
| validation results downloadable | Pass | upload_validation_01_append_orders_lines_reviews.xlsx_2026-11-15.csv |
| confirmation sentence uses actual counts | Pass | Data successfully added. 23 records were processed, 17 were accepted (17 added), 1 duplicate was detected and 5 records were rejected.Orders |
| tables grow: 19,444 orders, 28,115 lines, 11,216 reviews | Pass | [19444,28115,11216] |
| KPIs recalculated (orders 19,444; GMV up) | Pass | 2091882100 |
| raw-style order cleaned: day-first date, POD -> Pay on delivery, "Lagos State" -> Lagos | Pass | ["2026-01-04 10:15:00","Pay on delivery","Lagos"] |
| month filter gains Jan 2026 | Pass |  |
| header shows working dataset status | Pass |  |

### T06 local persistence

| Check | Result | Detail |
|---|---|---|
| after reload the working dataset (19,444 orders, 1 upload) is restored from IndexedDB | Pass | 19444, 1 |

### T07 duplicate handling

| Check | Result | Detail |
|---|---|---|
| re-uploading the same workbook adds nothing (18 duplicates) | Pass | {"rows in file":23,"passed cleaning and validation":19,"rejected":3,"duplicates":18,"new records to add":0,"test records removed":2} |
| apply button disabled when nothing to add | Pass |  |
| reviews: older version superseded, text score read, out-of-range score rejected | Pass | {"rows in file":4,"passed cleaning and validation":2,"rejected":1,"duplicates":1,"new records to add":2} |
| latest review version kept (score 4, comment trimmed) and "4/5" stored as 4 | Pass | MV000003:4:edited version / MV000005:4:null |

### T08 update or add (merge)

| Check | Result | Detail |
|---|---|---|
| merge mode: the open order now delivered is an update; nothing new | Pass | {"rows in file":23,"passed cleaning and validation":19,"rejected":2,"duplicates":0,"new records to add":0,"records to update":1,"test record |
| order status updated from shipped to delivered and delivery measures recalculated | Pass | shipped -> delivered/1/0 |

### T09 JSON and alternative headers

| Check | Result | Detail |
|---|---|---|
| JSON with orders and order lines accepted (6 new records) | Pass | {"rows in file":6,"passed cleaning and validation":6,"rejected":0,"duplicates":0,"new records to add":6} |
| alternative column names mapped and reported | Pass |  |
| labels standardised (in_transit -> shipped, Completed -> delivered, Abuja -> FCT) and category assigned | Pass | ALIAS0/shipped/FCT/Men's Fashion ; ALIAS1/delivered/Rivers/Home & Kitchen ; ALIAS2/delivered/Rivers/Shoes & Bags |

### T10 security

| Check | Result | Detail |
|---|---|---|
| HTML in uploaded text is shown as text, not executed | Pass | img 0, alerts 0 |
| exported CSV neutralises formula text | Pass |  |

### T11 data export

| Check | Result | Detail |
|---|---|---|
| full CSV export has every analysed order | Pass | 19449 vs 19449 |
| export includes uploaded orders and the source column | Pass |  |
| all 19,438 base orders in the export match the pandas analysis file (38 fields each) | Pass |  |
| filtered CSV export matches the filtered view | Pass | 6710 vs 6710 |
| Excel export opens with orders, lines, reviews, 4 summaries and About | Pass | ['Orders (analysis)', 'Order lines', 'Reviews', 'By month', 'By category', 'By state', 'Seller scorecard', 'About'] 19449 28120 11218 |
| category summary CSV downloads | Pass | marketvale_category_summary_filtered_2026-11-15.csv |

### T12 PDF report

| Check | Result | Detail |
|---|---|---|
| filtered report downloads as a valid PDF | Pass | 8 pages |
| report states scope and filters | Pass |  |
| report has section "1. Business context and problem" | Pass |  |
| report has section "2. Purpose and objectives" | Pass |  |
| report has section "3. Dataset overview" | Pass |  |
| report has section "4. Data preparation" | Pass |  |
| report has section "5. Analytical methods" | Pass |  |
| report has section "6. KPI definitions" | Pass |  |
| report has section "7. Key numerical results" | Pass |  |
| report has section "8. Key findings" | Pass |  |
| report has section "9. Areas requiring management attention" | Pass |  |
| report has section "10. Business interpretation" | Pass |  |
| report has section "11. Recommendations" | Pass |  |
| report has section "12. Limitations" | Pass |  |
| report reflects uploaded data (upload history) | Pass |  |
| full-dataset report covers every order | Pass | 19449 |
| report embeds 6 chart images | Pass |  |
| report text is plain ASCII with amounts in NGN | Pass |  |

### T13 undo and reset

| Check | Result | Detail |
|---|---|---|
| undo removes the last upload (security file) | Pass | 19447, 4 |
| replace asks for confirmation | Pass |  |
| replace leaves only the 40 orders in the file, and no reviews | Pass | 40, 40, 0 |
| undoing a replace restores the previous data | Pass | 19447 |
| reset returns to the original 19,438 orders | Pass |  |
| after reset and reload, local data is gone | Pass |  |

### T14 raw data cleaning

| Check | Result | Detail |
|---|---|---|
| raw workbook (4 sheets, 73,914 rows) read and cleaned in the browser | Pass | 4.4 s |
| every cleaning-rule count equals the workbook cleaning log (23 rules) | Pass | {"R3":971,"R5":1943,"R4":1555,"R6":663,"R2":18,"R9":98,"R7":25,"R1":140,"R8":30,"I4":20,"I5":25,"I1":60,"I2":18,"I3":25,"V5":200,"V3":30,"V2 |
| rebuilt orders, lines, reviews and customers are identical to the clean tables | Pass | {"orders":{"n":19438,"base":19438,"diff":0},"order_items":{"n":28109,"base":28109,"diff":0},"reviews":{"n":11211,"base":11211,"diff":0},"cus |
| KPIs after replacing with the cleaned raw data equal the reference | Pass |  |

### T15 layout and accessibility

| Check | Result | Detail |
|---|---|---|
| dark mode applied | Pass |  |
| arrow keys move between tabs | Pass |  |
| visible charts have text alternatives | Pass |  |
| mobile 390px: no horizontal page scroll on overview | Pass | 0px |
| mobile 390px: no horizontal page scroll on categories | Pass | 0px |
| mobile 390px: no horizontal page scroll on customers | Pass | 0px |
| mobile 390px: no horizontal page scroll on delivery | Pass | 0px |
| mobile 390px: no horizontal page scroll on experience | Pass | 0px |
| mobile 390px: no horizontal page scroll on sellers | Pass | 0px |
| mobile 390px: no horizontal page scroll on data | Pass | 0px |
| tablet 820px: no horizontal page scroll | Pass |  |

### T16 deployment

| Check | Result | Detail |
|---|---|---|
| all asset references are relative | Pass |  |
| every referenced file exists | Pass |  |
| dashboard works opened directly from disk (file://) | Pass | 19438;  |
| no network requests to external hosts | Pass |  |
| no JavaScript errors during the whole run | Pass |  |

## Test data

The upload test files in `tests/data/` are created by `tests/make_test_files.py`. They contain invented orders, lines and reviews (IDs MVDEMO..., ALIAS..., SAFE..., REPL...), a few rows that reuse existing keys on purpose (to test duplicates and updates), and `06_raw_sheets.xlsx` with the source workbook's raw sheets (to test the browser cleaning). All data is synthetic.

## How to re-run

```bash
python -m http.server 8765 &
python scripts/clean_data.py && python scripts/prepare_analysis.py
python tests/make_test_files.py
node tests/run_tests.js
python tests/make_test_report.py
```

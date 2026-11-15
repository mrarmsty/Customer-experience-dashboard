# Methodology

## 1. Data preparation

The source workbook contains clean sheets, raw sheets and a cleaning log. Rather than trusting the clean sheets as given, `scripts/clean_data.py` **rebuilds** the clean orders, order lines, reviews and customers from the raw sheets with explicitly coded rules. It then compares the result with the workbook's clean sheets, cell by cell.

| Table | Rows (rebuilt / workbook) | Cells compared | Cells different |
|---|---|---:|---:|
| orders | 19,438 / 19,438 | 427,636 | 0 |
| order_items | 28,109 / 28,109 | 168,654 | 0 |
| reviews | 11,211 / 11,211 | 56,055 | 0 |
| customers | 14,800 / 14,800 | 74,000 | 8 |

**The 8 differing cells** are in `signup_date_imputed`. The workbook sets the flag to 1 for 8 accounts whose signup date was missing and stayed blank, because those customers never ordered. That contradicts its own data dictionary ("1 if signup_date was imputed from the first order"). The rebuild follows the dictionary and leaves the flag at 0. All 23 rule counts equal the workbook's cleaning log.

| Rule | Problem in the raw data | Action | Rows |
|---|---|---|---:|
| R1 | Duplicate order rows (re-exported batch) | Removed | 140 |
| R2 | Internal test orders (MVTEST..., CU_TEST, reason "Test order") | Removed | 18 |
| R3 | Purchase time as day-first text `dd/mm/yyyy hh:mm` | Parsed | 971 |
| R4 | Status spellings (Completed, canceled, in_transit, pending...) | Mapped to 6 statuses | 1,555 |
| R5 | Payment spellings (POD, card, Transfer...) | Mapped to 4 methods | 1,943 |
| R6 | Ship-to state spellings (Lagos State, Abuja, Port Harcourt...) | Mapped to the standard state | 663 |
| R7 | Delivered time before shipped time | Swapped back; flagged | 25 |
| R8 | Negative shipping fee | Made positive; flagged | 30 |
| R9 | Delivered order without a delivery time | Kept, flagged, excluded from delivery-time measures | 98 |
| I1 | Duplicate order lines | Removed | 60 |
| I2 | Lines of removed test orders | Removed | 18 |
| I3 | Prices recorded in kobo (unit price above 20x the 2024 list price) | Price, discount and total divided by 100 | 25 |
| I4 | Negative quantity with positive line total | Made positive | 20 |
| I5 | Unit price missing | (line total + discount) / quantity | 25 |
| V1 | Edited review exported twice | Latest version kept | 120 |
| V2 | Score as text ('4 stars', '4/5') | Number extracted | 71 |
| V3 | Score outside 1-5 | Removed (true score unknown) | 30 |
| V4 | Review dated before the delivery | Set to the delivery date; flagged | 20 |
| V5 | Spaces around comments | Trimmed | 200 |
| C1 | Duplicate customer rows | Removed | 70 |
| C2 | Customer state spellings | Mapped | 593 |
| C3 | Acquisition channel blank | Set to 'Unknown' | 444 |
| C4 | Signup date missing | First order date (flagged); blank if no orders | 40 |

**The kobo rule (I3) needed a detection rule.** The workbook says only "one seller-month". The ratio of selling price to the 2024 list price is below 5 for every normal line, while the 25 affected lines sit at 125-151, so a threshold of 20 separates them with no false positives.

**The same rules run in the browser.** `assets/js/data-processing.js` applies them to the base data and to every upload. The automated tests upload the raw sheets and confirm the dashboard reproduces the clean tables exactly.

## 2. Analysis grain and joins

- **Order level.** Each order has one seller and, in this data, products from one category. Every order therefore has one category, and order measures (cancellation, delivery, review) belong to that category. If an uploaded order mixes categories, the first line's category is used.
- **Reviews** are per order, joined by order_id.
- **Region** is the geopolitical zone of the delivery state.
- **Customers** are counted from orders. The customer table supplies the acquisition channel.

## 3. Measures

| Measure | Definition |
|---|---|
| GMV | Line totals (after item discounts, before vouchers and shipping) of orders not cancelled |
| Constant-price GMV | GMV / monthly price index. Index = selling value / value at 2024 list prices, all orders not cancelled; it rises from 1.01 (Jan 2024) to 1.49 (Dec 2025). |
| Average order value | GMV / orders not cancelled |
| Cancellation rate | Cancelled / orders placed |
| Return rate | Returned / delivered (incl. returned) |
| Delivered successfully | Delivered / closed orders (excludes the 340 orders still shipped or processing at the extract) |
| Delivery success | Delivered / (delivered + failed deliveries) |
| Delivery time | Days from purchase to delivery (orders with a delivery time) |
| Late delivery | Delivery date after the estimated delivery date |
| Low rating | 1 or 2 stars |
| Purchase, repeat rate | A purchase is a checkout (cart_id) not cancelled. Repeat = 2+ purchases in the period. |
| Cohorts | Quarter of first purchase; share buying again 1, 2, ... quarters later |
| Year on year | Same months of the year in the last two calendar years in view |

## 4. Statistical methods (significance level 0.05)

| Question | Method | Result (all data) |
|---|---|---|
| Are late deliveries associated with low ratings? | 2x2 chi-square; relative risk with 95% CI (log method) | 31.8% vs 7.6%; RR 4.18 (3.79-4.62); p < 0.001 |
| Does lateness have a dose-response? | Spearman correlation of days late and score; low-rating share by days late | rho = -0.447; 7.6% on time, 22.9% at 1 day, 36.3% at 2 days, 59.1% at 3+ days |
| Do scores differ by category? | Kruskal-Wallis (ordinal scores) with epsilon squared | H = 530.6, p < 0.001, small effect (0.046) |
| Is the category effect only delivery? | Chi-square of low rating by category, on-time deliveries only | Still significant (p < 0.001): Women's Fashion 16.7% vs 2.8% (Books) when on time |
| Do cancellations differ by category? | Chi-square | p < 0.001; Phones & Tablets 9.9% highest |
| Do delivery times differ by state? | Kruskal-Wallis | p < 0.001, large effect (0.22) |
| Does the fulfilment model matter? | Chi-square | Late 10.7% (Marketplace Fulfilled) vs 15.9% (Seller Fulfilled), p < 0.001 |
| Is there a trend in orders? | OLS slope of monthly orders | +24.5 orders a month, p = 0.002 |
| Which sellers are worse than the marketplace? | Wilson 95% interval per seller (30+ deliveries or reviews); flag when the lower bound is above the marketplace rate | 25 sellers flagged for late delivery, 13 for low ratings |

**Logistic regression (technical report only).** To check that the late-delivery effect is not explained by category, item size or fulfilment, `scripts/prepare_analysis.py` fits a logistic regression of low rating on late delivery, bulky items, same-state route, fulfilment model and category (n = 10,838). The odds ratios are:
- late delivery 5.66 (p < 0.001);
- bulky items 1.69;
- Marketplace Fulfilled 0.78;
- Women's Fashion 3.17, Shoes & Bags 1.84 and Men's Fashion 1.67, each relative to Phones & Tablets.

Pseudo R² is 0.12. Late delivery and fashion categories remain strong independent predictors. The browser does not run this regression; the dashboard shows the stratified view (on-time-only rates) instead.

## 5. Rules behind insights, flags and status

Key findings and recommendations are generated by fixed rules in `assets/js/analytics.js` from the numbers in view, and each one shows its rule or evidence. Examples:
- **Delivery recommendation:** shown when the late-delivery relative risk exceeds 1.5 and is significant.
- **Product-driven categories:** categories whose on-time low-rating rate is more than 1.5 times the marketplace on-time rate.
- **Delivery-driven categories:** categories whose rate falls by 40% or more when delivery is on time.

Status thresholds are illustrative, set in `config.js`:

| Measure | Warning | Critical |
|---|---|---|
| Late deliveries | 10% | 15% |
| 1-2 star reviews | 10% | 15% |
| Cancellations | 5% | 10% |
| Repeat rate (lower is worse) | 35% | 25% |
| Delivery success (lower is worse) | 98% | 95% |

## 6. Verification

`scripts/prepare_analysis.py` writes every reference value with pandas, SciPy and statsmodels. `tests/run_tests.js` compares the running dashboard with these values. It also compares the export with `orders_analysis.csv` on 38 fields for every order, and checks the browser cleaning against the raw sheets. See `tests/test-report.md`.

# Limitations and assumptions

## Data

- **Synthetic data.** Marketvale is a fictional marketplace, and the workbook states that its patterns are properties of a simulation. Findings demonstrate the analytical method; they are not evidence about real Nigerian e-commerce.
- **Inflation.** Selling prices rise throughout the period (the price index goes from 1.01 to 1.49), so naira growth overstates real growth. The dashboard shows GMV at constant January 2024 prices using one marketplace-wide index. Category-specific price trends are not modelled.
- **Open orders.** 340 orders were still shipped or processing at the extract. They count as placed orders, but they are excluded from delivery-success rates and have no delivery outcome yet.
- **Missing delivery scans.** 98 delivered orders have no delivery time. They are excluded from delivery-time and lateness measures; their true timing cannot be recovered.
- **Reviews are per order, not per product.** About 58% of orders are reviewed, and reviewers may differ from non-reviewers.
- **Review themes** come from keyword rules on the comments. Only about 39% of reviews have a comment, and a keyword approach can misclassify unusual wording.
- **Category per order.** In this data every order holds one category. For uploaded orders that mix categories, the first line's category is used for order-level measures.
- **Source discrepancy.** The workbook's clean customer sheet flags 8 accounts as "signup date imputed" although no date was imputed. The rebuilt table follows the data dictionary.

## Method

- Statistical tests show association, not causation. Late deliveries go with poor reviews even after allowing for category, item size, route and fulfilment model (logistic regression in the technical report). Even so, unmeasured factors (carrier, product quality) may contribute.
- Repeat rates and cohorts depend on the period in view. Customers who first bought late in 2025 have had little time to return, so their cohorts are shown only for quarters that can be observed.
- Sellers, states and categories with few orders are noisy. Ranking needs 30+ deliveries for sellers and 100+ for states; flags use 95% Wilson intervals rather than raw rates.
- The status thresholds (late 10% / 15%, low ratings 10% / 15%, cancellations 5% / 10%, repeat 35% / 25%, delivery success 98% / 95%) are illustrative and set in `config.js`.

## Technical

- Uploaded data is stored only in the current browser (IndexedDB). It is not shared with other visitors or devices, and it is lost if site data is cleared.
- Undo is kept for the last 3 uploads; older uploads can only be removed with a full reset.
- Upload limits are 25 MB and 150,000 rows per sheet, to keep analysis responsive in the browser. Recalculating after a filter takes about half a second on a typical laptop.
- Tests ran in Chromium only. Firefox, Safari and screen-reader software were not tested.
- An actual publish to GitHub Pages was not performed from the build environment. The tests confirm the conditions it needs: relative paths, no server code, no external requests, and that the page works from `file://`.

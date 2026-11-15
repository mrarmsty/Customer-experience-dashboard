# Portfolio positioning

## Competencies demonstrated

| Competency | Evidence in this project |
|---|---|
| Business problem-solving | Turned management's assortment, seller and customer-experience questions into 6 objectives and 25 questions. Each maps to a tab, KPI, chart or test, plus an "areas needing attention" view and rule-based recommendations. |
| Product and commercial analytics | GMV and its contribution by category, order value, cancellations and returns; constant-price growth that separates inflation from real growth |
| Customer analytics | Purchases counted per checkout (not per seller order), repeat rate, new vs returning customers, quarterly cohorts, spend by region, acquisition channel |
| Operations / fulfilment analytics | Delivery success, delivery time, late rate by month, region, state, fulfilment model, item size and season; seller delay ranking with confidence intervals |
| Statistical reasoning | Chi-square, relative risk with CI, Spearman, Kruskal-Wallis with effect sizes, Wilson intervals for fair seller flags, a stratified on-time-only comparison and a logistic regression to separate delivery effects from product effects |
| Data cleaning and validation | Rebuilt the clean tables from the raw sheets with 23 coded rules, reconciled them cell by cell (a source discrepancy was found and documented), and re-implemented the same rules in the browser for uploads |
| Data modelling | Six related tables joined into an order-level analysis table; referential checks between tables on upload |
| Dashboard development | Vanilla JavaScript app: 9 tabs, 20 ECharts visualisations, click-to-filter, measure selectors, searchable scorecards, light and dark themes, responsive layout |
| Data management | Multi-table uploads (Excel, CSV, JSON) with append, update-or-add and replace; undo and reset; IndexedDB persistence with an honest statement that it is local to one browser |
| Reporting | Client-side PDF report and CSV/Excel exports that reflect current data and filters |
| Testing and QA | 150 automated browser checks; every KPI and test cross-checked against pandas/SciPy; the browser's cleaning of the raw sheets checked against the clean tables |

## Relevant roles

| Role | Fit | Why |
|---|---|---|
| Product Analyst / Commercial Analyst (e-commerce, marketplace) | Strongest | Category performance, customer repeat behaviour, review drivers, seller performance |
| Data Analyst / Senior Data Analyst | Strong | End to end: assessment, cleaning, modelling, statistics, dashboard, reporting, testing |
| Business Intelligence Analyst | Strong | KPI design, interactive filters and drill-down, refreshable data, exports |
| Operations Analyst (logistics, fulfilment) | Strong | Delivery reliability, regional and seasonal delays, fulfilment-model comparison, seller SLAs |
| Analytics Consultant | Good | Turns findings into prioritised, evidence-backed recommendations for management |

## CV entry

**Marketvale Marketplace Performance Dashboard** (JavaScript, Apache ECharts, ExcelJS, jsPDF, Playwright, Python/pandas/SciPy/statsmodels)

- Analysed 19,438 orders, 28,109 order lines and 11,211 reviews from a synthetic Nigerian online marketplace (2024-2025). Rebuilt the clean data from raw exports with 23 coded cleaning rules and reconciled it cell by cell with the published clean tables.
- Showed that two categories generate 47% of GMV, that 2025 growth was +56% in naira but +26% after removing price inflation, and that late deliveries are 4.2 times as likely to receive a 1-2 star review. Women's Fashion stays the worst-rated category even when delivered on time, pointing to product issues rather than delivery.
- Built an interactive 9-tab dashboard with multi-table data upload (cleaning, validation, duplicate handling, update-or-add), local persistence, and PDF and Excel outputs that recalculate from the updated data. Flagged 25 sellers for late delivery using confidence-interval rules.
- Verified every KPI and statistical test against an independent pandas/SciPy pipeline with 150 automated browser checks.

## Interview questions and answers

**1. What problem does the dashboard solve?**
Management wanted to know which categories perform, how customers buy, how good delivery is and what causes poor reviews, so they could make assortment, seller and customer-experience decisions. The dashboard answers the brief's 25 questions across five tabs and flags areas needing attention against explicit thresholds. It also recommends actions, each with the evidence behind it. New data can be added without a developer.

**2. The workbook already had clean sheets. Why rebuild them?**
I didn't want to trust a cleaning process I hadn't checked, and the dashboard needed the same rules for uploads anyway. I coded the 23 rules, rebuilt the four tables from the raw sheets and compared them cell by cell. Orders, lines and reviews matched exactly. The customers table showed 8 rows where the workbook flags a signup date as imputed although it is still blank, which contradicts its own dictionary. I documented that rather than silently copying it. The kobo rule needed an explicit detection threshold: price above 20 times the list price. I checked that it separates the 25 affected lines with no false positives.

**3. How did you deal with inflation?**
Prices rose about 49% over the two years, so naira GMV growth of 56% overstates real growth. I built a monthly price index (selling value against the products' 2024 list prices) and deflated GMV, which gives 26% real growth. Order volume grew 25%, so most real growth comes from more orders. The dashboard can show either view, and I compare volumes as well as values.

**4. How do you define a repeat customer?**
A checkout can be split into several seller orders that share a cart_id. Counting orders would make one multi-seller checkout look like a repeat purchase, so a purchase is a distinct checkout that was not cancelled, and a repeat customer has two or more. The repeat rate is 29.9%, and about 21% of each quarter's new customers buy again the next quarter.

**5. Is late delivery really associated with poor reviews?**
Yes, strongly. Late orders get a 1-2 star review 31.8% of the time against 7.6% when on time: a relative risk of 4.2 (95% CI 3.8-4.6). There is a clear dose-response: 23% at one day late, 36% at two days and 59% at three or more. Because late orders might differ in other ways, I fitted a logistic regression with category, bulky items, route and fulfilment model. Late delivery keeps an odds ratio of about 5.7. It is still an association, but a consistent one.

**6. How did you separate product problems from delivery problems by category?**
I compared each category's 1-2 star share for all reviews and for on-time deliveries only.
- **Home Appliances:** the share falls from 18% to 8% when on time, so delivery drives most of its dissatisfaction.
- **Women's Fashion:** it stays at 16.7% even when on time, against 7.6% for the marketplace. With "not as described / wrong item" as its top complaint theme, that points to listings and product accuracy.

The two need different actions: logistics for one, listing quality and size guides for the other.

**7. How did you flag poor sellers fairly?**
Raw rates punish small sellers with a few bad orders. I required at least 30 deliveries or reviews and flagged a seller only when the lower bound of its 95% Wilson interval is above the marketplace rate. That gave 25 sellers for late delivery and 13 for low ratings, 10 on both lists. The scorecard can show flagged sellers only.

**8. What drives delivery delays?**
- **Fulfilment model:** seller-fulfilled orders are late 15.9% of the time against 10.7% for Marketplace Fulfilled, and take 2.1 days longer.
- **Season:** the 20 November - 24 December peak pushes the late rate to 27% against 10% the rest of the year.
- **Region:** the North East averages 7.4 days and is 24% late.
- **Sellers:** a handful are late most of the time.

These are the targets in the recommendations.

**9. How do uploads work with six related tables?**
One Excel workbook can hold several tables; each sheet is recognised by its name or by its columns. Each table goes through the cleaning rules and validation. Then references are checked: order lines and reviews must belong to an order in the data or the same file, while unknown sellers or products are kept with a warning. Keys are order_id, order_id plus line number, order_id for reviews, and customer, seller and product IDs. The modes are:
- **Append:** skips identical records and flags conflicting ones.
- **Update or add:** for example, a shipped order now delivered.
- **Replace:** replaces the transaction tables after confirmation.

As a stress test, uploading the raw sheets in replace mode reproduces the clean tables exactly, in about 5 seconds.

**10. How did you make sure the numbers are right?**
The pandas/SciPy pipeline is independent of the JavaScript. The Playwright suite compares the two:
- every KPI;
- every category, state and region figure;
- the cohort table, flagged sellers and every statistical test;
- the export, on 38 fields for all 19,438 orders.

It also tests every upload path, undo, persistence, the PDF, mobile layout and the file:// mode: 150 checks in total, all passing.

**11. What would you change for a real marketplace?**
- Move the data to a governed warehouse with a scheduled refresh and access control, since browser storage is fine for a demonstration but not for shared use.
- Add carrier and route data to explain delays.
- Collect product-level ratings and return reasons.
- Test interventions such as later promised dates or proactive delay messages with A/B experiments, rather than relying on observational associations.

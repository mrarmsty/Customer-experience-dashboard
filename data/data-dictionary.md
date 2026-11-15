# Data dictionary

All data is **synthetic**: Marketvale is a fictional online marketplace. Amounts are in Nigerian naira (NGN). Orders run from 1 Jan 2024 to 31 Dec 2025, extracted at 31 Dec 2025 23:59.

## 1. Files

| File | What it is |
|---|---|
| `data/raw/marketvale_marketplace_data.xlsx` | Source workbook as supplied. It holds clean and raw sheets, the cleaning log and the publisher's data dictionary. It is kept unchanged. |
| `data/clean/*.csv` | Clean tables. Orders, order_items, reviews and customers are **rebuilt from the raw sheets** by `scripts/clean_data.py`. Sellers, products, categories, states and calendar are copied from the workbook. |
| `data/base-data.js` | The clean tables embedded for the dashboard, so it works from `file://` (calendar reduced to the columns used). |
| `data/processed/orders_analysis.csv` | Order-level analysis table (one row per order), produced by `scripts/prepare_analysis.py`. |
| `data/processed/summary_by_*.csv`, `seller_scorecard.csv`, `cohort_retention.csv` | Summary tables |
| `data/processed/cleaning_log.csv`, `reconciliation.json` | Rule counts from the rebuild, and the cell-by-cell comparison with the workbook's clean sheets |
| `data/processed/reference_values.json` | Every KPI and test result from pandas/SciPy, used by the automated tests |

## 2. Source tables (clean)

| Table | Key | Rows | Grain |
|---|---|---:|---|
| orders | order_id | 19,438 | One order (one seller, one category). A multi-seller checkout is split into orders that share a `cart_id`. |
| order_items | order_id + order_item_seq | 28,109 | One product line in an order |
| reviews | order_id (one review per order at most) | 11,211 | A review of an order (not of a product) |
| customers | customer_id | 14,800 | Every registered account, including 3,127 that never ordered |
| sellers | seller_id | 180 | Seller location, tier (Official Store / Top Seller / Standard), fulfilment model, status |
| products | product_id | 2,593 | Listing, category, seller, 2024 list price, bulky flag |
| categories | category_id | 18 | Category name and group (6 groups) |
| states | state | 37 | 36 states plus FCT, with geopolitical zone |
| calendar | date | 731 | Sales events, public holidays, peak-logistics period (20 Nov - 24 Dec) |

### orders

| Column | Type | Meaning |
|---|---|---|
| order_id, cart_id, customer_id, seller_id | text | Keys. `cart_id` identifies the checkout. |
| order_purchase_ts | date-time | When the order was placed |
| payment_method | text | Card, Bank transfer, Pay on delivery, Wallet |
| payment_confirmed_ts, shipped_ts, delivered_ts, delivery_failed_ts, return_requested_ts, cancelled_ts | date-time | Milestones. Blank when they did not happen. |
| items_subtotal_ngn | NGN | Sum of the line totals. This is the order's GMV unless the order was cancelled. |
| voucher_discount_ngn, shipping_fee_ngn, order_total_ngn | NGN | order_total = subtotal - voucher + shipping |
| order_status | text | delivered, returned (delivered then returned), cancelled, delivery_failed, shipped / processing (still open at the extract) |
| estimated_delivery_date | date | Delivery date promised at checkout |
| cancelled_by, cancellation_reason | text | Who cancelled and why |
| ship_from_state, ship_to_state | text | Origin and delivery state. The delivery state is the customer's state. |
| data_quality_note | text | `delivered_ts_missing` (98), `shipped_delivered_swapped_fixed` (25), `shipping_fee_sign_fixed` (30) |

### order_items

| Column | Type | Meaning |
|---|---|---|
| order_id, order_item_seq, product_id, seller_id | text / integer | Keys |
| quantity | integer | Units bought (1-4) |
| unit_price_ngn, item_discount_ngn, line_total_ngn | NGN | line_total = quantity x unit price - item discount |

### reviews

| Column | Type | Meaning |
|---|---|---|
| review_id, order_id | text | One review per order at most |
| review_score | integer 1-5 | Star rating. **Low rating = 1 or 2 stars.** |
| review_date | date | Date submitted |
| review_comment | text | Optional comment (about 39% of reviews have one) |
| review_date_corrected | 0/1 | 1 if the raw date preceded the delivery and was moved to the delivery date (rule V4) |

### customers

| Column | Type | Meaning |
|---|---|---|
| customer_id | text | Key |
| signup_date | date | Account creation date |
| signup_date_imputed | 0/1 | 1 if signup_date was imputed from the first order (rule C4) |
| customer_state, customer_zone | text | State and zone of the default address |
| acquisition_channel | text | Organic search, Social media, Paid ads, Referral, Influencer, Direct / app store, Unknown |

Sellers, products, categories, states and calendar follow the workbook's own data dictionary (sheet `data_dictionary`).

## 3. Order-level analysis table (`orders_analysis.csv` and the dashboard's data export)

| Field | Definition |
|---|---|
| seller_name, seller_tier, fulfilment_model | From sellers ("Unknown" if the seller is not in the seller list) |
| date, month, quarter, year, weekday, hour | From order_purchase_ts |
| category_id, category_name, category_group | From the products in the order (all lines of an order share one category) |
| cancelled, open, delivered, returned, failed | 0/1 status flags. delivered = delivered or returned; open = shipped or processing. |
| lines, units, item_discount | Number of lines, units, sum of item discounts |
| **gmv** | items_subtotal_ngn if the order was not cancelled, else 0 |
| list_value | Sum of quantity x 2024 list price. Used for the price index. |
| zone | Geopolitical zone of ship_to_state |
| intra_state | 1 if shipped from and to the same state |
| is_bulky | 1 if any product in the order is bulky |
| sales_event, peak_logistics | From the calendar on the purchase date |
| promised_days | estimated_delivery_date - purchase date (days) |
| **delivery_days** | (delivered_ts - order_purchase_ts) in days. Blank if there is no delivery time. |
| **late** | 1 if date(delivered_ts) > estimated_delivery_date. Blank if there is no delivery time. |
| days_late | max(0, date(delivered_ts) - estimated_delivery_date) |
| review_score, **low_rating** | Score, and 1 if the score is 1 or 2 (blank if not reviewed) |
| theme | Rule-based theme of the review comment (reviewed orders only) |
| record_source | Export only: `base dataset` or `upload <id>` |

## 4. Derived measures (definitions used everywhere)

| Measure | Formula |
|---|---|
| GMV | Sum of gmv |
| GMV at January 2024 prices | Sum over orders of gmv / price index of the order's month. **Price index** = sum(quantity x unit price) / sum(quantity x 2024 list price), over all orders not cancelled in the month. |
| Average order value (AOV) | GMV / orders not cancelled |
| Cancellation rate | Cancelled / orders placed |
| Return rate | Returned / delivered (incl. returned) |
| Delivered successfully (closed orders) | Delivered / orders not open |
| Delivery success | Delivered / (delivered + delivery_failed) |
| Late rate | Late / orders with a delivery time |
| Purchasing customer, repeat rate | Customer with 1+ checkouts (cart_id) not cancelled; repeat = 2+ checkouts |
| Cohort retention | Share of a quarter's first-time buyers who buy in a later quarter (k = 1, 2, ...) |
| Seller flag | Seller with 30+ deliveries (or reviews) whose 95% Wilson lower bound for the late (or low-rating) rate is above the marketplace rate |

## 5. Upload format

The dashboard accepts any of the six tables as Excel sheets (named like the tables, or with the `raw_` prefix), as CSV files or as JSON. Columns are matched by name, ignoring case, spaces and punctuation; common alternative names are recognised (for example `Order Date`, `Qty`, `Status`). Required columns per table are listed on the dashboard's Methodology tab and in `assets/js/config.js`.

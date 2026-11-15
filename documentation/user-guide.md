# User guide

## Opening the dashboard

- **Online:** open the GitHub Pages address of the repository.
- **On your computer:** double-click `index.html`, or run `python -m http.server 8765` in the project folder and open `http://localhost:8765`.

The data loads in a second or two. All analysis runs in your browser; nothing is sent to a server.

## The header

| Item | What it does |
|---|---|
| Dataset status | Shows "Original dataset" or "Working dataset". Working dataset means data has been added in this browser. |
| **Generate Analysis Report** | Creates a PDF report of the current filtered view or of the whole dataset |
| **Download Analysis Data** | Exports the order-level analysis data (CSV, or Excel with order lines, reviews and summary sheets) |
| Moon icon | Switches between light and dark mode |

## Filters

The filter bar applies to every tab, the report and the exports.

- **From / To:** month range of the order date.
- **Category, Region, Seller tier, Fulfilment, Payment:** tick the groups to include, or use All or None.
- **Chips** under the bar show the active filters. Click a chip to remove it; **Reset filters** clears everything.
- **Shortcuts:** click a month on a monthly chart, a category bar, or a region bar to filter the whole dashboard to it.

## Tabs

| Tab | Questions it answers |
|---|---|
| Overview | How is the marketplace doing? It shows KPI cards with month-on-month change and status, key findings, areas needing attention, GMV by category and recommended actions. |
| Product categories | Which categories drive GMV, orders, units and order value? Which have high cancellations or poor ratings? It includes a ranking with a measure selector, a value vs experience matrix, a quarterly trend (naira or constant prices) and a scorecard. |
| Customers | How many customers buy, and do they come back? Where do they spend most, and when do they order? It shows purchases per customer, new vs returning customers, cohorts, spend by region, top states, repeat rate by channel, an order-time heatmap and payment methods. |
| Delivery | How reliable and fast is delivery? Where and for whom is it slow? It shows late deliveries by month, delivery-time distribution, regions, factors behind lateness, the slowest states and the sellers with most delays. |
| Reviews | How satisfied are customers, and what drives poor reviews? It shows poor reviews by lateness, the score distribution, poor reviews by category (all vs on-time only), complaint themes and statistical tests. |
| Sellers | Which sellers need attention? It shows a late vs low-rating scatter, tier comparison and a searchable scorecard with flags. |
| Data explorer | Every order behind the charts: search, sort, choose columns, page through |
| Add data | Upload data, check it, apply it, undo or reset |
| Methodology & help | Definitions, cleaning rules, analysis rules and the upload format |

**Reading the charts**
- Hover for exact values. Use ⤢ for full screen.
- Pale bars are small groups (fewer than 30 cases).
- Whiskers are 95% confidence intervals.
- Status badges combine an icon and a word: ✓ On track, ! Warning, ✕ Critical.

## Adding data

1. Open **Add data**. Optionally download the blank template (one sheet per table) or the fictional test file.
2. Choose a mode:
   - **Add new records:** new orders, lines, reviews, customers, sellers or products are added. Existing records (same key) are not changed.
   - **Update or add:** matching records are updated and new ones added. For example, an order that was "shipped" at the last extract can now be delivered. Blank cells keep the existing values.
   - **Replace the transaction data:** orders, order lines and reviews are replaced by the file. The file must contain orders and order lines. You will be asked to confirm.
3. Drop an **Excel workbook** (one sheet per table, named like the table), or a **CSV/JSON** file for one table. A JSON file can also hold several tables (`{"orders": [...], "order_items": [...]}`).
4. Read the **Upload check**. For each table it shows:
   - rows, valid, rejected, duplicates, new and updated;
   - which cleaning rules were applied (for example "R5: 1 payment labels standardised");
   - how the columns were matched;
   - the reason for every row not used. You can download the reasons as a CSV.
5. Click **Apply upload**. A message states the real counts, and every tab recalculates. New months appear in the month filter automatically.

**Common validation messages**

| Message | Meaning | What to do |
|---|---|---|
| required columns missing | A sheet lacks a column the table needs | Add the column (see the Upload file format table) and upload again |
| is not a recognised status | Status not one of delivered, returned, cancelled, delivery_failed, shipped, processing, or a known spelling | Correct the status |
| Order ... does not exist | An order line or review refers to an order that is not in the data or the file | Include the order in the same workbook, or upload orders first |
| Internal test order | Order looks like a test (MVTEST..., CU_TEST) | None: test orders are removed on purpose |
| Already exists with different values | In "Add new records" mode the key exists with other values | Use "Update or add" if you mean to change it |

**Undo and reset.** **Undo last upload** reverses the most recent upload (the last 3 can be undone). **Reset to the original dataset** removes all uploaded data from this browser.

**Your data stays in this browser** (IndexedDB). Other people and other devices do not see it.

## Reports and exports

- **PDF report:** about 8 pages, built from the current data and filters. It covers scope, summary, context, objectives, dataset, data preparation, methods, KPI definitions, key numbers with 6 charts and tables, findings, areas requiring attention, interpretation, recommendations and limitations. Amounts are written as "NGN" because PDF fonts lack the naira sign.
- **CSV:** one row per order, with every derived field (GMV, delivery days, late flag, review score and more) and the record source. Text that could be read as a spreadsheet formula is prefixed with an apostrophe.
- **Excel:** the same orders, plus their order lines and reviews, monthly, category, state and seller summaries, and an About sheet.
- **Category summary (CSV):** on the Add data tab.

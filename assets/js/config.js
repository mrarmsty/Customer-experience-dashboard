/* config.js - table schemas, label mappings, business rules, thresholds and KPI definitions.
   Every analytical convention lives here so it can be reviewed and changed in one place. */
(function () {
  'use strict';
  const n = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const uniq = (a) => [...new Set(a)];
  const F = (key, type, required, aliases = [], extra = {}) => ({ key, type, required, aliases: uniq([key, ...aliases].map(n)), ...extra });

  // ------------------------------------------------------------------ uploadable tables
  // type: text | int | num | ts (date-time) | date | flag (0/1). The first alias is the standard column name.
  const TABLES = {
    orders: {
      label: 'Orders', key: ['order_id'], sheetNames: ['orders', 'raw_orders', 'order'],
      fields: [
        F('order_id', 'text', true, ['Order ID', 'Order Number']),
        F('cart_id', 'text', false, ['Cart ID', 'Checkout ID']),
        F('customer_id', 'text', true, ['Customer ID']),
        F('seller_id', 'text', true, ['Seller ID']),
        F('order_purchase_ts', 'ts', true, ['Order Date', 'Purchase Date', 'Order Purchase Timestamp', 'Order Time']),
        F('payment_method', 'text', false, ['Payment Method', 'Payment Type']),
        F('payment_confirmed_ts', 'ts', false, ['Payment Confirmed', 'Payment Date']),
        F('items_subtotal_ngn', 'num', true, ['Items Subtotal', 'Subtotal', 'Items Value'], { min: 0 }),
        F('voucher_discount_ngn', 'num', false, ['Voucher Discount', 'Voucher'], { min: 0 }),
        F('shipping_fee_ngn', 'num', false, ['Shipping Fee', 'Delivery Fee']),
        F('order_total_ngn', 'num', false, ['Order Total', 'Total']),
        F('order_status', 'text', true, ['Order Status', 'Status']),
        F('shipped_ts', 'ts', false, ['Shipped Date', 'Shipped At']),
        F('delivered_ts', 'ts', false, ['Delivered Date', 'Delivery Date', 'Delivered At']),
        F('estimated_delivery_date', 'date', false, ['Estimated Delivery Date', 'Promised Date', 'Expected Delivery']),
        F('delivery_failed_ts', 'ts', false, ['Delivery Failed Date']),
        F('return_requested_ts', 'ts', false, ['Return Requested Date']),
        F('cancelled_ts', 'ts', false, ['Cancelled Date', 'Cancellation Date']),
        F('cancelled_by', 'text', false, ['Cancelled By']),
        F('cancellation_reason', 'text', false, ['Cancellation Reason']),
        F('ship_from_state', 'text', false, ['Ship From State', 'Origin State']),
        F('ship_to_state', 'text', true, ['Ship To State', 'Delivery State', 'Customer State', 'Destination State']),
        F('data_quality_note', 'text', false, ['Data Quality Note']),
      ],
    },
    order_items: {
      label: 'Order lines', key: ['order_id', 'order_item_seq'], sheetNames: ['order_items', 'raw_order_items', 'items', 'order_lines'],
      fields: [
        F('order_id', 'text', true, ['Order ID']),
        F('order_item_seq', 'int', true, ['Line Number', 'Item Seq', 'Order Item ID', 'Line'], { min: 1 }),
        F('product_id', 'text', true, ['Product ID']),
        F('seller_id', 'text', false, ['Seller ID']),
        F('quantity', 'int', true, ['Qty', 'Units']),
        F('unit_price_ngn', 'num', false, ['Unit Price', 'Price']),
        F('item_discount_ngn', 'num', false, ['Item Discount', 'Discount'], { min: 0 }),
        F('line_total_ngn', 'num', true, ['Line Total', 'Line Value', 'Amount'], { min: 0 }),
      ],
    },
    reviews: {
      label: 'Reviews', key: ['order_id'], sheetNames: ['reviews', 'raw_reviews', 'review'],
      fields: [
        F('review_id', 'text', false, ['Review ID']),
        F('order_id', 'text', true, ['Order ID']),
        F('review_score', 'text', true, ['Review Score', 'Rating', 'Score', 'Stars']),
        F('review_date', 'date', true, ['Review Date']),
        F('review_comment', 'text', false, ['Review Comment', 'Comment']),
        F('review_date_corrected', 'flag', false, ['Review Date Corrected']),
      ],
    },
    customers: {
      label: 'Customers', key: ['customer_id'], sheetNames: ['customers', 'raw_customers', 'customer'],
      fields: [
        F('customer_id', 'text', true, ['Customer ID']),
        F('signup_date', 'date', false, ['Signup Date', 'Registration Date']),
        F('signup_date_imputed', 'flag', false, []),
        F('customer_state', 'text', true, ['Customer State', 'State']),
        F('customer_zone', 'text', false, ['Customer Zone', 'Zone']),
        F('acquisition_channel', 'text', false, ['Acquisition Channel', 'Channel']),
      ],
    },
    sellers: {
      label: 'Sellers', key: ['seller_id'], sheetNames: ['sellers', 'seller'],
      fields: [
        F('seller_id', 'text', true, ['Seller ID']), F('seller_name', 'text', true, ['Seller Name', 'Shop Name']),
        F('seller_state', 'text', false, ['Seller State']), F('seller_zone', 'text', false, ['Seller Zone']),
        F('primary_category_id', 'text', false, ['Primary Category ID', 'Category ID']),
        F('seller_tier', 'text', true, ['Seller Tier', 'Tier']), F('fulfilment_model', 'text', true, ['Fulfilment Model', 'Fulfillment Model']),
        F('join_date', 'date', false, ['Join Date']), F('status', 'text', false, ['Status']), F('deactivated_date', 'date', false, ['Deactivated Date']),
      ],
    },
    products: {
      label: 'Products', key: ['product_id'], sheetNames: ['products', 'product'],
      fields: [
        F('product_id', 'text', true, ['Product ID']), F('product_name', 'text', false, ['Product Name']), F('product_type', 'text', false, ['Product Type']),
        F('category_id', 'text', true, ['Category ID']), F('seller_id', 'text', false, ['Seller ID']),
        F('list_price_ngn_2024', 'num', true, ['List Price', 'List Price 2024'], { min: 0 }), F('is_bulky', 'flag', false, ['Bulky', 'Is Bulky']),
        F('listed_date', 'date', false, ['Listed Date']),
      ],
    },
  };
  // processing order matters: orders before lines, reviews and customers (rules I2, V4 and C4 need the orders)
  const TABLE_ORDER = ['sellers', 'products', 'orders', 'order_items', 'reviews', 'customers'];
  const TRANSACTION_TABLES = ['orders', 'order_items', 'reviews'];

  // ------------------------------------------------------------------ label standardisation (rules R4, R5, R6/C2)
  const STATUS = { delivered: 'delivered', completed: 'delivered', returned: 'returned', return_completed: 'returned', cancelled: 'cancelled', canceled: 'cancelled',
    delivery_failed: 'delivery_failed', 'failed delivery': 'delivery_failed', 'delivery failed': 'delivery_failed', shipped: 'shipped', in_transit: 'shipped', 'in transit': 'shipped',
    processing: 'processing', pending: 'processing' };
  const PAYMENT = { card: 'Card', 'debit card': 'Card', 'credit card': 'Card', 'bank transfer': 'Bank transfer', bank_transfer: 'Bank transfer', transfer: 'Bank transfer',
    'pay on delivery': 'Pay on delivery', pod: 'Pay on delivery', 'cash on delivery': 'Pay on delivery', wallet: 'Wallet', 'marketvale wallet': 'Wallet' };
  const STATE_ALIAS = { abuja: 'FCT', 'f.c.t': 'FCT', 'fct abuja': 'FCT', fct: 'FCT', 'federal capital territory': 'FCT', ibadan: 'Oyo', 'port harcourt': 'Rivers', ph: 'Rivers' };
  const TIERS = ['Official Store', 'Top Seller', 'Standard'];
  const FULFILMENT = ['Marketplace Fulfilled', 'Seller Fulfilled'];

  // ------------------------------------------------------------------ rules and thresholds
  const RULES = {
    maxFileBytes: 25 * 1024 * 1024, maxRows: 150000,
    koboRatio: 20,           // unit price above 20x the product's 2024 list price = recorded in kobo (rule I3)
    lowRating: 2,             // 1-2 stars = low rating
    alpha: 0.05,
    minSellerN: 30,           // sellers need 30 delivered (or reviewed) orders to be ranked or flagged
    minStateN: 100,           // states need 100 delivered orders to be ranked on delivery time
    minCategoryN: 30,
    // illustrative management thresholds for the status column on Overview (adjust to local standards)
    status: {
      lateRate: { warn: 10, crit: 15 },          // % of deliveries after the promised date
      lowRate: { warn: 10, crit: 15 },           // % of reviews with 1-2 stars
      cancelRate: { warn: 5, crit: 10 },         // % of orders cancelled
      repeatRate: { warn: 35, crit: 25 },        // % of purchasing customers who buy again (lower is worse)
      deliverySuccess: { warn: 98, crit: 95 },   // % of shipped orders delivered (lower is worse)
    },
  };

  // review comment themes: first matching rule wins (keywords, lower case)
  const THEMES = [
    ['Late delivery', ['late', 'delayed', 'took too long', 'after the promised', 'slow']],
    ['Failed delivery', ['delivery failed', 'never showed', 'could not reach', 'rider']],
    ['Damaged item', ['damaged', 'broken', 'crushed', 'scratch', 'dent']],
    ['Not as described / wrong item', ['not as described', 'wrong size', 'different from', 'fake', 'not original', 'pictures']],
    ['Product quality', ['stopped working', 'poor', 'average quality']],
    ['Cancellation / refund', ['cancel', 'refund', 'out of stock']],
    ['Positive', ['works well', 'good value', 'great seller', 'exactly as described', 'neatly packaged', 'very satisfied', 'will buy again', 'nice quality', 'fast delivery', 'earlier than expected']],
    ['Neutral', ['okay', 'fine', 'average']],
  ];

  const KPI_DEFS = [
    { id: 'gmv', name: 'GMV', formula: 'Gross merchandise value: sum of line totals (after item discounts, before vouchers and shipping) of orders that were not cancelled', compare: 'Latest month vs previous month; year on year in naira and at constant (January 2024) prices', unit: 'NGN', fields: 'order_items.line_total_ngn, orders.order_status' },
    { id: 'orders', name: 'Orders', formula: 'Count of orders placed (all statuses)', compare: 'Latest month vs previous month', unit: 'orders', fields: 'orders.order_id' },
    { id: 'aov', name: 'Average order value', formula: 'GMV / orders not cancelled', compare: 'Latest month vs previous month', unit: 'NGN', fields: 'orders.items_subtotal_ngn' },
    { id: 'customers', name: 'Customers & repeat rate', formula: 'Purchasing customers = customers with at least one order not cancelled. Repeat rate = customers with 2+ separate checkouts (cart_id) / purchasing customers', compare: 'Within the selected period; status thresholds 35% and 25%', unit: 'customers / %', fields: 'orders.customer_id, orders.cart_id' },
    { id: 'cancel', name: 'Cancellation rate', formula: 'Cancelled orders / orders placed x 100', compare: 'Latest month vs previous month (pp); status thresholds 5% and 10%', unit: '%', fields: 'orders.order_status' },
    { id: 'delivery', name: 'Delivered successfully', formula: 'Delivered or returned orders / orders with a final outcome (excluding orders still shipped or processing at the extract) x 100. Delivery success = delivered / (delivered + failed deliveries)', compare: 'Status thresholds on delivery success 98% and 95%', unit: '%', fields: 'orders.order_status' },
    { id: 'late', name: 'Late deliveries & delivery time', formula: 'Late = delivery date after the estimated delivery date; share of orders with a delivery timestamp. Delivery time = days from purchase to delivery', compare: 'Latest month vs previous month (pp); status thresholds 10% and 15%', unit: '% / days', fields: 'orders.delivered_ts, orders.estimated_delivery_date, orders.order_purchase_ts' },
    { id: 'rating', name: 'Average review score', formula: 'Mean star rating (1-5) of reviewed orders; low rating = 1 or 2 stars', compare: 'Low-rating share shown alongside; status thresholds 10% and 15%', unit: 'stars', fields: 'reviews.review_score' },
  ];

  const MEASURES = {
    gmv: { label: 'GMV (NGN)', unit: 'ngn' }, real_gmv: { label: 'GMV at Jan 2024 prices (NGN)', unit: 'ngn' }, orders: { label: 'Orders', unit: 'int' },
    aov: { label: 'Average order value (NGN)', unit: 'ngn' }, customers: { label: 'Purchasing customers', unit: 'int' }, cancel_rate: { label: 'Cancellation rate (%)', unit: 'pct' },
    late_rate: { label: 'Late deliveries (%)', unit: 'pct' }, avg_days: { label: 'Average delivery time (days)', unit: 'days' },
    avg_score: { label: 'Average review score (1-5)', unit: 'score' }, low_rate: { label: 'Low ratings, 1-2 stars (%)', unit: 'pct' }, price_index: { label: 'Price index (Jan 2024 list prices = 1)', unit: 'idx' },
  };
  const CAT_MEASURES = {
    gmv: 'GMV', gmv_share: 'Share of GMV (%)', orders: 'Orders', units: 'Units sold', aov: 'Average order value', cancel_rate: 'Cancellation rate (%)',
    return_rate: 'Return rate (%)', late_rate: 'Late deliveries (%)', avg_score: 'Average review score', low_rate: 'Low ratings (%)',
  };
  const CAT_UNITS = { gmv: 'ngn', gmv_share: 'pct', orders: 'int', units: 'int', aov: 'ngn', cancel_rate: 'pct', return_rate: 'pct', late_rate: 'pct', avg_score: 'score', low_rate: 'pct' };

  window.MvConfig = { TABLES, TABLE_ORDER, TRANSACTION_TABLES, STATUS, PAYMENT, STATE_ALIAS, TIERS, FULFILMENT, RULES, THEMES, KPI_DEFS, MEASURES, CAT_MEASURES, CAT_UNITS, norm: n };
})();

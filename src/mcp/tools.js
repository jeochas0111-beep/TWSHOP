'use strict';

const { z } = require('zod');

function registerTools(server, client) {
  function jsonResult(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  function errResult(msg) {
    return { content: [{ type: 'text', text: msg }], isError: true };
  }

  // Helper: simple GET tool
  function get(name, desc, pathFn, schema) {
    server.tool(name, desc, schema || {}, async (params) => {
      try {
        const path = typeof pathFn === 'function' ? pathFn(params) : pathFn;
        return jsonResult(await client.request('GET', path));
      } catch (e) { return errResult(e.message); }
    });
  }

  // Helper: simple mutation tool
  function mut(name, desc, method, pathFn, schema) {
    server.tool(name, desc, schema || {}, async (params) => {
      try {
        const path = typeof pathFn === 'function' ? pathFn(params) : pathFn;
        const opts = {};
        if (method !== 'GET') opts.body = params;
        return jsonResult(await client.request(method, path, opts));
      } catch (e) { return errResult(e.message); }
    });
  }

  // Helper: query param tool
  function getQ(name, desc, pathFn, schema) {
    server.tool(name, desc, schema || {}, async (params) => {
      try {
        const path = typeof pathFn === 'function' ? pathFn(params) : pathFn;
        const { _path, ...query } = params;
        return jsonResult(await client.request('GET', path, { query }));
      } catch (e) { return errResult(e.message); }
    });
  }

  // ========== SYSTEM ==========
  get('health_check', 'Check if the TWODRAPES server is running', '/api/health');

  get('get_bootstrap_config', 'Get app bootstrap config including channel info, feature flags, and rate settings', '/api/bootstrap');

  // ========== AUTH ==========
  mut('auth_verify', 'Verify current authentication token', 'POST', '/api/auth/verify');

  get('auth_get_me', 'Get current authenticated user profile', '/api/auth/me');

  mut('auth_update_profile', '[WRITE] Update current user display name and/or username', 'PUT', '/api/auth/me', {
    display_name: z.string().optional().describe('New display name'),
    username: z.string().optional().describe('New username')
  });

  // ========== GLOBALS ==========
  get('get_globals', 'Get all global configuration values (exchange rates, hem allowances, loss values, labor rates, etc.)', '/api/globals');

  mut('update_globals', '[WRITE] Update global configuration values. This will modify system-wide settings.', 'PUT', '/api/globals', {
    values: z.array(z.object({
      key: z.string(),
      value: z.string(),
      value_type: z.enum(['number', 'boolean', 'text']).optional()
    })).describe('Array of key-value pairs to update')
  });

  // ========== FABRICS ==========
  get('list_fabrics', 'List all fabric materials', '/api/fabrics');

  mut('create_fabric', '[WRITE] Create a new fabric material', 'POST', '/api/fabrics', {
    name: z.string().describe('Fabric display name'),
    series: z.string().optional().describe('Series grouping'),
    width_cm: z.number().positive().describe('Roll width in cm'),
    price_per_m: z.number().nonnegative().describe('Cost per meter in RMB'),
    enabled: z.number().optional().describe('1=enabled, 0=disabled')
  });

  mut('update_fabric', '[WRITE] Update a fabric material', 'PUT', '/api/fabrics/:id', {
    id: z.string().describe('Fabric ID'),
    name: z.string().optional(),
    series: z.string().optional(),
    width_cm: z.number().positive().optional(),
    price_per_m: z.number().nonnegative().optional(),
    enabled: z.number().optional()
  });

  mut('delete_fabric', '[WRITE] Delete a fabric material', 'DELETE', '/api/fabrics/:id', {
    id: z.string().describe('Fabric ID to delete')
  });

  // ========== LININGS ==========
  get('list_linings', 'List all lining materials', '/api/linings');

  mut('create_lining', '[WRITE] Create a new lining material', 'POST', '/api/linings', {
    name: z.string().describe('Lining display name'),
    color: z.string().optional().describe('English color label'),
    width_cm: z.number().describe('Roll width in cm (0 for no-lining)'),
    price_per_m: z.number().nonnegative().describe('Cost per meter in RMB'),
    enabled: z.number().optional()
  });

  mut('update_lining', '[WRITE] Update a lining material', 'PUT', '/api/linings/:id', {
    id: z.string().describe('Lining ID'),
    name: z.string().optional(),
    color: z.string().optional(),
    width_cm: z.number().optional(),
    price_per_m: z.number().nonnegative().optional(),
    enabled: z.number().optional()
  });

  mut('delete_lining', '[WRITE] Delete a lining material', 'DELETE', '/api/linings/:id', {
    id: z.string().describe('Lining ID to delete')
  });

  // ========== PRODUCTS ==========
  get('list_products', 'List active products for the current channel', '/api/products');

  get('list_archived_products', 'List archived products for the current channel', '/api/products/archived');

  get('get_product', 'Get a single product by ID with all pricing tiers and options', '/api/products/:id', {
    id: z.string().describe('Product ID')
  });

  mut('create_product', '[WRITE] Create a new product with pricing tiers and options', 'POST', '/api/products', {
    name: z.string().describe('Product name'),
    factory_name: z.string().optional().describe('Name shown to factory'),
    type: z.string().optional().describe('Product type (e.g. curtain)'),
    series: z.string().optional().describe('Product series'),
    default_fabric_id: z.string().optional().describe('Default fabric ID'),
    base_price: z.number().optional().describe('Base USD price'),
    default_fullness: z.number().optional().describe('Default fullness ratio'),
    panels_per_unit: z.number().optional().describe('Panels per unit'),
    width_prices: z.array(z.object({ size_in: z.number(), price_usd: z.number(), sort_order: z.number().optional() })).optional(),
    length_prices: z.array(z.object({ size_in: z.number(), price_usd: z.number(), sort_order: z.number().optional() })).optional(),
    option_groups: z.array(z.object({
      option_key: z.string(), label: z.string(), type: z.string().optional(),
      required: z.number().optional(), priceable: z.number().optional(),
      costable: z.number().optional(), factory: z.number().optional(),
      values: z.array(z.object({ label: z.string(), price_usd: z.number().optional(), cost_rmb: z.number().optional() })).optional()
    })).optional()
  });

  mut('update_product', '[WRITE] Update product details, pricing tiers, and options', 'PUT', '/api/products/:id', {
    id: z.string().describe('Product ID'),
    name: z.string().optional(),
    factory_name: z.string().optional(),
    type: z.string().optional(),
    series: z.string().optional(),
    default_fabric_id: z.string().optional(),
    base_price: z.number().optional(),
    default_fullness: z.number().optional(),
    panels_per_unit: z.number().optional(),
    enabled: z.number().optional()
  });

  mut('delete_product', '[WRITE] Delete a product and all associated data', 'DELETE', '/api/products/:id', {
    id: z.string().describe('Product ID to delete')
  });

  mut('copy_product', '[WRITE] Duplicate a product with a new ID', 'POST', '/api/products/:id/copy', {
    id: z.string().describe('Product ID to copy')
  });

  mut('update_product_width_prices', '[WRITE] Replace width-based pricing tiers for a product', 'PUT', '/api/products/:id/width-prices', {
    id: z.string().describe('Product ID'),
    prices: z.array(z.object({ size_in: z.number(), price_usd: z.number(), sort_order: z.number().optional() })).describe('Width price tiers')
  });

  mut('update_product_length_prices', '[WRITE] Replace length-based pricing tiers for a product', 'PUT', '/api/products/:id/length-prices', {
    id: z.string().describe('Product ID'),
    prices: z.array(z.object({ size_in: z.number(), price_usd: z.number(), sort_order: z.number().optional() })).describe('Length price tiers')
  });

  mut('update_product_options', '[WRITE] Replace all option groups and values for a product', 'PUT', '/api/products/:id/options', {
    id: z.string().describe('Product ID'),
    options: z.array(z.object({
      option_key: z.string(), label: z.string(), type: z.string().optional(),
      required: z.number().optional(), priceable: z.number().optional(),
      costable: z.number().optional(), factory: z.number().optional(),
      values: z.array(z.object({ label: z.string(), price_usd: z.number().optional(), cost_rmb: z.number().optional() })).optional()
    })).describe('Option groups with values')
  });

  mut('archive_product', '[WRITE] Archive a product (soft delete)', 'PUT', '/api/products/:id/archive', {
    id: z.string().describe('Product ID to archive')
  });

  mut('unarchive_product', '[WRITE] Restore an archived product', 'PUT', '/api/products/:id/unarchive', {
    id: z.string().describe('Product ID to restore')
  });

  // ========== RULES ==========
  get('get_labor_rules', 'List all labor cost rules (tiered by height and layer type)', '/api/labor-rules');

  mut('update_labor_rules', '[WRITE] Replace all labor cost rules. This deletes existing rules and inserts new ones.', 'PUT', '/api/labor-rules', {
    rules: z.array(z.object({
      layer: z.enum(['single', 'double']),
      min_m: z.number(),
      max_m: z.number().nullable().optional(),
      rate_rmb_per_m: z.number(),
      note: z.string().optional(),
      sort_order: z.number().optional()
    })).describe('Complete set of labor rules')
  });

  get('get_memory_rules', 'List all memory/shaping cost rules', '/api/memory-rules');

  mut('update_memory_rules', '[WRITE] Replace all memory training cost rules', 'PUT', '/api/memory-rules', {
    rules: z.array(z.object({
      min_m: z.number(),
      max_m: z.number().nullable().optional(),
      single_rate_rmb: z.number(),
      double_coef: z.number().optional(),
      manual_quote: z.number().optional(),
      note: z.string().optional(),
      sort_order: z.number().optional()
    })).describe('Complete set of memory rules')
  });

  get('get_tax_rates', 'List all US state sales tax rates', '/api/tax-rules');

  mut('update_tax_rates', '[WRITE] Replace all tax rates', 'PUT', '/api/tax-rates', {
    rates: z.array(z.object({
      code: z.string().describe('State code (e.g. CA, TX)'),
      state: z.string().describe('Full state name'),
      rate: z.number().describe('Tax rate percentage (e.g. 8.99)'),
      note: z.string().optional()
    })).describe('Complete set of tax rates')
  });

  // ========== CALCULATION ==========
  mut('calc_item_cost', 'Calculate estimated cost for a single order item based on product, fabric, dimensions, and options', 'POST', '/api/calc/item', {
    product_id: z.string().describe('Product ID'),
    fabric_id: z.string().describe('Fabric ID'),
    lining_id: z.string().optional().describe('Lining ID (null for no lining)'),
    width_in: z.number().positive().describe('Finished width in inches'),
    length_in: z.number().positive().describe('Finished length in inches'),
    fullness: z.number().positive().optional().describe('Fullness ratio (default from product)'),
    qty: z.number().positive().optional().describe('Quantity (default 1)'),
    selected_options: z.record(z.string()).optional().describe('Selected option key-value pairs'),
    panels_per_unit: z.number().optional()
  });

  mut('calc_material_plan', 'Calculate fabric/lining material cutting plan (yield, warnings, layer info)', 'POST', '/api/calc/material-plan', {
    fabric_id: z.string().describe('Fabric ID'),
    lining_id: z.string().optional().describe('Lining ID'),
    width_in: z.number().positive().describe('Finished width in inches'),
    length_in: z.number().positive().describe('Finished length in inches'),
    fullness: z.number().positive().optional(),
    qty: z.number().positive().optional(),
    double_layer: z.boolean().optional().describe('Whether this is a double-layer curtain')
  });

  // ========== ORDERS ==========
  get('list_orders', 'List orders (max 200) with their items. Use query params to filter.', '/api/orders', {
    channel: z.string().optional().describe('Filter by channel (shopify/amazon)'),
    status: z.string().optional().describe('Filter by status'),
    date_from: z.string().optional().describe('Filter from date (YYYY-MM-DD)'),
    date_to: z.string().optional().describe('Filter to date (YYYY-MM-DD)')
  });

  get('get_order', 'Get a single order with all items and details', '/api/orders/:id', {
    id: z.number().describe('Order ID')
  });

  mut('create_order', '[WRITE] Create a new order with items', 'POST', '/api/orders', {
    order_no: z.string().optional().describe('Order number'),
    order_date: z.string().optional().describe('Order date (YYYY-MM-DD)'),
    delivery_date: z.string().optional(),
    customer_name: z.string().optional(),
    customer_email: z.string().optional(),
    customer_phone: z.string().optional(),
    customer_address: z.string().optional(),
    tax_state_code: z.string().optional().describe('US state code for tax'),
    remark: z.string().optional(),
    items: z.array(z.object({
      product_id: z.string(),
      product_name: z.string().optional(),
      qty: z.number().positive(),
      width_in: z.number().positive(),
      length_in: z.number().positive(),
      fabric_id: z.string(),
      lining_id: z.string().optional(),
      fullness: z.number().optional(),
      room_label: z.string().optional(),
      selected_options: z.record(z.string()).optional(),
      remark: z.string().optional()
    })).describe('Order items')
  });

  mut('update_order', '[WRITE] Update an existing order', 'PUT', '/api/orders/:id', {
    id: z.number().describe('Order ID'),
    order_no: z.string().optional(),
    order_date: z.string().optional(),
    delivery_date: z.string().optional(),
    customer_name: z.string().optional(),
    customer_email: z.string().optional(),
    customer_phone: z.string().optional(),
    customer_address: z.string().optional(),
    tax_state_code: z.string().optional(),
    remark: z.string().optional(),
    logistics_provider: z.string().optional(),
    tracking_number: z.string().optional(),
    delivery_channel: z.string().optional(),
    weight_kg: z.number().optional(),
    logistics_cost_rmb: z.number().optional(),
    shipping_cost: z.number().optional(),
    delivered_date: z.string().optional(),
    shipping_date: z.string().optional()
  });

  mut('delete_order', '[WRITE] Delete an order and all its items and feedback', 'DELETE', '/api/orders/:id', {
    id: z.number().describe('Order ID to delete')
  });

  mut('set_order_status', '[WRITE] Update order status (draft/production/shipping/completed)', 'PUT', '/api/orders/:id/status', {
    id: z.number().describe('Order ID'),
    status: z.enum(['draft', 'production', 'shipping', 'completed']).describe('New status')
  });

  mut('set_order_reminder', '[WRITE] Set or clear a reminder flag on an order', 'PUT', '/api/orders/:id/reminder', {
    id: z.number().describe('Order ID'),
    reminder: z.number().describe('1 to set, 0 to clear'),
    reminder_text: z.string().optional().describe('Reminder text')
  });

  mut('recalculate_order', '[WRITE] Recalculate all cost fields for an order', 'POST', '/api/orders/:id/recalculate', {
    id: z.number().describe('Order ID')
  });

  mut('recalculate_all_orders', '[WRITE] Recalculate all orders for the current channel', 'POST', '/api/orders/recalculate-all', {});

  mut('update_order_logistics', '[WRITE] Update logistics cost and recalculate', 'PUT', '/api/orders/:id/logistics', {
    id: z.number().describe('Order ID'),
    logistics_cost_rmb: z.number().describe('Logistics cost in RMB'),
    logistics_provider: z.string().optional(),
    tracking_number: z.string().optional(),
    delivery_channel: z.string().optional(),
    weight_kg: z.number().optional()
  });

  mut('update_order_cost_overrides', '[WRITE] Set production cost override and logistics cost, then recalculate', 'PUT', '/api/orders/:id/cost-overrides', {
    id: z.number().describe('Order ID'),
    production_cost_override_rmb: z.number().nullable().describe('Override production cost (null to clear)'),
    logistics_cost_rmb: z.number().optional()
  });

  mut('update_order_financial', '[WRITE] Override sales amount and tax in USD, or clear overrides. Recalculates.', 'PUT', '/api/orders/:id/financial', {
    id: z.number().describe('Order ID'),
    sales_override_usd: z.number().nullable().optional().describe('Override sales amount (null to clear)'),
    tax_override_usd: z.number().nullable().optional().describe('Override tax amount (null to clear)')
  });

  mut('update_delivery_screenshot', '[WRITE] Upload a delivery confirmation screenshot (base64 image)', 'POST', '/api/orders/:id/delivery-screenshot', {
    id: z.number().describe('Order ID'),
    image_base64: z.string().describe('Base64-encoded image data'),
    filename: z.string().optional().describe('Filename (default: screenshot.png)')
  });

  mut('delete_delivery_screenshot', '[WRITE] Delete the delivery confirmation screenshot', 'DELETE', '/api/orders/:id/delivery-screenshot', {
    id: z.number().describe('Order ID')
  });

  // ========== ORDER ITEMS ==========
  mut('set_item_discount', '[WRITE] Set discount mode/value and actual paid amount for an order item', 'PUT', '/api/order-items/:id/discount', {
    id: z.number().describe('Order item ID'),
    discount_mode: z.enum(['none', 'flat', 'percent']).describe('Discount mode'),
    discount_value: z.number().optional().describe('Discount value'),
    actual_paid_usd: z.number().optional().describe('Actual amount paid in USD')
  });

  mut('set_item_option', '[WRITE] Update a single selected option on an order item', 'PUT', '/api/order-items/:id/option', {
    id: z.number().describe('Order item ID'),
    option_key: z.string().describe('Option key'),
    option_value: z.string().describe('Option value label')
  });

  mut('update_item_size', '[WRITE] Update width/length dimensions for an order item', 'PUT', '/api/order-items/:id/size', {
    id: z.number().describe('Order item ID'),
    width_in: z.number().positive().describe('Width in inches'),
    length_in: z.number().positive().describe('Length in inches')
  });

  mut('update_item_qty', '[WRITE] Update quantity for an order item', 'PUT', '/api/order-items/:id/qty', {
    id: z.number().describe('Order item ID'),
    qty: z.number().positive().describe('New quantity')
  });

  mut('update_item_production_cost', '[WRITE] Set or clear production cost override on an order item', 'PUT', '/api/order-items/:id/production-cost', {
    id: z.number().describe('Order item ID'),
    production_cost_override_rmb: z.number().nullable().describe('Override cost in RMB (null to clear)')
  });

  // ========== FACTORY ==========
  get('list_factory_orders', 'List factory-formatted order summaries for production', '/api/factory/orders');

  get('get_factory_params', 'Get all factory parameters (globals, fabrics, linings, labor rules, memory rules)', '/api/factory/params');

  mut('update_factory_params', '[WRITE] Batch update all factory parameters in a single transaction', 'PUT', '/api/factory/params', {
    globals: z.record(z.string()).optional().describe('Global config key-value pairs'),
    fabrics: z.array(z.object({ id: z.string(), name: z.string(), width_cm: z.number(), price_per_m: z.number() })).optional(),
    linings: z.array(z.object({ id: z.string(), name: z.string(), width_cm: z.number(), price_per_m: z.number() })).optional(),
    labor_rules: z.array(z.object({ layer: z.string(), min_m: z.number(), max_m: z.number().nullable().optional(), rate_rmb_per_m: z.number() })).optional(),
    memory_rules: z.array(z.object({ min_m: z.number(), max_m: z.number().nullable().optional(), single_rate_rmb: z.number(), double_coef: z.number().optional() })).optional()
  });

  get('list_factory_feedback', 'List all factory feedback rows (actual usage and costs)', '/api/factory/feedback');

  mut('delete_factory_feedback', '[WRITE] Delete factory feedback records by IDs. Recalculates affected orders.', 'DELETE', '/api/factory/feedback', {
    ids: z.array(z.number()).describe('Array of feedback IDs to delete')
  });

  // ========== ANALYTICS ==========
  getQ('get_analytics_overview', 'Get comprehensive analytics: summary totals, monthly trends, expense breakdown, product comparison, channel comparison. Supports date/status/product filters.', '/api/analytics/overview', {
    date_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    date_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    channel: z.string().optional().describe('Filter by channel'),
    status: z.string().optional().describe('Filter by status'),
    product_id: z.string().optional().describe('Filter by product')
  });

  // ========== IMPORT / EXPORT ==========
  server.tool('export_config_csv', 'Export full system configuration as CSV (fabrics, linings, rules, products)', {}, async () => {
    try {
      const result = await client.request('GET', '/api/export/config-csv');
      if (result._file) {
        const text = result.buffer.toString('utf-8');
        return { content: [{ type: 'text', text }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_orders_csv', 'Export all orders for the current channel as CSV with full details', {}, async () => {
    try {
      const result = await client.request('GET', '/api/export/orders-csv');
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_summary_csv', 'Export order summary CSV with optional channel and status filters', {
    channel: z.string().optional().describe('Filter by channel'),
    status: z.string().optional().describe('Filter by status')
  }, async (params) => {
    try {
      const result = await client.request('GET', '/api/export/summary-csv', { query: params });
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_factory_order_xlsx', 'Download a factory production sheet for a single order as XLSX (base64)', {
    order_id: z.number().describe('Order ID')
  }, async ({ order_id }) => {
    try {
      const result = await client.request('GET', `/api/export/factory-order/${order_id}`);
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_cost_record_csv', 'Download cost record for a single order as CSV', {
    order_id: z.number().describe('Order ID')
  }, async ({ order_id }) => {
    try {
      const result = await client.request('GET', `/api/export/cost-record/${order_id}`);
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_product_template_csv', 'Download empty product import template CSV', {}, async () => {
    try {
      const result = await client.request('GET', '/api/export/product-template-csv');
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_order_import_template_csv', 'Download order import template CSV with example data', {}, async () => {
    try {
      const result = await client.request('GET', '/api/export/order-import-template-csv');
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_product_config_csv', 'Download a single product configuration as CSV', {
    id: z.string().describe('Product ID')
  }, async ({ id }) => {
    try {
      const result = await client.request('GET', `/api/export/product-csv/${id}`);
      if (result._file) return { content: [{ type: 'text', text: result.buffer.toString('utf-8') }] };
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_factory_orders_batch', '[WRITE] Download batch factory production sheets as XLSX (base64)', {
    order_ids: z.array(z.number()).describe('Array of order IDs')
  }, async ({ order_ids }) => {
    try {
      const result = await client.request('POST', '/api/export/factory-orders-batch', { body: { order_ids } });
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('export_orders_full_batch', '[WRITE] Download full order details (all fields, multi-item expansion) as XLSX (base64)', {
    order_ids: z.array(z.number()).optional().describe('Array of order IDs (empty for all)')
  }, async ({ order_ids }) => {
    try {
      const result = await client.request('POST', '/api/export/orders-full-batch', { body: { order_ids: order_ids || [] } });
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('import_config_csv', '[WRITE] Import full configuration from CSV (fabrics, linings, rules, products). Provide base64-encoded CSV content.', {
    file_content: z.string().describe('Base64-encoded CSV file content')
  }, async ({ file_content }) => {
    try {
      const buffer = Buffer.from(file_content, 'base64');
      const result = await client.uploadFile('/api/import/config-csv', 'file', 'config.csv', buffer, 'text/csv');
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('import_product_csv', '[WRITE] Import product template from CSV for the current channel. Provide base64-encoded CSV content.', {
    file_content: z.string().describe('Base64-encoded CSV file content')
  }, async ({ file_content }) => {
    try {
      const buffer = Buffer.from(file_content, 'base64');
      const result = await client.uploadFile('/api/import/product-csv', 'file', 'products.csv', buffer, 'text/csv');
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('import_orders_csv', '[WRITE] Import orders from CSV. Provide base64-encoded CSV content.', {
    file_content: z.string().describe('Base64-encoded CSV file content')
  }, async ({ file_content }) => {
    try {
      const buffer = Buffer.from(file_content, 'base64');
      const result = await client.uploadFile('/api/import/orders-csv', 'file', 'orders.csv', buffer, 'text/csv');
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  // ========== SHOPIFY ==========
  get('get_shopify_status', 'Get Shopify integration status and settings', '/api/shopify/status');

  mut('update_shopify_settings', '[WRITE] Save Shopify settings (shop domain, API version, admin token)', 'POST', '/api/shopify/settings', {
    shop_domain: z.string().optional().describe('Shopify shop domain'),
    api_version: z.string().optional().describe('Shopify API version'),
    admin_token: z.string().optional().describe('Shopify Admin API access token')
  });

  mut('fetch_shopify_order', 'Fetch a single Shopify order by order name', 'POST', '/api/shopify/orders/fetch', {
    order_name: z.string().describe('Shopify order name (e.g. #1001)')
  });

  get('list_shopify_recent_orders', 'Fetch recent Shopify orders', '/api/shopify/orders/recent', {
    limit: z.number().optional().describe('Max orders to fetch (default 20)')
  });

  // ========== SAMPLES ==========
  get('list_samples', 'List sample sales records', '/api/samples');

  mut('create_sample', '[WRITE] Create a new sample sale record', 'POST', '/api/samples', {
    product_id: z.string().optional(),
    fabric_name: z.string().describe('Fabric name'),
    quantity: z.number().positive().optional().describe('Quantity (default 1)'),
    amount_usd: z.number().optional().describe('Amount in USD'),
    sale_date: z.string().optional().describe('Sale date (YYYY-MM-DD)'),
    remark: z.string().optional()
  });

  mut('delete_sample', '[WRITE] Delete a sample sale record', 'DELETE', '/api/samples/:id', {
    id: z.number().describe('Sample record ID to delete')
  });

  // ========== PRODUCTION PHOTOS ==========
  get('list_production_photos', 'List all production photos for an order', '/api/production-photos/:orderId', {
    orderId: z.number().describe('Order ID')
  });

  mut('upload_production_photos', '[WRITE] Upload production photos for an order (base64 image(s))', 'POST', '/api/production-photos/:orderId', {
    orderId: z.number().describe('Order ID'),
    images: z.array(z.object({
      data: z.string().describe('Base64-encoded image data'),
      filename: z.string().describe('Filename with extension'),
      mime_type: z.string().optional().describe('MIME type (default: image/png)')
    })).describe('Array of images to upload (max 20)')
  });

  mut('delete_production_photo', '[WRITE] Delete a production photo', 'DELETE', '/api/production-photos/:photoId', {
    photoId: z.number().describe('Photo ID to delete')
  });

  // ========== BACKUPS ==========
  get('list_backups', 'List the 50 most recent database backups', '/api/backups');

  mut('create_backup', '[WRITE] Create a manual database backup', 'POST', '/api/backups/manual', {
    note: z.string().optional().describe('Backup note')
  });

  server.tool('get_latest_backup_json', 'Export full database as JSON. Returns the JSON payload directly.', {}, async () => {
    try {
      const result = await client.request('GET', '/api/backups/export-json');
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  mut('import_backup_json', '[WRITE] Import database from JSON backup. Creates auto-backup before restore.', 'POST', '/api/backups/import-json', {
    file_content: z.string().describe('Base64-encoded JSON backup file content')
  });

  server.tool('get_delivery_screenshot', 'Download delivery confirmation screenshot for an order (base64)', {
    id: z.number().describe('Order ID')
  }, async ({ id }) => {
    try {
      const result = await client.request('GET', `/api/orders/${id}/delivery-screenshot`);
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('get_production_photo_file', 'Download a production photo file by filename (base64)', {
    filename: z.string().describe('Photo filename')
  }, async ({ filename }) => {
    try {
      const result = await client.request('GET', `/api/production-photos/file/${encodeURIComponent(filename)}`);
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });

  server.tool('get_latest_backup_download', 'Download the most recent backup file (base64)', {}, async () => {
    try {
      const result = await client.request('GET', '/api/backups/latest/download');
      if (result._file) {
        return { content: [{ type: 'text', text: `File: ${result.filename}\nContent-Type: ${result.contentType}\nBase64: ${result.buffer.toString('base64')}` }] };
      }
      return jsonResult(result);
    } catch (e) { return errResult(e.message); }
  });
}

module.exports = { registerTools };

const { db } = require('../db');

function getGlobals() {
  const out = {};
  for (const row of db.prepare('SELECT key,value,value_type FROM globals').all()) {
    if (row.value_type === 'number') out[row.key] = Number(row.value) || 0;
    else if (row.value_type === 'boolean') out[row.key] = row.value === 'true' || row.value === '1';
    else out[row.key] = row.value || '';
  }
  return out;
}
function saveSetting(key, value) {
  db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,value_type=excluded.value_type,updated_at=excluded.updated_at')
    .run(key, String(value || ''), 'text', key === 'shopifyAdminToken' ? 'Shopify Admin API token' : 'Shopify setting', new Date().toISOString());
}
function settings() {
  const g = getGlobals();
  return {
    shopDomain: g.shopifyShopDomain || '',
    apiVersion: g.shopifyApiVersion || '2026-01',
    hasToken: !!g.shopifyAdminToken
  };
}
function privateSettings() {
  const g = getGlobals();
  const shopDomain = String(g.shopifyShopDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  const token = String(g.shopifyAdminToken || '').trim();
  const apiVersion = String(g.shopifyApiVersion || '2026-01').trim();
  if (!shopDomain) throw new Error('请先填写 Shopify 店铺域名');
  if (!token) throw new Error('请先填写 Shopify Admin API Access Token');
  return { shopDomain, token, apiVersion };
}
async function shopifyGet(path, params = {}) {
  const { shopDomain, token, apiVersion } = privateSettings();
  const url = new URL(`https://${shopDomain}/admin/api/${apiVersion}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.errors || data.error || `Shopify API 请求失败：${res.status}`);
  return data;
}
function firstTaxRate(order) {
  const line = (order.tax_lines || [])[0] || (order.line_items || []).flatMap(x => x.tax_lines || [])[0];
  if (line?.rate != null) return Number(line.rate) > 1 ? Number(line.rate) : Number(line.rate) * 100;
  const total = Number(order.current_total_price || order.total_price || 0);
  const tax = Number(order.current_total_tax || order.total_tax || 0);
  return total > 0 ? (tax / Math.max(total - tax, 0.01)) * 100 : 0;
}
function propMap(lineItem) {
  const out = {};
  for (const p of lineItem.properties || []) {
    if (p && p.name && p.value !== '' && p.value != null) out[p.name] = p.value;
  }
  return out;
}
function pickProp(props, names) {
  const entries = Object.entries(props);
  for (const name of names) {
    const hit = entries.find(([k]) => k.toLowerCase().replace(/[^a-z0-9]+/g, '') === name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (hit) return hit[1];
  }
  return '';
}
function asNumber(v) {
  const m = String(v || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}
function mapOrder(order) {
  const address = order.shipping_address || order.billing_address || {};
  const customer = order.customer || {};
  return {
    shopify_order_id: String(order.id),
    order_no: order.name || order.order_number || '',
    order_date: String(order.created_at || '').slice(0, 10),
    customer_name: [address.first_name || customer.first_name, address.last_name || customer.last_name].filter(Boolean).join(' ') || order.customer?.default_address?.name || '',
    customer_email: order.email || order.contact_email || customer.email || '',
    customer_phone: address.phone || order.phone || customer.phone || '',
    customer_address: [address.address1, address.address2, address.city, address.province_code || address.province, address.zip, address.country_code || address.country].filter(Boolean).join(', '),
    billing_address: [order.billing_address?.company, order.billing_address?.name, order.billing_address?.address1, order.billing_address?.address2, order.billing_address?.city, order.billing_address?.province_code || order.billing_address?.province, order.billing_address?.zip, order.billing_address?.country_code || order.billing_address?.country].filter(Boolean).join('\n'),
    tax_state_code: address.province_code || '',
    tax_rate: firstTaxRate(order),
    total_price_usd: Number(order.current_total_price || order.total_price || 0),
    total_tax_usd: Number(order.current_total_tax || order.total_tax || 0),
    financial_status: order.financial_status || '',
    fulfillment_status: order.fulfillment_status || '',
    items: (order.line_items || []).map(line => {
      const props = propMap(line);
      const selected_options = {
        color: pickProp(props, ['Color']),
        header_style: pickProp(props, ['Hanging Header Style', 'Header Style']),
        lining: pickProp(props, ['Lining Type', 'Lining']),
        memory_shaped: pickProp(props, ['Memory Shaped', 'Memory']),
        tieback: pickProp(props, ['Matching Tieback', 'Tieback'])
      };
      return {
        shopify_line_item_id: String(line.id),
        title: line.title,
        sku: line.sku || '',
        variant_title: line.variant_title || '',
        quantity: Number(line.quantity || 1),
        width_in: asNumber(pickProp(props, ['Width', 'Width inch', 'Width / inch'])),
        length_in: asNumber(pickProp(props, ['Length', 'Length inch', 'Length / inch'])),
        room_label: pickProp(props, ['Room Label', 'Room']),
        selected_options,
        properties: props,
        price_usd: Number(line.price || 0) * Number(line.quantity || 1)
      };
    })
  };
}
async function fetchOrderByName(orderName) {
  const name = String(orderName || '').trim();
  if (!name) throw new Error('请输入 Shopify 订单号');
  const data = await shopifyGet('/orders.json', { status: 'any', name, limit: 1 });
  const order = (data.orders || [])[0];
  if (!order) throw new Error(`没有找到订单：${name}`);
  return mapOrder(order);
}
async function recentOrders(limit = 20) {
  const data = await shopifyGet('/orders.json', { status: 'any', limit: Math.min(Number(limit) || 20, 50), order: 'created_at desc' });
  return (data.orders || []).map(mapOrder);
}

module.exports = { settings, saveSetting, fetchOrderByName, recentOrders };

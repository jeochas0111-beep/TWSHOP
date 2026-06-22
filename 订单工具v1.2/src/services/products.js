const { db } = require('../db');

function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function b(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' ? 1 : 0; }
function slug(s) { return String(s || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `product_${Date.now()}`; }
function now() { return new Date().toISOString(); }
function toProductPayload(body) {
  const id = body.id || slug(body.name);
  if (!body.name) throw new Error('产品名称必填');
  if (n(body.base_price ?? body.basePrice) < 0) throw new Error('基础价不能为负');
  const ch = body.channel === 'amazon' ? 'amazon' : 'shopify';
  return {
    id,
    name: body.name,
    channel: ch,
    factory_name: body.factory_name ?? body.factoryName ?? body.name,
    shopify_option_set: body.shopify_option_set ?? body.shopifyOptionSet ?? '',
    type: body.type || 'curtain',
    series: body.series || '',
    default_fabric_id: body.default_fabric_id ?? body.defaultFabricId ?? '',
    base_price: n(body.base_price ?? body.basePrice),
    default_fullness: n(body.default_fullness ?? body.defaultFullness, 2),
    panels_per_unit: Math.max(1, n(body.panels_per_unit ?? body.panelsPerUnit, 1)),
    enabled: b(body.enabled !== false),
    width_prices: body.width_prices || body.widthPrices || [],
    length_prices: body.length_prices || body.lengthPrices || [],
    options: body.options || []
  };
}
const VALID_TABLES = new Set(['product_width_prices', 'product_length_prices', 'product_option_groups', 'product_option_values']);
function rows(productId, table) {
  if (!VALID_TABLES.has(table)) throw new Error('Invalid table name');
  return db.prepare(`SELECT * FROM ${table} WHERE product_id=? ORDER BY sort_order,id`).all(productId);
}
function getProduct(id) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!p) return null;
  const archiveRow = db.prepare('SELECT channel FROM product_archive WHERE product_id=?').all(id);
  const archivedChannels = new Set(archiveRow.map(r => r.channel));
  const options = db.prepare('SELECT * FROM product_option_groups WHERE product_id=? ORDER BY sort_order,id').all(id).map(g => ({
    ...g,
    key: g.option_key,
    values: db.prepare('SELECT * FROM product_option_values WHERE group_id=? ORDER BY sort_order,id').all(g.id).map(v => ({ ...v, price: v.price_usd, costRmb: v.cost_rmb }))
  }));
  return {
    ...p,
    factoryName: p.factory_name,
    shopifyOptionSet: p.shopify_option_set,
    defaultFabricId: p.default_fabric_id,
    basePrice: p.base_price,
    defaultFullness: p.default_fullness,
    panelsPerUnit: p.panels_per_unit || 1,
    enabled: !!p.enabled,
    archived: archivedChannels.has(p.channel || 'shopify'),
    archivedChannels: [...archivedChannels],
    width_prices: rows(id, 'product_width_prices'),
    length_prices: rows(id, 'product_length_prices'),
    widthPrices: rows(id, 'product_width_prices').map(r => ({ size: r.size_in, price: r.price_usd })),
    lengthPrices: rows(id, 'product_length_prices').map(r => ({ size: r.size_in, price: r.price_usd })),
    options
  };
}
function getProducts(channel) {
  let products;
  if (channel === 'amazon' || channel === 'shopify') {
    products = db.prepare(`SELECT p.* FROM products p WHERE p.channel=? AND p.id NOT IN (SELECT product_id FROM product_archive WHERE channel=?) ORDER BY p.enabled DESC,p.name`).all(channel, channel);
  } else {
    products = db.prepare('SELECT * FROM products ORDER BY enabled DESC,name').all();
  }
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const widthRows = db.prepare(`SELECT * FROM product_width_prices WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const lengthRows = db.prepare(`SELECT * FROM product_length_prices WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const groups = db.prepare(`SELECT * FROM product_option_groups WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const groupIds = groups.map((g) => g.id);
  const values = groupIds.length
    ? db.prepare(`SELECT * FROM product_option_values WHERE group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY group_id,sort_order,id`).all(...groupIds)
    : [];

  const byProduct = (rows) => rows.reduce((map, row) => {
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(row);
    return map;
  }, new Map());
  const widthByProduct = byProduct(widthRows);
  const lengthByProduct = byProduct(lengthRows);
  const valuesByGroup = values.reduce((map, row) => {
    if (!map.has(row.group_id)) map.set(row.group_id, []);
    map.get(row.group_id).push(row);
    return map;
  }, new Map());
  const groupsByProduct = byProduct(groups);

  return products.map((p) => {
    const width_prices = widthByProduct.get(p.id) || [];
    const length_prices = lengthByProduct.get(p.id) || [];
    const options = (groupsByProduct.get(p.id) || []).map(g => ({
      ...g,
      key: g.option_key,
      values: (valuesByGroup.get(g.id) || []).map(v => ({ ...v, price: v.price_usd, costRmb: v.cost_rmb }))
    }));
    return {
      ...p,
      factoryName: p.factory_name,
      shopifyOptionSet: p.shopify_option_set,
      defaultFabricId: p.default_fabric_id,
      basePrice: p.base_price,
      defaultFullness: p.default_fullness,
      panelsPerUnit: p.panels_per_unit || 1,
      enabled: !!p.enabled,
      width_prices,
      length_prices,
      widthPrices: width_prices.map(r => ({ size: r.size_in, price: r.price_usd })),
      lengthPrices: length_prices.map(r => ({ size: r.size_in, price: r.price_usd })),
      options
    };
  });
}
function getArchivedProducts(channel) {
  const ch = channel === 'amazon' ? 'amazon' : 'shopify';
  const products = db.prepare(`SELECT p.* FROM products p INNER JOIN product_archive pa ON p.id=pa.product_id WHERE pa.channel=? AND p.channel=? ORDER BY p.name`).all(ch, ch);
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const widthRows = db.prepare(`SELECT * FROM product_width_prices WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const lengthRows = db.prepare(`SELECT * FROM product_length_prices WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const groups = db.prepare(`SELECT * FROM product_option_groups WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`).all(...ids);
  const groupIds = groups.map((g) => g.id);
  const values = groupIds.length
    ? db.prepare(`SELECT * FROM product_option_values WHERE group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY group_id,sort_order,id`).all(...groupIds)
    : [];
  const byProduct = (rows) => rows.reduce((map, row) => { if (!map.has(row.product_id)) map.set(row.product_id, []); map.get(row.product_id).push(row); return map; }, new Map());
  const widthByProduct = byProduct(widthRows);
  const lengthByProduct = byProduct(lengthRows);
  const valuesByGroup = values.reduce((map, row) => { if (!map.has(row.group_id)) map.set(row.group_id, []); map.get(row.group_id).push(row); return map; }, new Map());
  const groupsByProduct = byProduct(groups);
  return products.map((p) => ({
    ...p,
    factoryName: p.factory_name,
    shopifyOptionSet: p.shopify_option_set,
    defaultFabricId: p.default_fabric_id,
    basePrice: p.base_price,
    defaultFullness: p.default_fullness,
    panelsPerUnit: p.panels_per_unit || 1,
    enabled: !!p.enabled,
    archived: true,
    width_prices: widthByProduct.get(p.id) || [],
    length_prices: lengthByProduct.get(p.id) || [],
    widthPrices: (widthByProduct.get(p.id) || []).map(r => ({ size: r.size_in, price: r.price_usd })),
    lengthPrices: (lengthByProduct.get(p.id) || []).map(r => ({ size: r.size_in, price: r.price_usd })),
    options: (groupsByProduct.get(p.id) || []).map(g => ({ ...g, key: g.option_key, values: (valuesByGroup.get(g.id) || []).map(v => ({ ...v, price: v.price_usd, costRmb: v.cost_rmb })) }))
  }));
}
function archiveProduct(productId, channel) {
  const ch = channel === 'amazon' ? 'amazon' : 'shopify';
  db.prepare('INSERT OR IGNORE INTO product_archive(product_id,channel,archived_at) VALUES(?,?,?)').run(productId, ch, now());
}
function unarchiveProduct(productId, channel) {
  const ch = channel === 'amazon' ? 'amazon' : 'shopify';
  db.prepare('DELETE FROM product_archive WHERE product_id=? AND channel=?').run(productId, ch);
}
function replacePrices(productId, kind, prices) {
  const table = kind === 'width' ? 'product_width_prices' : 'product_length_prices';
  db.transaction((rows) => {
    db.prepare(`DELETE FROM ${table} WHERE product_id=?`).run(productId);
    const stmt = db.prepare(`INSERT INTO ${table}(product_id,size_in,price_usd,sort_order) VALUES(?,?,?,?)`);
    (rows || []).filter(r => n(r.size_in ?? r.size) > 0).forEach((r, i) => {
      if (n(r.price_usd ?? r.price) < 0) throw new Error('价格不能为负');
      stmt.run(productId, n(r.size_in ?? r.size), n(r.price_usd ?? r.price), i);
    });
  })(prices);
}
function replaceProductOptions(productId, options) {
  db.transaction((items) => {
    db.prepare('DELETE FROM product_option_groups WHERE product_id=?').run(productId);
    const group = db.prepare('INSERT INTO product_option_groups(product_id,option_key,label,source_name,type,required,priceable,costable,factory,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const value = db.prepare('INSERT INTO product_option_values(group_id,label,price_usd,cost_rmb,sort_order) VALUES(?,?,?,?,?)');
    (items || []).forEach((o, i) => {
      const key = o.option_key || o.key || slug(o.label || `option_${i}`);
      const info = group.run(productId, key, o.label || key, o.source_name || o.sourceName || o.label || key, o.type || 'dropdown', b(o.required !== false), b(o.priceable !== false), b(o.costable !== false), b(o.factory !== false), i);
      (o.values || []).forEach((v, j) => value.run(info.lastInsertRowid, v.label || '', n(v.price_usd ?? v.price), n(v.cost_rmb ?? v.costRmb), j));
    });
  })(options);
}
function upsertProduct(payload) {
  const p = toProductPayload(payload);
  db.prepare('INSERT INTO products(id,name,channel,factory_name,shopify_option_set,type,series,default_fabric_id,base_price,default_fullness,panels_per_unit,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,channel=excluded.channel,factory_name=excluded.factory_name,shopify_option_set=excluded.shopify_option_set,type=excluded.type,series=excluded.series,default_fabric_id=excluded.default_fabric_id,base_price=excluded.base_price,default_fullness=excluded.default_fullness,panels_per_unit=excluded.panels_per_unit,enabled=excluded.enabled,updated_at=excluded.updated_at')
    .run(p.id, p.name, p.channel, p.factory_name, p.shopify_option_set, p.type, p.series, p.default_fabric_id, p.base_price, p.default_fullness, p.panels_per_unit, p.enabled, now(), now());
  if (payload.width_prices || payload.widthPrices) replacePrices(p.id, 'width', p.width_prices);
  if (payload.length_prices || payload.lengthPrices) replacePrices(p.id, 'length', p.length_prices);
  if (payload.options) replaceProductOptions(p.id, p.options);
  return getProduct(p.id);
}

module.exports = { toProductPayload, getProducts, getProduct, getArchivedProducts, archiveProduct, unarchiveProduct, replaceProductOptions, replacePrices, upsertProduct };

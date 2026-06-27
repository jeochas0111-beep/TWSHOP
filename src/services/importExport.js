const { db } = require('../db');
const { getProducts, upsertProduct, getProduct } = require('./products');

function n(v, fallback = 0) {
  const cleaned = String(v ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  const x = Number(cleaned);
  return Number.isFinite(x) ? x : fallback;
}
function truth(v) { return !/^(false|0|否|停用)$/i.test(String(v ?? '').trim()); }
function norm(s) { return String(s || '').trim().replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function val(row, aliases) {
  const map = {};
  for (const [k, v] of Object.entries(row)) map[norm(k)] = v;
  for (const a of aliases) if (map[norm(a)] != null) return map[norm(a)];
  return '';
}
function slug(s) {
  return String(s || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `product_${Date.now()}`;
}
function parseDimensionSize(label) {
  const text = String(label || '').trim();
  if (!text) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? n(m[1]) : 0;
}
function detectDimensionKind(optionName, values) {
  const key = norm(optionName);
  const isWidthName = /(width|panel_width|single_panel_width)/.test(key);
  const isLengthName = /(length|drop|panel_length|single_panel_length|height)/.test(key);
  if (!isWidthName && !isLengthName) return '';
  const hasNumericSizes = (values || []).some(v => parseDimensionSize(v.label) > 0);
  if (!hasNumericSizes) return '';
  return isWidthName ? 'width' : 'length';
}
function parsePriceMap(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  return raw.split('|').map(part => {
    const [size, price] = part.split(':');
    return { size_in: n(size), price_usd: n(price) };
  }).filter(x => x.size_in > 0);
}
function formatPriceMap(rows) {
  return (rows || []).map(r => `${n(r.size_in ?? r.size)}:${n(r.price_usd ?? r.price).toFixed(2)}`).join('|');
}
function parseOptionGroups(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  return raw.split(';').map(groupPart => {
    const [groupLabel, valuesText] = groupPart.split('=');
    const label = String(groupLabel || '').trim();
    if (!label) return null;
    const values = String(valuesText || '').split('|').map(v => {
      const [valueLabel, price, third] = v.split(':');
      return {
        label: String(valueLabel || '').trim(),
        price_usd: n(price),
        cost_rmb: n(third) // 第三段沿用到成本字段，兼容现有数据结构
      };
    }).filter(v => v.label);
    return {
      option_key: slug(label),
      key: slug(label),
      label,
      source_name: label,
      type: 'dropdown',
      required: true,
      factory: true,
      priceable: true,
      costable: true,
      values
    };
  }).filter(Boolean);
}
function formatOptionGroups(options) {
  return (options || []).map(group => {
    const label = group.label || group.option_key || group.key || '';
    const values = (group.values || []).map(v => `${v.label}:${n(v.price_usd ?? v.price).toFixed(2)}:${n(v.cost_rmb ?? v.costRmb).toFixed(2)}`).join('|');
    return `${label}=${values}`;
  }).join(';');
}
function configRows(products = getProducts()) {
  const rows = [];
  db.prepare('SELECT * FROM globals ORDER BY key').all().forEach(g => rows.push({ section: 'global', field: g.key, value: g.value, note: g.note || '' }));
  db.prepare('SELECT * FROM fabrics ORDER BY name').all().forEach(f => rows.push({ section: 'fabric', id: f.id, name: f.name, series: f.series, width_cm: f.width_cm, price_rmb_m: f.price_per_m, enabled: f.enabled }));
  db.prepare('SELECT * FROM linings ORDER BY name').all().forEach(l => rows.push({ section: 'lining', id: l.id, name: l.name, color: l.color, width_cm: l.width_cm, price_rmb_m: l.price_per_m, enabled: l.enabled }));
  products.forEach(p => {
    ['name', 'factory_name', 'shopify_option_set', 'series', 'default_fabric_id', 'base_price', 'default_fullness', 'enabled'].forEach(field => rows.push({ section: 'product_base', product_id: p.id, field, value: p[field] ?? p[field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] ?? '' }));
    (p.width_prices || []).forEach(r => rows.push({ section: 'width_price', product_id: p.id, size_in: r.size_in, price_usd: r.price_usd }));
    (p.length_prices || []).forEach(r => rows.push({ section: 'length_price', product_id: p.id, size_in: r.size_in, price_usd: r.price_usd }));
    (p.options || []).forEach(o => {
      rows.push({ section: 'option_group', product_id: p.id, option_key: o.option_key, label: o.label, field: o.type, value: o.required ? 'required' : 'optional', enabled: o.factory });
      (o.values || []).forEach(v => rows.push({ section: 'option_value', product_id: p.id, option_key: o.option_key, label: v.label, price_usd: v.price_usd, cost_rmb: v.cost_rmb }));
    });
  });
  db.prepare('SELECT * FROM tax_rates ORDER BY code').all().forEach(t => rows.push({ section: 'tax_rate', state_code: t.code, state_name: t.state, tax_rate: t.rate, note: t.note || '' }));
  db.prepare('SELECT * FROM labor_rules ORDER BY sort_order,id').all().forEach(r => rows.push({ section: 'labor_rule', layer: r.layer, min_m: r.min_m, max_m: r.max_m, rate_rmb_m: r.rate_rmb_per_m, note: r.note || '' }));
  db.prepare('SELECT * FROM memory_rules ORDER BY sort_order,id').all().forEach(r => rows.push({ section: 'memory_rule', min_m: r.min_m, max_m: r.max_m, single_rate_rmb_m: r.single_rate_rmb, double_coef: r.double_coef, manual_quote: r.manual_quote, note: r.note || '' }));
  return rows;
}
function productTemplateRows(channel) {
  const fabrics = db.prepare('SELECT id,name FROM fabrics ORDER BY name').all();
  const fabricNameById = new Map(fabrics.map(f => [f.id, f.name]));
  const products = getProducts(channel);
  if (!products.length) {
    return [{
      product_name: 'Lucie Linen Blend Curtain',
      default_fabric: '涤麻大肚',
      base_price_usd: '39.99',
      width_prices: '20:7.99|22:8.99|24:9.99',
      length_prices: '30:9.99|32:10.99|34:11.99',
      option_groups: 'Color=Beige White:0:0|Natural:0:0;Lining Type=Unlined:0:0|Blackout 80%:45.99:0|Blackout 100%:56.99:0'
    }];
  }
  return products.map(p => ({
    product_name: p.name || '',
    default_fabric: fabricNameById.get(p.default_fabric_id || p.defaultFabricId) || p.default_fabric_id || p.defaultFabricId || '',
    base_price_usd: n(p.base_price ?? p.basePrice).toFixed(2),
    width_prices: formatPriceMap(p.width_prices || p.widthPrices),
    length_prices: formatPriceMap(p.length_prices || p.lengthPrices),
    option_groups: formatOptionGroups(p.options || [])
  }));
}
function applyProductTemplateRows(rows, channel) {
  const fabrics = db.prepare('SELECT id,name FROM fabrics').all();
  const fabricIdByName = new Map(fabrics.map(f => [String(f.name || '').trim(), f.id]));
  let changed = 0;
  rows.forEach((r, index) => {
    const productName = String(val(r, ['product_name', 'product name', 'name', '产品名称'])).trim();
    const defaultFabric = String(val(r, ['default_fabric', 'default fabric', 'fabric', '默认主面料'])).trim();
    const basePrice = String(val(r, ['base_price_usd', 'base price usd', 'base_price', 'base price', '基础价usd', '基础价'])).trim();
    const widthPrices = String(val(r, ['width_prices', 'width prices', 'width_price_map', 'width'])).trim();
    const lengthPrices = String(val(r, ['length_prices', 'length prices', 'length_price_map', 'length'])).trim();
    const optionGroups = String(val(r, ['option_groups', 'option groups', 'options', '选项组'])).trim();
    if (!productName && !defaultFabric && !basePrice) return;
    if (!productName || !defaultFabric || basePrice === '') {
      throw new Error(`第 ${index + 2} 行缺少必填字段（product_name/default_fabric/base_price_usd）`);
    }
    const ch = channel || 'shopify';
    const existing = getProducts(ch).find(p => String(p.name || '').trim() === productName);
    const defaultFabricId = fabricIdByName.get(defaultFabric) || fabrics.find(f => f.id === defaultFabric)?.id || 'fabric_dmdd';
    const product = {
      ...(existing || {}),
      id: existing?.id || slug(productName),
      name: productName,
      channel: ch,
      factory_name: productName,
      default_fabric_id: defaultFabricId,
      base_price: n(basePrice),
      default_fullness: existing?.default_fullness || existing?.defaultFullness || 2,
      enabled: true,
      width_prices: parsePriceMap(widthPrices),
      length_prices: parsePriceMap(lengthPrices),
      options: parseOptionGroups(optionGroups)
    };
    upsertProduct(product);
    changed++;
  });
  return { changed };
}
function applyConfigRows(rows) {
  const products = new Map();
  let changed = 0;
  for (const r of rows) {
    const sec = String(r.section || '').trim();
    if (sec === 'global') {
      const key = r.field || r.name || r.id;
      if (key) db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,value_type=excluded.value_type,note=excluded.note,updated_at=excluded.updated_at').run(key, r.value, isNaN(Number(r.value)) ? 'text' : 'number', r.note || '', new Date().toISOString());
      changed++;
    } else if (sec === 'fabric') {
      db.prepare('INSERT INTO fabrics(id,name,series,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime("now"),datetime("now")) ON CONFLICT(id) DO UPDATE SET name=excluded.name,series=excluded.series,width_cm=excluded.width_cm,price_per_m=excluded.price_per_m,enabled=excluded.enabled,updated_at=datetime("now")').run(r.id, r.name, r.series || r.name, n(r.width_cm), n(r.price_rmb_m), truth(r.enabled) ? 1 : 0);
      changed++;
    } else if (sec === 'lining') {
      db.prepare('INSERT INTO linings(id,name,color,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime("now"),datetime("now")) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,width_cm=excluded.width_cm,price_per_m=excluded.price_per_m,enabled=excluded.enabled,updated_at=datetime("now")').run(r.id, r.name, r.color || '', n(r.width_cm), n(r.price_rmb_m), truth(r.enabled) ? 1 : 0);
      changed++;
    } else if (sec.startsWith('product') || sec === 'width_price' || sec === 'length_price' || sec.startsWith('option')) {
      const pid = r.product_id || r.id;
      if (!pid) continue;
      if (!products.has(pid)) products.set(pid, getProduct(pid) || { id: pid, name: pid, type: 'curtain', default_fabric_id: 'fabric_dmdd', base_price: 0, default_fullness: 2, enabled: true, width_prices: [], length_prices: [], options: [] });
      const p = products.get(pid);
      if (sec === 'product' || sec === 'product_template') {
        p.name = r.product_name || r.name || p.name || pid;
        p.factory_name = p.name;
        p.default_fabric_id = r.fabric_id || r.default_fabric_id || p.default_fabric_id || 'fabric_dmdd';
        p.base_price = n(r.base_price_usd ?? r.base_price ?? p.base_price);
        p.default_fullness = p.default_fullness || 2;
        p.enabled = true;
      } else if (sec === 'product_base') {
        const field = r.field;
        const value = r.value || r.name || '';
        if (field === 'name') p.name = value;
        else if (field === 'factory_name' || field === 'factoryName') p.factory_name = value;
        else if (field === 'shopify_option_set' || field === 'shopifyOptionSet') p.shopify_option_set = value;
        else if (field === 'series') p.series = value;
        else if (field === 'default_fabric_id' || field === 'defaultFabricId') p.default_fabric_id = value;
        else if (field === 'base_price' || field === 'basePrice') p.base_price = n(value);
        else if (field === 'default_fullness' || field === 'defaultFullness') p.default_fullness = n(value, 2);
        else if (field === 'enabled') p.enabled = truth(value);
      } else if (sec === 'width_price') p.width_prices.push({ size_in: n(r.size_in), price_usd: n(r.price_usd) });
      else if (sec === 'length_price') p.length_prices.push({ size_in: n(r.size_in), price_usd: n(r.price_usd) });
      else if (sec === 'option_group') {
        p.options = p.options.filter(o => (o.option_key || o.key) !== r.option_key);
        p.options.push({ option_key: r.option_key, key: r.option_key, label: r.label || r.option_key, source_name: r.label || r.option_key, type: r.field || 'dropdown', required: String(r.value || 'required') !== 'optional', factory: truth(r.enabled), priceable: true, costable: true, values: [] });
      } else if (sec === 'option_value') {
        let o = p.options.find(x => (x.option_key || x.key) === r.option_key);
        if (!o) { o = { option_key: r.option_key, key: r.option_key, label: r.option_key, type: 'dropdown', values: [] }; p.options.push(o); }
        o.values.push({ label: r.label, price_usd: n(r.price_usd), cost_rmb: n(r.cost_rmb) });
      }
      changed++;
    } else if (sec === 'tax_rate') {
      db.prepare('INSERT INTO tax_rates(code,state,rate,note) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,rate=excluded.rate,note=excluded.note').run(String(r.state_code).toUpperCase(), r.state_name, n(r.tax_rate), r.note || '');
      changed++;
    }
  }
  products.forEach(upsertProduct);
  return { changed };
}
function parseEasifyRows(rows) {
  const bySet = {};
  rows.forEach(row => {
    const setName = String(val(row, ['option_set_title', 'option set title', 'option_set_name', 'option set name', 'product_title', 'product name'])).trim();
    const optionName = String(val(row, ['option_name', 'option name', 'option_title', 'option title', 'option_label', 'name'])).trim();
    const label = String(val(row, ['option_value_label', 'option value label', 'option_value', 'value_label', 'label', 'value'])).trim();
    if (!setName || !optionName || !label) return;
    bySet[setName] ||= {};
    bySet[setName][optionName] ||= [];
    bySet[setName][optionName].push({
      label,
      price_usd: n(val(row, ['option_value_add_on_price', 'option value add on price', 'price', 'add-on price', 'option value price'])),
      cost_rmb: n(val(row, ['cost_rmb', 'cost']))
    });
  });
  let productCount = 0, optionCount = 0;
  for (const [setName, opts] of Object.entries(bySet)) {
    let p = getProducts().find(x => norm(x.shopify_option_set || x.shopifyOptionSet || x.name) === norm(setName));
    if (!p) p = { id: norm(setName), name: setName, factory_name: setName, shopify_option_set: setName, type: 'curtain', default_fabric_id: 'fabric_dmdd', base_price: 0, default_fullness: 2, enabled: true, width_prices: [], length_prices: [], options: [] };
    const nextOptions = [];
    const widthPriceMap = new Map();
    const lengthPriceMap = new Map();
    Object.entries(opts).forEach(([name, values]) => {
      const kind = detectDimensionKind(name, values);
      if (kind === 'width' || kind === 'length') {
        const target = kind === 'width' ? widthPriceMap : lengthPriceMap;
        values.forEach(v => {
          const sizeIn = parseDimensionSize(v.label);
          if (sizeIn > 0) target.set(sizeIn, n(v.price_usd));
        });
        return;
      }
      nextOptions.push({
        option_key: norm(name),
        key: norm(name),
        label: name,
        source_name: name,
        type: 'dropdown',
        required: true,
        priceable: true,
        costable: true,
        factory: true,
        values
      });
    });
    p.options = nextOptions;
    if (widthPriceMap.size) {
      p.width_prices = Array.from(widthPriceMap.entries())
        .map(([size_in, price_usd]) => ({ size_in: n(size_in), price_usd: n(price_usd) }))
        .sort((a, b) => a.size_in - b.size_in);
    }
    if (lengthPriceMap.size) {
      p.length_prices = Array.from(lengthPriceMap.entries())
        .map(([size_in, price_usd]) => ({ size_in: n(size_in), price_usd: n(price_usd) }))
        .sort((a, b) => a.size_in - b.size_in);
    }
    upsertProduct(p);
    productCount++;
    optionCount += p.options.length;
  }
  return { productCount, optionCount };
}
module.exports = { configRows, productTemplateRows, applyProductTemplateRows, applyConfigRows, parseEasifyRows };

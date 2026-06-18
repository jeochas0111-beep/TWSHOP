const fs = require('fs');
const path = require('path');

const globals = {
  // --- v2 calculation model globals ---
  usdRmbRate: 6.9,
  paypalFeeRate: 0.044,
  inchToCm: 2.54,
  topHemAllowanceCm: 10,
  bottomHemAllowanceCm: 5,
  singleLayerLossCm: 9,
  doubleLayerLossCm: 11,
  factoryIssueBufferCm: 50,
  defaultFullness: 2,
  singleLaborRmbPerM: 8,
  doubleLaborRmbPerM: 10,
  singleMemoryRmbPerM: 6,
  doubleMemoryRmbPerM: 9,
  costCoefficient: 1.2,
  salesAmountMode: 'pretax',
  usTaxRate: 0,
  // --- legacy / unused keys (kept for backward compat) ---
  usdRmb: 6.8,
  spliceFeePerM: 3,
  profitWarnRate: 0.4,
  superHeightWarnM: 4.5,
  manualHeightM: 7,
  top_nonwoven_allowance_cm: 10,
  bottom_hem_allowance_cm: 5,
  material_issue_buffer_cm: 50,
  manualCutExtraCm: 50,
  factorySettlementMultiplier: 1.2,
  shopifyShopDomain: '',
  shopifyAdminToken: '',
  shopifyApiVersion: '2026-01'
};

const fallback = {
  fabrics: [
    { id: 'fabric_dmdd', name: '涤麻大肚', series: '涤麻大肚', widthCm: 340, pricePerM: 26.14, enabled: true },
    { id: 'fabric_cmdd', name: '棉麻大肚', series: '棉麻大肚', widthCm: 340, pricePerM: 26.14, enabled: true },
    { id: 'fabric_dmmfl', name: '印花麻料', series: '印花麻料', widthCm: 340, pricePerM: 26.14, enabled: true }
  ],
  linings: [
    { id: 'lining_none', name: '无内衬', color: '', widthCm: 0, pricePerM: 0, enabled: true },
    { id: 'lining_white_280', name: '遮光内衬白色', color: 'White Blackout Lining', widthCm: 280, pricePerM: 12, enabled: true },
    { id: 'lining_450_white_280', name: '450gsm遮光内衬白色', color: '450gsm White Blackout Lining', widthCm: 280, pricePerM: 18, enabled: true },
    { id: 'lining_black_280', name: '遮光内衬黑色', color: 'Black Blackout Lining', widthCm: 280, pricePerM: 12, enabled: true }
  ],
  products: [{
    id: 'lucie_linen_blend_curtain',
    name: 'Lucie Linen Blend Curtain',
    factoryName: 'Lucie DMDD',
    shopifyOptionSet: 'Lucie DMDD',
    type: 'curtain',
    series: 'Lucie',
    defaultFabricId: 'fabric_dmdd',
    basePrice: 0,
    defaultFullness: 2,
    enabled: true,
    widthPrices: [{ size: 40, price: 17.99 }, { size: 80, price: 49.99 }, { size: 120, price: 95.99 }, { size: 220, price: 261.99 }],
    lengthPrices: [{ size: 84, price: 38.99 }, { size: 96, price: 44.99 }, { size: 120, price: 59.99 }, { size: 216, price: 117.99 }],
    options: [
      { key: 'color', label: 'Color', sourceName: 'Color', type: 'image-swatches', required: true, priceable: true, costable: false, factory: true, values: [{ label: 'Snow White', price: 0, costRmb: 0 }, { label: 'Natural', price: 0, costRmb: 0 }] },
      { key: 'header_style', label: 'Hanging Header Style', sourceName: 'Hanging Header Style', type: 'dropdown', required: true, priceable: true, costable: true, factory: true, values: [{ label: '2X Pinch Pleat (Black Rings)', price: 25.99, costRmb: 12 }] },
      { key: 'lining', label: 'Lining Type', sourceName: 'Lining Type', type: 'dropdown', required: true, priceable: true, costable: true, factory: true, values: [{ label: 'Unlined', price: 0, costRmb: 0 }, { label: 'Blackout 100%', price: 56.99, costRmb: 0 }] },
      { key: 'memory_shaped', label: 'Memory Shaped', sourceName: 'Memory Shaped', type: 'dropdown', required: false, priceable: true, costable: true, factory: true, values: [{ label: 'Without memory training', price: 0, costRmb: 0 }, { label: 'Add memory training', price: 89.99, costRmb: 0 }] },
      { key: 'tieback', label: 'Matching Tieback', sourceName: 'Matching Tieback', type: 'dropdown', required: true, priceable: true, costable: true, factory: true, values: [{ label: 'Yes need the matching tieback', price: 1, costRmb: 8 }, { label: 'No Need', price: 0, costRmb: 0 }] }
    ]
  }]
};

const taxRates = [
  ['AL', 'Alabama', 9.46], ['AK', 'Alaska', 1.82], ['AZ', 'Arizona', 8.52], ['AR', 'Arkansas', 9.46], ['CA', 'California', 8.99],
  ['CO', 'Colorado', 7.89], ['CT', 'Connecticut', 6.35], ['DE', 'Delaware', 0], ['FL', 'Florida', 7.02], ['GA', 'Georgia', 7.38],
  ['HI', 'Hawaii', 4.5], ['ID', 'Idaho', 6.03], ['IL', 'Illinois', 8.86], ['IN', 'Indiana', 7], ['IA', 'Iowa', 6.94],
  ['KS', 'Kansas', 8.66], ['KY', 'Kentucky', 6], ['LA', 'Louisiana', 9.56], ['ME', 'Maine', 5.5], ['MD', 'Maryland', 6],
  ['MA', 'Massachusetts', 6.25], ['MI', 'Michigan', 6], ['MN', 'Minnesota', 8.04], ['MS', 'Mississippi', 7.07], ['MO', 'Missouri', 8.41],
  ['MT', 'Montana', 0], ['NE', 'Nebraska', 6.97], ['NV', 'Nevada', 8.24], ['NH', 'New Hampshire', 0], ['NJ', 'New Jersey', 6.6],
  ['NM', 'New Mexico', 7.62], ['NY', 'New York', 8.53], ['NC', 'North Carolina', 6.99], ['ND', 'North Dakota', 6.96], ['OH', 'Ohio', 7.24],
  ['OK', 'Oklahoma', 8.99], ['OR', 'Oregon', 0], ['PA', 'Pennsylvania', 6.34], ['RI', 'Rhode Island', 7], ['SC', 'South Carolina', 7.5],
  ['SD', 'South Dakota', 6.4], ['TN', 'Tennessee', 9.56], ['TX', 'Texas', 8.2], ['UT', 'Utah', 7.25], ['VT', 'Vermont', 6.36],
  ['VA', 'Virginia', 5.77], ['WA', 'Washington', 9.46], ['WV', 'West Virginia', 6.57], ['WI', 'Wisconsin', 5.7], ['WY', 'Wyoming', 5.44], ['DC', 'District of Columbia', 6]
].map(([code, state, rate]) => ({ code, state, rate, note: 'average reference; Shopify/ZIP tax prevails' }));

function readLegacyData() {
  const legacyPath = path.join(__dirname, '..', '..', '定制订单统计工具.html');
  if (!fs.existsSync(legacyPath)) return fallback;
  const html = fs.readFileSync(legacyPath, 'utf8');
  const marker = 'const DEFAULT_DATA = ';
  const start = html.indexOf(marker);
  if (start < 0) return fallback;
  const end = html.indexOf(';\nconst STORAGE_KEY', start);
  if (end < 0) return fallback;
  try {
    const parsed = JSON.parse(html.slice(start + marker.length, end));
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function seed(db) {
  const now = new Date().toISOString();
  const data = readLegacyData();
  const tx = db.transaction(() => {
    const g = db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?)');
    for (const [key, value] of Object.entries(globals)) g.run(key, String(value), typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text', '', now);
    const fabric = db.prepare('INSERT INTO fabrics(id,name,series,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for (const f of data.fabrics || fallback.fabrics) fabric.run(f.id, f.name, f.series || f.name, f.widthCm ?? f.width_cm, f.pricePerM ?? f.price_per_m, f.enabled === false ? 0 : 1, now, now);
    const lining = db.prepare('INSERT INTO linings(id,name,color,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for (const l of data.linings || fallback.linings) lining.run(l.id, l.name, l.color || '', l.widthCm ?? l.width_cm, l.pricePerM ?? l.price_per_m, l.enabled === false ? 0 : 1, now, now);
    const product = db.prepare('INSERT INTO products(id,name,channel,factory_name,shopify_option_set,type,series,default_fabric_id,base_price,default_fullness,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const wp = db.prepare('INSERT INTO product_width_prices(product_id,size_in,price_usd,sort_order) VALUES(?,?,?,?)');
    const lp = db.prepare('INSERT INTO product_length_prices(product_id,size_in,price_usd,sort_order) VALUES(?,?,?,?)');
    const og = db.prepare('INSERT INTO product_option_groups(product_id,option_key,label,source_name,type,required,priceable,costable,factory,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const ov = db.prepare('INSERT INTO product_option_values(group_id,label,price_usd,cost_rmb,sort_order) VALUES(?,?,?,?,?)');
    for (const p of data.products || fallback.products) {
      product.run(p.id, p.name, 'shopify', p.factoryName || p.factory_name || p.name, p.shopifyOptionSet || p.shopify_option_set || '', p.type || 'curtain', p.series || '', p.defaultFabricId || p.default_fabric_id || 'fabric_dmdd', p.basePrice || 0, p.defaultFullness || 2, p.enabled === false ? 0 : 1, now, now);
      (p.widthPrices || p.width_prices || []).forEach((r, i) => wp.run(p.id, r.size ?? r.size_in, r.price ?? r.price_usd, i));
      (p.lengthPrices || p.length_prices || []).forEach((r, i) => lp.run(p.id, r.size ?? r.size_in, r.price ?? r.price_usd, i));
      (p.options || []).forEach((o, i) => {
        const info = og.run(p.id, o.key || o.option_key, o.label || o.key, o.sourceName || o.source_name || o.label || '', o.type || 'dropdown', o.required === false ? 0 : 1, o.priceable === false ? 0 : 1, o.costable === false ? 0 : 1, o.factory === false ? 0 : 1, i);
        (o.values || []).forEach((v, j) => ov.run(info.lastInsertRowid, v.label || '', v.price ?? v.price_usd ?? 0, v.costRmb ?? v.cost_rmb ?? 0, j));
      });
    }
    const labor = db.prepare('INSERT INTO labor_rules(layer,min_m,max_m,rate_rmb_per_m,note,sort_order) VALUES(?,?,?,?,?,?)');
    [['single', 0, 3.4, 8], ['single', 3.4, 5, 12], ['single', 5, null, 16], ['double', 0, 3.4, 10], ['double', 3.4, 5, 15], ['double', 5, null, 20]].forEach((r, i) => labor.run(r[0], r[1], r[2], r[3], '', i));
    const memory = db.prepare('INSERT INTO memory_rules(min_m,max_m,single_rate_rmb,double_coef,manual_quote,note,sort_order) VALUES(?,?,?,?,?,?,?)');
    [[0, 3.2, 6, 1.5, 0], [3.2, 4.5, 12, 1.5, 0], [4.5, 5.5, 25, 1.5, 0], [5.5, 7, 45, 1.5, 0], [7, null, 0, 1.5, 1]].forEach((r, i) => memory.run(r[0], r[1], r[2], r[3], r[4], '', i));
    const tax = db.prepare('INSERT INTO tax_rates(code,state,rate,note) VALUES(?,?,?,?)');
    taxRates.forEach(r => tax.run(r.code, r.state, r.rate, r.note));
  });
  tx();
}

module.exports = { seed, fallback, globals, taxRates };

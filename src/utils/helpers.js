const { db } = require('../db');
const { getProducts, getProduct } = require('../services/products');
const formulas = require('../formulas');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const XLSX = require('xlsx');
const { rateConfig } = require('../config');

// Runtime helpers — read from globals DB so edits take effect immediately
function getPaypalFeeRate() { return num(getGlobals().paypalFeeRate, 0.044); }
function getUsdRmbRate() { return num(getGlobals().usdRmbRate, 6.9); }
// Legacy constants kept for backward compatibility (prefer the functions above)
const { paypalFeeRate: PAYPAL_FEE_RATE, usdRmbRate: USD_RMB_RATE } = rateConfig();

function now() { return new Date().toISOString(); }

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function boolInt(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' ? 1 : 0;
}

function optionalNonNegative(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function optionalNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function requireNonNegative(v, label) {
  if (num(v) < 0) throw new Error(`${label}不能为负`);
}

function orderChannel(v) {
  return String(v || '').toLowerCase() === 'amazon' ? 'amazon' : 'shopify';
}

const VALID_TABLES = new Set(["globals", "fabrics", "linings", "products", "product_width_prices", "product_length_prices", "product_option_groups", "product_option_values", "labor_rules", "memory_rules", "tax_rates", "orders", "order_items", "factory_feedback", "backups"]);

function tableAll(name, order = "id") {
  if (!VALID_TABLES.has(name) || !/^[a-zA-Z0-9_,]+$/.test(order)) throw new Error("Invalid table or order");
  return db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all();
}

function getGlobals() {
  const out = {};
  for (const row of db.prepare('SELECT key,value,value_type FROM globals').all()) {
    if (row.value_type === 'number') out[row.key] = num(row.value);
    else if (row.value_type === 'boolean') out[row.key] = row.value === 'true' || row.value === '1';
    else out[row.key] = row.value;
  }
  return out;
}

function upsertGlobal(key, value, note = '') {
  const booleanKeys = new Set(['laborUseFlatWidth']);
  const textKeys = new Set(['salesAmountMode']);
  let type = 'text';
  let normalized = value;

  if (booleanKeys.has(key)) {
    type = 'boolean';
    normalized = value === true || value === 'true' || value === '1' ? 'true' : 'false';
  } else if (!textKeys.has(key) && value !== '' && Number.isFinite(Number(value))) {
    type = 'number';
    normalized = String(Number(value));
  } else if (typeof value === 'boolean') {
    type = 'boolean';
    normalized = value ? 'true' : 'false';
  }

  db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,value_type=excluded.value_type,note=excluded.note,updated_at=excluded.updated_at')
    .run(key, String(normalized), type, note, now());
}

function context(channel) {
  return {
    globals: getGlobals(),
    fabrics: tableAll('fabrics', 'name'),
    linings: tableAll('linings', 'name'),
    products: getProducts(channel),
    laborRules: tableAll('labor_rules', 'sort_order,id'),
    memoryRules: tableAll('memory_rules', 'sort_order,id'),
    taxRates: tableAll('tax_rates', 'code')
  };
}

function calcItemFromPayload(payload, channel) {
  const ctx = context(channel);
  const product = getProduct(payload.product_id || payload.productId);
  if (!product) throw new Error('产品不存在');

  return formulas.calcItem({
    ...payload,
    product,
    productId: product.id,
    fabricId: payload.fabric_id || payload.fabricId || product.default_fabric_id,
    liningId: payload.lining_id || payload.liningId || payload.liningMaterialId || 'lining_none',
    widthIn: num(payload.width_in ?? payload.widthIn),
    lengthIn: num(payload.length_in ?? payload.lengthIn),
    qty: Math.max(1, Math.floor(num(payload.qty, 1))),
    fullness: num(payload.fullness, product.default_fullness || 2),
    actualPaidUsd: num(payload.actual_paid_usd ?? payload.actualPaidUsd),
    applyDiscount: payload.apply_discount ?? payload.applyDiscount ?? true,
    discountMode: payload.discount_mode ?? payload.discountMode ?? 'percent',
    discountValue: num(payload.discount_value ?? payload.discountValue ?? payload.discount_usd ?? payload.discountUsd),
    selectedOptions: payload.selected_options || payload.selectedOptions || payload.options || {},
    taxRate: num(payload.tax_rate ?? payload.taxRate ?? ctx.globals.usTaxRate),
    layer: payload.layer || (payload.has_lining || payload.hasLining ? 'double' : 'single'),
    manualSpliceCostRmb: num(payload.manual_splice_cost_rmb ?? payload.manualSpliceCostRmb),
    logisticsCostRmb: num(payload.logistics_cost_rmb ?? payload.logisticsCostRmb)
  }, ctx);
}

function parseCsvBuffer(req) {
  return parse(req.file.buffer.toString('utf8').replace(/^﻿/, ''), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true
  });
}

function sendCsv(res, filename, rows) {
  const csv = stringify(rows, { header: true, bom: true });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
}

function sendBuffer(res, filename, buffer, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

function sendHtmlXls(res, filename, rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

module.exports = {
  PAYPAL_FEE_RATE,
  USD_RMB_RATE,
  getPaypalFeeRate,
  getUsdRmbRate,
  now,
  num,
  boolInt,
  optionalNonNegative,
  optionalNumber,
  requireNonNegative,
  orderChannel,
  VALID_TABLES,
  tableAll,
  getGlobals,
  upsertGlobal,
  context,
  calcItemFromPayload,
  parseCsvBuffer,
  sendCsv,
  sendBuffer,
  sendHtmlXls
};

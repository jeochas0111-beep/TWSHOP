const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parseCsvBuffer, sendCsv, sendHtmlXls } = require('../utils/helpers');
const { makeBackup, pruneAutoBackups } = require('../services/backups');
const { configRows, productTemplateRows, applyProductTemplateRows, applyConfigRows } = require('../services/importExport');
const { getProduct } = require('../services/products');
const { parseOrderImportRows } = require('../utils/orders');
const { orderRows } = require('../utils/orders');
const { notFound, requireAdmin, requireChannelOperator, requireFile, route, sendOk } = require('../utils/api');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 导入路由
router.post('/import/config-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '配置 CSV 导入前');
  const result = applyConfigRows(parseCsvBuffer(req));
  pruneAutoBackups();
  sendOk(res, result);
}));

router.post('/import/product-csv', requireChannelOperator, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '产品模板 CSV 导入前');
  const result = applyProductTemplateRows(parseCsvBuffer(req), req.channel);
  pruneAutoBackups();
  sendOk(res, result);
}));

router.post('/import/orders-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '订单 CSV 导入前');
  const result = parseOrderImportRows(parseCsvBuffer(req), req.channel);
  pruneAutoBackups();
  sendOk(res, result);
}));

// 导出路由
router.get('/export/product-template-csv', requireChannelOperator, (req, res) => {
  sendCsv(res, 'TWODRAPES_产品导入模板.csv', productTemplateRows(req.channel));
});

router.get('/export/config-csv', requireAdmin, (req, res) => {
  sendCsv(res, 'TWODRAPES_完整配置.csv', configRows());
});

router.get('/export/product-csv/:id', requireAdmin, route((req, res) => {
  const p = getProduct(req.params.id);
  if (!p) notFound('产品不存在');
  sendCsv(res, `${p.name}_产品配置.csv`, configRows([p]));
}));

router.get('/export/order-import-template-csv', requireAdmin, (req, res) => {
  sendCsv(res, 'TWODRAPES_订单导入模板.csv', [{
    channel: 'shopify',
    order_no: 'TW-TEST-001',
    order_date: '2026-05-26',
    delivery_date: '2026-05-30',
    customer_name: 'Alice',
    customer_email: 'alice@example.com',
    customer_phone: '123456',
    customer_address: 'Shanghai',
    tax_state_code: 'CA',
    tax_rate: '8.25',
    remark: '手动导入示例',
    status: 'production',
    logistics_provider: '云途',
    tracking_number: 'YT1234567890',
    weight_kg: '5.5',
    shipping_date: '2026-06-01',
    delivered_date: '2026-06-10',
    delivery_channel: 'UPS',
    shipping_cost: '150',
    logistics_cost_rmb: '120',
    production_cost_override_rmb: '',
    product_id: '',
    product_name: 'Lucie DMDD',
    qty: '1',
    width_in: '52',
    length_in: '84',
    fabric_id: '',
    lining_id: 'lining_none',
    fullness: '2',
    selected_options: 'color:Snow White|memory_shaped:Without memory training',
    actual_paid_usd: '0',
    room_label: 'Living Room',
    item_remark: ''
  }]);
});

router.get('/export/factory-order/:orderId', route((req, res) => {
  const XLSX = require('xlsx');
  const o = orderRows(req.params.orderId);
  if (!o) notFound('订单不存在');
  const rows = require('../services/exports').factoryRows(o);
  const headers = Object.keys(rows[0] || {});
  const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colWidths = {
    '下单日期': 14, '订单号': 20, '面料名称': 18, '内衬/颜色': 16, '顶部工艺': 14,
    '配件': 22, '宽(cm)': 10, '高(cm)': 10, '需做条数': 10,
    '是否需要记忆定型': 16, '是否需要绑带': 12,
    '韩褶数/打孔数/暗袢数': 18, '是否需要铅块': 12,
    '详细工艺': 60, '交期': 14, '项目备注': 40
  };
  ws['!cols'] = headers.map(h => ({ wch: colWidths[h] || Math.max(10, String(h).length * 2 + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '生产单');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`工厂生产单-${o.order_no || o.id}.xlsx`)}`);
  res.send(buf);
}));

router.post('/export/factory-orders-batch', route((req, res) => {
  const XLSX = require('xlsx');
  const ids = req.body.ids || [];
  if (!ids.length) notFound('未选择订单');
  const allRows = [];
  for (const id of ids) {
    const o = orderRows(id);
    if (o) allRows.push(...require('../services/exports').factoryRows(o));
  }
  if (!allRows.length) notFound('未找到有效订单数据');
  const headers = Object.keys(allRows[0]);
  const aoa = [headers, ...allRows.map(r => headers.map(h => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colWidths = {
    '下单日期': 14, '订单号': 20, '面料名称': 18, '内衬/颜色': 16, '顶部工艺': 14,
    '配件': 22, '宽(cm)': 10, '高(cm)': 10, '需做条数': 10,
    '是否需要记忆定型': 16, '是否需要绑带': 12,
    '韩褶数/打孔数/暗袢数': 18, '是否需要铅块': 12,
    '详细工艺': 60, '交期': 14, '项目备注': 40
  };
  ws['!cols'] = headers.map(h => ({ wch: colWidths[h] || Math.max(10, String(h).length * 2 + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '生产单');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`工厂生产单-${today()}.xlsx`)}`);
  res.send(buf);
  function today() { return new Date().toISOString().slice(0, 10); }
}));

router.post('/export/orders-full-batch', route((req, res) => {
  const XLSX = require('xlsx');
  const ids = req.body.ids || [];
  const source = req.body.source || '';  // 'shopify' / 'amazon' / ''
  const { db } = require('../db');
  let orders;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    orders = db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders}) ORDER BY order_date DESC`).all(...ids);
  } else {
    orders = db.prepare('SELECT * FROM orders ORDER BY order_date DESC').all();
  }
  if (!orders.length) notFound('未选择订单');
  const orderIds = orders.map(o => o.id);
  const allItems = orderIds.length
    ? db.prepare(`SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`).all(...orderIds)
    : [];
  const itemsByOrder = new Map();
  for (const it of allItems) {
    const key = String(it.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(it);
  }
  const fmt2 = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : ''; };
  const sourceLabel = source === 'shopify' ? '独立站' : source === 'amazon' ? '亚马逊' : '';
  const hasSource = !!sourceLabel;

  // Find max items per order for column generation
  let maxItems = 0;
  for (const o of orders) {
    const count = (itemsByOrder.get(String(o.id)) || []).length;
    if (count > maxItems) maxItems = count;
  }
  if (maxItems === 0) maxItems = 1;

  // Build order-level columns
  const orderCols = [
    '订单号', '下单日期', '交期', '客户', '渠道', '状态',
    '售价(RMB)', '成本(RMB)', '利润(RMB)', '生产成本', '物流成本',
    '货代', '尾程派送', '追踪编码', '重量(KG)', '发货时间', '到货时间', '时效'
  ];
  if (hasSource) orderCols.push('导出端');

  // Build item column groups: 品名1, 数量1, 面料1, 尺寸1, 品名2, ...
  const itemHeaders = [];
  for (let i = 1; i <= maxItems; i++) {
    itemHeaders.push(`品名${i}`, `数量${i}`, `面料${i}`, `尺寸${i}`);
  }
  const headers = [...orderCols, ...itemHeaders];

  // Build rows: one row per order
  const rows = [];
  for (const o of orders) {
    const items = itemsByOrder.get(String(o.id)) || [];
    const costRmb = fmt2(o.total_cost_rmb);
    const salesRmb = fmt2(o.total_net_sales_rmb);
    const profit = typeof costRmb === 'number' && typeof salesRmb === 'number' ? Math.round((salesRmb - costRmb) * 100) / 100 : '';
    const orderRow = [
      o.order_no || '', o.order_date || '', o.delivery_date || '',
      o.customer_name || '', o.channel || '', o.status || '',
      salesRmb, costRmb, profit,
      fmt2(o.production_cost_override_rmb), fmt2(o.logistics_cost_rmb),
      o.logistics_provider || '', o.delivery_channel || '',
      o.tracking_number || '', fmt2(o.weight_kg),
      o.shipping_date || '', o.delivered_date || '',
      calcDays(o.shipping_date, o.delivered_date)
    ];
    if (hasSource) orderRow.push(sourceLabel);
    // Append item columns
    for (let i = 0; i < maxItems; i++) {
      const it = items[i];
      if (it) {
        orderRow.push(it.product_name || '', it.qty || '', it.fabric_name || '', `W${it.width_in}xL${it.length_in}inch`);
      } else {
        orderRow.push('', '', '', '');
      }
    }
    rows.push(orderRow);
  }
  if (!rows.length) notFound('未找到有效订单数据');
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(10, String(h).length * 2 + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '订单全部信息');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`订单全部信息-${today()}.xlsx`)}`);
  res.send(buf);
  function today() { return new Date().toISOString().slice(0, 10); }
  function calcDays(from, to) {
    if (!from || !to) return '';
    const a = new Date(from), b = new Date(to);
    if (isNaN(a) || isNaN(b)) return '';
    return Math.round((b - a) / 86400000);
  }
}));

router.get('/export/cost-record/:orderId', route((req, res) => {
  const o = orderRows(req.params.orderId);
  if (!o) notFound('订单不存在');
  sendCsv(res, `订单成本记录_${o.order_no || o.id}.csv`, require('../services/exports').costRows(o));
}));

router.get('/export/orders-csv', requireAdmin, (req, res) => {
  const { db } = require('../db');
  const channel = req.channel || 'shopify';
  const orders = db.prepare('SELECT * FROM orders WHERE channel=? ORDER BY created_at DESC').all(channel);
  const ids = orders.map(r => r.id);
  const allItems = ids.length
    ? db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids)
    : [];
  const itemsByOrder = new Map();
  for (const it of allItems) {
    const key = String(it.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(it);
  }
  const rows = [];
  for (const o of orders) {
    const items = itemsByOrder.get(String(o.id)) || [];
    const costRmb = Number(o.total_cost_rmb) || 0;
    const salesRmb = Number(o.total_net_sales_rmb) || 0;
    const profit = salesRmb - costRmb;
    const orderFields = {
      channel: o.channel, order_no: o.order_no, order_date: o.order_date, delivery_date: o.delivery_date,
      customer_name: o.customer_name, customer_email: o.customer_email, customer_phone: o.customer_phone,
      customer_address: o.shipping_address || o.customer_address, remark: o.remark, status: o.status,
      logistics_provider: o.logistics_provider || '', tracking_number: o.tracking_number || '',
      weight_kg: o.weight_kg || '', shipping_date: o.shipping_date || '', delivered_date: o.delivered_date || '',
      delivery_channel: o.delivery_channel || '', shipping_cost: o.shipping_cost || '',
      logistics_cost_rmb: o.logistics_cost_rmb || '',
      production_cost_override_rmb: o.production_cost_override_rmb != null ? o.production_cost_override_rmb : '',
      total_sales_rmb: salesRmb || '', total_cost_rmb: costRmb || '', profit_rmb: profit || ''
    };
    if (!items.length) {
      rows.push({
        ...orderFields,
        product_id: '', product_name: '', qty: '', width_in: '', length_in: '',
        fabric_id: '', lining_id: '', fullness: '', selected_options: '', item_remark: ''
      });
    } else {
      for (const it of items) {
        const itemCost = Number(it.final_cost_rmb) || 0;
        rows.push({
          ...orderFields,
          product_id: it.product_id, product_name: it.product_name, qty: it.qty,
          width_in: it.width_in, length_in: it.length_in,
          fabric_id: it.fabric_id, lining_id: it.lining_id, fullness: it.fullness,
          selected_options: it.selected_options_json || '', item_remark: it.remark || '',
          item_cost_rmb: itemCost || ''
        });
      }
    }
  }
  sendCsv(res, `TWODRAPES_订单导出_${new Date().toISOString().slice(0, 10)}.csv`, rows);
});

router.get('/export/summary-csv', requireAdmin, (req, res) => {
  const { db } = require('../db');
  const channel = req.query.channel || '';
  const status = req.query.status || '';
  let sql = 'SELECT * FROM orders';
  const params = [];
  const wheres = [];
  if (channel) { wheres.push('channel=?'); params.push(channel); }
  if (status) { wheres.push('status=?'); params.push(status); }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY order_date DESC, id DESC';
  const orders = db.prepare(sql).all(...params);
  const ids = orders.map(r => r.id);
  const allItems = ids.length
    ? db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids)
    : [];
  const itemsByOrder = new Map();
  for (const it of allItems) {
    const key = String(it.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(it);
  }
  const rows = [];
  for (const o of orders) {
    const items = itemsByOrder.get(String(o.id)) || [];
    const costRmb = Number(o.total_cost_rmb) || 0;
    const salesRmb = Number(o.total_net_sales_rmb) || 0;
    const profit = salesRmb - costRmb;
    if (!items.length) {
      rows.push({
        '订单号': o.order_no || '',
        '下单日期': o.order_date || '',
        '交期': o.delivery_date || '',
        '客户': o.customer_name || '',
        '渠道': o.channel || '',
        '状态': o.status || '',
        '售价(RMB)': salesRmb || '',
        '成本(RMB)': costRmb || '',
        '利润(RMB)': profit || '',
        '生产成本': o.production_cost_override_rmb != null ? o.production_cost_override_rmb : '',
        '物流成本': o.logistics_cost_rmb || '',
        '货代': o.logistics_provider || '',
        '尾程派送': o.delivery_channel || '',
        '追踪编码': o.tracking_number || '',
        '重量(KG)': o.weight_kg || '',
        '发货时间': o.shipping_date || '',
        '到货时间': o.delivered_date || '',
        '时效': calcDays(o.shipping_date, o.delivered_date)
      });
    } else {
      for (const it of items) {
        rows.push({
          '订单号': o.order_no || '',
          '下单日期': o.order_date || '',
          '交期': o.delivery_date || '',
          '客户': o.customer_name || '',
          '渠道': o.channel || '',
          '状态': o.status || '',
          '品名': it.product_name || '',
          '数量': it.qty || '',
          '面料': it.fabric_name || '',
          '生产成本': o.production_cost_override_rmb != null ? o.production_cost_override_rmb : '',
          '物流成本': o.logistics_cost_rmb || '',
          '售价(RMB)': salesRmb || '',
          '成本(RMB)': costRmb || '',
          '利润(RMB)': profit || '',
          '货代': o.logistics_provider || '',
          '尾程派送': o.delivery_channel || '',
          '追踪编码': o.tracking_number || '',
          '重量(KG)': o.weight_kg || '',
          '发货时间': o.shipping_date || '',
          '到货时间': o.delivered_date || '',
          '时效': calcDays(o.shipping_date, o.delivered_date)
        });
      }
    }
  }
  sendCsv(res, `TWODRAPES_订单汇总_${new Date().toISOString().slice(0, 10)}.csv`, rows);
});

function calcDays(from, to) {
  if (!from || !to) return '';
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return '';
  return Math.round((b - a) / 86400000);
}

module.exports = router;

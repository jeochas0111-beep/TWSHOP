const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { num, getUsdRmbRate, orderChannel } = require('../utils/helpers');
const { badRequest, route } = require('../utils/api');

const STATUSES = new Set(['draft', 'production', 'shipping', 'completed']);

function rate(profit, income) {
  return income > 0 ? profit / income : 0;
}

function monthKey(order) {
  const date = String(order.order_date || order.created_at || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(date) ? date : '未填写日期';
}

function buildFilters(query, defaultChannel) {
  const where = [];
  const params = [];

  const dateFrom = String(query.date_from || '').trim();
  const dateTo = String(query.date_to || '').trim();
  const channel = String(query.channel || defaultChannel || '').trim();
  const status = String(query.status || '').trim();
  const productId = String(query.product_id || '').trim();

  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) badRequest('开始日期格式无效');
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) badRequest('结束日期格式无效');
  if (channel) {
    if (!['shopify', 'amazon'].includes(channel)) badRequest('渠道无效');
    where.push('o.channel=?');
    params.push(orderChannel(channel));
  }
  if (status) {
    if (!STATUSES.has(status)) badRequest('状态无效');
    where.push('o.status=?');
    params.push(status);
  }
  if (dateFrom) {
    where.push("COALESCE(o.order_date,'') >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("COALESCE(o.order_date,'') <= ?");
    params.push(dateTo);
  }
  if (productId) {
    where.push('EXISTS (SELECT 1 FROM order_items oi_filter WHERE oi_filter.order_id=o.id AND oi_filter.product_id=?)');
    params.push(productId);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    productId
  };
}

function addTotals(target, row) {
  const usdRmbRate = getUsdRmbRate();
  const income = num(row.total_net_sales_rmb);
  const totalCost = num(row.total_cost_rmb);
  const logistics = num(row.logistics_cost_rmb);
  const production = Math.max(0, totalCost - logistics);
  const paypal = num(row.paypal_fee_usd) * usdRmbRate;
  const tax = num(row.total_tax_usd) * usdRmbRate;
  const profit = num(row.total_profit_rmb);

  target.orderCount += 1;
  target.incomeRmb += income;
  target.productionCostRmb += production;
  target.logisticsCostRmb += logistics;
  target.totalCostRmb += totalCost;
  target.paypalFeeRmb += paypal;
  target.taxRmb += tax;
  target.profitRmb += profit;
}

function publicTotals(totals) {
  return {
    ...totals,
    profitRate: rate(totals.profitRmb, totals.incomeRmb),
    averageOrderValueRmb: totals.orderCount > 0 ? totals.incomeRmb / totals.orderCount : 0
  };
}

router.get('/analytics/overview', route((req, res) => {
  const filters = buildFilters(req.query, req.channel);
  const orders = db.prepare(`SELECT * FROM orders o ${filters.whereSql} ORDER BY COALESCE(o.order_date,o.created_at,'')`).all(...filters.params);
  const orderIds = orders.map((order) => order.id);

  const baseTotals = {
    orderCount: 0,
    incomeRmb: 0,
    productionCostRmb: 0,
    logisticsCostRmb: 0,
    paypalFeeRmb: 0,
    taxRmb: 0,
    totalCostRmb: 0,
    profitRmb: 0
  };
  const summary = { ...baseTotals };
  const monthlyMap = new Map();
  const channelMap = new Map();

  for (const order of orders) {
    addTotals(summary, order);

    const month = monthKey(order);
    if (!monthlyMap.has(month)) monthlyMap.set(month, { month, ...baseTotals });
    addTotals(monthlyMap.get(month), order);

    const channel = order.channel === 'amazon' ? 'amazon' : 'shopify';
    if (!channelMap.has(channel)) channelMap.set(channel, { channel, ...baseTotals });
    addTotals(channelMap.get(channel), order);
  }

  let itemRows = [];
  if (orderIds.length) {
    const placeholders = orderIds.map(() => '?').join(',');
    const itemParams = [...orderIds];
    let productSql = '';
    if (filters.productId) {
      productSql = ' AND product_id=?';
      itemParams.push(filters.productId);
    }
    itemRows = db.prepare(`
      SELECT order_id,product_id,product_name,qty,net_sales_rmb,final_cost_rmb,cost_rmb,profit_rmb
      FROM order_items
      WHERE order_id IN (${placeholders})${productSql}
    `).all(...itemParams);
  }

  const productMap = new Map();
  for (const item of itemRows) {
    const key = item.product_id || item.product_name || 'unknown';
    if (!productMap.has(key)) {
      productMap.set(key, {
        productId: item.product_id || '',
        productName: item.product_name || '未命名产品',
        orderIds: new Set(),
        itemCount: 0,
        qty: 0,
        incomeRmb: 0,
        costRmb: 0,
        profitRmb: 0
      });
    }
    const product = productMap.get(key);
    product.orderIds.add(item.order_id);
    product.itemCount += 1;
    product.qty += num(item.qty);
    product.incomeRmb += num(item.net_sales_rmb);
    product.costRmb += num(item.final_cost_rmb || item.cost_rmb);
    product.profitRmb += num(item.profit_rmb);
  }

  const productComparison = Array.from(productMap.values())
    .map((product) => ({
      productId: product.productId,
      productName: product.productName,
      orderCount: product.orderIds.size,
      itemCount: product.itemCount,
      qty: product.qty,
      incomeRmb: product.incomeRmb,
      costRmb: product.costRmb,
      profitRmb: product.profitRmb,
      profitRate: rate(product.profitRmb, product.incomeRmb)
    }))
    .sort((a, b) => b.incomeRmb - a.incomeRmb);

  const expenseBreakdown = [
    { key: 'production', label: '生产成本', amountRmb: summary.productionCostRmb },
    { key: 'logistics', label: '物流成本', amountRmb: summary.logisticsCostRmb },
    { key: 'paypal', label: 'PayPal 手续费', amountRmb: summary.paypalFeeRmb },
    { key: 'tax', label: '税费', amountRmb: summary.taxRmb }
  ];

  // Sample sales aggregation
  const sampleWhere = [];
  const sampleParams = [];
  // Apply channel filter to samples
  const sampleChannel = String(req.query.channel || req.channel || '').trim();
  if (sampleChannel) {
    sampleWhere.push('channel=?');
    sampleParams.push(orderChannel(sampleChannel));
  }
  const sampleDateFrom = String(req.query.date_from || '').trim();
  const sampleDateTo = String(req.query.date_to || '').trim();
  if (sampleDateFrom) {
    sampleWhere.push("COALESCE(sale_date,'') >= ?");
    sampleParams.push(sampleDateFrom);
  }
  if (sampleDateTo) {
    sampleWhere.push("COALESCE(sale_date,'') <= ?");
    sampleParams.push(sampleDateTo);
  }
  const sampleWhereSql = sampleWhere.length ? `WHERE ${sampleWhere.join(' AND ')}` : '';
  const sampleRows = db.prepare(`SELECT * FROM sample_sales ${sampleWhereSql} ORDER BY COALESCE(sale_date, created_at, '')`).all(...sampleParams);

  let sampleTotalQty = 0;
  let sampleTotalAmountUsd = 0;
  const sampleMonthlyMap = new Map();

  for (const row of sampleRows) {
    sampleTotalQty += num(row.quantity);
    sampleTotalAmountUsd += num(row.amount_usd);

    const date = String(row.sale_date || row.created_at || '').slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(date) ? date : '未填写日期';
    if (!sampleMonthlyMap.has(month)) sampleMonthlyMap.set(month, { month, qty: 0, amountUsd: 0, amountRmb: 0 });
    const entry = sampleMonthlyMap.get(month);
    entry.qty += num(row.quantity);
    entry.amountUsd += num(row.amount_usd);
    entry.amountRmb += num(row.amount_usd) * getUsdRmbRate();
  }

  const sampleSummary = {
    totalRecords: sampleRows.length,
    totalQty: sampleTotalQty,
    totalAmountUsd: sampleTotalAmountUsd,
    totalAmountRmb: sampleTotalAmountUsd * getUsdRmbRate()
  };
  const sampleMonthlyTrend = Array.from(sampleMonthlyMap.values()).sort((a, b) => a.month < b.month ? -1 : 1);

  res.json({
    filters: {
      dateFrom: req.query.date_from || '',
      dateTo: req.query.date_to || '',
      channel: req.query.channel || '',
      productId: req.query.product_id || '',
      status: req.query.status || ''
    },
    summary: publicTotals(summary),
    monthlyTrend: Array.from(monthlyMap.values()).map(publicTotals),
    expenseBreakdown,
    productComparison,
    channelComparison: Array.from(channelMap.values()).map(publicTotals),
    sampleSummary,
    sampleMonthlyTrend
  });
}));

module.exports = router;

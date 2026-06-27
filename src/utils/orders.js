const { db } = require('../db');
const { now, num, optionalNonNegative, optionalNumber, orderChannel, getPaypalFeeRate, getUsdRmbRate } = require('./helpers');
const { calcItemFromPayload } = require('./helpers');

function computeOrderTotals(totals, logisticsCostRmb, usdRmb) {
  const paypalFeeRate = getPaypalFeeRate();
  const grossSalesUsd = totals.sales;
  const paypalFeeUsd = grossSalesUsd * paypalFeeRate;
  const actualIncomeUsd = grossSalesUsd - paypalFeeUsd;
  const actualIncomeRmb = actualIncomeUsd * usdRmb;
  const totalCostRmb = totals.productionCost + logisticsCostRmb;
  const profitRmb = actualIncomeRmb - totalCostRmb;
  const profitRate = actualIncomeRmb > 0 ? profitRmb / actualIncomeRmb : 0;
  return { grossSalesUsd, paypalFeeUsd, actualIncomeUsd, actualIncomeRmb, totalCostRmb, profitRmb, profitRate };
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getFeedbackCostByItemIds(itemIds) {
  const ids = (itemIds || []).map((id) => Number(id)).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM factory_feedback WHERE order_item_id IN (${placeholders})`).all(...ids);
  const map = new Map();
  for (const row of rows) {
    // Main fabric cost
    const settlement = optionalNumber(row.settlement_cost);
    const total = optionalNumber(row.total_cost);
    // Lining cost
    const liningSettlement = optionalNumber(row.lining_settlement_cost);
    const liningTotal = optionalNumber(row.lining_total_cost);

    const mainCost = settlement != null ? settlement : total;
    const liningCost = liningSettlement != null ? liningSettlement : liningTotal;
    const finalCost = (mainCost || 0) + (liningCost || 0);

    let source = 'estimated';
    if (settlement != null || liningSettlement != null) source = 'factory_settlement';
    else if (total != null || liningTotal != null) source = 'factory_cost_total';

    map.set(row.order_item_id, {
      finalCost,
      source,
      issuedUsageM: optionalNumber(row.planned_meters),
      actualUsageM: optionalNumber(row.actual_meters),
      fabricPriceRmb: optionalNumber(row.fabric_unit_price),
      laborRmb: optionalNumber(row.labor_fee),
      memoryRmb: optionalNumber(row.memory_fee),
      costTotalRmb: total,
      settlementRmb: settlement,
      liningMaterial: row.lining_material || null,
      liningActualMeters: optionalNumber(row.lining_actual_meters),
      liningUnitPrice: optionalNumber(row.lining_unit_price),
      liningLaborRmb: optionalNumber(row.lining_labor_fee),
      liningMemoryRmb: optionalNumber(row.lining_memory_fee),
      liningCostTotalRmb: liningTotal,
      liningSettlementRmb: liningSettlement
    });
  }
  return map;
}

function applyFinalCost(calc, feedback) {
  const estimatedCostRmb = num(calc.estimatedCostRmb ?? calc.finalCostRmb, 0);
  if (feedback && feedback.finalCost != null) {
    return { estimatedCostRmb, finalCostRmb: feedback.finalCost, finalCostSource: feedback.source };
  }
  return { estimatedCostRmb, finalCostRmb: estimatedCostRmb, finalCostSource: 'estimated' };
}

function nextItemCode(orderDate, fabricName, hasLining) {
  const mmdd = String(orderDate || '').slice(5, 7) + String(orderDate || '').slice(8, 10);
  const layer = hasLining ? '双层' : '单层';
  const prefix = `定制-${fabricName}${layer} TWDZ${mmdd}-`;
  const rows = db.prepare('SELECT item_code FROM order_items WHERE item_code LIKE ? ORDER BY item_code DESC').all(`${prefix}%`);
  const max = rows.reduce((m, r) => Math.max(m, num(String(r.item_code).split('-').pop())), 0);
  return prefix + String(max + 1);
}

function orderRows(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(orderId).map(r => ({
    ...r,
    calc_detail: parseJsonObject(r.calc_detail_json),
    selected_options: parseJsonObject(r.selected_options_json)
  }));
  return { ...order, items };
}

function orderStatus(v, fallback = 'production') {
  const value = String(v || '').trim();
  return ['draft', 'production', 'shipping', 'completed'].includes(value) ? value : fallback;
}

function saveOrder(body, orderId) {
  const saved = db.transaction(() => {
    const orderDate = body.order_date || body.orderDate || now().slice(0, 10);
    const deliveryDate = body.delivery_date || body.deliveryDate || orderDate;
    let channel = orderChannel(body.channel || body.source);
    const usdRmb = getUsdRmbRate();
    let id = orderId;
    let existingLogisticsCostRmb = 0;
    let existingSalesOverrideUsd = null;
    let existingTaxOverrideUsd = null;

    if (id) {
      const existing = db.prepare('SELECT channel,logistics_cost_rmb,sales_override_usd,tax_override_usd,status FROM orders WHERE id=?').get(id);
      channel = orderChannel(body.channel || body.source || existing?.channel);
      existingLogisticsCostRmb = num(existing?.logistics_cost_rmb, 0);
      existingSalesOverrideUsd = optionalNonNegative(existing?.sales_override_usd);
      existingTaxOverrideUsd = optionalNonNegative(existing?.tax_override_usd);
      db.prepare('UPDATE orders SET channel=?,status=?,order_no=?,order_date=?,delivery_date=?,customer_name=?,customer_email=?,customer_phone=?,customer_address=?,tax_state_code=?,tax_rate=?,remark=?,logistics_provider=?,tracking_number=?,delivery_channel=?,weight_kg=?,logistics_cost_rmb=?,delivered_date=?,shipping_date=?,shipping_cost=?,paypal_fee_usd=?,actual_income_usd=?,updated_at=? WHERE id=?')
        .run(channel, orderStatus(body.status ?? existing?.status), body.order_no || body.orderNo || '', orderDate, deliveryDate, body.customer_name || body.customerName || '', body.customer_email || body.customerEmail || '', body.customer_phone || body.customerPhone || '', body.customer_address || body.customerAddress || '', body.tax_state_code || body.taxStateCode || '', num(body.tax_rate ?? body.taxRate), body.remark || '', body.logistics_provider || body.logisticsProvider || '', body.tracking_number || body.trackingNumber || '', body.delivery_channel || body.deliveryChannel || '', num(body.weight_kg ?? body.weightKg), num(body.logistics_cost_rmb ?? body.logisticsCostRmb, existingLogisticsCostRmb), body.delivered_date || body.deliveredDate || '', body.shipping_date || body.shippingDate || '', num(body.shipping_cost ?? body.shippingCost), 0, 0, now(), id);

      if (!Array.isArray(body.items)) {
        return {
          recalculateExistingItems: true,
          id,
          logisticsCostRmb: num(body.logistics_cost_rmb ?? body.logisticsCostRmb, existingLogisticsCostRmb)
        };
      }

      if (body.items.length) {
        db.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
      }
    } else {
      const info = db.prepare('INSERT INTO orders(channel,status,order_no,order_date,delivery_date,customer_name,customer_email,customer_phone,customer_address,tax_state_code,tax_rate,remark,total_sales_usd,total_tax_usd,total_net_sales_rmb,total_cost_rmb,total_profit_rmb,total_profit_rate,logistics_provider,tracking_number,delivery_channel,weight_kg,logistics_cost_rmb,delivered_date,shipping_date,shipping_cost,paypal_fee_usd,actual_income_usd,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(channel, orderStatus(body.status), body.order_no || body.orderNo || '', orderDate, deliveryDate, body.customer_name || body.customerName || '', body.customer_email || body.customerEmail || '', body.customer_phone || body.customerPhone || '', body.customer_address || body.customerAddress || '', body.tax_state_code || body.taxStateCode || '', num(body.tax_rate ?? body.taxRate), body.remark || '', 0, 0, 0, 0, 0, 0, body.logistics_provider || body.logisticsProvider || '', body.tracking_number || body.trackingNumber || '', body.delivery_channel || body.deliveryChannel || '', num(body.weight_kg ?? body.weightKg), num(body.logistics_cost_rmb ?? body.logisticsCostRmb, 0), body.delivered_date || body.deliveredDate || '', body.shipping_date || body.shippingDate || '', num(body.shipping_cost ?? body.shippingCost), num(body.paypal_fee_usd ?? body.paypalFeeUsd, 0), num(body.actual_income_usd ?? body.actualIncomeUsd, 0), now(), now());
      id = info.lastInsertRowid;
    }

    let totals = { sales: 0, tax: 0, productionCost: 0 };
    for (const item of body.items || []) {
      const calc = calcItemFromPayload({ ...item, tax_rate: body.tax_rate ?? body.taxRate });
      const code = nextItemCode(orderDate, calc.details.fabricName, calc.details.hasLining);
      const cost = applyFinalCost(calc, null);
      totals.sales += calc.netSalesUsd;
      totals.tax += calc.taxUsd;
      totals.productionCost += cost.finalCostRmb;
      const itemProfitRmb = calc.netSalesRmb - cost.finalCostRmb;
      const itemProfitRate = calc.netSalesRmb > 0 ? itemProfitRmb / calc.netSalesRmb : 0;

      db.prepare('INSERT INTO order_items(order_id,product_id,product_name,item_code,qty,width_in,length_in,fabric_id,fabric_name,lining_id,lining_name,fullness,room_label,actual_paid_usd,system_price_usd,sales_usd,tax_usd,net_sales_rmb,cost_rmb,estimated_cost_rmb,final_cost_rmb,final_cost_source,profit_rmb,profit_rate,calc_detail_json,selected_options_json,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, calc.product.id, calc.product.name, code, calc.qty, calc.widthIn, calc.lengthIn, calc.fabric.id, calc.details.fabricName, calc.lining?.id || 'lining_none', calc.details.liningName, calc.fullness, item.room_label || item.roomLabel || '', calc.actualPaidUsd || null, calc.systemPriceUsd, calc.netSalesUsd, calc.taxUsd, calc.netSalesRmb, cost.finalCostRmb, cost.estimatedCostRmb, cost.finalCostRmb, cost.finalCostSource, itemProfitRmb, itemProfitRate, JSON.stringify({ ...calc, finalCostRmb: cost.finalCostRmb, finalCostSource: cost.finalCostSource }), JSON.stringify(calc.selectedOptions), item.remark || '', now(), now());
    }

    if (existingSalesOverrideUsd != null) totals.sales = existingSalesOverrideUsd;
    if (existingTaxOverrideUsd != null) totals.tax = existingTaxOverrideUsd;
    const logisticsCostRmb = num(body.logistics_cost_rmb ?? body.logisticsCostRmb, existingLogisticsCostRmb);
    const financial = computeOrderTotals(totals, logisticsCostRmb, usdRmb);

    db.prepare('UPDATE orders SET total_sales_usd=?,total_tax_usd=?,total_net_sales_rmb=?,total_cost_rmb=?,total_profit_rmb=?,total_profit_rate=?,logistics_cost_rmb=?,paypal_fee_usd=?,actual_income_usd=?,updated_at=? WHERE id=?')
      .run(totals.sales, totals.tax, financial.actualIncomeRmb, financial.totalCostRmb, financial.profitRmb, financial.profitRate, logisticsCostRmb, financial.paypalFeeUsd, financial.actualIncomeUsd, now(), id);

    return orderRows(id);
  })();

  if (saved?.recalculateExistingItems) {
    return recalculateOrderById(saved.id, saved.logisticsCostRmb);
  }

  return saved;
}

function _recalculateOrderCore(id, logisticsOverride) {
  const order = orderRows(id);
  if (!order) throw new Error('订单不存在');
  const usdRmb = getUsdRmbRate();
  const logisticsCostRmb = logisticsOverride == null ? num(order.logistics_cost_rmb, 0) : num(logisticsOverride, 0);
  const feedbackCostMap = getFeedbackCostByItemIds((order.items || []).map((it) => it.id));
  let totals = { sales: 0, tax: 0, productionCost: 0 };

  for (const item of order.items || []) {
    const previousCalc = item.calc_detail || {};
    const applyDiscount = previousCalc.applyDiscount ?? previousCalc.apply_discount ?? true;
    const discountMode = previousCalc.discountMode ?? previousCalc.discount_mode ?? 'percent';
    const discountValue = previousCalc.discountValue ?? previousCalc.discount_value ?? previousCalc.discountUsd ?? previousCalc.discount_usd ?? 0;
    const calc = calcItemFromPayload({
      product_id: item.product_id,
      qty: item.qty,
      width_in: item.width_in,
      length_in: item.length_in,
      fabric_id: item.fabric_id,
      lining_id: item.lining_id,
      fullness: item.fullness,
      selected_options: item.selected_options || {},
      actual_paid_usd: item.actual_paid_usd ?? previousCalc.actualPaidUsd ?? previousCalc.actual_paid_usd ?? 0,
      apply_discount: applyDiscount,
      discount_mode: discountMode,
      discount_value: discountValue,
      tax_rate: order.tax_rate || 0
    });

    let normalizedCode = String(item.item_code || '');
    normalizedCode = normalizedCode.replace(/^(定制-.*?)(单层|双层)(\s+TWDZ\d{4}-\d+)$/, (_, p1, _layer, p3) => `${p1}${calc.details.hasLining ? '双层' : '单层'}${p3}`);

    totals.sales += calc.netSalesUsd;
    totals.tax += calc.taxUsd;
    const feedback = feedbackCostMap.get(item.id) || null;
    const cost = applyFinalCost(calc, feedback);
    const itemCostOverride = optionalNonNegative(item.production_cost_override_rmb);
    const itemCost = itemCostOverride ?? cost.finalCostRmb;
    totals.productionCost += itemCost;
    const itemProfitRmb = calc.netSalesRmb - itemCost;
    const itemProfitRate = calc.netSalesRmb > 0 ? itemProfitRmb / calc.netSalesRmb : 0;

    const persistedCalc = {
      ...calc,
      applyDiscount: calc.applyDiscount,
      estimatedCostRmb: cost.estimatedCostRmb,
      finalCostRmb: cost.finalCostRmb,
      finalCostSource: cost.finalCostSource,
      factoryFeedback: feedback,
      costDiagnostic: {
        estimatedCostRmb: cost.estimatedCostRmb,
        factoryCostTotalRmb: feedback?.costTotalRmb ?? null,
        factorySettlementRmb: feedback?.settlementRmb ?? null,
        finalCostRmb: cost.finalCostRmb,
        finalCostSource: cost.finalCostSource,
        costDiffRmb: cost.finalCostRmb - cost.estimatedCostRmb,
        costDiffRate: cost.estimatedCostRmb > 0 ? (cost.finalCostRmb - cost.estimatedCostRmb) / cost.estimatedCostRmb : 0
      }
    };

    db.prepare('UPDATE order_items SET item_code=?,fabric_name=?,lining_name=?,system_price_usd=?,sales_usd=?,tax_usd=?,net_sales_rmb=?,cost_rmb=?,estimated_cost_rmb=?,final_cost_rmb=?,final_cost_source=?,factory_issued_usage_m=?,factory_actual_usage_m=?,factory_fabric_price_rmb=?,factory_labor_rmb=?,factory_memory_rmb=?,factory_cost_total_rmb=?,factory_settlement_rmb=?,profit_rmb=?,profit_rate=?,calc_detail_json=?,updated_at=? WHERE id=?')
      .run(
        normalizedCode,
        calc.details.fabricName,
        calc.details.liningName,
        calc.systemPriceUsd,
        calc.netSalesUsd,
        calc.taxUsd,
        calc.netSalesRmb,
        itemCost,
        cost.estimatedCostRmb,
        cost.finalCostRmb,
        cost.finalCostSource,
        feedback?.issuedUsageM ?? null,
        feedback?.actualUsageM ?? null,
        feedback?.fabricPriceRmb ?? null,
        feedback?.laborRmb ?? null,
        feedback?.memoryRmb ?? null,
        feedback?.costTotalRmb ?? null,
        feedback?.settlementRmb ?? null,
        itemProfitRmb,
        itemProfitRate,
        JSON.stringify(persistedCalc),
        now(),
        item.id
      );
  }

  const salesOverrideUsd = optionalNonNegative(order.sales_override_usd);
  const taxOverrideUsd = optionalNonNegative(order.tax_override_usd);
  const productionCostOverride = optionalNonNegative(order.production_cost_override_rmb);
  if (salesOverrideUsd != null) totals.sales = salesOverrideUsd;
  if (taxOverrideUsd != null) totals.tax = taxOverrideUsd;
  if (productionCostOverride != null) totals.productionCost = productionCostOverride;
  const financial = computeOrderTotals(totals, logisticsCostRmb, usdRmb);

  db.prepare('UPDATE orders SET total_sales_usd=?,total_tax_usd=?,total_net_sales_rmb=?,total_cost_rmb=?,total_profit_rmb=?,total_profit_rate=?,paypal_fee_usd=?,actual_income_usd=?,updated_at=? WHERE id=?')
    .run(totals.sales, totals.tax, financial.actualIncomeRmb, financial.totalCostRmb, financial.profitRmb, financial.profitRate, financial.paypalFeeUsd, financial.actualIncomeUsd, now(), id);
  db.prepare('UPDATE orders SET logistics_cost_rmb=? WHERE id=?').run(logisticsCostRmb, id);

  return orderRows(id);
}

function recalculateOrderById(orderId, logisticsOverride) {
  return db.transaction((id) => _recalculateOrderCore(id, logisticsOverride))(orderId);
}

function parseSelectedOptionsText(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  const out = {};
  raw.split('|').forEach((pair) => {
    const [k, ...vParts] = pair.split(':');
    const key = String(k || '').trim();
    if (!key) return;
    out[key] = vParts.join(':').trim();
  });
  return out;
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return value;
  }
  return '';
}

function parseOrderImportRows(rows, channel) {
  const { getProducts } = require('../services/products');
  const products = getProducts(channel);
  const byOrder = new Map();
  const errors = [];
  let skippedRows = 0;

  rows.forEach((row, idx) => {
    const lineNo = idx + 2;
    const orderNo = String(pick(row, ['order_no', '订单号'])).trim();
    const productIdInput = String(pick(row, ['product_id', '产品ID'])).trim();
    const productNameInput = String(pick(row, ['product_name', '产品名称'])).trim();
    const widthIn = num(pick(row, ['width_in', 'Width / inch', 'width', '宽']));
    const lengthIn = num(pick(row, ['length_in', 'Length / inch', 'length', '高']));
    if (!orderNo || !widthIn || !lengthIn) { skippedRows++; return; }

    const product = productIdInput
      ? products.find((p) => p.id === productIdInput)
      : products.find((p) => String(p.name || '').trim() === productNameInput);
    if (!product) {
      errors.push(`第${lineNo}行产品不存在：${productIdInput || productNameInput || '(空)'}`);
      skippedRows++;
      return;
    }

    const channel = orderChannel(pick(row, ['channel', '渠道']) || 'shopify');
    const key = `${channel}::${orderNo}`;
    if (!byOrder.has(key)) {
      byOrder.set(key, {
        channel,
        order_no: orderNo,
        order_date: String(pick(row, ['order_date', '下单日期'])).trim() || now().slice(0, 10),
        delivery_date: String(pick(row, ['delivery_date', '交期日期'])).trim() || now().slice(0, 10),
        customer_name: String(pick(row, ['customer_name', '客户姓名'])).trim(),
        customer_email: String(pick(row, ['customer_email', '客户邮箱'])).trim(),
        customer_phone: String(pick(row, ['customer_phone', '客户电话'])).trim(),
        customer_address: String(pick(row, ['customer_address', '收货地址'])).trim(),
        tax_state_code: String(pick(row, ['tax_state_code', '州缩写'])).trim().toUpperCase(),
        tax_rate: num(pick(row, ['tax_rate', '税率%'])),
        remark: String(pick(row, ['remark', '订单备注'])).trim(),
        status: String(pick(row, ['status', '状态'])).trim() || 'production',
        logistics_provider: String(pick(row, ['logistics_provider', '货代'])).trim(),
        tracking_number: String(pick(row, ['tracking_number', '尾程追踪编码', '追踪号'])).trim(),
        weight_kg: num(pick(row, ['weight_kg', '重量'])),
        shipping_date: String(pick(row, ['shipping_date', '发货时间'])).trim(),
        delivered_date: String(pick(row, ['delivered_date', '到货时间'])).trim(),
        delivery_channel: String(pick(row, ['delivery_channel', '尾程派送渠道'])).trim(),
        shipping_cost: num(pick(row, ['shipping_cost', '头程费用'])),
        logistics_cost_rmb: num(pick(row, ['logistics_cost_rmb', '物流成本'])),
        production_cost_override_rmb: pick(row, ['production_cost_override_rmb', '生产成本']) ? num(pick(row, ['production_cost_override_rmb', '生产成本'])) : null,
        items: []
      });
    }

    const fabricId = String(pick(row, ['fabric_id', '主面料ID'])).trim() || product.default_fabric_id || product.defaultFabricId || '';
    const liningId = String(pick(row, ['lining_id', '内衬ID'])).trim() || 'lining_none';
    const selectedOptions = parseSelectedOptionsText(pick(row, ['selected_options', '选项']));
    byOrder.get(key).items.push({
      product_id: product.id,
      qty: Math.max(1, Math.floor(num(pick(row, ['qty', '数量']), 1))),
      width_in: widthIn,
      length_in: lengthIn,
      fabric_id: fabricId,
      lining_id: liningId,
      fullness: num(pick(row, ['fullness', '褶皱倍率']), product.default_fullness || product.defaultFullness || 2),
      selected_options: selectedOptions,
      actual_paid_usd: num(pick(row, ['actual_paid_usd', '实付USD'])),
      room_label: String(pick(row, ['room_label', '房间标签'])).trim(),
      remark: String(pick(row, ['item_remark', '项目备注'])).trim()
    });
  });

  let importedOrders = 0;
  let importedItems = 0;
  for (const body of byOrder.values()) {
    try {
      const saved = saveOrder(body);
      importedOrders++;
      importedItems += saved.items?.length || 0;
    } catch (e) {
      errors.push(`订单 ${body.order_no} 导入失败：${e.message}`);
    }
  }
  return { importedOrders, importedItems, skippedRows, errors };
}

module.exports = {
  computeOrderTotals,
  getFeedbackCostByItemIds,
  applyFinalCost,
  nextItemCode,
  orderRows,
  saveOrder,
  recalculateOrderById,
  recalculateOrderCore: _recalculateOrderCore,
  parseSelectedOptionsText,
  pick,
  parseOrderImportRows
};

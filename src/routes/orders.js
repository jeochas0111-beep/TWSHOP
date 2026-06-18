const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { now, optionalNonNegative, orderChannel } = require('../utils/helpers');
const { saveOrder, recalculateOrderById, recalculateOrderCore, orderRows } = require('../utils/orders');
const { badRequest, nonNegativeNumber, notFound, positiveIntParam, route, sendOk } = require('../utils/api');

const screenshotDir = path.join(__dirname, '..', '..', 'data', 'delivery-screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });
const screenshotUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, screenshotDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `ds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件 (png/jpg/gif/webp)'));
  }
});

router.get('/orders', (req, res) => {
  const channel = req.channel || 'shopify';
  const rows = db.prepare('SELECT * FROM orders WHERE channel=? ORDER BY order_date DESC, created_at DESC, id DESC LIMIT 200').all(channel);
  const ids = rows.map(r => r.id);
  const allItems = ids.length
    ? db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids)
    : [];
  const itemsByOrder = new Map();
  for (const it of allItems) {
    const key = String(it.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push({
      ...it,
      calc_detail: undefined,
      calc_detail_json: undefined,
      selected_options_json: undefined,
      selected_options: JSON.parse(it.selected_options_json || '{}')
    });
  }
  res.json(rows.map(r => ({ ...r, items: itemsByOrder.get(String(r.id)) || [] })));
});

router.get('/orders/:id', route((req, res) => {
  const o = orderRows(req.params.id);
  if (!o) return notFound('订单不存在');
  const channel = req.channel || 'shopify';
  if (o.channel && o.channel !== channel) return notFound('订单不存在');
  res.json(o);
}));

router.post('/orders', route((req, res) => {
  if (!req.body || typeof req.body !== 'object') badRequest('请求体必须是 JSON 对象');
  sendOk(res, { order: saveOrder({ ...req.body, channel: req.channel || 'shopify' }) });
}));

router.put('/orders/:id', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  const existing = db.prepare('SELECT status FROM orders WHERE id=?').get(id);
  if (!existing) notFound('订单不存在');
  sendOk(res, { order: saveOrder(req.body, id) });
}));

router.delete('/orders/:id', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  const channel = req.channel || 'shopify';
  const existing = db.prepare('SELECT status,channel FROM orders WHERE id=?').get(id);
  if (!existing) notFound('订单不存在');
  if (existing.channel && existing.channel !== channel) notFound('订单不存在');
  const itemIds = db.prepare('SELECT id FROM order_items WHERE order_id=?').all(id).map(r => r.id);
  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM factory_feedback WHERE order_item_id IN (${placeholders})`).run(...itemIds);
  }
  db.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
  const result = db.prepare('DELETE FROM orders WHERE id=?').run(id);
  if (!result.changes) notFound('订单不存在');
  sendOk(res);
}));

router.put('/orders/:id/status', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  const status = String(req.body.status || '').trim();
  const allowed = new Set(['draft', 'production', 'shipping', 'completed']);
  if (!allowed.has(status)) badRequest('订单状态无效');
  const result = db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
  if (!result.changes) notFound('订单不存在');
  sendOk(res, { order: orderRows(id) });
}));

router.put('/orders/:id/reminder', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  const reminder = req.body.reminder ? 1 : 0;
  const reminderText = String(req.body.reminder_text || '').trim() || null;
  const result = db.prepare('UPDATE orders SET reminder=?,reminder_text=?,updated_at=? WHERE id=?').run(reminder, reminderText, now(), id);
  if (!result.changes) notFound('订单不存在');
  sendOk(res, { order: orderRows(id) });
}));

router.post('/orders/:id/recalculate', route((req, res) => {
  sendOk(res, { order: recalculateOrderById(req.params.id) });
}));

router.put('/orders/:id/logistics', route((req, res) => {
  const logisticsCostRmb = nonNegativeNumber(req.body.logistics_cost_rmb ?? req.body.logisticsCostRmb ?? 0, '物流成本不能为负数');
  sendOk(res, { order: recalculateOrderById(req.params.id, logisticsCostRmb) });
}));

router.put('/orders/:id/cost-overrides', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  const existing = db.prepare('SELECT id FROM orders WHERE id=?').get(id);
  if (!existing) notFound('订单不存在');
  const productionCost = optionalNonNegative(req.body.production_cost_override_rmb);
  const logisticsCost = nonNegativeNumber(req.body.logistics_cost_rmb ?? 0, '物流成本不能为负数');
  const updates = [];
  const params = [];
  if (productionCost != null) { updates.push('production_cost_override_rmb=?'); params.push(productionCost); }
  else { updates.push('production_cost_override_rmb=?'); params.push(null); }
  updates.push('logistics_cost_rmb=?'); params.push(logisticsCost);
  updates.push('updated_at=?'); params.push(now());
  params.push(id);
  db.prepare(`UPDATE orders SET ${updates.join(',')} WHERE id=?`).run(...params);
  sendOk(res, { order: recalculateOrderById(id) });
}));

router.put('/orders/:id/financial', route((req, res) => {
  const order = orderRows(req.params.id);
  if (!order) notFound('订单不存在');

  const clear = req.body.clear === true || req.body.clear === 'true';
  if (clear) {
    db.prepare('UPDATE orders SET sales_override_usd=NULL,tax_override_usd=NULL,updated_at=? WHERE id=?').run(now(), req.params.id);
    return sendOk(res, { order: recalculateOrderById(req.params.id) });
  }

  const salesUsd = optionalNonNegative(req.body.sales_usd ?? req.body.salesUsd ?? req.body.total_sales_usd);
  const taxUsd = optionalNonNegative(req.body.tax_usd ?? req.body.taxUsd ?? req.body.total_tax_usd);

  if (salesUsd == null) badRequest('销售金额必须是非负数字');
  if (taxUsd == null) badRequest('税费必须是非负数字');

  db.prepare('UPDATE orders SET sales_override_usd=?,tax_override_usd=?,updated_at=? WHERE id=?').run(salesUsd, taxUsd, now(), req.params.id);
  sendOk(res, { order: recalculateOrderById(req.params.id) });
}));

router.put('/order-items/:id/discount', route((req, res) => {
  const itemId = positiveIntParam(req, 'id', '项目不存在');
  const allowedModes = new Set(['percent', 'percentage', '%', 'amount', 'fixed', 'usd']);

  const result = db.transaction(() => {
    const item = db.prepare('SELECT id,order_id,actual_paid_usd,calc_detail_json FROM order_items WHERE id=?').get(itemId);
    if (!item) notFound('项目不存在');

    let calcDetail = {};
    try { calcDetail = JSON.parse(item.calc_detail_json || '{}'); } catch { calcDetail = {}; }

    const hasApply = Object.prototype.hasOwnProperty.call(req.body, 'apply_discount') || Object.prototype.hasOwnProperty.call(req.body, 'applyDiscount');
    const applyValue = req.body.apply_discount ?? req.body.applyDiscount;
    const applyDiscount = hasApply
      ? !(applyValue === false || applyValue === 'false' || applyValue === 0 || applyValue === '0')
      : (calcDetail.applyDiscount ?? true);

    const discountMode = String(req.body.discount_mode ?? req.body.discountMode ?? calcDetail.discountMode ?? 'percent').trim().toLowerCase();
    if (!allowedModes.has(discountMode)) badRequest('折扣方式无效');

    const discountValueRaw = req.body.discount_value ?? req.body.discountValue ?? calcDetail.discountValue ?? 0;
    const discountValue = optionalNonNegative(discountValueRaw);
    if (discountValue == null) badRequest('折扣值必须是非负数');

    const actualPaidRaw = req.body.actual_paid_usd ?? req.body.actualPaidUsd ?? item.actual_paid_usd ?? 0;
    const actualPaidUsd = optionalNonNegative(actualPaidRaw);
    if (actualPaidUsd == null) badRequest('实付金额必须是非负数');

    const nextCalcDetail = {
      ...calcDetail,
      applyDiscount,
      discountMode,
      discountValue,
      actualPaidUsd
    };
    db.prepare('UPDATE order_items SET actual_paid_usd=?,calc_detail_json=?,updated_at=? WHERE id=?')
      .run(actualPaidUsd, JSON.stringify(nextCalcDetail), now(), itemId);

    return recalculateOrderCore(item.order_id);
  })();
  sendOk(res, { order: result });
}));

router.put('/order-items/:id/option', route((req, res) => {
  const itemId = positiveIntParam(req, 'id', '项目不存在');

  const key = String(req.body.key || '').trim();
  const value = String(req.body.value || '').trim();
  if (!key) badRequest('选项键不能为空');
  if (!value) badRequest('选项值不能为空');

  const result = db.transaction(() => {
    const item = db.prepare('SELECT id,order_id,selected_options_json FROM order_items WHERE id=?').get(itemId);
    if (!item) notFound('项目不存在');

    const selectedOptions = JSON.parse(item.selected_options_json || '{}');
    selectedOptions[key] = value;
    db.prepare('UPDATE order_items SET selected_options_json=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(selectedOptions), now(), itemId);
    return recalculateOrderCore(item.order_id);
  })();
  sendOk(res, { order: result });
}));

router.put('/order-items/:id/size', route((req, res) => {
  const itemId = positiveIntParam(req, 'id', '项目不存在');
  const widthIn = Number(req.body.width_in ?? req.body.widthIn);
  const lengthIn = Number(req.body.length_in ?? req.body.lengthIn);
  if (!Number.isFinite(widthIn) || widthIn <= 0) badRequest('宽度必须大于 0');
  if (!Number.isFinite(lengthIn) || lengthIn <= 0) badRequest('高度必须大于 0');

  const result = db.transaction(() => {
    const item = db.prepare('SELECT id,order_id FROM order_items WHERE id=?').get(itemId);
    if (!item) notFound('项目不存在');

    db.prepare('UPDATE order_items SET width_in=?,length_in=?,updated_at=? WHERE id=?')
      .run(widthIn, lengthIn, now(), itemId);
    return recalculateOrderCore(item.order_id);
  })();
  sendOk(res, { order: result });
}));

router.put('/order-items/:id/qty', route((req, res) => {
  const itemId = positiveIntParam(req, 'id', '项目不存在');

  const qty = Number(req.body.qty);
  if (!Number.isFinite(qty) || qty <= 0) badRequest('数量必须大于 0');

  const normalizedQty = Math.max(1, Math.floor(qty));
  const result = db.transaction(() => {
    const item = db.prepare('SELECT id,order_id FROM order_items WHERE id=?').get(itemId);
    if (!item) notFound('项目不存在');

    db.prepare('UPDATE order_items SET qty=?,updated_at=? WHERE id=?')
      .run(normalizedQty, now(), itemId);
    return recalculateOrderCore(item.order_id);
  })();
  sendOk(res, { order: result });
}));

router.put('/order-items/:id/production-cost', route((req, res) => {
  const itemId = positiveIntParam(req, 'id', '项目不存在');
  const costVal = req.body.production_cost_override_rmb;
  const override = costVal != null && costVal !== '' ? Number(costVal) : null;
  if (override != null && (!Number.isFinite(override) || override < 0)) badRequest('生产成本不能为负数');

  const result = db.transaction(() => {
    const item = db.prepare('SELECT id,order_id FROM order_items WHERE id=?').get(itemId);
    if (!item) notFound('项目不存在');
    db.prepare('UPDATE order_items SET production_cost_override_rmb=?,updated_at=? WHERE id=?')
      .run(override, now(), itemId);
    return recalculateOrderCore(item.order_id);
  })();
  sendOk(res, { order: result });
}));

router.post('/orders/recalculate-all', route((req, res) => {
  const channel = req.channel || 'shopify';
  const ids = db.prepare('SELECT id FROM orders WHERE channel=?').all(channel).map((r) => r.id);
  let updated = 0;
  for (const id of ids) {
    recalculateOrderById(id);
    updated++;
  }
  sendOk(res, { updated });
}));

router.get('/orders/:id/delivery-screenshot', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  if (id === undefined) return;
  const order = db.prepare('SELECT delivery_screenshot FROM orders WHERE id=?').get(id);
  if (!order || !order.delivery_screenshot) return notFound('无签收截图');
  const filePath = path.join(screenshotDir, order.delivery_screenshot);
  if (!fs.existsSync(filePath)) return notFound('截图文件不存在');
  res.sendFile(filePath);
}));

router.post('/orders/:id/delivery-screenshot', (req, res, next) => {
  screenshotUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: '文件大小超过限制（最大 10MB）' });
      return res.status(400).json({ ok: false, error: err.message || '文件上传失败' });
    }
    next();
  });
}, route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  if (id === undefined) return;
  const order = db.prepare('SELECT id, delivery_screenshot FROM orders WHERE id=?').get(id);
  if (!order) return notFound('订单不存在');
  if (!req.file) return badRequest('请选择图片文件');
  // Delete old screenshot
  if (order.delivery_screenshot) {
    const oldPath = path.join(screenshotDir, order.delivery_screenshot);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const filename = req.file.filename;
  db.prepare('UPDATE orders SET delivery_screenshot=?, updated_at=? WHERE id=?').run(filename, now(), id);
  sendOk(res, { filename });
}));

router.delete('/orders/:id/delivery-screenshot', route((req, res) => {
  const id = positiveIntParam(req, 'id', '订单不存在');
  if (id === undefined) return;
  const order = db.prepare('SELECT id, delivery_screenshot FROM orders WHERE id=?').get(id);
  if (!order) return notFound('订单不存在');
  if (order.delivery_screenshot) {
    const filePath = path.join(screenshotDir, order.delivery_screenshot);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('UPDATE orders SET delivery_screenshot=NULL, updated_at=? WHERE id=?').run(now(), id);
  }
  sendOk(res, { deleted: true });
}));

module.exports = router;

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { now } = require('../utils/helpers');
const { toProductPayload, getProducts, getProduct, getArchivedProducts, archiveProduct, unarchiveProduct, replaceProductOptions, replacePrices } = require('../services/products');
const { notFound, route, sendOk } = require('../utils/api');

router.get('/products', (req, res) => {
  const channel = req.query.channel || req.channel || 'shopify';
  res.json(getProducts(channel));
});

router.get('/products/archived', (req, res) => {
  const channel = req.query.channel || req.channel || 'shopify';
  res.json(getArchivedProducts(channel));
});

router.get('/products/:id', route((req, res) => {
  const p = getProduct(req.params.id);
  if (!p) return notFound('产品不存在');
  const channel = req.channel || 'shopify';
  if (p.channel && p.channel !== channel) return notFound('产品不存在');
  res.json(p);
}));

router.post('/products', route((req, res) => {
  const p = toProductPayload({ ...req.body, channel: req.channel || 'shopify' });
  db.prepare('INSERT INTO products(id,name,channel,factory_name,shopify_option_set,type,series,default_fabric_id,base_price,default_fullness,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(p.id, p.name, p.channel, p.factory_name, p.shopify_option_set, p.type, p.series, p.default_fabric_id, p.base_price, p.default_fullness, p.enabled, now(), now());
  replacePrices(p.id, 'width', p.width_prices || []);
  replacePrices(p.id, 'length', p.length_prices || []);
  replaceProductOptions(p.id, p.options || []);
  sendOk(res, { product: getProduct(p.id) });
}));

router.put('/products/:id', route((req, res) => {
  const p = toProductPayload({ ...req.body, id: req.params.id, channel: req.channel || 'shopify' });
  db.prepare('UPDATE products SET name=?,channel=?,factory_name=?,shopify_option_set=?,type=?,series=?,default_fabric_id=?,base_price=?,default_fullness=?,enabled=?,updated_at=? WHERE id=?')
    .run(p.name, p.channel, p.factory_name, p.shopify_option_set, p.type, p.series, p.default_fabric_id, p.base_price, p.default_fullness, p.enabled, now(), req.params.id);
  if (req.body.width_prices) replacePrices(req.params.id, 'width', req.body.width_prices);
  if (req.body.length_prices) replacePrices(req.params.id, 'length', req.body.length_prices);
  if (req.body.options) replaceProductOptions(req.params.id, req.body.options);
  sendOk(res, { product: getProduct(req.params.id) });
}));

router.delete('/products/:id', route((req, res) => {
  const id = req.params.id;
  const channel = req.channel || 'shopify';
  const existing = db.prepare('SELECT id,channel FROM products WHERE id=?').get(id);
  if (!existing) notFound('产品不存在');
  if (existing.channel && existing.channel !== channel) notFound('产品不存在');
  db.prepare('DELETE FROM product_option_values WHERE group_id IN (SELECT id FROM product_option_groups WHERE product_id=?)').run(id);
  db.prepare('DELETE FROM product_option_groups WHERE product_id=?').run(id);
  db.prepare('DELETE FROM product_width_prices WHERE product_id=?').run(id);
  db.prepare('DELETE FROM product_length_prices WHERE product_id=?').run(id);
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  sendOk(res);
}));

router.post('/products/:id/copy', route((req, res) => {
  const p = getProduct(req.params.id);
  if (!p) notFound('产品不存在');

  const copy = {
    ...p,
    id: `${p.id}_copy_${Date.now()}`,
    name: `${p.name} Copy`,
    factory_name: `${p.factory_name || p.name} Copy`,
    channel: req.channel || 'shopify'
  };

  db.prepare('INSERT INTO products(id,name,channel,factory_name,shopify_option_set,type,series,default_fabric_id,base_price,default_fullness,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(copy.id, copy.name, copy.channel, copy.factory_name, copy.shopify_option_set, copy.type, copy.series, copy.default_fabric_id, copy.base_price, copy.default_fullness, copy.enabled ? 1 : 0, now(), now());
  replacePrices(copy.id, 'width', copy.width_prices || []);
  replacePrices(copy.id, 'length', copy.length_prices || []);
  replaceProductOptions(copy.id, copy.options || []);
  sendOk(res, { product: getProduct(copy.id) });
}));

router.put('/products/:id/width-prices', route((req, res) => {
  replacePrices(req.params.id, 'width', req.body.prices || req.body || []);
  sendOk(res);
}));

router.put('/products/:id/length-prices', route((req, res) => {
  replacePrices(req.params.id, 'length', req.body.prices || req.body || []);
  sendOk(res);
}));

router.put('/products/:id/options', route((req, res) => {
  replaceProductOptions(req.params.id, req.body.options || req.body || []);
  sendOk(res);
}));

router.put('/products/:id/archive', route((req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id=?').get(req.params.id);
  if (!existing) return notFound('产品不存在');
  archiveProduct(req.params.id, req.channel || 'shopify');
  sendOk(res, { archived: true });
}));

router.put('/products/:id/unarchive', route((req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id=?').get(req.params.id);
  if (!existing) return notFound('产品不存在');
  unarchiveProduct(req.params.id, req.channel || 'shopify');
  sendOk(res, { unarchived: true });
}));

module.exports = router;

const express = require('express');
const router = express.Router();
const shopify = require('../services/shopify');
const appConfig = require('../config');

function requireShopifyEnabled(req, res, next) {
  if (!appConfig.shopifyIntegrationEnabled) {
    return res.status(404).json({ ok: false, error: 'Shopify 订单拉取功能暂未启用' });
  }
  next();
}

router.get('/shopify/status', requireShopifyEnabled, (req, res) => {
  res.json(shopify.settings());
});

router.post('/shopify/settings', requireShopifyEnabled, (req, res) => {
  try {
    if (req.body.shopDomain != null) shopify.saveSetting('shopifyShopDomain', req.body.shopDomain);
    if (req.body.apiVersion != null) shopify.saveSetting('shopifyApiVersion', req.body.apiVersion);
    if (req.body.adminToken) shopify.saveSetting('shopifyAdminToken', req.body.adminToken);
    res.json({ ok: true, settings: shopify.settings() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/shopify/orders/fetch', requireShopifyEnabled, async (req, res) => {
  try {
    res.json({ ok: true, order: await shopify.fetchOrderByName(req.body.orderName || req.body.order_no || req.body.name) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/shopify/orders/recent', requireShopifyEnabled, async (req, res) => {
  try {
    res.json({ ok: true, orders: await shopify.recentOrders(req.query.limit || 20) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;

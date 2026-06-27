const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db } = require('../db');
const { now, num, boolInt, requireNonNegative, context, upsertGlobal } = require('../utils/helpers');
const { recalculateOrderById } = require('../utils/orders');
const factoryService = require('../services/factory');
const { requireFile, route, sendOk } = require('../utils/api');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/factory/orders', (req, res) => {
  res.json(factoryService.listFactoryOrders());
});

router.get('/factory/params', (req, res) => {
  const ctx = context();
  const factoryGlobals = {};
  ['topHemAllowanceCm', 'bottomHemAllowanceCm', 'singleLayerLossCm', 'doubleLayerLossCm',
    'factoryIssueBufferCm', 'singleLaborRmbPerM', 'doubleLaborRmbPerM',
    'singleMemoryRmbPerM', 'doubleMemoryRmbPerM', 'costCoefficient', 'defaultFullness',
    'usdRmbRate', 'paypalFeeRate'
  ].forEach(k => {
    factoryGlobals[k] = ctx.globals[k];
  });
  res.json({
    globals: factoryGlobals,
    fabrics: ctx.fabrics,
    linings: ctx.linings,
    laborRules: ctx.laborRules,
    memoryRules: ctx.memoryRules
  });
});

router.put('/factory/params', route((req, res) => {
  const allowedGlobals = ['topHemAllowanceCm', 'bottomHemAllowanceCm', 'singleLayerLossCm', 'doubleLayerLossCm',
    'factoryIssueBufferCm', 'singleLaborRmbPerM', 'doubleLaborRmbPerM',
    'singleMemoryRmbPerM', 'doubleMemoryRmbPerM', 'costCoefficient', 'defaultFullness',
    'usdRmbRate', 'paypalFeeRate'
  ];

  db.transaction((body) => {
    for (const key of allowedGlobals) {
      if (body.globals && Object.prototype.hasOwnProperty.call(body.globals, key)) {
        upsertGlobal(key, body.globals[key], '管理端维护');
      }
    }

    if (Array.isArray(body.fabrics)) {
      const ids = [];
      for (const f of body.fabrics) {
        if (!f.id || !f.name) continue;
        if (num(f.width_cm) <= 0) throw new Error(`${f.name || f.id} 门幅必须 > 0`);
        requireNonNegative(f.price_per_m, '面料价格');
        ids.push(f.id);
        db.prepare('INSERT INTO fabrics(id,name,series,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,series=excluded.series,width_cm=excluded.width_cm,price_per_m=excluded.price_per_m,enabled=excluded.enabled,updated_at=excluded.updated_at')
          .run(f.id, f.name, f.series || f.name, num(f.width_cm), num(f.price_per_m), boolInt(f.enabled), now(), now());
      }
      if (ids.length) db.prepare(`DELETE FROM fabrics WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
      else db.prepare('DELETE FROM fabrics').run();
    }

    if (Array.isArray(body.linings)) {
      const ids = [];
      for (const l of body.linings) {
        if (!l.id || !l.name) continue;
        requireNonNegative(l.width_cm, '内衬门幅');
        requireNonNegative(l.price_per_m, '内衬价格');
        ids.push(l.id);
        db.prepare('INSERT INTO linings(id,name,color,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,width_cm=excluded.width_cm,price_per_m=excluded.price_per_m,enabled=excluded.enabled,updated_at=excluded.updated_at')
          .run(l.id, l.name, l.color || '', num(l.width_cm), num(l.price_per_m), boolInt(l.enabled), now(), now());
      }
      if (!ids.includes('lining_none')) ids.push('lining_none');
      if (ids.length) db.prepare(`DELETE FROM linings WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    if (Array.isArray(body.laborRules)) {
      db.prepare('DELETE FROM labor_rules').run();
      body.laborRules.forEach((r, i) => {
        db.prepare('INSERT INTO labor_rules(layer,min_m,max_m,rate_rmb_per_m,note,sort_order) VALUES(?,?,?,?,?,?)')
          .run(r.layer === 'double' ? 'double' : 'single', num(r.min_m), r.max_m === '' || r.max_m == null ? null : num(r.max_m), num(r.rate_rmb_per_m), r.note || '', i);
      });
    }

    if (Array.isArray(body.memoryRules)) {
      db.prepare('DELETE FROM memory_rules').run();
      body.memoryRules.forEach((r, i) => {
        db.prepare('INSERT INTO memory_rules(min_m,max_m,single_rate_rmb,double_coef,manual_quote,note,sort_order) VALUES(?,?,?,?,?,?,?)')
          .run(num(r.min_m), r.max_m === '' || r.max_m == null ? null : num(r.max_m), num(r.single_rate_rmb), num(r.double_coef, 1), boolInt(r.manual_quote), r.note || '', i);
      });
    }
  })(req.body || {});

  const ctx = context();
  const factoryGlobals = {};
  allowedGlobals.forEach(k => { factoryGlobals[k] = ctx.globals[k]; });
  sendOk(res, {
    globals: factoryGlobals,
    fabrics: ctx.fabrics,
    linings: ctx.linings,
    laborRules: ctx.laborRules,
    memoryRules: ctx.memoryRules
  });
}));

router.get('/factory/feedback/export-xlsx', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('TWODRAPES_工厂加工费用确认单.xlsx')}`);
  res.send(factoryService.exportFeedbackXlsx());
});

router.get('/factory/feedback', (req, res) => {
  res.json(factoryService.listFeedbackRows());
});

router.get('/factory/feedback/export-csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('TWODRAPES_工厂加工费用确认单.csv')}`);
  res.send(factoryService.exportFeedbackCsv());
});

router.post('/factory/feedback/import', upload.single('file'), route((req, res) => {
  const file = requireFile(req);
  const result = factoryService.importFeedback(file.buffer, file.originalname || '');
  const orderIds = db.prepare('SELECT DISTINCT oi.order_id AS order_id FROM factory_feedback ff JOIN order_items oi ON oi.id=ff.order_item_id WHERE oi.order_id IS NOT NULL').all().map((r) => r.order_id);
  for (const orderId of orderIds) recalculateOrderById(orderId);
  sendOk(res, result);
}));

router.delete('/factory/feedback', route((req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || !ids.length) {
    throw new (require('../utils/api').ApiError)(400, '请选择要删除的反馈记录');
  }
  // Find affected orders before deleting
  const cleanIds = ids.map(id => Number(id)).filter(Number.isFinite);
  const placeholders = cleanIds.map(() => '?').join(',');
  const affectedOrderIds = db.prepare(`SELECT DISTINCT oi.order_id FROM factory_feedback ff JOIN order_items oi ON oi.id=ff.order_item_id WHERE ff.id IN (${placeholders})`).all(...cleanIds).map(r => r.order_id);
  const result = factoryService.deleteFeedback(ids);
  for (const orderId of affectedOrderIds) recalculateOrderById(orderId);
  sendOk(res, result);
}));

module.exports = router;

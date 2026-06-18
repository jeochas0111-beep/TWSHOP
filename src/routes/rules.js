const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { now, num, boolInt, tableAll } = require('../utils/helpers');

// 加工费规则
router.get('/labor-rules', (req, res) => {
  res.json(tableAll('labor_rules', 'sort_order,id'));
});

router.put('/labor-rules', (req, res) => {
  try {
    db.transaction((rows) => {
      db.prepare('DELETE FROM labor_rules').run();
      rows.forEach((r, i) => {
        db.prepare('INSERT INTO labor_rules(layer,min_m,max_m,rate_rmb_per_m,note,sort_order) VALUES(?,?,?,?,?,?)')
          .run(r.layer, num(r.min_m), r.max_m === '' || r.max_m == null ? null : num(r.max_m), num(r.rate_rmb_per_m), r.note || '', i);
      });
    })(req.body.rules || req.body || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 定型费规则
router.get('/memory-rules', (req, res) => {
  res.json(tableAll('memory_rules', 'sort_order,id'));
});

router.put('/memory-rules', (req, res) => {
  try {
    db.transaction((rows) => {
      db.prepare('DELETE FROM memory_rules').run();
      rows.forEach((r, i) => {
        db.prepare('INSERT INTO memory_rules(min_m,max_m,single_rate_rmb,double_coef,manual_quote,note,sort_order) VALUES(?,?,?,?,?,?,?)')
          .run(num(r.min_m), r.max_m === '' || r.max_m == null ? null : num(r.max_m), num(r.single_rate_rmb), num(r.double_coef, 1), boolInt(r.manual_quote), r.note || '', i);
      });
    })(req.body.rules || req.body || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 税率
router.get('/tax-rates', (req, res) => {
  res.json(tableAll('tax_rates', 'code'));
});

router.put('/tax-rates', (req, res) => {
  try {
    db.transaction((rows) => {
      db.prepare('DELETE FROM tax_rates').run();
      rows.forEach(r => {
        db.prepare('INSERT INTO tax_rates(code,state,rate,note) VALUES(?,?,?,?)')
          .run(String(r.code).toUpperCase(), r.state, num(r.rate), r.note || '');
      });
    })(req.body.rates || req.body || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;

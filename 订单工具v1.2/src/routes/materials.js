const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { now, num, boolInt, requireNonNegative, tableAll } = require('../utils/helpers');
const { badRequest, route, sendOk } = require('../utils/api');

function validateFabric(body, id) {
  if (!id || !body.name) badRequest('ID 和名称必填');
  requireNonNegative(body.price_per_m, '价格');
  if (num(body.width_cm) <= 0) badRequest('面料门幅必须 > 0');
}

function validateLining(body, id) {
  if (!id || !body.name) badRequest('ID 和名称必填');
  requireNonNegative(body.price_per_m, '价格');
  if (num(body.width_cm) <= 0) badRequest('内衬门幅必须 > 0');
}

router.get('/fabrics', (req, res) => {
  res.json(tableAll('fabrics', 'name'));
});

router.post('/fabrics', route((req, res) => {
  validateFabric(req.body, req.body.id);
  const fields = ['id', 'name', 'series', 'width_cm', 'price_per_m', 'enabled'];
  const vals = fields.map(f => f === 'enabled' ? boolInt(req.body[f]) : req.body[f]);
  db.prepare(`INSERT INTO fabrics(${fields.join(',')},created_at,updated_at) VALUES(${fields.map(() => '?').join(',')},?,?)`)
    .run(...vals, now(), now());
  sendOk(res);
}));

router.put('/fabrics/:id', route((req, res) => {
  validateFabric(req.body, req.params.id);
  const result = db.prepare('UPDATE fabrics SET name=?,series=?,width_cm=?,price_per_m=?,enabled=?,updated_at=? WHERE id=?')
    .run(req.body.name, req.body.series ?? '', num(req.body.width_cm), num(req.body.price_per_m), boolInt(req.body.enabled), now(), req.params.id);

  if (result.changes === 0) {
    const fields = ['id', 'name', 'series', 'width_cm', 'price_per_m', 'enabled'];
    const vals = fields.map(f => f === 'enabled' ? boolInt(req.body[f]) : f === 'id' ? req.params.id : req.body[f]);
    db.prepare(`INSERT INTO fabrics(${fields.join(',')},created_at,updated_at) VALUES(${fields.map(() => '?').join(',')},?,?)`)
      .run(...vals, now(), now());
  }
  sendOk(res);
}));

router.delete('/fabrics/:id', route((req, res) => {
  db.prepare('DELETE FROM fabrics WHERE id=?').run(req.params.id);
  sendOk(res);
}));

router.get('/linings', (req, res) => {
  res.json(tableAll('linings', 'name'));
});

router.post('/linings', route((req, res) => {
  validateLining(req.body, req.body.id);
  const fields = ['id', 'name', 'color', 'width_cm', 'price_per_m', 'enabled'];
  const vals = fields.map(f => f === 'enabled' ? boolInt(req.body[f]) : req.body[f]);
  db.prepare(`INSERT INTO linings(${fields.join(',')},created_at,updated_at) VALUES(${fields.map(() => '?').join(',')},?,?)`)
    .run(...vals, now(), now());
  sendOk(res);
}));

router.put('/linings/:id', route((req, res) => {
  validateLining(req.body, req.params.id);
  const result = db.prepare('UPDATE linings SET name=?,color=?,width_cm=?,price_per_m=?,enabled=?,updated_at=? WHERE id=?')
    .run(req.body.name, req.body.color ?? '', num(req.body.width_cm), num(req.body.price_per_m), boolInt(req.body.enabled), now(), req.params.id);

  if (result.changes === 0) {
    const fields = ['id', 'name', 'color', 'width_cm', 'price_per_m', 'enabled'];
    const vals = fields.map(f => f === 'enabled' ? boolInt(req.body[f]) : f === 'id' ? req.params.id : req.body[f]);
    db.prepare(`INSERT INTO linings(${fields.join(',')},created_at,updated_at) VALUES(${fields.map(() => '?').join(',')},?,?)`)
      .run(...vals, now(), now());
  }
  sendOk(res);
}));

router.delete('/linings/:id', route((req, res) => {
  db.prepare('DELETE FROM linings WHERE id=?').run(req.params.id);
  sendOk(res);
}));

module.exports = router;

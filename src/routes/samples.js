const express = require('express');
const { db } = require('../db');
const { now, orderChannel } = require('../utils/helpers');

function requestChannel(req) {
  const raw = req.channel || req.user?.channel || req.query.channel;
  return raw ? orderChannel(raw) : null;
}

function sampleRoutes() {
  const router = express.Router();

  router.get('/samples', (req, res) => {
    try {
      const channel = requestChannel(req);
      const rows = channel
        ? db.prepare('SELECT * FROM sample_sales WHERE channel = ? ORDER BY sale_date DESC, id DESC').all(channel)
        : db.prepare('SELECT * FROM sample_sales ORDER BY sale_date DESC, id DESC').all();
      res.json(rows);
    } catch (e) {
      console.error('[SAMPLES] list error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/samples', (req, res) => {
    try {
      const channel = requestChannel(req) || orderChannel(req.body?.channel);
      const { product_id, fabric_name, quantity, amount_usd, sale_date, remark } = req.body || {};
      if (!fabric_name) return res.status(400).json({ ok: false, error: '请输入面料名称' });
      const ts = now();
      const result = db.prepare(
        'INSERT INTO sample_sales (channel, product_id, fabric_name, quantity, amount_usd, sale_date, remark, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(channel, product_id || null, fabric_name, quantity || 1, amount_usd || 0, sale_date || null, remark || null, ts, ts);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      console.error('[SAMPLES] create error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.delete('/samples/:id', (req, res) => {
    try {
      const { id } = req.params;
      const channel = requestChannel(req);
      const result = channel
        ? db.prepare('DELETE FROM sample_sales WHERE id = ? AND channel = ?').run(id, channel)
        : db.prepare('DELETE FROM sample_sales WHERE id = ?').run(id);
      if (!result.changes) return res.status(404).json({ ok: false, error: '记录不存在' });
      res.json({ ok: true });
    } catch (e) {
      console.error('[SAMPLES] delete error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  return router;
}

module.exports = { sampleRoutes };

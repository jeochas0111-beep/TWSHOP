const express = require('express');
const router = express.Router();

function now() { return new Date().toISOString(); }

router.get('/health', (req, res) => {
  res.json({ ok: true, name: 'TWODRAPES 工厂下单成本核算工具', time: now() });
});

module.exports = router;

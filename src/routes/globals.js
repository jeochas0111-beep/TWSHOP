const express = require('express');
const router = express.Router();
const { getGlobals, upsertGlobal } = require('../utils/helpers');

router.get('/globals', (req, res) => {
  res.json(getGlobals());
});

router.put('/globals', (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body || {})) {
      upsertGlobal(key, value);
    }
    res.json({ ok: true, globals: getGlobals() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;

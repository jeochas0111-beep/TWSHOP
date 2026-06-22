const express = require('express');
const router = express.Router();
const { num } = require('../utils/helpers');
const formulas = require('../formulas');
const { context, calcItemFromPayload } = require('../utils/helpers');
const { route } = require('../utils/api');

router.post('/calc/item', route((req, res) => {
  res.json(calcItemFromPayload(req.body, req.channel));
}));

router.post('/calc/material-plan', route((req, res) => {
  const ctx = context(req.channel);
  const fabric = ctx.fabrics.find(f => f.id === (req.body.fabric_id || req.body.fabricId)) || ctx.fabrics[0];
  const lining = ctx.linings.find(l => l.id === (req.body.lining_id || req.body.liningId));
  const layer = req.body.layer || (req.body.has_lining || req.body.hasLining ? 'double' : 'single');

  const mainPlan = formulas.materialPlan({
    widthIn: num(req.body.width_in ?? req.body.widthIn),
    lengthIn: num(req.body.length_in ?? req.body.lengthIn),
    qty: num(req.body.qty, 1),
    fullness: num(req.body.fullness, ctx.globals.defaultFullness || 2),
    material: fabric,
    globals: ctx.globals,
    layer
  });

  const liningPlan = layer === 'double' && lining && lining.width_cm > 0
    ? formulas.materialPlan({
        widthIn: num(req.body.width_in ?? req.body.widthIn),
        lengthIn: num(req.body.length_in ?? req.body.lengthIn),
        qty: num(req.body.qty, 1),
        fullness: num(req.body.fullness, ctx.globals.defaultFullness || 2),
        material: lining,
        globals: ctx.globals,
        layer
      })
    : null;

  res.json({
    mainPlan,
    liningPlan,
    warnings: [...mainPlan.warnings, ...(liningPlan?.warnings || [])]
  });
}));

module.exports = router;

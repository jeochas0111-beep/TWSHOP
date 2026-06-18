module.exports = function(db) {
  const cols = db.prepare('PRAGMA table_info(order_items)').all().map(c => c.name);
  if (!cols.includes('production_cost_override_rmb'))
    db.exec('ALTER TABLE order_items ADD COLUMN production_cost_override_rmb REAL');
};

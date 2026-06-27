module.exports = function migrateProductionCostOverride(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('production_cost_override_rmb')) db.exec('ALTER TABLE orders ADD COLUMN production_cost_override_rmb REAL');
};

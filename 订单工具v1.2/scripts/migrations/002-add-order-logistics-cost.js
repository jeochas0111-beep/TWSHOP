module.exports = function migrateAddOrderLogisticsCost(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  const hasLogistics = cols.some((c) => c.name === "logistics_cost_rmb");
  if (!hasLogistics) {
    db.exec("ALTER TABLE orders ADD COLUMN logistics_cost_rmb REAL DEFAULT 0");
  }
};


module.exports = function migrateAddOrderSalesOverrides(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("sales_override_usd")) {
    db.exec("ALTER TABLE orders ADD COLUMN sales_override_usd REAL DEFAULT NULL");
  }
  if (!names.has("tax_override_usd")) {
    db.exec("ALTER TABLE orders ADD COLUMN tax_override_usd REAL DEFAULT NULL");
  }
};

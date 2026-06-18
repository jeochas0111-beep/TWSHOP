module.exports = function migrateAddOrderPaymentActuals(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("paypal_fee_usd")) {
    db.exec("ALTER TABLE orders ADD COLUMN paypal_fee_usd REAL DEFAULT 0");
  }
  if (!names.has("actual_income_usd")) {
    db.exec("ALTER TABLE orders ADD COLUMN actual_income_usd REAL DEFAULT 0");
  }
};

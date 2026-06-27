module.exports = function migrateOrderStatus(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("status")) {
    db.exec("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'production'");
  }
  db.exec("UPDATE orders SET status='production' WHERE status IS NULL OR status=''");
};

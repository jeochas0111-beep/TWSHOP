module.exports = (db) => {
  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes('delivery_screenshot')) {
    db.exec("ALTER TABLE orders ADD COLUMN delivery_screenshot TEXT");
  }
};

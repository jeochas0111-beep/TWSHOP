module.exports = function migrate(db) {
  const hasColumn = db.prepare('PRAGMA table_info(orders)').all().some(row => row.name === 'channel');
  if (!hasColumn) {
    db.prepare("ALTER TABLE orders ADD COLUMN channel TEXT DEFAULT 'shopify'").run();
  }
  db.prepare("UPDATE orders SET channel='shopify' WHERE channel IS NULL OR channel=''").run();
};

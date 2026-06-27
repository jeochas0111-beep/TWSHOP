module.exports = function (db) {
  // Check if channel column already exists
  const cols = db.prepare("PRAGMA table_info(products)").all();
  if (cols.some(c => c.name === 'channel')) return;

  db.exec("ALTER TABLE products ADD COLUMN channel TEXT DEFAULT 'shopify'");

  // All existing products belong to shopify (default), no data migration needed
  // since the default is already 'shopify'
};

module.exports = function migrateShippingFields(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('shipping_date')) db.exec('ALTER TABLE orders ADD COLUMN shipping_date TEXT');
  if (!cols.includes('shipping_cost')) db.exec('ALTER TABLE orders ADD COLUMN shipping_cost REAL');
};

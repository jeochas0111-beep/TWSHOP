module.exports = function migrateDeliveryChannel(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('delivery_channel')) db.exec('ALTER TABLE orders ADD COLUMN delivery_channel TEXT');
  if (!cols.includes('weight_kg')) db.exec('ALTER TABLE orders ADD COLUMN weight_kg REAL');
};

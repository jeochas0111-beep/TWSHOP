module.exports = function migrateLogisticsFields(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('logistics_provider')) db.exec('ALTER TABLE orders ADD COLUMN logistics_provider TEXT');
  if (!cols.includes('tracking_number')) db.exec('ALTER TABLE orders ADD COLUMN tracking_number TEXT');
};

module.exports = function migrateDeliveredDate(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('delivered_date')) db.exec('ALTER TABLE orders ADD COLUMN delivered_date TEXT');
};

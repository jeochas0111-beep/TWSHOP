module.exports = function migrateReminder(db) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('reminder'))
    db.exec('ALTER TABLE orders ADD COLUMN reminder INTEGER DEFAULT 0');
  if (!cols.includes('reminder_text'))
    db.exec('ALTER TABLE orders ADD COLUMN reminder_text TEXT');
};

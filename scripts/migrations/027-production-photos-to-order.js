module.exports = function migrateProductionPhotosToOrder(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_photos'").all();
  if (!tables.length) return;

  const cols = db.prepare("PRAGMA table_info(production_photos)").all();
  const hasOrderId = cols.some(c => c.name === 'order_id');
  if (hasOrderId) return;

  db.exec(`
    ALTER TABLE production_photos ADD COLUMN order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE;
    UPDATE production_photos SET order_id = (
      SELECT order_items.order_id FROM order_items WHERE order_items.id = production_photos.order_item_id
    );
    CREATE INDEX idx_production_photos_order ON production_photos(order_id);
  `);

  db.prepare('DELETE FROM production_photos WHERE order_id IS NULL').run();
};

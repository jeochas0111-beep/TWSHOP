module.exports = function migrateProductionPhotos(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_photos'").all();
  if (tables.length) return;

  db.exec(`
    CREATE TABLE production_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_production_photos_item ON production_photos(order_item_id);
  `);
};

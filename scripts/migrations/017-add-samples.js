module.exports = function migrateSamples(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sample_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'shopify',
      product_id TEXT,
      fabric_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      sale_date TEXT,
      remark TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
};

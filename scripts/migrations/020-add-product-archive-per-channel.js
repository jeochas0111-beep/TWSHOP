module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_archive(
      product_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'shopify',
      archived_at TEXT,
      PRIMARY KEY(product_id, channel)
    );
  `);

  // Migrate existing archived=1 products to both channels
  const archived = db.prepare('SELECT id FROM products WHERE archived=1').all();
  const ins = db.prepare('INSERT OR IGNORE INTO product_archive(product_id,channel,archived_at) VALUES(?,?,?)');
  const now = new Date().toISOString();
  for (const p of archived) {
    ins.run(p.id, 'shopify', now);
    ins.run(p.id, 'amazon', now);
  }
};

module.exports = (db) => {
  const cols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
  if (!cols.includes('archived')) {
    db.exec("ALTER TABLE products ADD COLUMN archived INTEGER DEFAULT 0");
  }
};

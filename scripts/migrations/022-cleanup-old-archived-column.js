module.exports = function run(db) {
  // Reset the old shared archived column — archive state is now managed by product_archive table
  db.exec("UPDATE products SET archived=0");
};

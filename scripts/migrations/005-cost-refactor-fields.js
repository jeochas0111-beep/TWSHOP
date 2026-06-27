module.exports = function migrateCostRefactorFields(db) {
  function addColumn(table, name, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }

  addColumn("order_items", "estimated_cost_rmb", "REAL DEFAULT 0");
  addColumn("order_items", "final_cost_rmb", "REAL DEFAULT 0");
  addColumn("order_items", "final_cost_source", "TEXT DEFAULT 'estimated'");
  addColumn("order_items", "factory_issued_usage_m", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_actual_usage_m", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_fabric_price_rmb", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_labor_rmb", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_memory_rmb", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_cost_total_rmb", "REAL DEFAULT NULL");
  addColumn("order_items", "factory_settlement_rmb", "REAL DEFAULT NULL");

  addColumn("products", "panels_per_unit", "REAL DEFAULT 1");

  db.exec(`
    UPDATE order_items
    SET estimated_cost_rmb = COALESCE(NULLIF(estimated_cost_rmb, 0), cost_rmb, 0),
        final_cost_rmb = COALESCE(NULLIF(final_cost_rmb, 0), cost_rmb, 0),
        final_cost_source = COALESCE(NULLIF(final_cost_source, ''), 'estimated')
  `);
};

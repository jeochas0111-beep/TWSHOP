module.exports = function migrateFeedbackLiningColumns(db) {
  function addColumn(table, name, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }

  addColumn('factory_feedback', 'lining_material', 'TEXT');
  addColumn('factory_feedback', 'lining_actual_meters', 'REAL');
  addColumn('factory_feedback', 'lining_unit_price', 'REAL');
  addColumn('factory_feedback', 'lining_labor_fee', 'TEXT');
  addColumn('factory_feedback', 'lining_memory_fee', 'REAL');
  addColumn('factory_feedback', 'lining_total_cost', 'REAL');
  addColumn('factory_feedback', 'lining_settlement_cost', 'REAL');
};

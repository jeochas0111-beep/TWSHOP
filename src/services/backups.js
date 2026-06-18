const fs = require('fs');
const path = require('path');
const { db, backupDir } = require('../db');
const { getProducts } = require('./products');

function now() { return new Date().toISOString(); }

const VALID_TABLES = new Set(['globals','fabrics','linings','products','product_width_prices','product_length_prices','product_option_groups','product_option_values','product_archive','labor_rules','memory_rules','tax_rates','orders','order_items','factory_feedback','backups','users','sample_sales']);
function all(table, order = '1') {
  if (!VALID_TABLES.has(table)) throw new Error('Invalid table name');
  if (!/^[a-zA-Z0-9_,\s]+$/.test(order)) throw new Error('Invalid order clause');
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}
function exportBackupPayload() {
  return {
    schema: 'twodrapes_factory_tool_sqlite_v1',
    exportedAt: now(),
    data: {
      globals: all('globals', 'key'),
      fabrics: all('fabrics', 'name'),
      linings: all('linings', 'name'),
      products: getProducts(),
      productArchive: all('product_archive', 'product_id'),
      laborRules: all('labor_rules', 'sort_order,id'),
      memoryRules: all('memory_rules', 'sort_order,id'),
      taxRates: all('tax_rates', 'code'),
      orders: all('orders', 'id'),
      orderItems: all('order_items', 'id'),
      users: all('users', 'id'),
      sampleSales: all('sample_sales', 'id')
    }
  };
}
function makeBackup(type = 'auto', note = '') {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now().replace(/[:.]/g, '-');
  const filePath = path.join(backupDir, `twodrapes_${type}_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(exportBackupPayload(), null, 2), 'utf8');
  const info = db.prepare('INSERT INTO backups(backup_type,file_path,created_at,note) VALUES(?,?,?,?)').run(type, filePath, now(), note);
  return db.prepare('SELECT * FROM backups WHERE id=?').get(info.lastInsertRowid);
}
function pruneAutoBackups() {
  const rows = db.prepare("SELECT * FROM backups WHERE backup_type='auto' ORDER BY created_at DESC").all();
  rows.slice(10).forEach(r => {
    try { if (fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch {}
    db.prepare('DELETE FROM backups WHERE id=?').run(r.id);
  });
}
function importBackupPayload(payload) {
  const data = payload.data || payload;
  const tx = db.transaction(() => {
    for (const table of ['factory_feedback', 'order_items', 'orders', 'product_option_values', 'product_option_groups', 'product_width_prices', 'product_length_prices', 'product_archive', 'products', 'fabrics', 'linings', 'labor_rules', 'memory_rules', 'tax_rates', 'globals', 'users', 'sample_sales']) db.prepare(`DELETE FROM ${table}`).run();
    (data.globals || []).forEach(g => db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?)').run(g.key, g.value, g.value_type || 'text', g.note || '', g.updated_at || now()));
    (data.fabrics || []).forEach(f => db.prepare('INSERT INTO fabrics(id,name,series,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(f.id, f.name, f.series, f.width_cm, f.price_per_m, f.enabled, f.created_at || now(), f.updated_at || now()));
    (data.linings || []).forEach(l => db.prepare('INSERT INTO linings(id,name,color,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(l.id, l.name, l.color, l.width_cm, l.price_per_m, l.enabled, l.created_at || now(), l.updated_at || now()));
    const { upsertProduct } = require('./products');
    (data.products || []).forEach(upsertProduct);
    (data.productArchive || []).forEach(pa => db.prepare('INSERT OR IGNORE INTO product_archive(product_id,channel,archived_at) VALUES(?,?,?)').run(pa.product_id, pa.channel, pa.archived_at || now()));
    (data.taxRates || []).forEach(t => db.prepare('INSERT INTO tax_rates(code,state,rate,note) VALUES(?,?,?,?)').run(t.code, t.state, t.rate, t.note || ''));
    (data.laborRules || []).forEach((r, i) => db.prepare('INSERT INTO labor_rules(layer,min_m,max_m,rate_rmb_per_m,note,sort_order) VALUES(?,?,?,?,?,?)').run(r.layer, r.min_m, r.max_m, r.rate_rmb_per_m, r.note || '', r.sort_order ?? i));
    (data.memoryRules || []).forEach((r, i) => db.prepare('INSERT INTO memory_rules(min_m,max_m,single_rate_rmb,double_coef,manual_quote,note,sort_order) VALUES(?,?,?,?,?,?,?)').run(r.min_m, r.max_m, r.single_rate_rmb, r.double_coef, r.manual_quote, r.note || '', r.sort_order ?? i));
    // Restore orders and order_items
    (data.orders || []).forEach(o => {
      const cols = ['id','channel','order_no','order_date','delivery_date','customer_name','customer_email','customer_phone','customer_address','tax_state_code','tax_rate','remark','total_sales_usd','total_tax_usd','total_net_sales_rmb','total_cost_rmb','total_profit_rmb','total_profit_rate','created_at','updated_at','logistics_cost_rmb','paypal_fee_usd','actual_income_usd','sales_override_usd','tax_override_usd','status','logistics_provider','tracking_number','delivery_channel','weight_kg','delivered_date','shipping_date','shipping_cost','production_cost_override_rmb','reminder','reminder_text'];
      const vals = cols.map(c => o[c] ?? null);
      db.prepare(`INSERT INTO orders(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...vals);
    });
    (data.orderItems || []).forEach(item => {
      const cols = ['id','order_id','product_id','product_name','item_code','qty','width_in','length_in','fabric_id','fabric_name','lining_id','lining_name','fullness','room_label','actual_paid_usd','system_price_usd','sales_usd','tax_usd','net_sales_rmb','cost_rmb','profit_rmb','profit_rate','remark','created_at','updated_at','estimated_cost_rmb','final_cost_rmb','final_cost_source','factory_issued_usage_m','factory_actual_usage_m','factory_fabric_price_rmb','factory_labor_rmb','factory_memory_rmb','factory_cost_total_rmb','factory_settlement_rmb','production_cost_override_rmb','selected_options_json','calc_detail_json'];
      const vals = cols.map(c => item[c] ?? null);
      db.prepare(`INSERT INTO order_items(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...vals);
    });
    (data.users || []).forEach(u => db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,role,channel,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(u.id, u.username, u.password_hash, u.role || 'user', u.channel || 'shopify', u.created_at || now(), u.updated_at || now()));
    (data.sampleSales || []).forEach(s => db.prepare('INSERT INTO sample_sales(id,fabric_id,fabric_name,quantity,sold_at,price_usd,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(s.id, s.fabric_id, s.fabric_name, s.quantity, s.sold_at, s.price_usd, s.note || '', s.created_at || now()));
  });
  tx();
}

module.exports = { makeBackup, exportBackupPayload, importBackupPayload, pruneAutoBackups };

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const backupDir = path.join(dataDir, 'backups');
const exportDir = path.join(dataDir, 'exports');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });

const dbPath = process.env.TEST_DB || path.join(dataDir, 'twodrapes.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.transaction = (fn) => {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (e) { console.error('[DB] ROLLBACK failed:', e.message); }
      throw error;
    }
  };
};

function initDb() {
  db.exec(`
CREATE TABLE IF NOT EXISTS globals(key TEXT PRIMARY KEY,value TEXT,value_type TEXT,note TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS fabrics(id TEXT PRIMARY KEY,name TEXT,series TEXT,width_cm REAL,price_per_m REAL,enabled INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS linings(id TEXT PRIMARY KEY,name TEXT,color TEXT,width_cm REAL,price_per_m REAL,enabled INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT,channel TEXT DEFAULT 'shopify',factory_name TEXT,shopify_option_set TEXT,type TEXT,series TEXT,default_fabric_id TEXT,base_price REAL,default_fullness REAL,panels_per_unit REAL DEFAULT 1,enabled INTEGER,archived INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS product_width_prices(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT,size_in REAL,price_usd REAL,sort_order INTEGER,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS product_length_prices(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT,size_in REAL,price_usd REAL,sort_order INTEGER,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS product_option_groups(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT,option_key TEXT,label TEXT,source_name TEXT,type TEXT,required INTEGER,priceable INTEGER,costable INTEGER,factory INTEGER,sort_order INTEGER,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS product_option_values(id INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER,label TEXT,price_usd REAL,cost_rmb REAL,sort_order INTEGER,FOREIGN KEY(group_id) REFERENCES product_option_groups(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS product_archive(product_id TEXT NOT NULL,channel TEXT NOT NULL DEFAULT 'shopify',archived_at TEXT,PRIMARY KEY(product_id, channel));
CREATE TABLE IF NOT EXISTS labor_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,layer TEXT,min_m REAL,max_m REAL,rate_rmb_per_m REAL,note TEXT,sort_order INTEGER);
CREATE TABLE IF NOT EXISTS memory_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,min_m REAL,max_m REAL,single_rate_rmb REAL,double_coef REAL,manual_quote INTEGER,note TEXT,sort_order INTEGER);
CREATE TABLE IF NOT EXISTS tax_rates(code TEXT PRIMARY KEY,state TEXT,rate REAL,note TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT DEFAULT 'shopify',status TEXT DEFAULT 'production',order_no TEXT,order_date TEXT,delivery_date TEXT,customer_name TEXT,customer_email TEXT,customer_phone TEXT,customer_address TEXT,tax_state_code TEXT,tax_rate REAL,remark TEXT,total_sales_usd REAL,total_tax_usd REAL,total_net_sales_rmb REAL,total_cost_rmb REAL,total_profit_rmb REAL,total_profit_rate REAL,logistics_provider TEXT,tracking_number TEXT,delivery_channel TEXT,weight_kg REAL,logistics_cost_rmb REAL DEFAULT 0,paypal_fee_usd REAL DEFAULT 0,actual_income_usd REAL DEFAULT 0,sales_override_usd REAL,tax_override_usd REAL,delivered_date TEXT,shipping_date TEXT,shipping_cost REAL,production_cost_override_rmb REAL,reminder INTEGER DEFAULT 0,reminder_text TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,product_id TEXT,product_name TEXT,item_code TEXT UNIQUE,qty INTEGER,width_in REAL,length_in REAL,fabric_id TEXT,fabric_name TEXT,lining_id TEXT,lining_name TEXT,fullness REAL,room_label TEXT,actual_paid_usd REAL,system_price_usd REAL,sales_usd REAL,tax_usd REAL,net_sales_rmb REAL,cost_rmb REAL,estimated_cost_rmb REAL DEFAULT 0,final_cost_rmb REAL DEFAULT 0,final_cost_source TEXT DEFAULT 'estimated',factory_issued_usage_m REAL,factory_actual_usage_m REAL,factory_fabric_price_rmb REAL,factory_labor_rmb REAL,factory_memory_rmb REAL,factory_cost_total_rmb REAL,factory_settlement_rmb REAL,production_cost_override_rmb REAL,profit_rmb REAL,profit_rate REAL,calc_detail_json TEXT,selected_options_json TEXT,remark TEXT,created_at TEXT,updated_at TEXT,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS factory_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,order_item_id INTEGER UNIQUE,item_code TEXT,material TEXT,width_cm REAL,length_cm REAL,qty INTEGER,planned_meters TEXT,actual_meters REAL,fabric_unit_price REAL,labor_fee TEXT,memory_fee REAL,total_cost REAL,settlement_cost REAL,lining_material TEXT,lining_actual_meters REAL,lining_unit_price REAL,lining_labor_fee REAL,lining_memory_fee REAL,lining_total_cost REAL,lining_settlement_cost REAL,completed_at TEXT,remark TEXT,created_at TEXT,updated_at TEXT,FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS backups(id INTEGER PRIMARY KEY AUTOINCREMENT,backup_type TEXT,file_path TEXT,created_at TEXT,note TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,username TEXT NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,display_name TEXT,role TEXT DEFAULT 'operator',enabled INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT,UNIQUE(channel, username));
CREATE TABLE IF NOT EXISTS sample_sales(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL DEFAULT 'shopify',product_id TEXT,fabric_name TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,amount_usd REAL NOT NULL DEFAULT 0,sale_date TEXT,remark TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_items_code ON order_items(item_code);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
`);
  runMigrations();
}



function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'scripts', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();
  for (const file of files) {
    try {
      const migrate = require(path.join(migrationsDir, file));
      if (typeof migrate === 'function') migrate(db);
    } catch (e) {
      console.error(`Migration ${file} failed:`, e.message);
      process.exit(1);
    }
  }
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM globals').get().c;
  if (!count) require('../scripts/seed-defaults').seed(db);
  ensureDefaultGlobals();
}

function ensureDefaultGlobals() {
  const defaults = require('../scripts/seed-defaults').globals;
  const now = new Date().toISOString();
  // Use upsert: insert new keys, but never overwrite existing non-empty values
  for (const [key, value] of Object.entries(defaults)) {
    const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
    const existing = db.prepare('SELECT value FROM globals WHERE key = ?').get(key);
    if (!existing || existing.value === '' || existing.value == null) {
      db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, value_type=excluded.value_type, updated_at=excluded.updated_at')
        .run(key, String(value), type, '', now);
    }
  }
}

module.exports = { db, dbPath, dataDir, backupDir, exportDir, initDb, seedIfEmpty };

#!/usr/bin/env node
/**
 * 导出所有业务数据为 JSON 文件
 * 用法: node scripts/export-data.js [输出路径]
 * 示例: node scripts/export-data.js ../backup-2026-06-11.json
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const OUTPUT = process.argv[2] || path.join(__dirname, '..', 'data', `twodrapes_backup_${new Date().toISOString().slice(0, 10)}.json`);

const EXPORT_TABLES = [
  'globals',
  'fabrics',
  'linings',
  'products',
  'product_width_prices',
  'product_length_prices',
  'product_option_groups',
  'product_option_values',
  'labor_rules',
  'memory_rules',
  'tax_rates',
  'orders',
  'order_items',
  'factory_feedback',
  'sample_sales',
  'users'
];

const data = { exported_at: new Date().toISOString(), version: 1, tables: {} };

for (const table of EXPORT_TABLES) {
  try {
    data.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  } catch (e) {
    console.warn(`  跳过 ${table}: ${e.message}`);
  }
}

// 统计
let totalRows = 0;
const summary = {};
for (const [table, rows] of Object.entries(data.tables)) {
  summary[table] = rows.length;
  totalRows += rows.length;
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), 'utf8');

console.log('');
console.log('=========================================');
console.log('  数据导出完成');
console.log('=========================================');
console.log('');
console.log(`  文件: ${OUTPUT}`);
console.log(`  大小: ${(fs.statSync(OUTPUT).size / 1024).toFixed(1)} KB`);
console.log(`  总行数: ${totalRows}`);
console.log('');
for (const [table, count] of Object.entries(summary)) {
  if (count > 0) console.log(`  ${table}: ${count} 行`);
}
console.log('');

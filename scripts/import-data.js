#!/usr/bin/env node
/**
 * 从 JSON 备份文件导入所有业务数据
 * 用法: node scripts/import-data.js <备份文件路径>
 * 示例: node scripts/import-data.js ../backup-2026-06-11.json
 *
 * 注意: 此脚本会覆盖同名记录，不会删除多余记录
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const INPUT = process.argv[2];
if (!INPUT) {
  console.error('用法: node scripts/import-data.js <备份文件路径>');
  console.error('示例: node scripts/import-data.js ../twodrapes_backup_2026-06-11.json');
  process.exit(1);
}

if (!fs.existsSync(INPUT)) {
  console.error(`文件不存在: ${INPUT}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!data.tables) {
  console.error('无效的备份文件格式');
  process.exit(1);
}

// 导入顺序：先基础数据，再关联数据
const IMPORT_ORDER = [
  'globals',
  'fabrics',
  'linings',
  'tax_rates',
  'labor_rules',
  'memory_rules',
  'products',
  'product_width_prices',
  'product_length_prices',
  'product_option_groups',
  'product_option_values',
  'users',
  'orders',
  'order_items',
  'factory_feedback',
  'sample_sales'
];

let totalImported = 0;
let totalSkipped = 0;

function upsertColumns(table) {
  // 获取表的列信息
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  return cols;
}

function importTable(table, rows) {
  if (!rows || !rows.length) return { imported: 0, skipped: 0 };

  const cols = upsertColumns(table);
  const validRows = rows.filter(row => {
    // 只保留表中存在的列
    const keys = Object.keys(row).filter(k => cols.includes(k));
    return keys.length > 0;
  });

  if (!validRows.length) return { imported: 0, skipped: rows.length };

  // 使用事务批量导入
  const result = db.transaction(() => {
    let imported = 0;
    let skipped = 0;

    for (const row of validRows) {
      try {
        const keys = Object.keys(row).filter(k => cols.includes(k));
        const values = keys.map(k => row[k]);

        // 构建 UPSERT 语句
        const placeholders = keys.map(() => '?').join(',');
        const updateSet = keys.map(k => `${k}=excluded.${k}`).join(',');

        // 用 id 或第一个列作为冲突判断
        const conflictCol = cols.includes('id') ? 'id' : keys[0];

        const sql = `INSERT INTO ${table}(${keys.join(',')}) VALUES(${placeholders})
          ON CONFLICT(${conflictCol}) DO UPDATE SET ${updateSet}`;

        db.prepare(sql).run(...values);
        imported++;
      } catch (e) {
        skipped++;
        if (skipped <= 3) console.warn(`  ${table} 行导入失败: ${e.message}`);
      }
    }

    return { imported, skipped };
  })();

  return result;
}

console.log('');
console.log('=========================================');
console.log('  数据导入');
console.log(`  备份文件: ${INPUT}`);
console.log(`  备份时间: ${data.exported_at || '未知'}`);
console.log('=========================================');
console.log('');

for (const table of IMPORT_ORDER) {
  const rows = data.tables[table];
  if (!rows) continue;

  const { imported, skipped } = importTable(table, rows);
  totalImported += imported;
  totalSkipped += skipped;

  const parts = [];
  if (imported > 0) parts.push(`${imported} 导入`);
  if (skipped > 0) parts.push(`${skipped} 跳过`);
  console.log(`  ${table}: ${parts.join(', ')}`);
}

console.log('');
console.log('=========================================');
console.log(`  导入完成: ${totalImported} 条记录`);
if (totalSkipped > 0) console.log(`  跳过: ${totalSkipped} 条`);
console.log('=========================================');
console.log('');

const XLSX = require('xlsx');
const { stringify } = require('csv-stringify/sync');
const { parse } = require('csv-parse/sync');
const { db } = require('../db');

function n(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : fallback;
}
function optionalNumber(v) {
  if (v == null || v === '') return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function parseJson(s, fallback = {}) {
  try { return JSON.parse(s || ''); } catch { return fallback; }
}
function cm(inch) { return Math.round((Number(inch) || 0) * 2.54 * 100) / 100; }
function pick(row, aliases) {
  for (const key of aliases) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}
function yn(v) { return v ? '是' : '否'; }
function productionHeader(options) {
  return options.hanging_header_style || options.header_style || options.header || '';
}
function productionTieback(options) {
  const v = options.tieback || '';
  return /no need|without|no|无/i.test(v) ? '否' : (v || '否');
}
function productionMemory(options) {
  const v = options.memory_shaped || '';
  return /without|no|无/i.test(v) ? '否' : '是';
}
function normalizeCode(code) {
  return String(code || '').replace(/\s+/g, '').trim();
}

function listFactoryOrders() {
  const rows = db.prepare(`
    SELECT oi.*, o.channel, o.status AS order_status, o.order_no, o.order_date, o.delivery_date, o.remark AS order_remark,
           ff.planned_meters, ff.actual_meters, ff.fabric_unit_price, ff.labor_fee, ff.memory_fee,
           ff.total_cost, ff.settlement_cost, ff.completed_at, ff.remark AS feedback_remark,
           ff.lining_material, ff.lining_actual_meters, ff.lining_unit_price, ff.lining_labor_fee,
           ff.lining_memory_fee, ff.lining_total_cost, ff.lining_settlement_cost
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN factory_feedback ff ON ff.order_item_id=oi.id
    ORDER BY o.created_at ASC, oi.id ASC
  `).all();
  return rows.map(row => {
    const calc = parseJson(row.calc_detail_json);
    const options = parseJson(row.selected_options_json);
    const breakdown = calc.costBreakdown || {};
    return {
      order_item_id: row.id,
      order_id: row.order_id,
      channel: row.channel || 'shopify',
      status: row.order_status || 'production',
      order_no: row.order_no,
      order_date: row.order_date,
      delivery_date: row.delivery_date,
      item_code: row.item_code,
      product_name: row.product_name,
      factory_name: calc.product?.factory_name || calc.product?.factoryName || row.product_name,
      material: row.fabric_name,
      lining: row.lining_name,
      header_style: productionHeader(options),
      width_cm: cm(row.width_in),
      length_cm: cm(row.length_in),
      qty: row.qty,
      actual_panel_qty: breakdown.actualPanelQty || calc.actualPanelQty || row.qty,
      fullness: row.fullness,
      memory: productionMemory(options),
      tieback: productionTieback(options),
      room_label: row.room_label || '',
      estimated_usage_m: breakdown.mainFabricTheoreticalUsageM || calc.mainPlan?.theoreticalUsageM || '',
      issued_usage_m: breakdown.mainFabricIssuedUsageM || calc.mainPlan?.issuedUsageM || calc.mainPlan?.fabricMeters || '',
      splice_required: breakdown.spliceRequired ?? calc.mainPlan?.spliceRequired ?? calc.mainPlan?.needSplice,
      memory_required: breakdown.memoryRequired ?? productionMemory(options) === '是',
      labor_fee_estimated: breakdown.estimatedLaborRmb ?? calc.laborCostRmb ?? '',
      memory_fee_estimated: breakdown.estimatedMemoryRmb ?? calc.memoryCostRmb ?? '',
      cost_total_estimated: row.estimated_cost_rmb || calc.estimatedCostRmb || calc.finalCostRmb || '',
      settlement_cost_estimated: '',
      notes: [row.remark, row.order_remark, (calc.warnings || []).join('；')].filter(Boolean).join('；'),
      factory_issued_usage_m: row.planned_meters,
      actual_meters: row.actual_meters,
      fabric_unit_price: row.fabric_unit_price,
      labor_fee: row.labor_fee,
      memory_fee: row.memory_fee,
      total_cost: row.total_cost,
      settlement_cost: row.settlement_cost,
      completed_at: row.completed_at,
      feedback_remark: row.feedback_remark,
      lining_material: row.lining_material,
      lining_actual_meters: row.lining_actual_meters,
      lining_unit_price: row.lining_unit_price,
      lining_labor_fee: row.lining_labor_fee,
      lining_memory_fee: row.lining_memory_fee,
      lining_total_cost: row.lining_total_cost,
      lining_settlement_cost: row.lining_settlement_cost
    };
  });
}

function feedbackRowsForExport() {
  const orders = listFactoryOrders();
  const rows = [];
  for (const r of orders) {
    const hasLining = r.lining && r.lining !== '无内衬' && r.lining !== 'Unlined';
    // Main fabric row
    rows.push({
      '订单号': r.order_no,
      '订单时间': r.order_date,
      '品名/编号': r.item_code,
      '产品': r.product_name,
      '顶部工艺/配件': r.header_style,
      '面料名称': r.material,
      '内衬名称': hasLining ? r.lining : '',
      '宽度cm': r.width_cm,
      '高度cm': r.length_cm,
      '数量': r.qty,
      '实际片数': r.actual_panel_qty,
      '预计用料米数': r.estimated_usage_m,
      '发料用料米数': r.factory_issued_usage_m ?? '',
      '是否拼接': yn(r.splice_required),
      '是否定型': yn(r.memory_required),
      '是否需要系带': r.tieback,
      '加工费': r.labor_fee ?? r.labor_fee_estimated ?? '',
      '定型费': r.memory_fee ?? r.memory_fee_estimated ?? '',
      '成本合计': r.total_cost ?? r.cost_total_estimated ?? '',
      '结算': r.settlement_cost ?? '',
      '_lining': false,
      '_itemCode': r.item_code
    });
    // Lining row for double-layer
    if (hasLining) {
      rows.push({
        '订单号': '',
        '订单时间': '',
        '品名/编号': r.item_code,
        '产品': '',
        '顶部工艺/配件': '',
        '面料名称': r.lining_material || r.lining,
        '内衬名称': '',
        '宽度cm': '',
        '高度cm': '',
        '数量': '',
        '实际片数': '',
        '预计用料米数': '',
        '发料用料米数': '',
        '是否拼接': '',
        '是否定型': '',
        '是否需要系带': '',
        '加工费': r.lining_labor_fee ?? '',
        '定型费': r.lining_memory_fee ?? '',
        '成本合计': r.lining_total_cost ?? '',
        '结算': r.lining_settlement_cost ?? '',
        '_lining': true,
        '_itemCode': r.item_code
      });
    }
  }
  return rows;
}

function listFeedbackRows() {
  return db.prepare(`
    SELECT ff.*, oi.order_id, o.order_no
    FROM factory_feedback ff
    LEFT JOIN order_items oi ON oi.id=ff.order_item_id
    LEFT JOIN orders o ON o.id=oi.order_id
    ORDER BY ff.updated_at DESC, ff.id DESC
  `).all().map(r => ({
    id: r.id,
    order_id: r.order_id,
    order_item_id: r.order_item_id,
    order_no: r.order_no || '',
    item_code: r.item_code,
    actual_meters: r.actual_meters,
    fabric_unit_price: r.fabric_unit_price,
    labor_fee: r.labor_fee,
    memory_fee: r.memory_fee,
    total_cost: r.total_cost,
    settlement_cost: r.settlement_cost,
    completed_at: r.completed_at,
    remark: r.remark,
    lining_material: r.lining_material,
    lining_actual_meters: r.lining_actual_meters,
    lining_unit_price: r.lining_unit_price,
    lining_labor_fee: r.lining_labor_fee,
    lining_memory_fee: r.lining_memory_fee,
    lining_total_cost: r.lining_total_cost,
    lining_settlement_cost: r.lining_settlement_cost
  }));
}

function upsertFeedback(row, liningRow = null) {
  const code = normalizeCode(pick(row, ['品名/编号', 'item_code']));
  if (!code) return false;
  const item = db.prepare('SELECT id,item_code FROM order_items').all().find(x => normalizeCode(x.item_code) === code);

  // Main fabric fields
  const issuedMeters = pick(row, ['用料米数', '发料用料米数', 'planned_meters', 'factory_issued_usage_m']);
  const actualMeters = pick(row, ['实际用料米数', 'actual_meters', 'factory_actual_usage_m']);
  const fabricUnitPrice = pick(row, ['面料单价', 'fabric_unit_price', 'factory_fabric_price_rmb']);
  const laborFee = pick(row, ['加工', 'labor_fee', 'factory_labor_rmb']);
  const memoryFee = pick(row, ['定型', 'memory_fee', 'factory_memory_rmb']);
  const totalCost = pick(row, ['工厂成本合计', '成本合计', 'total_cost', 'factory_cost_total_rmb']);
  const settlementCost = pick(row, ['工厂结算', '结算', 'settlement_cost', 'factory_settlement_rmb']);

  // Lining fields
  const liningMaterial = liningRow ? pick(liningRow, ['面料名称', '面料', 'material']) : null;
  const liningActualMeters = liningRow ? optionalNumber(pick(liningRow, ['实际用料米数', 'actual_meters'])) : null;
  const liningUnitPrice = liningRow ? optionalNumber(pick(liningRow, ['面料单价', 'fabric_unit_price'])) : null;
  const liningLaborFee = liningRow ? pick(liningRow, ['加工', 'labor_fee']) : null;
  const liningMemoryFee = liningRow ? optionalNumber(pick(liningRow, ['定型', 'memory_fee'])) : null;
  const liningTotalCost = liningRow ? optionalNumber(pick(liningRow, ['工厂成本合计', '成本合计', 'total_cost'])) : null;
  const liningSettlementCost = liningRow ? optionalNumber(pick(liningRow, ['工厂结算', '结算', 'settlement_cost'])) : null;

  const ts = new Date().toISOString();
  const existing = item
    ? db.prepare('SELECT id FROM factory_feedback WHERE order_item_id=?').get(item.id)
    : db.prepare('SELECT id FROM factory_feedback WHERE order_item_id IS NULL AND item_code=? ORDER BY id DESC LIMIT 1').get(code);

  if (existing) {
    db.prepare(`
      UPDATE factory_feedback SET order_item_id=?,item_code=?,material=?,width_cm=?,length_cm=?,qty=?,planned_meters=?,
        actual_meters=?,fabric_unit_price=?,labor_fee=?,memory_fee=?,total_cost=?,settlement_cost=?,completed_at=?,remark=?,
        lining_material=?,lining_actual_meters=?,lining_unit_price=?,lining_labor_fee=?,lining_memory_fee=?,lining_total_cost=?,lining_settlement_cost=?,
        updated_at=?
      WHERE id=?
    `).run(
      item?.id || null,
      item?.item_code || code,
      pick(row, ['面料名称', '面料', 'material']),
      optionalNumber(pick(row, ['宽度cm', 'width_cm'])),
      optionalNumber(pick(row, ['高度cm', 'length_cm'])),
      optionalNumber(pick(row, ['数量', 'qty'])),
      issuedMeters === '' ? '' : String(issuedMeters),
      optionalNumber(actualMeters),
      optionalNumber(fabricUnitPrice),
      laborFee === '' ? '' : String(laborFee),
      optionalNumber(memoryFee),
      optionalNumber(totalCost),
      optionalNumber(settlementCost),
      pick(row, ['完成时间', 'completed_at']),
      pick(row, ['工厂备注', '备注', 'remark']),
      liningMaterial,
      liningActualMeters,
      liningUnitPrice,
      liningLaborFee === '' ? null : (liningLaborFee != null ? String(liningLaborFee) : null),
      liningMemoryFee,
      liningTotalCost,
      liningSettlementCost,
      ts,
      existing.id
    );
  } else {
    db.prepare(`
      INSERT INTO factory_feedback(order_item_id,item_code,material,width_cm,length_cm,qty,planned_meters,
        actual_meters,fabric_unit_price,labor_fee,memory_fee,total_cost,settlement_cost,completed_at,remark,
        lining_material,lining_actual_meters,lining_unit_price,lining_labor_fee,lining_memory_fee,lining_total_cost,lining_settlement_cost,
        created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      item?.id || null,
      item?.item_code || code,
      pick(row, ['面料名称', '面料', 'material']),
      optionalNumber(pick(row, ['宽度cm', 'width_cm'])),
      optionalNumber(pick(row, ['高度cm', 'length_cm'])),
      optionalNumber(pick(row, ['数量', 'qty'])),
      issuedMeters === '' ? '' : String(issuedMeters),
      optionalNumber(actualMeters),
      optionalNumber(fabricUnitPrice),
      laborFee === '' ? '' : String(laborFee),
      optionalNumber(memoryFee),
      optionalNumber(totalCost),
      optionalNumber(settlementCost),
      pick(row, ['完成时间', 'completed_at']),
      pick(row, ['工厂备注', '备注', 'remark']),
      liningMaterial,
      liningActualMeters,
      liningUnitPrice,
      liningLaborFee === '' ? null : (liningLaborFee != null ? String(liningLaborFee) : null),
      liningMemoryFee,
      liningTotalCost,
      liningSettlementCost,
      ts, ts
    );
  }
  return true;
}

function importFeedback(buffer, filename = '') {
  let rows;
  if (/\.(xlsx|xls)$/i.test(filename)) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const firstRowHeader = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    rows = firstRowHeader.some(row => row['品名/编号'] || row.item_code)
      ? firstRowHeader
      : XLSX.utils.sheet_to_json(sheet, { defval: '', range: 1 });
  } else {
    rows = parse(buffer.toString('utf8').replace(/^﻿/, ''), { columns: true, skip_empty_lines: true, bom: true });
  }

  // Group rows by item_code to detect double-layer (consecutive rows with same code)
  let imported = 0;
  let unmatched = 0;
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const code = normalizeCode(pick(row, ['品名/编号', 'item_code']));
    if (!code) { i++; continue; }

    // Check if next row is lining (same item_code)
    let liningRow = null;
    if (i + 1 < rows.length) {
      const nextCode = normalizeCode(pick(rows[i + 1], ['品名/编号', 'item_code']));
      if (nextCode === code) {
        liningRow = rows[i + 1];
        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }

    const matched = code && db.prepare('SELECT id,item_code FROM order_items').all().some(x => normalizeCode(x.item_code) === code);
    if (upsertFeedback(row, liningRow)) {
      imported++;
      if (!matched) unmatched++;
    }
  }
  return { imported, unmatched, total: rows.length };
}

function deleteFeedback(ids = []) {
  const cleanIds = ids.map(id => Number(id)).filter(Number.isFinite);
  if (!cleanIds.length) return { deleted: 0 };
  const placeholders = cleanIds.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM factory_feedback WHERE id IN (${placeholders})`).run(...cleanIds);
  return { deleted: result.changes };
}

function deleteAllFeedback() {
  const result = db.prepare('DELETE FROM factory_feedback').run();
  return { deleted: result.changes };
}

function exportFeedbackXlsx() {
  const wb = XLSX.utils.book_new();
  const data = feedbackRowsForExport();
  const headers = ['订单号', '订单时间', '品名/编号', '产品', '顶部工艺/配件', '面料名称', '内衬名称',
    '宽度cm', '高度cm', '数量', '实际片数', '预计用料米数', '发料用料米数', '是否拼接', '是否定型',
    '是否需要系带', '加工费', '定型费', '成本合计', '结算'];

  const aoa = [headers];
  const merges = [];
  for (const row of data) {
    const isLining = row._lining;
    const vals = headers.map(h => row[h] ?? '');
    aoa.push(vals);

    if (!isLining) {
      const rowIdx = aoa.length - 1;
      // Check if next row is lining for same item
      const nextIdx = aoa.length;
      if (nextIdx < data.length && data[nextIdx]._lining && data[nextIdx]._itemCode === row._itemCode) {
        // Merge shared columns: A(0), B(1), C(2), D(3), E(4), G(6), H(7), I(8), J(9)
        for (const col of [0, 1, 2, 3, 4, 6, 7, 8, 9]) {
          merges.push({ s: { r: rowIdx, c: col }, e: { r: rowIdx + 1, c: col } });
        }
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = headers.map(h => ({ wch: Math.max(10, Math.min(24, String(h).length * 2 + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, '加工费用确认单');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportFeedbackCsv() {
  const data = feedbackRowsForExport();
  const headers = ['订单号', '订单时间', '品名/编号', '产品', '顶部工艺/配件', '面料名称', '内衬名称',
    '宽度cm', '高度cm', '数量', '实际片数', '预计用料米数', '发料用料米数', '是否拼接', '是否定型',
    '是否需要系带', '加工费', '定型费', '成本合计', '结算'];
  const rows = data.map(row => {
    const obj = {};
    for (const h of headers) obj[h] = row[h] ?? '';
    return obj;
  });
  return stringify(rows, { header: true, bom: true });
}

module.exports = { listFactoryOrders, listFeedbackRows, feedbackRowsForExport, importFeedback, deleteFeedback, deleteAllFeedback, exportFeedbackXlsx, exportFeedbackCsv };

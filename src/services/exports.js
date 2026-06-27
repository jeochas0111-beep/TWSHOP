function pct(v) { return `${((Number(v) || 0) * 100).toFixed(1)}%`; }
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function calc(item) { return item.calc_detail || JSON.parse(item.calc_detail_json || '{}'); }
function selected(item) { return item.selected_options || JSON.parse(item.selected_options_json || '{}'); }
function sourceLabel(source) {
  if (source === 'factory_settlement') return '工厂结算';
  if (source === 'factory_cost_total') return '工厂成本合计';
  return '系统预计';
}
function isNoLining(label) {
  return /^(unlined|no lining|without lining|none|无内衬|不需要|no)$/i.test(String(label || '').trim());
}
function isNoTieback(label) {
  return /^(no need|without|no|无|不需要)$/i.test(String(label || '').trim());
}

// ===== English → Chinese mappings =====
const COLOR_MAP = {
  'snow white': '雪白', 'natural': '本色', 'ivory': '象牙白',
  'light grey': '浅灰', 'dark grey': '深灰', 'black': '黑色',
  'beige': '米色', 'white': '白色', 'cream': '奶油色',
  'grey': '灰色', 'tan': '棕褐', 'navy': '藏蓝',
};

const HEADER_STYLE_MAP = {
  'pinch pleat': '韩褶', '2x pinch pleat': '双层韩褶',
  'pinch pleat + curtain ring': '韩褶+打环', '2x pinch pleat + curtain ring': '双层韩褶+打环',
  'pinch pleat + back tab': '韩褶+暗袢', '2x pinch pleat + back tab': '双层韩褶+暗袢',
  'back tab': '暗袢', '2x back tab': '双层暗袢',
  'curtain ring': '打环', '2x curtain ring': '双层打环',
  'rod pocket': '穿杆', 'grommet': '打孔',
  'header tape': '顶部工艺带', 'eyelet': '鸡眼',
};

const MEMORY_MAP = {
  'without memory training': '否', 'no': '否', 'without': '否',
  'add memory training': '是', 'yes': '是', '需要': '是',
};

const TIEBACK_MAP = {
  'no need': '否', 'without': '否', 'no': '否',
  'yes need the matching tieback': '是', 'yes': '是', '需要': '是',
};

function mapColor(en) {
  if (!en) return '';
  const key = String(en).trim().toLowerCase();
  return COLOR_MAP[key] || en;
}

function mapHeaderStyle(en) {
  if (!en) return { craft: '', accessory: '' };
  const raw = String(en).trim();
  const lower = raw.toLowerCase();
  // Extract accessory from parentheses: "2X Pinch Pleat (Black Rings)" → craft="2X Pinch Pleat", accessory="Black Rings"
  let accessory = '';
  const parenMatch = raw.match(/\(([^)]+)\)/);
  if (parenMatch) {
    accessory = parenMatch[1].trim();
    raw.replace(parenMatch[0], '').trim();
  }
  const craftPart = raw.replace(/\([^)]*\)/, '').trim();
  const craftKey = craftPart.toLowerCase().replace(/\s+/g, ' ');
  const craft = HEADER_STYLE_MAP[craftKey] || craftPart;
  return { craft, accessory };
}

function mapMemory(en) {
  if (!en) return '否';
  const key = String(en).trim().toLowerCase();
  return MEMORY_MAP[key] || (/without|no|无/i.test(en) ? '否' : '是');
}

function mapTieback(en) {
  if (!en) return '否';
  const key = String(en).trim().toLowerCase();
  return TIEBACK_MAP[key] || (/no need|without|no|无|不需要/i.test(en) ? '否' : '是');
}

function inchToCm(inch) {
  const v = Number(inch);
  return Number.isFinite(v) ? Math.round(v * 2.54) : '';
}

function buildDetailCraft(craft, hasLining) {
  const layer = hasLining ? '双层' : '单层';
  const liningHem = hasLining ? '7公分（内衬底边2公分）' : '5公分';
  const topHem = hasLining ? '8CM' : '10公分';
  const liningNote = hasLining ? '无纺布' : '150g无纺布包衬';
  const craftDesc = {
    '单层暗袢': `上${topHem}${liningNote}，底边卷边${liningHem}，侧边各卷2公分。下单宽度为成品宽度，上4公分袢，袢间距离需均分。水洗标在左侧第一个暗袢和第二个暗袢中间，上通用水洗标。`,
    '双层暗袢': `上${topHem}${liningNote}，底边卷边${liningHem}（内衬底边2公分），侧边各卷2公分。下单宽度为成品宽度，上4公分袢，袢间距离需均分。水洗标在左侧第一个暗袢和第二个暗袢中间，上通用水洗标。`,
    '韩褶': `上${topHem}${liningNote}，底边卷边${liningHem}，侧边各卷2公分。下单宽度为左侧第一个韩褶到右侧第一个韩褶距离，侧边折叠后需与韩褶齐平。上通用水洗标，水洗标在左侧第一个韩褶与第二个韩褶中间。`,
    '双层韩褶': `上${topHem}${liningNote}，底边卷边${liningHem}（内衬底边2公分），侧边各卷2公分。下单宽度为左侧第一个韩褶到右侧第一个韩褶距离，侧边折叠后需与韩褶齐平。上通用水洗标，水洗标在左侧第一个韩褶与第二个韩褶中间。`,
    '韩褶+暗袢': `上${topHem}${liningNote}，底边卷边${liningHem}，侧边各卷2公分。下单宽度为左侧第一个韩褶到右侧第一个韩褶距离，侧边折叠后需与韩褶齐平。每个韩哲左侧靠齐上2.5公分袢，上通用水洗标，水洗标在左侧第一个韩褶与第二个韩褶中间。`,
    '双层韩褶+暗袢': `上${topHem}${liningNote}，底边卷边${liningHem}（内衬底边2公分），侧边各卷2公分。下单宽度为左侧第一个韩褶到右侧第一个韩褶距离，侧边折叠后需与韩褶齐平。每个韩哲左侧靠齐上1.5公分袢，上通用水洗标，水洗标在左侧第一个韩褶与第二个韩褶中间。`,
    '打环': `上${topHem}${liningNote}，底边卷边${liningHem}，侧边各卷2公分。下单宽度为成品宽度，左右侧边距离第一个环4公分，环距离均分。上通用水洗标，水洗标在左侧第一个环与第二个环中间。`,
    '双层打环': `上${topHem}${liningNote}，底边卷边${liningHem}（内衬底边2公分），侧边各卷2公分。下单宽度为成品宽度，左右侧边距离第一个环4公分，环距离均分。上通用水洗标，水洗标在左侧第一个环与第二个环中间。`,
  };
  return craftDesc[craft] || '';
}

function factoryRows(order) {
  return order.items.map(item => {
    const c = calc(item), s = selected(item);
    const hasLining = !isNoLining(item.lining_name);
    const fabricName = c.fabric?.name || item.fabric_name || '';

    const color = mapColor(s.color || '');
    const { craft, accessory } = mapHeaderStyle(s.hanging_header_style || s.header_style || s.header || '');
    const memory = mapMemory(s.memory_shaped || '');
    const tieback = mapTieback(s.tieback || s.matching_tieback || '');
    const detailCraft = buildDetailCraft(craft, hasLining);

    const widthCm = inchToCm(item.width_in);
    const heightCm = inchToCm(item.length_in);
    const size = widthCm && heightCm ? `${widthCm}x${heightCm}cm` : '';

    return {
      '下单日期': order.order_date || '',
      '订单号': order.order_no || '',
      '面料名称': fabricName,
      '内衬/颜色': hasLining ? (item.lining_name || '') : (color || '无内衬'),
      '顶部工艺': craft,
      '配件': accessory,
      '宽(cm)': widthCm,
      '高(cm)': heightCm,
      '需做条数': item.qty,
      '是否需要记忆定型': memory,
      '是否需要绑带': tieback,
      '韩褶数/打孔数/暗袢数': '',
      '是否需要铅块': hasLining ? '不需要' : '需要',
      '详细工艺': detailCraft,
      '交期': order.delivery_date || '',
      '项目备注': item.remark || ''
    };
  });
}

function costRows(order) {
  return order.items.map(item => {
    const c = calc(item), b = c.costBreakdown || {};
    return {
      '订单号': order.order_no,
      '项目编号': item.item_code,
      '产品': item.product_name,
      'Width': item.width_in,
      'Length': item.length_in,
      '数量': item.qty,
      '实际片数': b.actualPanelQty || c.actualPanelQty || item.qty,
      '系统售价 USD': item.system_price_usd,
      '实际成交 USD': item.sales_usd,
      '税费 USD': item.tax_usd,
      '主面料理论用料 m': b.mainFabricTheoreticalUsageM || 0,
      '主面料发料用料 m': b.mainFabricIssuedUsageM || 0,
      '主面料单价 RMB/m': b.mainFabricUnitPriceRmb || 0,
      '主面料成本 RMB': c.mainFabricCostRmb || 0,
      '内衬理论用料 m': b.liningTheoreticalUsageM || 0,
      '内衬发料用料 m': b.liningIssuedUsageM || 0,
      '内衬单价 RMB/m': b.liningUnitPriceRmb || 0,
      '内衬成本 RMB': c.liningCostRmb || 0,
      '加工费 RMB': c.laborCostRmb || 0,
      '拼接费 RMB': c.spliceFeeRmb || 0,
      '定型费 RMB': c.memoryCostRmb || 0,
      '选项成本 RMB': c.optionCostRmb || 0,
      '系统预计成本 RMB': item.estimated_cost_rmb || c.estimatedCostRmb || 0,
      '工厂成本合计 RMB': item.factory_cost_total_rmb || '',
      '工厂结算 RMB': item.factory_settlement_rmb || '',
      '最终采用成本 RMB': item.final_cost_rmb || item.cost_rmb,
      '最终成本来源': sourceLabel(item.final_cost_source),
      '利润 RMB': item.profit_rmb,
      '利润率': pct(item.profit_rate)
    };
  });
}
module.exports = { factoryRows, costRows };

const $ = id => document.getElementById(id);
function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const APP_CONTEXT = window.TwodrapesAppContext || {};
const API_BASE = APP_CONTEXT.apiBase || window.location.origin;
const ORDER_CHANNEL = APP_CONTEXT.channel === 'amazon' ? 'amazon' : 'shopify';
const CHANNEL_LABEL = ORDER_CHANNEL === 'amazon' ? '亚马逊端' : '独立站端';
let USD_RMB_RATE = 6.8;
const INCH_TO_CM = 2.54;
const state = { globals: {}, products: [], fabrics: [], linings: [], laborRules: [], memoryRules: [], taxRates: [], features: {}, currentItems: [], lastOrderId: null, preview: null, ordersSizeUnit: localStorage.getItem('twodrapes_orders_size_unit') || 'inch', profitOrderChoices: [], spliceOrderChoices: [], spliceSelectedOrderId: '', ordersCache: [], ordersPage: 1, ordersPageSize: 50, selectedOrderIds: new Set(), analytics: { shopify: null, amazon: null, productSort: { shopify: 'income', amazon: 'income' }, activeChannel: 'shopify' } };
const fmt = (n, d = 2) => (Number(n) || 0).toFixed(d);
const usd = n => `$${fmt(n)}`;
const rmb = n => `¥${fmt(n)}`;
const pct = n => `${fmt((Number(n) || 0) * 100, 1)}%`;
const esc = s => String(s ?? '').replace(/[&<>"'`]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#96;' }[m]));
const num = n => Number(n) || 0;
let PAYPAL_FEE_RATE = 0.044;
const normalizeItemCode = (code) => String(code || '').replace(/^(定制-?|定制-)/, '定制-');
const optionKeyFromLabel = s => String(s || 'option').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `option_${Date.now()}`;
const today = () => new Date().toISOString().slice(0, 10);
const optionEditor = { groups: [], activeIndex: 0 };
const optionDragState = { fromIndex: null };

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

function authHeaders() {
  const headers = {};
  const token = localStorage.getItem('twodrapes_token');
  if (APP_CONTEXT.app) headers['X-Twodrapes-App'] = APP_CONTEXT.app;
  if (APP_CONTEXT.channel) headers['X-Twodrapes-Channel'] = APP_CONTEXT.channel;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function loadAuthImages(root = document) {
  root.querySelectorAll('img[data-auth-src]').forEach(img => {
    const url = img.getAttribute('data-auth-src');
    if (!url) return;
    fetch(apiUrl(url), { headers: authHeaders() })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
        const blobUrl = URL.createObjectURL(blob);
        img.dataset.blobUrl = blobUrl;
        img.src = blobUrl;
        img.style.cursor = 'zoom-in';
        img.onclick = () => window.open(blobUrl, '_blank');
      })
      .catch(() => {
        img.removeAttribute('src');
        img.alt = '图片加载失败';
      });
  });
}

// ===== Logistics Tracking Utilities =====
function getOrderCarrier(order) {
  if (!order) return '';
  return (
    order.carrier ||
    order.shippingCarrier ||
    order.shipping_carrier ||
    order.logisticsCarrier ||
    order.logistics_carrier ||
    order.deliveryChannel ||
    order.delivery_channel ||
    order.logisticsChannel ||
    order.logistics_channel ||
    order.shippingMethod ||
    order.shipping_method ||
    order.logistics_provider ||
    order.expressCompany ||
    order.express_company ||
    ''
  );
}

function normalizeCarrier(carrier = '') {
  const value = String(carrier).trim().toLowerCase();
  if (!value) return '';

  if (value.includes('usps') || value.includes('u.s.p.s') || value.includes('postal') || value.includes('美国邮政')) return 'usps';
  if (value === 'ups' || value.includes('united parcel')) return 'ups';
  if (value.includes('fedex') || value.includes('fed ex') || value.includes('federal express')) return 'fedex';
  if (value.includes('dhl')) return 'dhl';
  if (value.includes('yun') || value.includes('云途')) return 'yunexpress';
  if (value.includes('4px') || value.includes('递四方')) return '4px';
  if (value.includes('yanwen') || value.includes('燕文')) return 'yanwen';
  if (value.includes('ontrac')) return 'ontrac';
  if (value.includes('amazon') || value.includes('amzl') || value.includes('亚马逊物流')) return 'amazon';
  if (value.includes('cainiao') || value.includes('菜鸟')) return 'cainiao';
  if (value.includes('uniuni')) return 'uniuni';
  if (value.includes('speedx')) return 'speedx';
  if (value.includes('lasership')) return 'lasership';

  return value;
}

function getTrackingUrlByCarrier(carrier, trackingCode) {
  const normalizedCarrier = normalizeCarrier(carrier);
  const code = encodeURIComponent(String(trackingCode || '').trim());
  if (!code) return '';

  const builders = {
    usps: () => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${code}`,
    ups: () => `https://www.ups.com/track?tracknum=${code}`,
    fedex: () => `https://www.fedex.com/fedextrack/?trknbr=${code}`,
    dhl: () => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${code}`,
    yunexpress: () => `https://www.yuntrack.com/parcelTracking?id=${code}`,
    '4px': () => `https://www.4px.com/track/${code}`,
    yanwen: () => `https://track.yw56.com.cn/en/querydel?nums=${code}`,
    ontrac: () => `https://www.ontrac.com/tracking/?number=${code}`,
    amazon: () => `https://track.amazon.com/`,
    cainiao: () => `https://global.cainiao.com/newDetail.htm?mailNoList=${code}`,
  };

  return builders[normalizedCarrier] ? builders[normalizedCarrier]() : '';
}

async function handleTrackingCodeClick(event, order) {
  event.preventDefault();
  event.stopPropagation();

  const trackingCode = String(order?.tracking_number || '').trim();
  const carrier = getOrderCarrier(order);

  if (!trackingCode) return;

  let copied = false;
  try {
    await navigator.clipboard.writeText(trackingCode);
    copied = true;
  } catch { /* clipboard write failed */ }

  const trackingUrl = getTrackingUrlByCarrier(carrier, trackingCode);

  if (trackingUrl) {
    window.open(trackingUrl, '_blank', 'noopener,noreferrer');
    toast(copied ? '追踪编码已复制，正在打开物流官网' : '物流官网已打开，追踪编码复制失败');
  } else {
    toast(copied ? '追踪编码已复制，未配置该物流渠道官网' : '追踪编码复制失败，且未配置该物流渠道官网', 'warn');
  }
}

function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  const timeout = type === 'warn' ? 6000 : 3200;
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('toast-exit'); }, 200);
  }, timeout);
}

function applyChannelChrome() {
  document.title = `Twodrapes ${CHANNEL_LABEL}订单工具`;
  document.body?.setAttribute('data-channel', ORDER_CHANNEL);
  const title = $('appTitle');
  if (title) title.textContent = `Twodrapes ${CHANNEL_LABEL}订单工具`;
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function extractLabeledLine(raw, labels) {
  if (!raw) return '';
  const key = labels.map(escapeRegExp).join('|');
  const m = raw.match(new RegExp(`(?:^|\\n)\\s*(?:${key})\\s*[:：]\\s*([^\\n]*)`, 'im'));
  return m ? m[1].trim() : '';
}
function extractLabeledBlock(raw, labels, stopLabels) {
  if (!raw) return '';
  const key = labels.map(escapeRegExp).join('|');
  const stop = stopLabels.map(escapeRegExp).join('|');
  const m = raw.match(new RegExp(`(?:^|\\n)\\s*(?:${key})\\s*[:：]?[ \\t]*\\n?([\\s\\S]*?)(?=\\n[ \\t]*(?:${stop})\\s*[:：]?[ \\t]*(?:[^\\n]|$)|$)`, 'im'));
  return m ? m[1].trim() : '';
}
function findOrderNoFromRaw(raw) {
  const patterns = [
    /\b\d{3}-\d{7,8}-\d{6,9}\b/,
    /\b[A-Z]{1,4}-\d{4,}\b/i,
    /(?:^|\s)#\d{4,}(?:\s|$)/,
    /\b\d{8,}\b/
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[0]) return String(m[0]).trim();
  }
  return '';
}
function findAddressFromRaw(raw, stopLabels) {
  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return '';
  const stop = new RegExp(`^[ \\t]*(?:${stopLabels.map(escapeRegExp).join('|')})[ \\t]*(?:[:：]|$)`, 'i');
  const inlineStop = new RegExp(`(?:${stopLabels.map(escapeRegExp).join('|')})[^\\n]*[:：]`, 'i');
  const addrLabel = /(?:收货地址|地址|shipping\s*address|ship\s*to|address)\s*[:：]\s*(.*)/i;
  const addrToken = /(省|市|区|县|镇|街道|楼|室|单元|大道|广场|大厦|号|弄|巷|公寓|栋|牌|园|里|新村|Street|St\b|Road|Rd\b|Avenue|Ave\b|Lane|Drive|Dr\b|Boulevard|Blvd\b|Apartment|Apt\b|Suite|Zip|Postal|Postcode)/i;
  const zipCode = /\b\d{5}(?:-\d{4})?\b/;
  const stateCode = /\b(?:A[LKSZRAEP]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOPST]|N[CDEHJMVY]|O[ARHKRI]|P[ARW]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (stop.test(lines[i])) {
      const m = lines[i].match(addrLabel);
      if (m && m[1].trim()) { lines[i] = m[1].trim(); start = i; break; }
      continue;
    }
    if (addrToken.test(lines[i])) { start = i; break; }
    if (zipCode.test(lines[i]) && i > 0) { start = i - 1; break; }
    if (stateCode.test(lines[i]) && i > 0) { start = i - 1; break; }
  }
  if (start < 0) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (stop.test(line)) break;
    if (!line) break;
    const trimmed = line.replace(inlineStop, '').trim();
    if (trimmed) out.push(trimmed);
    if (out.length >= 5) break;
  }
  return out.join('\n').trim();
}
function parseBulkCustomerInfo(rawText) {
  const raw = String(rawText || '').replace(/\r/g, '').trim();
  if (!raw) return {};
  const labels = {
    orderNo: ['shopify订单号', 'amazon订单号', '订单号', 'order id', 'order number', 'order no', 'shopify order id', 'amazon order id', 'order#'],
    name: ['客户姓名', '姓名', '收件人', '联系人', 'name', 'customer'],
    email: ['客户邮箱', '邮箱', 'email', 'e-mail', 'mail'],
    phone: ['客户电话', '电话', '手机', 'phone', 'tel', 'telephone', 'mobile'],
    address: ['收货地址', '地址', 'shipping address', 'ship to', 'address'],
    remark: ['订单备注', '备注', 'note', 'remark', 'message']
  };
  const stopKeys = [...labels.orderNo, ...labels.name, ...labels.email, ...labels.phone, ...labels.address, ...labels.remark];
  const result = {
    orderNo: extractLabeledLine(raw, labels.orderNo),
    name: extractLabeledLine(raw, labels.name),
    email: extractLabeledLine(raw, labels.email),
    phone: extractLabeledLine(raw, labels.phone),
    address: extractLabeledBlock(raw, labels.address, stopKeys),
    remark: extractLabeledBlock(raw, labels.remark, stopKeys)
  };
  if (!result.orderNo) {
    result.orderNo = findOrderNoFromRaw(raw);
  }
  if (!result.email) {
    const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) result.email = emailMatch[0];
  }
  if (!result.phone) {
    const phoneCandidates = raw.match(/(?:\+?\d[\d\s\-()]{6,}\d)/g) || [];
    const phone = phoneCandidates.find((x) => {
      const v = String(x || '').trim();
      const digits = v.replace(/\D/g, '');
      return digits.length >= 7 && !/\d{3}-\d{7}-\d{7}/.test(v);
    });
    if (phone) result.phone = phone.trim();
  }
  if (!result.name) {
    const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
    const labelExclude = /billing|shipping|edit|address|email|phone|order|payment|paypal/i;
    const namePattern = /^[A-Za-z一-龥][^\s]*\s+[A-Za-z一-龥][^\s]/;
    const firstNameLike = lines.find((x) =>
      x.length >= 3 && x.length <= 40 &&
      !/\uFFFD/.test(x) && !/@/.test(x) &&
      !labelExclude.test(x) &&
      namePattern.test(x)
    );
    if (firstNameLike) result.name = firstNameLike;
  }
  if (!result.address) {
    result.address = findAddressFromRaw(raw, stopKeys);
  }
  return result;
}
function applyMatchedCustomerInfo() {
  const raw = $('bulkCustomerInfoInput')?.value || '';
  if (!raw.trim()) {
    toast('请先粘贴客户信息', 'bad');
    return;
  }
  const parsed = parseBulkCustomerInfo(raw);
  const targets = [
    ['orderNo', 'orderNo'],
    ['name', 'customerName'],
    ['email', 'customerEmail'],
    ['phone', 'customerPhone'],
    ['address', 'shippingAddress'],
    ['remark', 'orderRemark']
  ];
  let filled = 0;
  let skipped = 0;
  targets.forEach(([key, fieldId]) => {
    const el = $(fieldId);
    const value = parsed[key];
    if (el && value) {
      if (el.value && el.value.trim()) { skipped++; return; }
      el.value = value;
      filled++;
      el.classList.remove('field-flash');
      void el.offsetWidth;
      el.classList.add('field-flash');
      el.addEventListener('animationend', () => el.classList.remove('field-flash'), { once: true });
    }
  });
  if (!filled && !skipped) {
    toast('未识别到可填充字段，请检查文本格式', 'bad');
    return;
  }
  const msg = [];
  if (filled) msg.push(`已填充 ${filled} 项`);
  if (skipped) msg.push(`${skipped} 项已有值已跳过`);
  toast(msg.join('，'));
}
function fillSelect(el, rows, value) {
  if (!el) return;
  el.innerHTML = rows.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('');
  if (value != null) el.value = value;
}
function table(el, headers, rows) {
  if (!el) return;
  el.innerHTML = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
}
function formatOrderSizeText(item, unit = state.ordersSizeUnit) {
  const widthIn = Number(item?.width_in) || 0;
  const lengthIn = Number(item?.length_in) || 0;
  if (unit === 'cm') return `${fmt(widthIn * INCH_TO_CM, 2)} x ${fmt(lengthIn * INCH_TO_CM, 2)}`;
  return `${fmt(widthIn, 0)} x ${fmt(lengthIn, 0)}`;
}
async function loadAll() {
  document.querySelector('main')?.classList.add('loading');
  try {
    const bootstrap = await api.json('/api/bootstrap');
    state.globals = bootstrap.globals || {};
    state.products = bootstrap.products || [];
    state.fabrics = bootstrap.fabrics || [];
    state.linings = bootstrap.linings || [];
    state.laborRules = bootstrap.laborRules || [];
    state.memoryRules = bootstrap.memoryRules || [];
    state.taxRates = bootstrap.taxRates || [];
    state.features = bootstrap.features || {};
    USD_RMB_RATE = Number(bootstrap.rates?.usdRmbRate) || USD_RMB_RATE;
    PAYPAL_FEE_RATE = Number(bootstrap.rates?.paypalFeeRate) || PAYPAL_FEE_RATE;
    renderAll();
    await loadOrders();
    await loadProfitOrderList();
  } catch (e) {
    console.error('loadAll error:', e);
  } finally {
    document.querySelector('main')?.classList.remove('loading');
  }
}
function activeProduct() {
  return state.products.find(p => p.id === $('itemProduct').value) || state.products[0];
}
function resolveProductFabricId(product) {
  const enabled = state.fabrics.filter(f => f.enabled);
  const enabledIds = new Set(enabled.map(f => f.id));
  const defaultFabricId = product?.default_fabric_id || product?.defaultFabricId || '';
  if (defaultFabricId && enabledIds.has(defaultFabricId)) return defaultFabricId;
  return enabled[0]?.id || '';
}
function resolveLiningIdFromOptions(product, options) {
  const liningOption = (product?.options || []).find(o => /lining/i.test(o.option_key || o.key || o.label || ''));
  if (!liningOption) return 'lining_none';
  const key = liningOption.option_key || liningOption.key;
  const label = String(options?.[key] || '').trim();
  if (!label || /unlined|no lining|without|none|无内衬/i.test(label)) return 'lining_none';
  const candidates = state.linings.filter(l => l.enabled && l.id !== 'lining_none');
  const exact = candidates.find(l => String(l.name || '').trim() === label);
  if (exact) return exact.id;
  const fuzzy = candidates.find(l => label.includes(String(l.name || '').trim()) || String(l.name || '').trim().includes(label));
  return fuzzy?.id || candidates[0]?.id || 'lining_none';
}
async function openQuoteModal() {
  const items = state.currentItems.length ? state.currentItems :
    (state.preview ? [{ payload: itemPayload(), calc: state.preview }] : []);
  if (!items.length) { toast('请先添加项目到订单', 'warn'); return; }

  let totalUsd = 0, totalCost = 0, totalProfit = 0;
  let html = '<div class="quote-modal-body">';

  items.forEach((item, i) => {
    const p = item.calc;
    const product = state.products.find(pr => pr.id === item.payload.product_id);
    const name = product?.name || '产品';
    const size = `${item.payload.width_in} x ${item.payload.length_in} inch`;
    const qty = item.payload.qty || 1;
    const systemPrice = Number(p.systemPriceUsd) || 0;
    const salesPrice = Number(p.salesUsd) || systemPrice;
    const cost = Number(p.estimatedCostRmb) || Number(p.finalCostRmb) || 0;
    const profit = Number(p.profitRmb) || 0;
    const rate = Number(p.profitRate) || 0;

    totalUsd += salesPrice;
    totalCost += cost;
    totalProfit += profit;

    html += `<div class="quote-item-card" data-index="${i}">`;
    html += `<div class="quote-item-header">
      <div class="quote-item-title">
        <h4>${esc(name)}</h4>
        <span class="quote-item-meta">${esc(size)} × ${qty}</span>
      </div>
      <div class="quote-item-price">
        <span class="quote-item-price-usd">${usd(salesPrice)}</span>
        <span class="quote-item-price-rmb">${rmb(salesPrice * USD_RMB_RATE)}</span>
      </div>
    </div>`;

    const opts = item.payload.selected_options || {};
    const optEntries = Object.entries(opts).filter(([, v]) => v);
    if (optEntries.length) {
      const optLabelMap = {};
      (product?.options || []).forEach(g => { optLabelMap[g.option_key || g.key] = g.label || g.option_key || g.key; });
      html += '<div class="quote-opts">';
      optEntries.forEach(([k, v]) => {
        const label = optLabelMap[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        html += `<div class="quote-opt-row"><span class="quote-opt-key">${esc(label)}</span><span class="quote-opt-val">${esc(v)}</span></div>`;
      });
      html += '</div>';
    }

    html += `<div class="quote-item-footer">
      <span>成本 <b>${rmb(cost)}</b></span>
      <span>利润 <b class="${profit >= 0 ? 'good' : 'bad'}">${rmb(profit)}</b></span>
      <span>利润率 <b>${fmt(rate * 100, 1)}%</b></span>
    </div>`;
    html += '</div>';
  });

  const totalIncomeRmb = totalUsd * (1 - PAYPAL_FEE_RATE) * USD_RMB_RATE;
  const totalRate = totalIncomeRmb > 0 ? (totalProfit / totalIncomeRmb) * 100 : 0;
  const lowProfit = totalRate < 40;
  html += `<div class="quote-summary-card">
    <div class="quote-summary-grid">
      <div class="quote-summary-cell">
        <span class="quote-summary-label">总售价</span>
        <span class="quote-summary-value">${rmb(totalUsd * USD_RMB_RATE)}</span>
      </div>
      <div class="quote-summary-cell">
        <span class="quote-summary-label">总成本</span>
        <span class="quote-summary-value">${rmb(totalCost)}</span>
      </div>
      <div class="quote-summary-cell">
        <span class="quote-summary-label">总利润</span>
        <span class="quote-summary-value ${totalProfit >= 0 ? 'good' : 'bad'}" id="quoteTotalProfit">${rmb(totalProfit)}</span>
      </div>
      <div class="quote-summary-cell">
        <span class="quote-summary-label">利润率</span>
        <span class="quote-summary-value ${lowProfit ? 'warn' : ''}" id="quoteTotalRate">${fmt(totalRate, 1)}%</span>
      </div>
    </div>
    ${lowProfit ? '<div class="quote-profit-warning">利润率低于 40%，请注意！</div>' : ''}
    <div class="quote-logistics-section">
      <div class="quote-logistics-row">
        <label class="quote-logistics-label">预计物流成本 (¥)</label>
        <input type="number" id="quoteLogisticsInput" class="quote-logistics-input" placeholder="0.00" min="0" step="0.01">
      </div>
      <div class="quote-net-result">
        <span>扣除物流后利润</span>
        <span class="quote-net-profit" id="quoteNetProfit">—</span>
      </div>
    </div>
  </div>`;

  html += '</div>';
  if ($('quoteModalContent')) $('quoteModalContent').innerHTML = html;

  $('quoteLogisticsInput')?.addEventListener('input', () => {
    const logistics = parseFloat($('quoteLogisticsInput').value) || 0;
    const netProfit = totalProfit - logistics;
    const netEl = $('quoteNetProfit');
    if (netEl) {
      netEl.textContent = rmb(netProfit);
      netEl.className = `quote-net-profit ${netProfit >= 0 ? 'good' : 'bad'}`;
    }
    const profitEl = $('quoteTotalProfit');
    if (profitEl) {
      const adjustedProfit = totalProfit - logistics;
      profitEl.textContent = rmb(adjustedProfit);
      profitEl.className = `quote-summary-value ${adjustedProfit >= 0 ? 'good' : 'bad'}`;
    }
    const rateEl = $('quoteTotalRate');
    if (rateEl && totalIncomeRmb > 0) {
      const adjustedRate = ((totalProfit - logistics) / totalIncomeRmb) * 100;
      rateEl.textContent = fmt(adjustedRate, 1) + '%';
      rateEl.className = `quote-summary-value ${adjustedRate < 40 ? 'warn' : ''}`;
    }
  });

  $('quoteModal')?.classList.remove('hidden');
}

function renderCostDetailModal(calc) {
  const b = calc.costBreakdown || {};
  const lines = [
    ['主面料理论用料', `${fmt(b.mainFabricTheoreticalUsageM)} m`],
    ['主面料发料用料', `${fmt(b.mainFabricIssuedUsageM)} m`],
    ['主面料单价', `${fmt(b.mainFabricUnitPriceRmb)} RMB/m`],
    ['主面料成本', rmb(calc.mainFabricCostRmb)],
    ['内衬理论用料', `${fmt(b.liningTheoreticalUsageM)} m`],
    ['内衬发料用料', `${fmt(b.liningIssuedUsageM)} m`],
    ['内衬单价', `${fmt(b.liningUnitPriceRmb)} RMB/m`],
    ['内衬成本', rmb(calc.liningCostRmb)],
    ['加工费', rmb(calc.laborCostRmb)],
    ['拼接费', rmb(calc.spliceFeeRmb)],
    ['定型费', rmb(calc.memoryCostRmb)],
    ['选项成本', rmb(calc.optionCostRmb)],
    ['物流成本', rmb(b.estimatedLogisticsRmb)],
    ['预计成本', rmb(calc.estimatedCostRmb ?? calc.finalCostRmb)]
  ];
  if ($('costDetailContent')) $('costDetailContent').innerHTML = `<div class="cost-grid">${lines.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>`;
}
function costSourceLabel(source) {
  if (source === 'factory_settlement') return '工厂结算';
  if (source === 'factory_cost_total') return '工厂成本合计';
  return '系统预计';
}
function optionDisplayRows(item) {
  const calc = item.calc_detail || {};
  const options = item.selected_options || {};
  const groups = calc.product?.options || [];
  const byKey = new Map(groups.map(g => [g.option_key || g.key, g]));
  return Object.entries(options).map(([key, value]) => {
    const group = byKey.get(key) || {};
    const found = (group.values || []).find(v => String(v.label) === String(value)) || {};
    return {
      itemId: item.id,
      key,
      label: group.label || key,
      value,
      values: (group.values || []).map(v => String(v.label)),
      priceUsd: found.price_usd ?? found.price ?? '',
      costRmb: found.cost_rmb ?? found.costRmb ?? ''
    };
  });
}
function optionListHtml(optRows) {
  if (!optRows.length) return '';
  return `<dl class="item-row-options">${optRows.map(r => `
    <div class="item-option-row">
      <b>${esc(r.label)}</b>
      <span>${esc(r.value)}</span>
    </div>
  `).join('')}</dl>`;
}
function orderItemModulesHtml(order, isEdit) {
  const items = order.items || [];
  if (!items.length) return '<div class="notice">暂无项目。</div>';

  // Edit mode: keep individual item cards with edit controls
  if (isEdit) {
    const itemCards = items.map(it => {
      const productName = esc(it.product_name || '产品');
      const itemCode = esc(normalizeItemCode(it.item_code));
      const widthIn = Number(it.width_in) || 0;
      const lengthIn = Number(it.length_in) || 0;
      const qty = Math.max(1, Number(it.qty) || 1);
      const qtySection = `<div class="item-module-fields">
        <div class="inline-logistics item-size-editor">
          <label>Width / inch <input type="number" min="0.01" step="0.01" value="${fmt(widthIn)}" data-item-width-input="${it.id}"></label>
          <label>Length / inch <input type="number" min="0.01" step="0.01" value="${fmt(lengthIn)}" data-item-length-input="${it.id}"></label>
        </div>
        <div class="inline-logistics item-qty-editor">
          <label>数量 <input type="number" min="1" step="1" value="${qty}" data-item-qty-input="${it.id}"></label>
        </div>
      </div>`;
      const optRows = optionDisplayRows(it);
      let optionsTable = '';
      if (optRows.length) {
        const rows = optRows.map(r => `<tr>
          <td>${esc(r.label)}</td>
          <td><select data-option-item-id="${r.itemId}" data-option-key="${esc(r.key)}">${r.values.map(v => `<option value="${esc(v)}" ${String(v) === String(r.value) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
          <td>${r.priceUsd === '' ? '' : fmt(r.priceUsd)}</td>
          <td>${r.costRmb === '' ? '' : fmt(r.costRmb)}</td>
        </tr>`).join('');
        optionsTable = `<div class="table-wrap detail-table"><table>
          <thead><tr><th>选项</th><th>选择值</th><th>售价 USD</th><th>成本 RMB</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      }
      return `<div class="order-item-module">
        <h4>${productName} <span class="item-module-code">${itemCode}</span></h4>
        ${qtySection}
        ${optionsTable}
      </div>`;
    }).join('');
    const prodCostVal = order.production_cost_override_rmb != null ? fmt(order.production_cost_override_rmb) : '';
    const costRow = `<div class="order-production-cost-row">
      <label>总生产成本（RMB）<input type="number" min="0" step="0.01" value="${prodCostVal}" placeholder="留空使用系统计算值" data-order-production-cost></label>
    </div>`;
    return itemCards + costRow;
  }

  // View mode: group by product name
  const groups = new Map();
  for (const it of items) {
    const name = it.product_name || '产品';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }

  const groupsHtml = Array.from(groups.entries()).map(([productName, groupItems]) => {
    const totalCount = groupItems.length;
    const totalQty = groupItems.reduce((s, it) => s + (Math.max(1, Number(it.qty) || 1)), 0);
    const headerLabel = totalCount === 1
      ? `${totalQty}条`
      : `${totalCount}项, 共${totalQty}条`;

    const rows = groupItems.map(it => {
      const itemCode = esc(normalizeItemCode(it.item_code));
      const size = `${fmt(it.width_in, 0)}×${fmt(it.length_in, 0)}`;
      const qty = Math.max(1, Number(it.qty) || 1);
      const itemPrice = Number(it.sales_usd) || 0;
      const optRows = optionDisplayRows(it);
      return `<div class="item-group-row">
        <div class="item-row-main">
          <span class="item-row-code">${itemCode}</span>
          <span class="item-row-size">${size}</span>
          <span class="item-row-qty">×${qty}</span>
          <span class="item-row-price">$${fmt(itemPrice)}</span>
        </div>
        ${optionListHtml(optRows)}
      </div>`;
    }).join('');

    return `<div class="item-group-card">
      <div class="item-group-header">
        <span class="item-group-name">${esc(productName)}</span>
        <span class="item-group-count">${headerLabel}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');

  const totalProdCost = order.production_cost_override_rmb != null
    ? Number(order.production_cost_override_rmb)
    : items.reduce((s, it) => s + (Number(it.final_cost_rmb) || 0), 0);
  const hasCost = order.production_cost_override_rmb != null || totalProdCost > 0;
  const costFooter = hasCost ? `<div class="item-group-cost-footer">总生产成本: ${rmb(totalProdCost)}</div>` : '';

  // Production photos section
  const photosSection = `<div class="detail-section production-photos-section">
    <div class="detail-section-title"><h4>生产照片</h4><span>${items.length} 个订单项</span></div>
    ${items.map(it => `<div class="production-photos-item" data-order-item-id="${it.id}">
      <div class="production-photos-header">
        <span class="production-photos-item-name">${esc(it.product_name || '产品')} — ${esc(it.item_code || '')}</span>
        <label class="btn small secondary production-photos-upload-btn">上传照片<input type="file" class="production-photos-file-input" data-item-id="${it.id}" accept="image/png,image/jpeg,image/gif,image/webp" multiple style="display:none"></label>
      </div>
      <div class="production-photos-grid" data-photos-for="${it.id}"><div class="production-photos-empty">暂无照片</div></div>
    </div>`).join('')}
  </div>`;

  return groupsHtml + costFooter + photosSection;
}

function orderFinancialSummaryHtml(order) {
  const profit = Number(order.total_profit_rmb) || 0;
  const profitRate = Number(order.total_profit_rate) || 0;
  const totalCost = Number(order.total_cost_rmb) || 0;
  const productionCost = order.production_cost_override_rmb != null
    ? Number(order.production_cost_override_rmb)
    : (order.items || []).reduce((sum, item) => sum + (Number(item.final_cost_rmb) || 0), 0);
  const rows = [
    ['订单销售额', usd(order.total_sales_usd), 'strong'],
    ['税费', usd(order.total_tax_usd), ''],
    ['净销售 RMB', rmb(order.total_net_sales_rmb), ''],
    ['生产成本 RMB', rmb(productionCost), ''],
    ['物流成本 RMB', rmb(order.logistics_cost_rmb), ''],
    ['总成本 RMB', rmb(totalCost), ''],
    ['利润 RMB', rmb(profit), profit < 0 ? 'bad strong' : 'good strong'],
    ['利润率', `${fmt(profitRate * 100, 1)}%`, profitRate < 0 ? 'bad strong' : 'good strong']
  ];
  if (Number(order.paypal_fee_usd) > 0) rows.splice(3, 0, ['PayPal 手续费', usd(order.paypal_fee_usd), '']);
  if (Number(order.actual_income_usd) > 0) rows.splice(1, 0, ['实收金额', usd(order.actual_income_usd), 'strong']);

  return `<div class="detail-section detail-section-amounts">
    <div class="detail-section-title">
      <h4>金额汇总</h4>
      <span>金额右对齐，保留核心财务字段</span>
    </div>
    <div class="amount-summary-grid">
      ${rows.map(([label, value, cls]) => `<div class="amount-summary-row ${cls}">
        <span>${esc(label)}</span>
        <b>${esc(value)}</b>
      </div>`).join('')}
    </div>
  </div>`;
}
async function saveEditableOrderItems(form, orderId) {
  const widthInputs = Array.from(form.querySelectorAll('[data-item-width-input]'));
  const itemIds = widthInputs.map(el => el.getAttribute('data-item-width-input'));

  for (const itemId of itemIds) {
    const widthIn = Number(form.querySelector(`[data-item-width-input="${itemId}"]`)?.value || 0);
    const lengthIn = Number(form.querySelector(`[data-item-length-input="${itemId}"]`)?.value || 0);
    if (!Number.isFinite(widthIn) || widthIn <= 0) throw new Error('宽度必须大于 0');
    if (!Number.isFinite(lengthIn) || lengthIn <= 0) throw new Error('高度必须大于 0');
    await api.json(`/api/order-items/${itemId}/size`, { method: 'PUT', body: JSON.stringify({ width_in: widthIn, length_in: lengthIn }) });
  }

  for (const itemId of itemIds) {
    const qty = Number(form.querySelector(`[data-item-qty-input="${itemId}"]`)?.value || 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须 > 0');
    await api.json(`/api/order-items/${itemId}/qty`, { method: 'PUT', body: JSON.stringify({ qty: Math.floor(qty) }) });
  }

  const prodCostInput = form.querySelector('[data-order-production-cost]');
  if (prodCostInput && orderId) {
    const costVal = prodCostInput.value.trim();
    const costOverride = costVal !== '' ? Number(costVal) : null;
    if (costOverride != null && (!Number.isFinite(costOverride) || costOverride < 0)) {
      throw new Error('生产成本不能为负数');
    }
    await api.json(`/api/orders/${orderId}/cost-overrides`, {
      method: 'PUT', body: JSON.stringify({ production_cost_override_rmb: costOverride, logistics_cost_rmb: Number(form.querySelector('[data-edit-field="logistics_cost_rmb"]')?.value || 0) })
    });
  }

  const salesOverride = Number(form.querySelector('[data-order-actual-paid]')?.value) || 0;
  const discountApply = form.querySelector('[data-order-discount-apply]')?.checked !== false;
  const discountMode = form.querySelector('[data-order-discount-mode]')?.value || 'percent';
  const discountValue = Number(form.querySelector('[data-order-discount-value]')?.value || 0);
  if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error('折扣值必须是非负数');

  if (salesOverride > 0 && orderId) {
    await api.json(`/api/orders/${orderId}/financial`, {
      method: 'PUT', body: JSON.stringify({ sales_usd: salesOverride, tax_usd: 0 })
    });
  } else if (orderId) {
    await api.json(`/api/orders/${orderId}/financial`, { method: 'PUT', body: JSON.stringify({ clear: true }) });
  }

  for (const itemId of itemIds) {
    await api.json(`/api/order-items/${itemId}/discount`, {
      method: 'PUT',
      body: JSON.stringify({ apply_discount: discountApply, discount_mode: discountMode, discount_value: discountValue, actual_paid_usd: 0 })
    });
  }

  const optionSelects = form.querySelectorAll('select[data-option-item-id]');
  for (const select of optionSelects) {
    const itemId = select.getAttribute('data-option-item-id');
    const key = select.getAttribute('data-option-key');
    const value = select.value;
    if (!value) continue;
    await api.json(`/api/order-items/${itemId}/option`, { method: 'PUT', body: JSON.stringify({ key, value }) });
  }
}
function orderLevelDiscountHtml(order) {
  const items = order.items || [];
  const first = items[0] || {};
  const calc = first.calc_detail || {};
  const applyDiscount = calc.applyDiscount !== false;
  const discountMode = String(calc.discountMode || 'percent').toLowerCase();
  const normalizedDiscountMode = ['amount', 'fixed', 'usd'].includes(discountMode) ? 'amount' : 'percent';
  const discountValue = Number(calc.discountValue ?? 0) || 0;
  const salesOverride = Number(order.sales_override_usd) || 0;

  const breakdownRows = items.map(it => {
    const sysPrice = Number(it.system_price_usd) || 0;
    const curSales = Number(it.sales_usd) || 0;
    return `<tr data-breakdown-item="${it.id}">
      <td>${esc(it.product_name || '')}</td>
      <td>$${fmt(sysPrice)}</td>
      <td class="bd-discount">—</td>
      <td class="bd-final">$${fmt(curSales)}</td>
    </tr>`;
  }).join('');

  return `<div class="detail-section"><h4>订单折扣</h4>
    <div class="order-level-discount">
      <div class="item-discount-header">
        <b>统一折扣</b>
        <span>应用到所有项目</span>
      </div>
      <div class="item-discount-grid">
        <label class="discount-switch"><input type="checkbox" ${applyDiscount ? 'checked' : ''} data-order-discount-apply> 应用折扣</label>
        <label>折扣方式<select data-order-discount-mode>
          <option value="percent" ${normalizedDiscountMode === 'percent' ? 'selected' : ''}>百分比</option>
          <option value="amount" ${normalizedDiscountMode === 'amount' ? 'selected' : ''}>固定金额 USD</option>
        </select></label>
        <label>折扣值<input type="number" min="0" step="0.01" value="${fmt(discountValue)}" data-order-discount-value></label>
      </div>
      <div class="order-actual-paid-row">
        <label>实收金额 USD（退款调整）<input type="number" min="0" step="0.01" value="${salesOverride ? fmt(salesOverride) : ''}" placeholder="留空按折扣计算" data-order-actual-paid></label>
        <span class="muted-hint">设置后覆盖折扣计算，直接指定订单总售价</span>
      </div>
    </div>
    <div class="discount-breakdown" data-discount-breakdown>
      <b>各项目优惠明细</b>
      <div class="table-wrap"><table>
        <thead><tr><th>产品</th><th>系统价</th><th>优惠</th><th>折后价</th></tr></thead>
        <tbody>${breakdownRows}</tbody>
      </table></div>
    </div>
  </div>`;
}

const LOGISTICS_FIELDS = ['logistics_provider', 'delivery_channel', 'tracking_number', 'shipping_date', 'weight_kg', 'logistics_cost_rmb', 'delivered_date'];

function computeLogisticsStatus(fields, hasScreenshot) {
  if (fields.delivered_date && hasScreenshot) return 'completed';
  if (fields.logistics_provider || fields.delivery_channel || fields.tracking_number ||
      fields.shipping_date || fields.weight_kg || fields.logistics_cost_rmb) return 'shipping';
  return null;
}

async function viewOrderModal(orderId, mode) {
  try {
    const order = await api.json(`/api/orders/${orderId}`);
    const payment = orderPaymentBreakdown(order);
    const logisticsCost = Number(order.logistics_cost_rmb) || 0;
    const form = $('editOrderForm');
    const isEdit = mode === 'edit';
    const originalOrderStatus = order.status;
    const originalHasScreenshot = !!order.delivery_screenshot;
    $('editOrderTitle').textContent = (isEdit ? '编辑' : '查看') + '订单 ' + esc(order.order_no || '#' + order.id);

    // Header description
    const descParts = [esc(order.order_no || '#' + order.id), CHANNEL_LABEL];
    if (order.order_date) descParts.push(order.order_date);
    $('editOrderDesc').textContent = descParts.join(' · ');

    // Status badge
    const statusInfo = orderStatusInfo(order);
    const badge = $('editOrderStatusBadge');
    badge.textContent = statusInfo.label;
    badge.className = 'order-status ' + statusInfo.cls;

    const field = (label, value, inputType, fieldName, extraClass = '') => {
      const cls = extraClass ? ` class="${extraClass}"` : '';
      if (!isEdit) return `<div${cls}><label>${label}<span class="detail-value">${esc(String(value || ''))}</span></label></div>`;
      if (inputType === 'textarea') return `<div${cls}><label>${label}<textarea rows="2" data-edit-field="${fieldName}">${esc(value || '')}</textarea></label></div>`;
      if (inputType === 'date') return `<div${cls}><label>${label}<input type="date" value="${esc(value || '')}" data-edit-field="${fieldName}"></label></div>`;
      if (inputType === 'number') return `<div${cls}><label>${label}<input type="number" step="0.01" min="0" value="${fmt(value)}" data-edit-field="${fieldName}"></label></div>`;
      if (inputType === 'integer') return `<div${cls}><label>${label}<input type="number" step="1" min="0" inputmode="numeric" value="${esc(value ?? '')}" data-edit-field="${fieldName}"></label></div>`;
      return `<div${cls}><label>${label}<input value="${esc(value || '')}" data-edit-field="${fieldName}"></label></div>`;
    };

    form.innerHTML =
      '<div class="order-detail-stack">' +
      '<div class="detail-section detail-section-overview">' +
      '<div class="detail-section-title"><h4>订单概览</h4><span>' + esc(order.order_no || '#' + order.id) + '</span></div>' +
      '<div class="detail-grid">' +
      field('下单日期', order.order_date, 'date', 'order_date') +
      field('交期日期', order.delivery_date, 'date', 'delivery_date') +
      field('备注', order.remark, 'text', 'remark', 'detail-field-wide') +
      '</div></div>' +
      '<div class="detail-section">' +
      '<div class="detail-section-title"><h4>客户信息</h4><span>姓名 / 联系方式 / 地址</span></div>' +
      '<div class="detail-grid">' +
      field('客户姓名', order.customer_name, 'text', 'customer_name') +
      field('邮箱', order.customer_email, 'text', 'customer_email') +
      field('电话', order.customer_phone, 'text', 'customer_phone') +
      field('地址', order.customer_address, 'textarea', 'customer_address', 'detail-field-wide') +
      '</div>' +
      '</div>' +
      '<div class="detail-section">' +
      '<div class="detail-section-title"><h4>物流信息</h4><span>发货 / 追踪 / 签收</span></div>' +
      '<div class="detail-grid">' +
      field('货代', order.logistics_provider, 'text', 'logistics_provider') +
      field('尾程派送渠道', order.delivery_channel, 'text', 'delivery_channel') +
      (isEdit
        ? field('尾程追踪编码', order.tracking_number, 'text', 'tracking_number')
        : `<div><label>尾程追踪编码${
            order.tracking_number
              ? `<button type="button" class="tracking-code-link" data-tracking-code="${esc(order.tracking_number)}" data-carrier="${esc(getOrderCarrier(order))}" title="点击复制追踪编码并打开物流官网"><span class="tracking-code-text">${esc(order.tracking_number)}</span><span class="tracking-code-icon" aria-hidden="true">↗</span></button>`
              : `<span class="detail-value">${esc(order.tracking_number || '')}</span>`
          }</label></div>`) +
      field('送达日期', order.delivered_date, 'date', 'delivered_date') +
      field('发货日期', order.shipping_date, 'date', 'shipping_date') +
      field('重量 KG', order.weight_kg, 'number', 'weight_kg') +
      field('物流成本（RMB）', logisticsCost, 'number', 'logistics_cost_rmb') +
      '</div>' +
      '<div class="delivery-screenshot-section">' +
      '<div class="delivery-screenshot-header"><h4>签收截图</h4></div>' +
      '<div class="delivery-screenshot-area" id="deliveryScreenshotArea">' +
      (order.delivery_screenshot
        ? `<div class="delivery-screenshot-preview"><img src="/api/orders/${order.id}/delivery-screenshot" alt="签收截图" onclick="window.open(this.src,'_blank')"><button class="btn small danger" id="deleteScreenshotBtn" type="button">删除</button></div>`
        : '<div class="delivery-screenshot-empty">暂无签收截图</div>') +
      '<div class="delivery-screenshot-upload"><label class="btn small secondary" id="uploadScreenshotLabel">上传截图<input type="file" accept="image/*" id="screenshotFileInput" style="display:none"></label></div>' +
      '</div></div>' +
      '</div></div>' +
      orderFinancialSummaryHtml(order) +
      (isEdit ? orderLevelDiscountHtml(order) : '') +
      '<div class="detail-section detail-section-items">' +
      '<div class="detail-section-title"><h4>商品明细</h4><span>' + (order.items || []).length + ' 项</span></div>' +
      orderItemModulesHtml(order, isEdit) +
      '</div>' +
      '</div>';

    // Footer action buttons
    const screenshotImage = form.querySelector('.delivery-screenshot-preview img');
    if (screenshotImage && screenshotImage.getAttribute('src')) {
      screenshotImage.setAttribute('data-auth-src', screenshotImage.getAttribute('src'));
      screenshotImage.removeAttribute('src');
      screenshotImage.onclick = null;
    }
    loadAuthImages(form);

    const footer = $('editOrderFooter');
    footer.innerHTML = isEdit
      ? '<button class="btn secondary small" type="button" data-cancel-edit="' + order.id + '">取消</button><button class="btn primary small" type="button" data-save-order-edit="' + order.id + '">保存修改</button>'
      : '<button class="btn primary small" type="button" data-switch-to-edit="' + order.id + '">编辑订单</button>';

    $('editOrderModal').classList.remove('hidden');

    // Load production photos for each item
    for (const it of (order.items || [])) {
      loadProductionPhotos(it.id);
    }

    // Setup real-time profit preview in edit mode
    if (isEdit) {
      setupProfitPreview(form, order);
    }

    // Bind close
    const closeHandler = () => $('editOrderModal').classList.add('hidden');
    $('closeEditOrderBtn').onclick = closeHandler;
    $('closeEditOrderModal').onclick = closeHandler;

    // Tracking code click delegation (view mode only)
    if (!isEdit) {
      form.addEventListener('click', (e) => {
        const link = e.target.closest('.tracking-code-link');
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        const trackingCode = link.dataset.trackingCode || '';
        const carrier = link.dataset.carrier || '';
        if (!trackingCode) return;
        (async () => {
          let copied = false;
          try { await navigator.clipboard.writeText(trackingCode); copied = true; } catch {}
          const url = getTrackingUrlByCarrier(carrier, trackingCode);
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
            toast(copied ? '追踪编码已复制，正在打开物流官网' : '物流官网已打开，追踪编码复制失败');
          } else {
            toast(copied ? '追踪编码已复制，未配置该物流渠道官网' : '追踪编码复制失败，且未配置该物流渠道官网', 'warn');
          }
        })();
      });
    }

    // Real-time discount preview
    if (isEdit) {
      const items = order.items || [];
      const updateBreakdown = () => {
        const apply = form.querySelector('[data-order-discount-apply]')?.checked !== false;
        const mode = form.querySelector('[data-order-discount-mode]')?.value || 'percent';
        const value = Number(form.querySelector('[data-order-discount-value]')?.value || 0);
        const rows = form.querySelectorAll('[data-breakdown-item]');
        for (const row of rows) {
          const itemId = row.getAttribute('data-breakdown-item');
          const item = items.find(i => String(i.id) === String(itemId));
          if (!item) continue;
          const sysPrice = Number(item.system_price_usd) || 0;
          let discountAmt = 0;
          let finalPrice = sysPrice;
          if (apply && value > 0) {
            if (mode === 'percent') {
              discountAmt = sysPrice * Math.min(value, 100) / 100;
            } else {
              discountAmt = Math.min(value, sysPrice);
            }
            finalPrice = Math.max(0, sysPrice - discountAmt);
          }
          const bdDiscount = row.querySelector('.bd-discount');
          const bdFinal = row.querySelector('.bd-final');
          if (bdDiscount) bdDiscount.textContent = discountAmt > 0 ? `-$${fmt(discountAmt)}` : '—';
          if (bdFinal) bdFinal.textContent = `$${fmt(finalPrice)}`;
        }
      };
      form.querySelectorAll('[data-order-discount-apply], [data-order-discount-mode], [data-order-discount-value]').forEach(el => {
        el.addEventListener('input', updateBreakdown);
        el.addEventListener('change', updateBreakdown);
      });
      updateBreakdown();
    }

    if (isEdit) {
      // Cancel button — switch back to view mode
      const cancelBtn = $('editOrderFooter').querySelector('[data-cancel-edit]');
      if (cancelBtn) cancelBtn.onclick = () => viewOrderModal(orderId, 'view');

      // Save order
      $('editOrderFooter').querySelector('[data-save-order-edit="' + order.id + '"]').addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const fields = form.querySelectorAll('[data-edit-field]');
        const payload = { order_no: order.order_no };
        const logisticsInput = form.querySelector('[data-edit-field="logistics_cost_rmb"]');
        const logisticsVal = logisticsInput ? Number(logisticsInput.value || 0) : 0;
        const weightInput = form.querySelector('[data-edit-field="weight_kg"]');
        const weightVal = weightInput ? Number(weightInput.value || 0) : 0;
        const trackingInput = form.querySelector('[data-edit-field="tracking_number"]');
        const trackingVal = trackingInput ? String(trackingInput.value || '').trim() : '';
        if (logisticsInput && (!Number.isFinite(logisticsVal) || logisticsVal < 0)) return toast('物流成本必须是非负数', 'bad');
        if (weightInput && (!Number.isFinite(weightVal) || weightVal < 0)) return toast('重量必须是非负数', 'bad');
        if (trackingVal && trackingVal.length > 50) return toast('尾程追踪编码过长', 'bad');
        fields.forEach(f => {
          if (f.dataset.editField === 'logistics_cost_rmb') payload[f.dataset.editField] = logisticsVal;
          else if (f.dataset.editField === 'weight_kg') payload[f.dataset.editField] = weightVal;
          else payload[f.dataset.editField] = f.value;
        });

        // Auto-update status based on logistics fields
        const logisticsValues = {};
        LOGISTICS_FIELDS.forEach(key => { logisticsValues[key] = payload[key] || ''; });
        const targetStatus = computeLogisticsStatus(logisticsValues, originalHasScreenshot);
        if (targetStatus && targetStatus !== originalOrderStatus) {
          const fromLabel = orderStatusInfo({ status: originalOrderStatus }).label;
          const toLabel = orderStatusInfo({ status: targetStatus }).label;
          if (!confirm(`订单当前状态为「${fromLabel}」，填写物流信息后将变更为「${toLabel}」，确认保存？`)) return;
          payload.status = targetStatus;
        }

        try {
          await api.json(`/api/orders/${order.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          await saveEditableOrderItems(form, order.id);
          toast('订单信息已保存');
          $('editOrderModal').classList.add('hidden');
          await loadOrders();
        } catch (e) { toast(e.message, 'bad'); }
      });
    } else {
      // View mode: bind edit button (now in footer)
      const editBtn = $('editOrderFooter').querySelector('[data-switch-to-edit]');
      if (editBtn) editBtn.onclick = () => viewOrderModal(orderId, 'edit');
    }

    // Delivery screenshot handlers
    const screenshotInput = $('screenshotFileInput');
    if (screenshotInput) {
      screenshotInput.onchange = async () => {
        const file = screenshotInput.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) return toast('文件大小不能超过 10MB', 'bad');
        const fd = new FormData();
        fd.append('file', file);
        try {
          await api.json(`/api/orders/${orderId}/delivery-screenshot`, { method: 'POST', body: fd });
          // Auto-update status to completed if delivered_date exists
          const deliveredInput = form.querySelector('[data-edit-field="delivered_date"]');
          const deliveredDate = deliveredInput ? deliveredInput.value : order.delivered_date;
          if (deliveredDate) {
            try {
              await api.json(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) });
              toast('签收截图已上传，订单已标记为完成');
            } catch (_) { toast('签收截图已上传'); }
          } else {
            toast('签收截图已上传');
          }
          viewOrderModal(orderId, mode);
        } catch (e) { toast('上传失败: ' + e.message, 'bad'); }
        screenshotInput.value = '';
      };
    }
    const deleteBtn = $('deleteScreenshotBtn');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        // If order is completed, confirm and revert status
        if (originalOrderStatus === 'completed') {
          if (!confirm('删除签收截图后，订单状态将从「完成」变为「已发货」，确认删除？')) return;
        } else {
          if (!confirm('确认删除签收截图？')) return;
        }
        try {
          await api.json(`/api/orders/${orderId}/delivery-screenshot`, { method: 'DELETE' });
          // Revert status from completed to shipping
          if (originalOrderStatus === 'completed') {
            try {
              await api.json(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: 'shipping' }) });
              toast('签收截图已删除，订单状态已变更');
            } catch (_) { toast('签收截图已删除'); }
          } else {
            toast('签收截图已删除');
          }
          viewOrderModal(orderId, mode);
        } catch (e) { toast('删除失败: ' + e.message, 'bad'); }
      };
    }
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderOrderFinalCostDetailModal(order) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const itemRows = (order.items || []).flatMap(it => {
    const c = it.calc_detail || {};
    const b = c.costBreakdown || {};
    const hasLining = Boolean(c.details?.hasLining) || Number(c.liningCostRmb || 0) > 0 || Number(b.liningTheoreticalUsageM || 0) > 0;
    const itemEstimated = Number(it.estimated_cost_rmb ?? c.estimatedCostRmb) || 0;
    const liningEstimated = Number(c.liningCostRmb) || 0;
    const mainEstimated = Math.max(0, itemEstimated - liningEstimated);
    const mainRow = `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>主面料</td>
      <td>${fmt(b.mainFabricTheoreticalUsageM)}</td>
      <td>${fmt(b.mainFabricIssuedUsageM)}</td>
      <td>${fmt(c.mainFabricCostRmb)}</td>
      <td>${fmt(c.laborCostRmb)}</td>
      <td>${fmt(c.spliceFeeRmb)}</td>
      <td>${fmt(c.memoryCostRmb)}</td>
      <td>${fmt(hasLining ? mainEstimated : itemEstimated)}</td>
      <td>${fmt(it.factory_cost_total_rmb)}</td>
      <td>${it.factory_settlement_rmb == null ? '待反馈' : fmt(it.factory_settlement_rmb)}</td>
      <td>${fmt(it.final_cost_rmb ?? it.cost_rmb)}</td>
    </tr>`;
    if (!hasLining) return [mainRow];
    const liningRow = `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>内衬</td>
      <td>${fmt(b.liningTheoreticalUsageM)}</td>
      <td>${fmt(b.liningIssuedUsageM)}</td>
      <td>${fmt(c.liningCostRmb)}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>${fmt(liningEstimated)}</td>
      <td>-</td>
      <td>${it.factory_settlement_rmb == null ? '待反馈' : fmt(it.factory_settlement_rmb)}</td>
      <td>-</td>
    </tr>`;
    return [mainRow, liningRow];
  }).join('');
  const finalItems = (order.items || []).reduce((sum, it) => sum + (Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0), 0);
  const estimatedItems = (order.items || []).reduce((sum, it) => sum + (Number(it.estimated_cost_rmb) || Number(it.calc_detail?.estimatedCostRmb) || 0), 0);
  const hasActualCost = (order.items || []).some(it => it.final_cost_source === 'factory_settlement' || it.final_cost_source === 'factory_cost_total' || it.production_cost_override_rmb != null)
    || order.production_cost_override_rmb != null;
  const costPrefix = hasActualCost ? '实际' : '预计';
  if ($('costDetailContent')) $('costDetailContent').innerHTML = `<div class="cost-grid">
    <div><b>${costPrefix}成本</b><span>${fmt(estimatedItems + logistics)}</span></div>
    <div><b>项目成本</b><span>${fmt(finalItems)}</span></div>
    <div><b>物流成本（RMB）</b><span>${fmt(logistics)}</span></div>
    <div><b>成本合计</b><span>${fmt(finalItems + logistics)}</span></div>
  </div>
  <div class="table-wrap detail-table"><table>
    <thead><tr><th>品名/编号</th><th>材料类型</th><th>预计用料米数</th><th>发料用料米数</th><th>材料成本</th><th>加工</th><th>拼接</th><th>定型</th><th>系统预计</th><th>工厂实际</th><th>工厂结算</th><th>最终</th></tr></thead>
    <tbody>${itemRows || '<tr><td colspan="12" class="empty-cell">暂无成本数据。</td></tr>'}</tbody>
  </table></div>`;
}
function orderCostDiagnosticHtml(order) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const estimatedItems = (order.items || []).reduce((sum, it) => sum + (Number(it.estimated_cost_rmb) || Number(it.calc_detail?.estimatedCostRmb) || 0), 0);
  const finalItems = (order.items || []).reduce((sum, it) => sum + (Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0), 0);
  const factoryTotal = (order.items || []).reduce((sum, it) => sum + (Number(it.factory_cost_total_rmb) || 0), 0);
  const factorySettlement = (order.items || []).reduce((sum, it) => sum + (Number(it.factory_settlement_rmb) || 0), 0);
  const estimated = estimatedItems + logistics;
  const finalCost = finalItems + logistics;
  const diff = finalCost - estimated;
  const diffRate = estimated > 0 ? diff / estimated : 0;
  const source = (order.items || []).some(it => it.final_cost_source === 'factory_settlement')
    ? 'factory_settlement'
    : (order.items || []).some(it => it.final_cost_source === 'factory_cost_total')
      ? 'factory_cost_total'
      : 'estimated';
  const rows = (order.items || []).map(it => {
    const c = it.calc_detail || {};
    const b = c.costBreakdown || {};
    return `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>${fmt(b.mainFabricTheoreticalUsageM)}</td>
      <td>${fmt(b.mainFabricIssuedUsageM)}</td>
      <td>${fmt(b.mainFabricUnitPriceRmb)}</td>
      <td>${fmt(c.mainFabricCostRmb)}</td>
      <td>${fmt(b.liningTheoreticalUsageM)}</td>
      <td>${fmt(b.liningIssuedUsageM)}</td>
      <td>${fmt(b.liningUnitPriceRmb)}</td>
      <td>${fmt(c.liningCostRmb)}</td>
      <td>${fmt(c.laborCostRmb)}</td>
      <td>${fmt(c.spliceFeeRmb)}</td>
      <td>${fmt(c.memoryCostRmb)}</td>
      <td>${fmt(c.optionCostRmb)}</td>
      <td>${fmt(it.estimated_cost_rmb ?? c.estimatedCostRmb)}</td>
      <td>${fmt(it.factory_cost_total_rmb)}</td>
      <td>${fmt(it.factory_settlement_rmb)}</td>
      <td>${fmt(it.final_cost_rmb ?? it.cost_rmb)}</td>
    </tr>`;
  }).join('');
  const hasActualCostDiag = (order.items || []).some(it => it.final_cost_source === 'factory_settlement' || it.final_cost_source === 'factory_cost_total' || it.production_cost_override_rmb != null)
    || order.production_cost_override_rmb != null;
  const costPrefixDiag = hasActualCostDiag ? '实际' : '预计';
  return `
    <div class="cost-diagnostic">
      <h4>成本诊断</h4>
      <div class="detail-grid">
        <div><b>${costPrefixDiag}成本</b><span>${fmt(estimated)}</span></div>
        <div><b>工厂成本合计</b><span>${fmt(factoryTotal)}</span></div>
        <div><b>工厂结算</b><span>${fmt(factorySettlement)}</span></div>
        <div><b>最终采用</b><span>${fmt(finalCost)}</span></div>
        <div><b>最终来源</b><span>${esc(costSourceLabel(source))}</span></div>
        <div><b>偏差金额</b><span>${fmt(diff)}</span></div>
        <div><b>偏差比例</b><span>${fmt(diffRate * 100, 1)}%</span></div>
        <div><b>物流成本（RMB）</b><span>${fmt(logistics)}</span></div>
      </div>
      <div class="table-wrap detail-table"><table>
        <thead><tr><th>品名/编号</th><th>主面料理论m</th><th>主面料发料m</th><th>主面料单价</th><th>主面料成本</th><th>内衬理论m</th><th>内衬发料m</th><th>内衬单价</th><th>内衬成本</th><th>加工</th><th>拼接</th><th>定型</th><th>选项</th><th>系统预计</th><th>工厂实际</th><th>工厂结算</th><th>最终</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}
function orderPaymentBreakdown(order) {
  const usdRmb = USD_RMB_RATE;
  const salesUsd = Number(order.total_sales_usd) || 0;
  const taxUsd = Number(order.total_tax_usd) || 0;
  const grossUsd = salesUsd;
  const paypalFeeUsd = grossUsd * PAYPAL_FEE_RATE;
  const incomeAfterFeeUsd = grossUsd - paypalFeeUsd;
  const grossRmb = grossUsd * usdRmb;
  const incomeRmb = incomeAfterFeeUsd * usdRmb;
  const logisticsRmb = Number(order.logistics_cost_rmb) || 0;
  const incomeAfterLogisticsRmb = incomeRmb - logisticsRmb;
  return { salesUsd, taxUsd, grossUsd, grossRmb, paypalFeeUsd, incomeAfterFeeUsd, incomeRmb, logisticsRmb, incomeAfterLogisticsRmb };
}
function renderOrderSalesDetailModal(order) {
  const b = orderPaymentBreakdown(order);
  const hasOverride = order.sales_override_usd != null || order.tax_override_usd != null;
  const content = $('costDetailContent');
  if (!content) return;
  content.innerHTML = `<div class="cost-grid">
    <div><b>销售 USD（不含税）</b><span>${fmt(b.salesUsd)}</span></div>
    <div><b>税费 USD</b><span>${fmt(b.taxUsd)}</span></div>
    <div><b>实际销售 USD（含税）</b><span>${fmt(b.grossUsd)}</span></div>
    <div><b>扣手续费后收入 USD</b><span>${fmt(b.incomeAfterFeeUsd)}</span></div>
    <div><b>扣手续费后收入 RMB</b><span>${fmt(b.incomeRmb)}</span></div>
    <div><b>物流成本（RMB）</b><span>${fmt(b.logisticsRmb)}</span></div>
    <div><b>手续费与物流后收入 RMB</b><span>${fmt(b.incomeAfterLogisticsRmb)}</span></div>
  </div>
  <div class="financial-edit">
    <h4>金额修正${hasOverride ? '（已启用）' : ''}</h4>
    <div class="form-grid">
      <label>销售 USD（不含税）<input type="number" step="0.01" min="0" value="${fmt(b.salesUsd)}" data-financial-sales="${order.id}"></label>
      <label>税费 USD<input type="number" step="0.01" min="0" value="${fmt(b.taxUsd)}" data-financial-tax="${order.id}"></label>
    </div>
    <div class="actions">
      <button class="btn small primary" type="button" data-save-financial="${order.id}">保存金额修正</button>
      <button class="btn small secondary" type="button" data-clear-financial="${order.id}">恢复系统计算</button>
    </div>
  </div>`;
  const saveBtn = content.querySelector(`[data-save-financial="${order.id}"]`);
  const clearBtn = content.querySelector(`[data-clear-financial="${order.id}"]`);
  if (saveBtn) saveBtn.onclick = async () => {
    const sales = Number(content.querySelector(`[data-financial-sales="${order.id}"]`)?.value || 0);
    const tax = Number(content.querySelector(`[data-financial-tax="${order.id}"]`)?.value || 0);
    if (!Number.isFinite(sales) || sales < 0 || !Number.isFinite(tax) || tax < 0) {
      toast('销售金额和税费必须是非负数字', 'bad');
      return;
    }
    const res = await api.json(`/api/orders/${order.id}/financial`, {
      method: 'PUT',
      body: JSON.stringify({ sales_usd: sales, tax_usd: tax })
    });
    renderOrderSalesDetailModal(res.order);
    await loadOrders();
    toast('金额修正已保存');
  };
  if (clearBtn) clearBtn.onclick = async () => {
    const res = await api.json(`/api/orders/${order.id}/financial`, {
      method: 'PUT',
      body: JSON.stringify({ clear: true })
    });
    renderOrderSalesDetailModal(res.order);
    await loadOrders();
    toast('已恢复系统计算金额');
  };
}
function selectedOptions(product) {
  const out = {};
  (product?.options || []).forEach(o => out[o.option_key || o.key] = $(`opt_${o.option_key || o.key}`)?.value || '');
  return out;
}
function selectedOptionRows(product) {
  return (product?.options || []).map(o => {
    const key = o.option_key || o.key;
    const value = $(`opt_${key}`)?.value || '';
    const found = (o.values || []).find(v => String(v.label) === String(value)) || {};
    return {
      key,
      label: o.label || key,
      value,
      priceUsd: Number(found.price_usd ?? found.price ?? 0)
    };
  });
}
function renderOptionQuoteList(product = activeProduct()) {
  const list = $('optionQuoteList');
  if (!list) return;
  const rows = selectedOptionRows(product).filter(r => r.value);
  if (!rows.length) {
    list.innerHTML = '<div class="option-quote-empty">选择产品后显示选项报价</div>';
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="option-quote-row">
      <div>
        <b>${esc(r.label)}</b>
        <span>${esc(r.value)}</span>
      </div>
      <strong>${usd(r.priceUsd)}</strong>
    </div>
  `).join('');
}
function itemPayload() {
  const p = activeProduct();
  const useDiscount = $('applyDiscountToggle')?.checked;
  const options = selectedOptions(p);
  return {
    product_id: p?.id,
    qty: Number($('itemQty')?.value) || 1,
    width_in: Number($('itemWidth')?.value) || 0,
    length_in: Number($('itemLength')?.value) || 0,
    fabric_id: resolveProductFabricId(p),
    lining_id: resolveLiningIdFromOptions(p, options),
    fullness: Number($('itemFullness')?.value) || p?.default_fullness || 2,
    selected_options: options,
    actual_paid_usd: Number($('actualPaidUsd')?.value) || 0,
    apply_discount: useDiscount,
    discount_mode: $('discountMode')?.value || 'percent',
    discount_value: Number($('discountUsd')?.value) || 0,
    tax_rate: 0,
    room_label: '',
    remark: $('itemRemark')?.value || ''
  };
}

function resetBuilderDiscountState() {
  const discountMode = $('discountMode');
  const discountUsd = $('discountUsd');
  const applyDiscountToggle = $('applyDiscountToggle');
  if (discountMode) discountMode.value = 'percent';
  if (discountUsd) discountUsd.value = 0;
  if (applyDiscountToggle) applyDiscountToggle.checked = true;
  if (discountMode) discountMode.dispatchEvent(new Event('change'));
}
async function updatePreview() {
  try {
    const payload = itemPayload();
    if (!payload.product_id || !payload.width_in || !payload.length_in) return;
    const res = await api.json('/api/calc/item', { method: 'POST', body: JSON.stringify(payload) });
    state.preview = res;
    const discountEnabled = $('applyDiscountToggle')?.checked;
    const discountMode = $('discountMode')?.value || 'percent';
    const discountInput = Number($('discountUsd')?.value) || 0;
    const discountAmount = discountEnabled ? (discountMode === 'percent' ? res.systemPriceUsd * discountInput / 100 : discountInput) : 0;
    const discountedPrice = Math.max(0, res.systemPriceUsd - discountAmount);
    if ($('previewPrice')) $('previewPrice').textContent = usd(res.systemPriceUsd);
    if ($('previewDiscountedPrice')) $('previewDiscountedPrice').textContent = usd(discountedPrice);
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderOrderForm() {
  if ($('itemProduct')) fillSelect($('itemProduct'), state.products.filter(p => p.enabled !== false).map(p => ({ value: p.id, label: p.name })));
  if ($('spFabric')) fillSelect($('spFabric'), state.fabrics.filter(f => f.enabled).map(f => ({ value: f.id, label: f.name })));
  if ($('spLining')) fillSelect($('spLining'), [{ value: '', label: '无内衬' }, ...state.linings.filter(l => l.enabled && l.id !== 'lining_none').map(l => ({ value: l.id, label: l.name }))]);
  if ($('applyTaxToggle')) $('applyTaxToggle').checked = false;
  if ($('applyDiscountToggle')) $('applyDiscountToggle').checked = true;
  if ($('orderDate') && !$('orderDate').value) $('orderDate').value = today();
  if ($('deliveryDate') && $('orderDate')?.value) $('deliveryDate').value = addDays($('orderDate').value, 4);
  renderDynamicOptions();
}
function renderDynamicOptions() {
  const p = activeProduct();
  if ($('itemFullness')) $('itemFullness').value = p?.default_fullness || p?.defaultFullness || 2;
  if ($('dynamicOptions')) $('dynamicOptions').innerHTML = (p?.options || []).map(o => {
    const key = o.option_key || o.key;
    const opts = (o.values || []).map(v => `<option value="${esc(v.label)}">${esc(v.label)}${Number(v.price_usd || v.price) ? ` (+$${fmt(v.price_usd || v.price)})` : ''}</option>`).join('');
    return `<label>${esc(o.label)}<select id="opt_${esc(key)}">${opts}</select></label>`;
  }).join('');
  (p?.options || []).forEach(o => $(`opt_${o.option_key || o.key}`)?.addEventListener('change', () => {
    renderOptionQuoteList(p);
    updatePreview();
  }));
  renderOptionQuoteList(p);
  updatePreview();
}

function renderCurrentItems() {
  const items = state.currentItems || [];
  const table = $('orderItemsTable');
  const countEl = $('currentCount');
  if (!table) return;
  if (!items.length) {
    table.innerHTML = '<thead><tr><th>品名</th><th>尺寸</th><th>数量</th><th>系统售价</th><th>操作</th></tr></thead><tbody><tr><td colspan="5" class="empty-cell">暂无项目 — 在上方填写定制选项后点击"添加到当前订单"</td></tr></tbody>';
    if (countEl) countEl.textContent = '0 项';
    return;
  }
  const rows = items.map((it, idx) => {
    const p = state.products.find(pp => pp.id === it.payload.product_id) || {};
    const calc = it.calc || {};
    const name = esc(p.name || it.payload.product_id || '-');
    const w = it.payload.width_in || 0;
    const l = it.payload.length_in || 0;
    const size = w && l ? (w + ' x ' + l + ' inch') : '-';
    const priceUsd = Number(calc.systemPriceUsd) || 0;
    const priceRmb = priceUsd * USD_RMB_RATE;
    return '<tr>' +
      '<td>' + name + '</td>' +
      '<td>' + size + '</td>' +
      '<td>' + (it.payload.qty || 1) + '</td>' +
      '<td>' + usd(priceUsd) + ' / ' + rmb(priceRmb) + '</td>' +
      '<td><button class="btn small danger" onclick="state.currentItems.splice(' + idx + ', 1); renderCurrentItems();">删除</button></td>' +
    '</tr>';
  }).join('');
  const totalQty = items.reduce((s, it) => s + (it.payload.qty || 1), 0);
  table.innerHTML = '<thead><tr><th>品名</th><th>尺寸</th><th>数量</th><th>系统售价</th><th>操作</th></tr></thead><tbody>' + rows +
    '<tr class="order-summary-row"><td colspan="2"><b>合计</b></td><td>' + totalQty + '</td><td></td><td></td></tr></tbody>';
  if (countEl) countEl.textContent = items.length + ' 项';
}

async function addItem() {
  await updatePreview();
  if (!state.preview) return toast('请先完成项目计算', 'bad');
  state.currentItems.push({ payload: itemPayload(), calc: state.preview });
  renderCurrentItems();
  const continueEntry = confirm('已添加到当前订单。\n\n是否继续录入下一个产品？\n\n点击“确定”继续录入（仅清空尺寸），点击“取消”结束录入。');
  if (continueEntry) {
    if ($('itemWidth')) $('itemWidth').value = '';
    if ($('itemLength')) $('itemLength').value = '';
    if ($('itemRemark')) $('itemRemark').value = '';
    updatePreview();
  } else {
    ['itemWidth','itemLength','itemRemark'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if ($('itemQty')) $('itemQty').value = 1;
    if ($('actualPaidUsd')) $('actualPaidUsd').value = 0;
    resetBuilderDiscountState();
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    updatePreview();
  }
}
async function saveOrder() {
  if (!state.currentItems.length) {
    await updatePreview();
    if (state.preview) state.currentItems = [{ payload: itemPayload(), calc: state.preview }];
  }
  if (!state.currentItems.length) return toast('当前订单没有项目', 'bad');
  const btn = $('saveOrderBtn');
  btn?.classList.add('loading');
  btn.disabled = true;
  try {
    const body = {
      channel: ORDER_CHANNEL,
      order_no: $('orderNo').value,
      order_date: $('orderDate').value,
      delivery_date: $('deliveryDate').value,
      customer_name: $('customerName').value,
      customer_email: $('customerEmail').value,
      customer_phone: $('customerPhone').value,
      customer_address: $('shippingAddress').value,
      remark: $('orderRemark').value,
      items: state.currentItems.map(x => x.payload)
    };
    const res = await api.json('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    state.lastOrderId = res.order.id;
    state.currentItems = [];
    localStorage.removeItem('twodrapes_order_draft');
    renderCurrentItems();
    await loadOrders();
    toast('订单已保存，并已同步到管理端');
    if (btn) { btn.classList.add('btn-success'); setTimeout(() => btn.classList.remove('btn-success'), 600); }

    // 清空下单页面
    ['orderNo','customerName','customerEmail','customerPhone','shippingAddress','orderRemark','itemWidth','itemLength','itemRemark'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if ($('orderDate')) $('orderDate').value = today();
    if ($('deliveryDate') && $('orderDate')?.value) $('deliveryDate').value = addDays($('orderDate').value, 4);
    if ($('itemQty')) $('itemQty').value = 1;
    if ($('actualPaidUsd')) $('actualPaidUsd').value = 0;
    resetBuilderDiscountState();
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    updatePreview();
  } finally {
    btn?.classList.remove('loading');
    btn.disabled = false;
  }
}
function orderStatusInfo(order) {
  const map = {
    draft: { label: '草稿', cls: 'muted' },
    production: { label: '待发货', cls: 'warn' },
    shipping: { label: '已发货', cls: 'ship' },
    completed: { label: '完成', cls: 'good' }
  };
  const key = order.status || 'draft';
  return { key, ...(map[key] || { label: '未知', cls: 'muted' }) };
}
function profitClass(rate, profit) {
  if ((Number(profit) || 0) < 0 || (Number(rate) || 0) < .1) return 'bad';
  if ((Number(rate) || 0) < .3) return 'warn';
  return 'good';
}
function orderSearchText(order) {
  const items = order.items || [];
  return [
    order.order_no,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.order_date,
    order.delivery_date,
    ...items.flatMap(it => [it.item_code, it.product_name, it.fabric_name, it.lining_name, it.room_label, it.remark])
  ].join(' ').toLowerCase();
}
function currentOrderFilters() {
  return {
    q: ($('ordersSearchInput')?.value || '').trim().toLowerCase(),
    from: $('ordersDateFrom')?.value || '',
    to: $('ordersDateTo')?.value || '',
    status: $('ordersStatusFilter')?.value || '',
    product: $('ordersProductFilter')?.value || '',
    prodCost: $('ordersProdCostFilter')?.value || '',
    logisticsCost: $('ordersLogisticsCostFilter')?.value || ''
  };
}
function filteredOrders() {
  const f = currentOrderFilters();
  return (state.ordersCache || []).filter(order => {
    const status = orderStatusInfo(order);
    if (f.q && !orderSearchText(order).includes(f.q)) return false;
    if (f.from && String(order.order_date || '') < f.from) return false;
    if (f.to && String(order.order_date || '') > f.to) return false;
    if (f.status && status.key !== f.status) return false;
    if (f.product && !(order.items || []).some(it => String(it.product_id || it.product_name || '') === f.product)) return false;
    if (f.prodCost === 'entered' && order.production_cost_override_rmb == null) return false;
    if (f.prodCost === 'not_entered' && order.production_cost_override_rmb != null) return false;
    if (f.logisticsCost === 'entered' && !Number(order.logistics_cost_rmb)) return false;
    if (f.logisticsCost === 'not_entered' && Number(order.logistics_cost_rmb)) return false;
    return true;
  });
}
function populateOrdersProductFilter() {
  const select = $('ordersProductFilter');
  if (!select) return;
  const current = select.value;
  const products = new Map();
  (state.ordersCache || []).forEach(order => (order.items || []).forEach(it => {
    const key = String(it.product_id || it.product_name || '').trim();
    if (key) products.set(key, it.product_name || key);
  }));
  select.innerHTML = '<option value="">全部产品</option>' + Array.from(products.entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (products.has(current)) select.value = current;
}
function renderOrdersBulkBar() {
  const selected = Array.from(state.selectedOrderIds || []);
  if ($('ordersSelectedCount')) $('ordersSelectedCount').textContent = `已选 ${selected.length} 项`;
  $('ordersBulkBar')?.classList.toggle('hidden', selected.length === 0);
}
function closeAllOrderMenus() {
  document.querySelectorAll('.order-action-menu.open').forEach(m => m.classList.remove('open'));
}

function bindOrdersTableDelegation() {
  const ordersTable = $('ordersTable');
  if (!ordersTable || ordersTable.dataset.bound === '1') return;
  ordersTable.dataset.bound = '1';
  ordersTable.addEventListener('click', async (e) => {
    const viewBtn = e.target.closest('[data-view-modal]');
    if (viewBtn) {
      e.stopPropagation();
      viewOrderModal(viewBtn.dataset.viewModal, 'view');
      closeAllOrderMenus();
      return;
    }
    const menuBtn = e.target.closest('[data-order-menu]');
    if (menuBtn) {
      e.stopPropagation();
      const id = menuBtn.dataset.orderMenu;
      const menu = document.getElementById('orderMenu-' + id);
      if (!menu) return;
      const wasOpen = menu.classList.contains('open');
      closeAllOrderMenus();
      if (!wasOpen) menu.classList.add('open');
      return;
    }
    const exportBtn = e.target.closest('[data-export-row]');
    if (exportBtn) {
      e.stopPropagation();
      closeAllOrderMenus();
      const orderId = exportBtn.dataset.exportRow;
      const order = (state.ordersCache || []).find(o => String(o.id) === String(orderId));
      if (order) exportSingleFactoryOrder(order);
      return;
    }
    const deleteBtn = e.target.closest('[data-delete-order]');
    if (deleteBtn) {
      e.stopPropagation();
      closeAllOrderMenus();
      const orderId = deleteBtn.dataset.deleteOrder;
      if (!confirm('\u786e\u5b9a\u8981\u5220\u9664\u6b64\u8ba2\u5355\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002')) return;
      try {
        await api.json(`/api/orders/${orderId}`, { method: 'DELETE' });
        state.ordersCache = (state.ordersCache || []).filter(o => String(o.id) !== String(orderId));
        state.selectedOrderIds.delete(String(orderId));
        renderOrdersPanel();
        renderOrdersBulkBar();
        toast('\u8ba2\u5355\u5df2\u5220\u9664');
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
  });
}
async function exportSingleFactoryOrder(order) {
  try {
    const res = await fetch('/api/export/factory-orders-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [String(order.id)] })
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '导出失败'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `工厂生产单-${order.order_no || order.id}-${today()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出生产单');
  } catch (e) { toast(e.message, 'bad'); }
}
async function exportSelectedOrdersFactory() {
  const ids = Array.from(state.selectedOrderIds || []);
  if (!ids.length) return toast('请先选择订单', 'bad');
  try {
    const res = await fetch('/api/export/factory-orders-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '导出失败'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `工厂生产单-${today()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${ids.length} 个订单的生产单`);
  } catch (e) { toast(e.message, 'bad'); }
}
async function exportSelectedOrdersFull() {
  const ids = Array.from(state.selectedOrderIds || []);
  if (!ids.length) return toast('请先选择订单', 'bad');
  try {
    const res = await fetch('/api/export/orders-full-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, source: ORDER_CHANNEL })
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '导出失败'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `订单全部信息-${today()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${ids.length} 个订单的全部信息`);
  } catch (e) { toast(e.message, 'bad'); }
}
function exportCurrentItemsFactory() {
  const items = state.currentItems || [];
  if (!items.length) return toast('当前订单没有项目', 'bad');
  const isNoLining = label => /^(unlined|no lining|without lining|none|无内衬|不需要|no)$/i.test(String(label || '').trim());
  const isNoTieback = label => /^(no need|without|no|无|不需要)$/i.test(String(label || '').trim());
  const orderDate = $('orderDate')?.value || today();
  const mmdd = orderDate.slice(5, 7) + orderDate.slice(8, 10);
  const rows = items.map((it, seq) => {
    const calc = it.calc || {};
    const opts = calc.selectedOptions || {};
    const product = state.products.find(p => p.id === it.payload.product_id) || {};
    const defaultFabricId = product.default_fabric_id || it.payload.fabric_id || '';
    const fabricObj = state.fabrics.find(f => f.id === defaultFabricId);
    const fabricName = fabricObj?.name || defaultFabricId;
    const liningId = it.payload.lining_id || 'lining_none';
    const liningGroup = (product.options || []).find(g => /lining/i.test(g.label));
    const liningKey = liningGroup?.option_key || 'lining';
    const liningLabel = opts[liningKey] || '';
    const hasLining = liningId !== 'lining_none' && !isNoLining(liningLabel);
    const layer = hasLining ? '双层' : '单层';
    const itemCode = `定制-${fabricName}${layer} TWDZ${mmdd}-${seq + 1}`;
    const colorGroup = (product.options || []).find(g => /color/i.test(g.label));
    const colorKey = colorGroup?.option_key || 'color';
    const headerStyle = opts.hanging_header_style || opts.header_style || '';
    const memoryVal = opts.memory_shaped || '';
    const hasMemory = !/without|no|无/i.test(memoryVal);
    const tiebackVal = opts.tieback || opts.matching_tieback || '';
    const hasTieback = !isNoTieback(tiebackVal);
    const size = `W${it.payload.width_in}xL${it.payload.length_in}inch`;
    return {
      '订单时间': $('orderDate')?.value || today(),
      '品名/编号': itemCode,
      '面料': fabricName,
      '颜色': opts[colorKey] || '',
      '有无内衬': hasLining ? liningLabel : '无内衬',
      '顶部工艺/配件': headerStyle,
      '尺寸': size,
      '需做条数': it.payload.qty || 1,
      '是否需要记忆定型': hasMemory ? '是' : '否',
      '是否需要绑带': hasTieback ? '是' : '否',
      '韩哲/打孔/暗畔数': '',
      '铅块': hasLining ? '不需要' : '需要',
      '项目备注': it.payload.remark || ''
    };
  });
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const blob = new Blob(['\ufeff' + csvRows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `生产单-当前订单-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`已导出 ${items.length} 个项目的生产单`);
}
function renderOrdersPanel() {
  populateOrdersProductFilter();
  const all = filteredOrders();
  const totalPages = Math.max(1, Math.ceil(all.length / state.ordersPageSize));
  state.ordersPage = Math.min(Math.max(1, state.ordersPage), totalPages);
  const start = (state.ordersPage - 1) * state.ordersPageSize;
  const pageRows = all.slice(start, start + state.ordersPageSize);
  const headers = [
    '<input type="checkbox" id="ordersCheckAll">',
    '订单',
    '客户',
    '下单日期',
    '交期',
    '项目',
    '小计',
    '状态',
    ''
  ];
  const body = pageRows.length ? pageRows.flatMap((o, i) => {
    const items = o.items || [];
    const totalCount = items.length;
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const summaryText = totalCount ? `${totalCount}项 / ${totalQty || 0}条` : '无项目';
    const status = orderStatusInfo(o);
    const profitRate = Number(o.total_profit_rate) || 0;
    const profitCls = profitClass(profitRate, o.total_profit_rmb);
    const checked = state.selectedOrderIds.has(String(o.id)) ? ' checked' : '';
    const salesUsd = Number(o.total_sales_usd || 0);
    const itemSummary = items.length ? `<div class="order-items-list">${items.map(it => {
      const name = esc(it.product_name || '产品');
      const fabric = esc(it.fabric_name || '');
      const opts = it.selected_options || {};
      const prod = state.products.find(p => p.id === it.product_id) || {};
      const colorGroup = (prod.options || []).find(g => g.label === 'Color');
      const color = colorGroup ? (opts[colorGroup.option_key] || '') : '';
      const w = fmt(Number(it.width_in) || 0);
      const l = fmt(Number(it.length_in) || 0);
      const qty = Number(it.qty) || 1;
      const qtyLabel = qty > 1 ? ` x${qty}` : '';
      const details = [];
      if (color) details.push(`<span>颜色: ${esc(color)}</span>`);
      if (fabric) details.push(`<span>面料: ${fabric}</span>`);
      details.push(`<span>尺寸: ${w} x ${l} inch</span>`);
      return `<div class="order-item-expand"><span class="order-item-name">${name}${qtyLabel}</span><div class="order-item-detail">${details.join('')}</div></div>`;
    }).join('')}</div>` : '<span class="order-count-muted">无项目</span>';
    const headerRow = `<tr class="order-group-header" data-order-id="${o.id}">
      <td data-label="选择" class="order-select-cell"><input class="order-select-box" type="checkbox" data-order-check="${o.id}"${checked}></td>
      <td data-label="订单">
        <div class="order-primary">
          <strong class="order-no-link" data-view-modal="${o.id}"${totalCount ? '' : ' disabled'} style="cursor:pointer">${esc(o.order_no || '#' + o.id)}</strong>
          ${o.reminder ? `<span class="reminder-tag" title="${esc(o.reminder_text || '需要更新')}">需更新</span>` : ''}
        </div>
      </td>
      <td data-label="客户"><span class="order-customer">${esc(o.customer_name || '-')}</span></td>
      <td data-label="下单日期"><span class="order-date">${o.order_date || '-'}</span></td>
      <td data-label="交期"><span class="order-date">${o.delivery_date || '-'}</span></td>
      <td data-label="项目">${itemSummary}</td>
      <td data-label="小计"><span class="order-money">${usd(salesUsd)}</span></td>
      <td data-label="状态">
        <select class="order-status-select ${status.cls}" data-order-status="${o.id}">
          <option value="draft"${status.key === 'draft' ? ' selected' : ''}>草稿</option>
          <option value="production"${status.key === 'production' ? ' selected' : ''}>待发货</option>
          <option value="shipping"${status.key === 'shipping' ? ' selected' : ''}>已发货</option>
          <option value="completed"${status.key === 'completed' ? ' selected' : ''}>完成</option>
        </select>
      </td>
      <td class="order-row-actions">
        <button class="order-action-trigger" data-order-menu="${o.id}" type="button" title="操作">⋯</button>
        <div class="order-action-menu" id="orderMenu-${o.id}">
          <button data-view-modal="${o.id}" ${totalCount ? '' : 'disabled'}>查看详情</button>
          <button data-export-row="${o.id}">导出生产单</button>
          <div class="menu-divider"></div>
          <button class="danger" data-delete-order="${o.id}">删除订单</button>
        </div>
      </td>
    </tr>`;
    return [headerRow];
  }) : ['<tr><td colspan="9" class="empty-cell">未找到匹配的订单</td></tr>'];
  table($('ordersTable'), headers, body);
  const visibleIds = pageRows.map(o => String(o.id));
  if ($('ordersCheckAll')) {
    $('ordersCheckAll').checked = visibleIds.length > 0 && visibleIds.every(id => state.selectedOrderIds.has(id));
    $('ordersCheckAll').onchange = () => {
      visibleIds.forEach(id => $('ordersCheckAll').checked ? state.selectedOrderIds.add(id) : state.selectedOrderIds.delete(id));
      document.querySelectorAll('[data-order-check]').forEach(input => { input.checked = $('ordersCheckAll').checked; });
      renderOrdersBulkBar();
    };
  }
  document.querySelectorAll('[data-order-check]').forEach(input => {
    input.onchange = () => {
      const id = String(input.dataset.orderCheck);
      input.checked ? state.selectedOrderIds.add(id) : state.selectedOrderIds.delete(id);
      renderOrdersBulkBar();
      if ($('ordersCheckAll')) $('ordersCheckAll').checked = visibleIds.length > 0 && visibleIds.every(x => state.selectedOrderIds.has(x));
    };
  });
  document.querySelectorAll('[data-order-status]').forEach(select => {
    select.onchange = async () => {
      const orderId = select.dataset.orderStatus;
      const newStatus = select.value;
      const label = orderStatusInfo({ status: newStatus }).label;
      const cached = (state.ordersCache || []).find(o => String(o.id) === String(orderId));
      const prevStatus = cached ? cached.status : null;
      if (cached) cached.status = newStatus;
      renderOrdersPanel();
      try {
        await api.json(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
        toast(`状态已更新为「${label}」`);
      } catch (e) {
        if (cached && prevStatus) cached.status = prevStatus;
        renderOrdersPanel();
        toast(e.message, 'bad');
      }
    };
  });
  document.querySelectorAll('[data-view-modal]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      viewOrderModal(btn.dataset.viewModal, 'view');
      closeAllOrderMenus();
    };
  });
  // Per-row action dropdown
  document.querySelectorAll('[data-order-menu]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.orderMenu;
      const menu = document.getElementById('orderMenu-' + id);
      const wasOpen = menu.classList.contains('open');
      closeAllOrderMenus();
      if (!wasOpen) menu.classList.add('open');
    };
  });
  document.querySelectorAll('[data-export-row]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      closeAllOrderMenus();
      const orderId = btn.dataset.exportRow;
      const order = (state.ordersCache || []).find(o => String(o.id) === String(orderId));
      if (order) exportSingleFactoryOrder(order);
    };
  });
  document.querySelectorAll('[data-delete-order]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      closeAllOrderMenus();
      const orderId = btn.dataset.deleteOrder;
      if (!confirm('确定要删除此订单吗？此操作不可撤销。')) return;
      try {
        await api.json(`/api/orders/${orderId}`, { method: 'DELETE' });
        state.ordersCache = (state.ordersCache || []).filter(o => String(o.id) !== String(orderId));
        state.selectedOrderIds.delete(String(orderId));
        renderOrdersPanel();
        renderOrdersBulkBar();
        toast('订单已删除');
      } catch (err) { toast(err.message, 'bad'); }
    };
  });
  // Close menus on outside click
  document.addEventListener('click', closeAllOrderMenus, { once: true });
  if ($('ordersPager')) {
    $('ordersPager').innerHTML = `
      <span>共 ${all.length} 条</span>
      <button class="btn small secondary" id="ordersPrevPage" type="button"${state.ordersPage <= 1 ? ' disabled' : ''}>上一页</button>
      <span>第 ${state.ordersPage} / ${totalPages} 页</span>
      <button class="btn small secondary" id="ordersNextPage" type="button"${state.ordersPage >= totalPages ? ' disabled' : ''}>下一页</button>
      <label>每页 <select id="ordersPageSize"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select> 条</label>
    `;
    $('ordersPageSize').value = String(state.ordersPageSize);
    $('ordersPrevPage').onclick = () => { state.ordersPage -= 1; loadOrders(); };
    $('ordersNextPage').onclick = () => { state.ordersPage += 1; loadOrders(); };
    $('ordersPageSize').onchange = () => { state.ordersPageSize = Number($('ordersPageSize').value) || 50; state.ordersPage = 1; loadOrders(); };
  }
  renderOrdersBulkBar();
}
async function loadOrders() {
  const rows = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
  state.ordersCache = rows;
  const validIds = new Set(state.ordersCache.map(o => String(o.id)));
  state.selectedOrderIds = new Set(Array.from(state.selectedOrderIds || []).filter(id => validIds.has(String(id))));
  renderOrdersPanel();
  renderNotifyPanel();
}
let profitCurrentOrder = null;
let profitCurrentDetails = null;
function profitOrderLabel(order) {
  if (!order) return '';
  return order.order_no || '#' + order.id;
}
function profitOrderSearchText(order) {
  return [
    order.id,
    order.order_no,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.order_date
  ].filter(Boolean).join(' ').toLowerCase();
}
function closeProfitOrderResults() {
  const results = $('profitOrderSearchResults');
  if (results) results.classList.add('hidden');
}
function selectProfitOrder(order) {
  const sel = $('profitOrderSelect');
  const input = $('profitOrderSearchInput');
  if (!sel || !input) return;
  sel.value = order ? String(order.id) : '';
  input.value = order ? profitOrderLabel(order) : '';
  closeProfitOrderResults();
}
function renderProfitOrderSearchResults(query = '') {
  const results = $('profitOrderSearchResults');
  if (!results) return;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    closeProfitOrderResults();
    return;
  }
  const matches = state.profitOrderChoices
    .filter(order => profitOrderSearchText(order).includes(q))
    .slice(0, 30);

  if (!matches.length) {
    results.innerHTML = '<div class="profit-order-empty">未找到匹配订单</div>';
    results.classList.remove('hidden');
    return;
  }

  results.innerHTML = matches.map(order => `
    <button type="button" class="profit-order-option" data-profit-order-id="${order.id}" role="option">
      <span>${esc(order.order_no || '#' + order.id)}</span>
      <small>${esc(order.customer_name || '未知')} | ${esc(order.order_date || '')}</small>
    </button>
  `).join('');
  results.classList.remove('hidden');
  results.querySelectorAll('[data-profit-order-id]').forEach(btn => {
    btn.onclick = () => selectProfitOrder(state.profitOrderChoices.find(order => String(order.id) === btn.dataset.profitOrderId));
  });
}
async function loadProfitOrderList() {
  const orders = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
  const sel = $('profitOrderSelect');
  if (!sel) return;
  const previous = sel.value;
  state.profitOrderChoices = orders;
  sel.innerHTML = '<option value="">选择值订单...</option>' +
    orders.map(o => `<option value="${o.id}">${esc(profitOrderLabel(o))}</option>`).join('');
  const selected = orders.find(o => String(o.id) === String(previous));
  selectProfitOrder(selected || null);
}
async function loadProfitDetail() {
  const orderId = $('profitOrderSelect')?.value;
  if (!orderId) { toast('请先选择一个订单', 'warn'); return; }
  const order = await api.json(`/api/orders/${orderId}`);
  profitCurrentOrder = order;
  profitCurrentDetails = order;
  if ($('profitOrderLabel')) {
    $('profitOrderLabel').textContent = order.order_no || '#' + order.id;
    $('profitOrderLabel').className = 'pill';
  }
  const viewBtn = $('profitViewOrderBtn');
  if (viewBtn) {
    viewBtn.style.display = '';
    viewBtn.onclick = () => viewOrderModal(order.id, 'view');
  }
  const payment = orderPaymentBreakdown(order);
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const totalCost = Number(order.total_cost_rmb) || 0;
  const productionCost = totalCost - logistics;
  const totalProfit = Number(order.total_profit_rmb) || 0;
  const profitRate = Number(order.total_profit_rate) || 0;
  const orderAmount = Number(order.total_sales_usd) || 0;
  const orderAmountRmb = orderAmount * USD_RMB_RATE;
  const items = order.items || [];
  const hasActualCost = items.some(it => it.final_cost_source === 'factory_settlement' || it.final_cost_source === 'factory_cost_total' || it.production_cost_override_rmb != null)
    || order.production_cost_override_rmb != null;
  const prefix = hasActualCost ? '实际' : '预计';
  $('profitDetailEmpty')?.classList.add('hidden');
  $('profitDetailContent')?.classList.remove('hidden');
  let metricsHtml =
    '<div class="metrics">' +
    '<div><label>系统售价（RMB）</label><b>' + rmb(orderAmountRmb) + '</b></div>' +
    '<div><label>' + prefix + '成本（RMB）</label><b>' + rmb(totalCost) + '</b></div>' +
    '<div><label>' + prefix + '利润（RMB）</label><b>' + rmb(totalProfit) + '</b></div>' +
    '<div><label>' + prefix + '利润率</label><b>' + fmt(profitRate * 100, 1) + '%</b></div>' +
    (logistics > 0 ? '<div><label>物流成本（RMB）</label><b>' + rmb(logistics) + '</b></div>' : '') +
    '</div>';
  if ($('profitDetailContent')) $('profitDetailContent').innerHTML = metricsHtml;
  renderProfitAdjustForm(order, payment);
}
function renderProfitAdjustForm(order, payment) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const productionCostOverride = order.production_cost_override_rmb != null ? Number(order.production_cost_override_rmb) : '';
  const salesOverride = order.sales_override_usd != null ? Number(order.sales_override_usd) : '';
  const form = $('profitAdjustForm');
  if (!form) return;
  form.innerHTML =
    '<div class="form-grid compact">' +
    '<label>生产成本（RMB）<input type="number" id="profitAdjProductionCost" step="0.01" min="0" value="' + productionCostOverride + '" placeholder="留空使用系统值"></label>' +
    '<label>物流成本（RMB）<input type="number" id="profitAdjLogistics" step="0.01" min="0" value="' + fmt(logistics) + '"></label>' +
    '<label>订单金额 USD<input type="number" id="profitAdjSales" step="0.01" min="0" value="' + salesOverride + '" placeholder="留空使用系统值"></label>' +
    '</div>' +
    '<div class="actions"><button class="btn primary small" id="profitRecalcBtn">重新计算利润</button></div>';
  $('profitRecalcBtn').onclick = async () => {
    if (!confirm('确认重新计算并覆盖？此操作将更新订单的成本和利润数据。')) return;
    const productionCostVal = $('profitAdjProductionCost').value.trim();
    const newLogistics = Number($('profitAdjLogistics').value || 0);
    const salesVal = $('profitAdjSales').value.trim();
    try {
      const costPayload = { logistics_cost_rmb: newLogistics };
      if (productionCostVal !== '') costPayload.production_cost_override_rmb = Number(productionCostVal);
      else costPayload.production_cost_override_rmb = null;
      await api.json(`/api/orders/${order.id}/cost-overrides`, { method: 'PUT', body: JSON.stringify(costPayload) });
      if (salesVal !== '') {
        await api.json(`/api/orders/${order.id}/financial`, { method: 'PUT', body: JSON.stringify({ sales_usd: Number(salesVal), tax_usd: 0 }) });
      }
      toast('利润已重新计算');
      await loadProfitDetail();
    } catch (e) { toast(e.message, 'bad'); }
  };
}
function spliceNeedText(plan) {
  if (!plan) return '-';
  return plan.needSplice ? '需要拼接' : '无需拼接';
}
function renderCuttingDiagram(mainPlan, liningPlan, productLabel) {
  if (!mainPlan || !mainPlan.rollWidthCm) return '';
  const rollCm = mainPlan.rollWidthCm;
  const plan = mainPlan;
  const widthCm = plan.widthCm || 0;
  const heightCm = plan.cutHeightCm || plan.requiredHeightCm || 0;
  const widthNeedCm = plan.widthNeedCm || 0;
  const heightNeedCm = plan.heightNeedCm || 0;
  const needSplice = plan.needSplice;
  const panels = needSplice ? Math.max(2, Math.ceil(widthNeedCm / rollCm)) : 1;
  const actualPanelQty = plan.actualPanelQty || 1;
  const uid = 'cd' + Math.random().toString(36).slice(2, 8);

  const W = 800, PAD = 52, ROLL_W = W - PAD * 2 - 76;
  const rollH = 52, rollY = 46;
  let svg = `<svg viewBox="0 0 ${W} 310" xmlns="http://www.w3.org/2000/svg" class="cutting-diagram">`;
  svg += `<defs>
    <linearGradient id="${uid}-roll" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient>
    <linearGradient id="${uid}-panel" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#dbeafe"/><stop offset="100%" stop-color="#93c5fd"/></linearGradient>
    <linearGradient id="${uid}-lining" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fef3c7"/><stop offset="100%" stop-color="#fcd34d"/></linearGradient>
    <linearGradient id="${uid}-waste" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fef2f2"/><stop offset="100%" stop-color="#fee2e2"/></linearGradient>
    <marker id="${uid}-ae" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0,7 2.5,0 5" fill="#64748b"/></marker>
    <marker id="${uid}-as" markerWidth="7" markerHeight="5" refX="0" refY="2.5" orient="auto"><polygon points="7 0,0 2.5,7 5" fill="#64748b"/></marker>
    <filter id="${uid}-shadow" x="-5%" y="-10%" width="110%" height="130%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.08"/>
    </filter>
  </defs>`;

  const titleText = (productLabel ? `${productLabel} — ` : '') + (needSplice ? `需拼接 ×${panels}` : '无需拼接');
  svg += `<text x="${W/2}" y="24" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">${esc(titleText)}</text>`;

  svg += `<text x="${PAD}" y="${rollY - 12}" font-size="10" fill="#94a3b8" font-weight="500">面料卷（门幅 ${rollCm}cm）</text>`;
  svg += `<rect x="${PAD}" y="${rollY}" width="${ROLL_W}" height="${rollH}" rx="8" fill="url(#${uid}-roll)" stroke="#cbd5e1" stroke-width="1"/>`;

  const usableW = ROLL_W - 20;
  const singlePanelW = panels > 1 ? usableW / panels : usableW * Math.min(0.82, widthNeedCm / rollCm);
  const panelH = rollH - 12;
  const panelY = rollY + 6;
  const panelsStartX = PAD + (ROLL_W - panels * singlePanelW) / 2;
  for (let i = 0; i < Math.min(panels, 8); i++) {
    const px = panelsStartX + i * singlePanelW;
    svg += `<rect x="${px + 2}" y="${panelY}" width="${singlePanelW - 4}" height="${panelH}" rx="5" fill="url(#${uid}-panel)" stroke="#3b82f6" stroke-width="1.5" filter="url(#${uid}-shadow)"/>`;
    const label = panels > 1 ? `面料 ${i + 1}` : '面料';
    svg += `<text x="${px + singlePanelW / 2}" y="${panelY + panelH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#1e40af" font-weight="600">${label}</text>`;
  }
  for (let i = 1; i < Math.min(panels, 8); i++) {
    const sx = panelsStartX + i * singlePanelW;
    svg += `<line x1="${sx}" y1="${rollY}" x2="${sx}" y2="${rollY + rollH}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4"/>`;
  }

  const dimLx = PAD - 8;
  svg += `<line x1="${dimLx}" y1="${rollY + 4}" x2="${dimLx}" y2="${rollY + rollH - 4}" stroke="#64748b" stroke-width="1" marker-start="url(#${uid}-as)" marker-end="url(#${uid}-ae)"/>`;
  svg += `<rect x="${dimLx - 42}" y="${rollY + rollH/2 - 10}" width="40" height="20" rx="4" fill="#f8fafc" stroke="#e2e8f0" stroke-width="0.5"/>`;
  svg += `<text x="${dimLx - 22}" y="${rollY + rollH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#64748b" font-weight="600">${rollCm}cm</text>`;

  const dimRx = PAD + ROLL_W + 16;
  const rightLabel = needSplice ? `需 ${fmt(widthNeedCm)}cm` : `宽 ${fmt(widthCm)}cm`;
  svg += `<line x1="${dimRx}" y1="${rollY + 2}" x2="${dimRx}" y2="${rollY + rollH - 2}" stroke="#3b82f6" stroke-width="1" marker-start="url(#${uid}-as)" marker-end="url(#${uid}-ae)"/>`;
  svg += `<text x="${dimRx + 6}" y="${rollY + rollH / 2 + 1}" dominant-baseline="middle" font-size="11" fill="#3b82f6" font-weight="600">${rightLabel}</text>`;

  let infoY = rollY + rollH + 22;
  const parts = [
    { label: '高', value: `${fmt(heightCm)}cm`, color: '#059669' },
    { label: '用料', value: `${fmt(plan.factoryIssuedUsageM)} m`, color: '#0891b2' },
  ];
  if (actualPanelQty > 1) parts.push({ label: '片数', value: `${actualPanelQty}`, color: '#7c3aed' });
  if (needSplice) parts.push({ label: '拼接', value: `×${panels}`, color: '#dc2626' });
  
  const segW = 120;
  const totalW = parts.length * segW;
  let partX = (W - totalW) / 2;
  
  parts.forEach((p, i) => {
    svg += `<text x="${partX}" y="${infoY}" font-size="10" fill="#94a3b8" font-weight="500">${p.label}</text>`;
    svg += `<text x="${partX + 28}" y="${infoY}" font-size="11" fill="${p.color}" font-weight="600">${p.value}</text>`;
    partX += segW;
  });
  infoY += 20;

  if (liningPlan) {
    svg += `<rect x="${PAD}" y="${infoY}" width="${ROLL_W}" height="24" rx="6" fill="url(#${uid}-lining)" stroke="#f59e0b" stroke-width="1" filter="url(#${uid}-shadow)"/>`;
    const liningLabel = liningPlan.needSplice ? '内衬 · 需拼接' : '内衬';
    svg += `<text x="${PAD + ROLL_W / 2}" y="${infoY + 13}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#92400e" font-weight="600">${liningLabel}  |  用料 ${fmt(liningPlan.factoryIssuedUsageM)}m</text>`;
    infoY += 32;
  }

  const legY = infoY + 6;
  const legItems = [
    { type: 'rect', gradId: `${uid}-panel`, stroke: '#3b82f6', label: '主面料' },
  ];
  if (liningPlan) legItems.push({ type: 'rect', gradId: `${uid}-lining`, stroke: '#f59e0b', label: '内衬' });
  if (needSplice) legItems.push({ type: 'line', label: '拼接缝' });
  
  let legX = PAD;
  legItems.forEach(item => {
    if (item.type === 'line') {
      svg += `<line x1="${legX}" y1="${legY - 1}" x2="${legX + 16}" y2="${legY - 1}" stroke="#ef4444" stroke-width="2" stroke-dasharray="5,3"/>`;
      svg += `<text x="${legX + 20}" y="${legY + 1}" font-size="10" fill="#64748b">${item.label}</text>`;
      legX += 72;
    } else {
      svg += `<rect x="${legX}" y="${legY - 7}" width="12" height="12" rx="3" fill="url(#${item.gradId})" stroke="${item.stroke}" stroke-width="1"/>`;
      svg += `<text x="${legX + 16}" y="${legY + 1}" font-size="10" fill="#64748b">${item.label}</text>`;
      legX += 60;
    }
  });

  const layoutStartY = legY + 36;
  svg += `<line x1="${PAD}" y1="${legY + 14}" x2="${W - PAD}" y2="${legY + 14}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>`;
  const layoutInner = renderCuttingLayout(plan, liningPlan, uid, layoutStartY);
  svg += layoutInner;
  const layoutContentH = needSplice ? Math.min(panels, 5) * 36 + 52 : 112;
  const totalH = layoutStartY + layoutContentH;
  svg = svg.replace(`viewBox="0 0 ${W} 310"`, `viewBox="0 0 ${W} ${totalH}"`);
  svg += '</svg>';
  return svg;
}

function renderCuttingLayout(plan, liningPlan, uid, offsetY) {
  if (!plan || !plan.rollWidthCm) return '';
  const rollCm = plan.rollWidthCm;
  const widthNeedCm = plan.widthNeedCm || 0;
  const heightNeedCm = plan.heightNeedCm || 0;
  const heightCm = plan.cutHeightCm || plan.requiredHeightCm || 0;
  const needSplice = plan.needSplice;
  const panels = needSplice ? Math.max(2, Math.ceil(widthNeedCm / rollCm)) : 1;
  const fullness = plan.fullness || 2;
  const topHem = plan.topHemCm || 10;
  const bottomHem = plan.bottomHemCm || 5;
  const layerLoss = plan.layerLossCm || 9;
  const finishedH = plan.heightCm || 0;

  const LW = 800, LPAD = 52, L_ROLL_W = LW - LPAD * 2;
  const oy = offsetY || 0;
  const stripH = 40, stripY = 24 + oy;
  let svg = '';

  svg += `<text x="${LW/2}" y="${4 + oy}" text-anchor="middle" font-size="11" font-weight="600" fill="#475569">裁片排布（俯视 · 按比例）</text>`;
  svg += `<rect x="${LPAD}" y="${stripY}" width="${L_ROLL_W}" height="${stripH}" rx="6" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>`;

  if (!needSplice) {
    const fitsDirectly = widthNeedCm <= rollCm;
    const cutWidthCm = fitsDirectly ? widthNeedCm : heightNeedCm;
    const panelPx = Math.min(cutWidthCm * (L_ROLL_W / rollCm), L_ROLL_W);
    const wastePx = L_ROLL_W - panelPx;
    const panelX = LPAD + wastePx / 2;

    svg += `<rect x="${panelX}" y="${stripY + 4}" width="${panelPx}" height="${stripH - 8}" rx="5" fill="url(#${uid}-panel)" stroke="#3b82f6" stroke-width="1.5" filter="url(#${uid}-shadow)"/>`;
    if (panelPx > 60) {
      svg += `<text x="${panelX + panelPx / 2}" y="${stripY + stripH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#1e40af" font-weight="600">${fmt(cutWidthCm)}cm</text>`;
    }
    if (wastePx > 30) {
      const halfW = wastePx / 2 - 2;
      if (halfW > 16) {
        svg += `<rect x="${LPAD}" y="${stripY + 4}" width="${halfW}" height="${stripH - 8}" rx="4" fill="url(#${uid}-waste)" stroke="#fca5a5" stroke-width="0.5" stroke-dasharray="4,3"/>`;
        svg += `<rect x="${panelX + panelPx + 2}" y="${stripY + 4}" width="${halfW}" height="${stripH - 8}" rx="4" fill="url(#${uid}-waste)" stroke="#fca5a5" stroke-width="0.5" stroke-dasharray="4,3"/>`;
        if (halfW > 22) {
          svg += `<text x="${LPAD + halfW / 2}" y="${stripY + stripH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#dc2626" font-weight="500">余料</text>`;
          svg += `<text x="${panelX + panelPx + 2 + halfW / 2}" y="${stripY + stripH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#dc2626" font-weight="500">余料</text>`;
        }
      }
    }
    const arrowY = stripY - 4;
    svg += `<line x1="${panelX}" y1="${arrowY}" x2="${panelX + panelPx}" y2="${arrowY}" stroke="#3b82f6" stroke-width="1" marker-start="url(#${uid}-as)" marker-end="url(#${uid}-ae)"/>`;
    const cutLabel = fitsDirectly ? `宽方向需用 ${fmt(widthNeedCm)}cm` : `旋转裁剪 · 高 ${fmt(heightNeedCm)}cm`;
    svg += `<text x="${panelX + panelPx / 2}" y="${arrowY - 5}" text-anchor="middle" font-size="10" fill="#3b82f6" font-weight="600">${cutLabel}</text>`;
  } else {
    const rowH = 30, gap = 6;
    for (let i = 0; i < Math.min(panels, 5); i++) {
      const py = stripY + i * (rowH + gap);
      svg += `<rect x="${LPAD}" y="${py}" width="${L_ROLL_W}" height="${rowH}" rx="5" fill="url(#${uid}-panel)" stroke="#3b82f6" stroke-width="1.5" filter="url(#${uid}-shadow)"/>`;
      svg += `<text x="${LPAD + L_ROLL_W / 2}" y="${py + rowH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#1e40af" font-weight="600">面料 ${i + 1} — 全幅 ${rollCm}cm</text>`;
      if (i < panels - 1) {
        const ly = py + rowH + gap / 2;
        svg += `<line x1="${LPAD}" y1="${ly}" x2="${LPAD + L_ROLL_W}" y2="${ly}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6,3"/>`;
      }
    }
    svg += `<text x="${LPAD + L_ROLL_W + 8}" y="${stripY + 12}" font-size="10" fill="#3b82f6" font-weight="600">总需 ${fmt(widthNeedCm)}cm</text>`;
    const lastUsable = rollCm - (panels * rollCm - widthNeedCm);
    svg += `<text x="${LPAD + L_ROLL_W + 8}" y="${stripY + 26}" font-size="9" fill="#94a3b8">末片 ${fmt(lastUsable)}cm</text>`;
  }

  const infoY = needSplice ? stripY + Math.min(panels, 5) * 36 + 14 : stripY + stripH + 22;
  const hParts = [];
  if (finishedH > 0) hParts.push({ label: '成品高', value: `${fmt(finishedH)}cm` });
  hParts.push({ label: '工艺', value: `上衬${topHem} + 底边${bottomHem} + 损耗${layerLoss}cm` });
  hParts.push({ label: '褶皱', value: `×${fullness}` });
  
  const hSegW = 180;
  const hTotalW = hParts.length * hSegW;
  let infoX = (LW - hTotalW) / 2;
  
  hParts.forEach((p, i) => {
    svg += `<text x="${infoX}" y="${infoY}" font-size="9" fill="#94a3b8" font-weight="500">${p.label}</text>`;
    svg += `<text x="${infoX + 40}" y="${infoY}" font-size="10" fill="#475569" font-weight="500">${p.value}</text>`;
    infoX += hSegW;
  });

  return svg;
}
function openCuttingDiagram(mainPlan, liningPlan, title, productLabel) {
  const modal = $('cuttingDiagramModal');
  const content = $('cuttingDiagramContent');
  if (!modal || !content) return;
  const h3 = modal.querySelector('h3');
  if (h3 && title) h3.textContent = title;
  const svg = renderCuttingDiagram(mainPlan, liningPlan, productLabel);
  content.innerHTML = svg ? `<div class="cutting-diagram-figure">${svg}</div>` : '<p class="muted">无可用示意图数据。</p>';
  modal.classList.remove('hidden');
}
function openCuttingDiagramMulti(items, title) {
  const modal = $('cuttingDiagramModal');
  const content = $('cuttingDiagramContent');
  if (!modal || !content) return;
  const h3 = modal.querySelector('h3');
  if (h3 && title) h3.textContent = title;
  const svgs = items.map(it => {
    const label = it.label || '';
    const svg = renderCuttingDiagram(it.mainPlan, it.liningPlan, label);
    if (!svg) return '';
    return `<div class="cutting-diagram-figure">${svg}</div>`;
  }).filter(Boolean).join('');
  content.innerHTML = svgs || '<p class="muted">无可用示意图数据。</p>';
  modal.classList.remove('hidden');
}
function spliceSummaryHtml(items, note = '') {
  return `<div class="splice-summary-grid">${items.map(item => `
    <div class="splice-summary-item">
      <b>${esc(item.label)}</b>
      <span>${esc(item.value)}</span>
    </div>`).join('')}</div>${note ? `<div class="splice-summary-note">${esc(note)}</div>` : ''}`;
}
function spliceOrderLabel(order) {
  if (!order) return '';
  return order.order_no || '#' + order.id;
}
function syncSpliceOrderSelect(orderId) {
  const sel = $('spliceOrderSelect');
  if (!sel) return;
  const value = String(orderId || '');
  if (!value) {
    sel.value = '';
    return;
  }
  if (!Array.from(sel.options).some(opt => opt.value === value)) {
    const order = state.spliceOrderChoices.find(o => String(o.id) === value);
    sel.add(new Option(order ? spliceOrderLabel(order) : value, value));
  }
  sel.value = value;
}
function clearSpliceOrderSelection() {
  state.spliceSelectedOrderId = '';
  syncSpliceOrderSelect('');
  if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = '';
  if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = '未选择订单';
  $('spliceOrderItems')?.classList.add('hidden');
  $('spliceOrderResults')?.classList.add('hidden');
  updateSpliceSelectionState();
}
function selectSpliceOrder(order) {
  if (!order) {
    clearSpliceOrderSelection();
    return;
  }
  state.spliceSelectedOrderId = String(order.id);
  syncSpliceOrderSelect(order.id);
  if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = spliceOrderLabel(order);
  $('spliceOrderSearchResults')?.classList.add('hidden');
  loadSpliceOrderItems();
}
async function loadSpliceOrderList() {
  const currentId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value || '';
  try {
    const rows = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
    state.spliceOrderChoices = Array.isArray(rows) ? rows : [];
    const sel = $('spliceOrderSelect');
    if (sel) {
      sel.innerHTML = '<option value="">选择订单...</option>' + state.spliceOrderChoices.map(o => `<option value="${esc(o.id)}">${esc(spliceOrderLabel(o))}</option>`).join('');
    }
    const current = state.spliceOrderChoices.find(o => String(o.id) === String(currentId));
    if (current) {
      state.spliceSelectedOrderId = String(current.id);
      syncSpliceOrderSelect(current.id);
      if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = spliceOrderLabel(current);
      await loadSpliceOrderItems();
    } else if (!currentId) {
      clearSpliceOrderSelection();
    } else {
      clearSpliceOrderSelection();
    }
  } catch (e) {
    toast('加载订单列表失败: ' + e.message, 'bad');
  }
}
function renderManualSpliceSummary(res) {
  const plans = [res.mainPlan, res.liningPlan].filter(Boolean);
  const totalBaseM = plans.reduce((sum, p) => sum + (Number(p.baseUsageM) || 0), 0);
  const totalIssuedM = plans.reduce((sum, p) => sum + (Number(p.factoryIssuedUsageM) || 0), 0);
  const spliceCount = plans.filter(p => p.needSplice).length;
  if ($('manualSpliceSummary')) $('manualSpliceSummary').textContent = spliceCount ? `${spliceCount} 项需拼接` : '无需拼接';
  if ($('manualSpliceResult')) {
    $('manualSpliceResult').classList.remove('empty');
    const items = [
      { label: '主面料', value: spliceNeedText(res.mainPlan) },
      { label: '内衬', value: res.liningPlan ? spliceNeedText(res.liningPlan) : '无内衬' },
      { label: '理论用料', value: `${fmt(totalBaseM)} m` },
      { label: '下料用料', value: `${fmt(totalIssuedM)} m` }
    ];
    $('manualSpliceResult').innerHTML = spliceSummaryHtml(items, res.mainPlan?.description || '');
  }
  const fabricSel = $('spFabric');
  const fabricName = fabricSel?.options[fabricSel.selectedIndex]?.text || '';
  const w = $('spWidth')?.value || '';
  const l = $('spLength')?.value || '';
  const spliceLabel = [fabricName, w && l ? `${w}×${l} inch` : ''].filter(Boolean).join(' ');
  state.spliceDiagramPlans = { mainPlan: res.mainPlan, liningPlan: res.liningPlan, label: spliceLabel };
  const hasSvg = renderCuttingDiagram(res.mainPlan, res.liningPlan, spliceLabel);
  if ($('manualSpliceDiagramBtn')) {
    $('manualSpliceDiagramBtn').classList.toggle('hidden', !hasSvg);
  }
}
function updateSpliceSelectionState() {
  const all = Array.from(document.querySelectorAll('.splice-item-check'));
  const checked = all.filter(cb => cb.checked);
  if ($('spliceSelectedCount')) $('spliceSelectedCount').textContent = `已选 ${checked.length} / ${all.length} 项`;
  if ($('spliceCheckAll')) $('spliceCheckAll').checked = all.length > 0 && checked.length === all.length;
  if ($('spliceSelectAllBtn')) $('spliceSelectAllBtn').textContent = checked.length === all.length && all.length ? '取消全选' : '全选';
}
async function calcSplice() {
  const fabricEl = $('spFabric');
  const widthEl = $('spWidth');
  const lengthEl = $('spLength');
  const qtyEl = $('spQty');
  const fullnessEl = $('spFullness');
  const liningEl = $('spLining');
  const layerEl = $('spLayer');
  if (!fabricEl || !widthEl || !lengthEl || !fullnessEl) return;
  const liningId = liningEl?.value || '';
  const layer = layerEl?.value || 'single';
  const btn = $('calcSpliceBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await api.json('/api/calc/material-plan', { method: 'POST', body: JSON.stringify({ fabric_id: fabricEl.value, width_in: widthEl.value, length_in: lengthEl.value, fullness: fullnessEl.value, layer, lining_id: liningId }) });
    renderManualSpliceSummary(res);
    const plans = [res.mainPlan, res.liningPlan].filter(Boolean);
    const spliceNeeded = plans.some(p => p.needSplice);
    if (spliceNeeded) {
      toast('⚠️ 需要拼接面料，请确认用量。', 'warn');
    }
    const rows = [['主面料', res.mainPlan], ['内衬', res.liningPlan]].filter(x => x[1]).map(([name, p]) => `<tr><td>${name}</td><td>${p.needSplice ? '是' : '否'}</td><td>${fmt(p.baseUsageM)}</td><td>${fmt(p.factoryIssuedUsageM)}</td><td>${esc(p.description)}</td></tr>`);
    table($('manualSpliceTable'), ['材料', '是否拼接', '基础用量 m', '下料用量 m', '说明'], rows);
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function loadSpliceOrderItems() {
  const orderId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value;
  if (!orderId) {
    $('spliceOrderItems')?.classList.add('hidden');
    $('spliceOrderResults')?.classList.add('hidden');
    if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = '未选择订单';
    updateSpliceSelectionState();
    return;
  }
  try {
    state.spliceSelectedOrderId = String(orderId);
    syncSpliceOrderSelect(orderId);
    const order = await api.json(`/api/orders/${orderId}`);
    const items = order.items || [];
    if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = `${order.order_no || '#' + order.id} / ${items.length} 项`;
    if (!items.length) { $('spliceOrderItems')?.classList.add('hidden'); toast('该订单无项目', 'warn'); updateSpliceSelectionState(); return; }
    $('spliceOrderItems')?.classList.remove('hidden');
    $('spliceOrderResults')?.classList.add('hidden');
    const rows = items.map((it, idx) => {
      const checked = ' checked';
      return `<tr>
        <td><input type="checkbox" class="splice-item-check" data-splice-idx="${idx}"${checked}></td>
        <td>${esc(it.item_code || '')}</td>
        <td>${esc(it.product_name || '')}</td>
        <td>${fmt(Number(it.width_in) || 0, 0)} x ${fmt(Number(it.length_in) || 0, 0)}</td>
        <td>${it.qty || 1}</td>
        <td>${esc(it.fabric_name || '')}</td>
        <td>${esc(it.lining_name || '无内衬')}</td>
      </tr>`;
    });
    table($('spliceOrderItemsTable'), ['<input type="checkbox" id="spliceCheckAll" checked>', '编号', '产品', '尺寸 inch', '数量', '面料', '内衬'], rows);
    $('spliceCheckAll').onchange = () => {
      document.querySelectorAll('.splice-item-check').forEach(cb => { cb.checked = $('spliceCheckAll').checked; });
      updateSpliceSelectionState();
    };
    document.querySelectorAll('.splice-item-check').forEach(cb => {
      cb.onchange = () => {
        updateSpliceSelectionState();
      };
    });
    updateSpliceSelectionState();
  } catch (e) { toast('加载订单项目失败: ' + e.message, 'bad'); }
}
async function calcSpliceForOrder() {
  const orderId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value;
  if (!orderId) return toast('请先选择订单', 'warn');
  const btn = $('spliceCalcOrderBtn');
  if (btn) btn.disabled = true;
  try {
    const order = await api.json(`/api/orders/${orderId}`);
    const items = order.items || [];
    const checks = document.querySelectorAll('.splice-item-check');
    const selectedIdxs = Array.from(checks).filter(cb => cb.checked).map(cb => Number(cb.dataset.spliceIdx));
    if (!selectedIdxs.length) return toast('请至少选择一个项目', 'warn');
    const selectedItems = selectedIdxs.map(i => items[i]).filter(Boolean);
    const results = [];
    for (const it of selectedItems) {
      const fabricId = it.fabric_id || '';
      const liningId = it.lining_id || '';
      const calc = it.calc_detail || {};
      const fullness = Number(it.fullness) || Number(calc.fullness) || 2;
      const layer = calc.details?.layer || (liningId && liningId !== 'lining_none' ? 'double' : 'single');
      try {
        const res = await api.json('/api/calc/material-plan', { method: 'POST', body: JSON.stringify({ fabric_id: fabricId, width_in: it.width_in, length_in: it.length_in, qty: it.qty, fullness, layer, lining_id: liningId }) });
        results.push({ item: it, mainPlan: res.mainPlan, liningPlan: res.liningPlan, warnings: res.warnings || [] });
      } catch (e) {
        results.push({ item: it, error: e.message });
      }
    }
    $('spliceOrderResults')?.classList.remove('hidden');
    const allWarnings = results.flatMap(r => r.warnings || []);
    const validResults = results.filter(r => !r.error);
    const plans = validResults.flatMap(r => [r.mainPlan, r.liningPlan].filter(Boolean));
    const totalBaseM = plans.reduce((sum, p) => sum + (Number(p.baseUsageM) || 0), 0);
    const totalIssuedM = plans.reduce((sum, p) => sum + (Number(p.factoryIssuedUsageM) || 0), 0);
    const splicePlans = plans.filter(p => p.needSplice).length;
    if (splicePlans > 0) {
      toast(`⚠️ ${splicePlans} 项材料需要拼接，请确认用量。`, 'warn');
    }
    let html = '<div class="splice-summary">' + spliceSummaryHtml([
      { label: '选中项目', value: `${selectedItems.length} 项` },
      { label: '需拼接材料', value: `${splicePlans} 项` },
      { label: '理论用料', value: `${fmt(totalBaseM)} m` },
      { label: '下料用料', value: `${fmt(totalIssuedM)} m` }
    ], '计算完成。') + '</div>';
    const rows = results.flatMap(r => {
      if (r.error) return [`<tr><td colspan="7">${esc(r.item.item_code || '')}</td><td colspan="6" class="bad">计算失败: ${esc(r.error)}</td></tr>`];
      return [['主面料', r.mainPlan], ['内衬', r.liningPlan]].filter(x => x[1]).map(([name, p]) => `<tr><td>${esc(r.item.item_code || '')}</td><td>${name}</td><td>${p.needSplice ? '是' : '否'}</td><td>${fmt(p.baseUsageM)}</td><td>${fmt(p.factoryIssuedUsageM)}</td><td>${esc(p.description)}</td></tr>`);
    });
    if ($('spliceOrderResultContent')) $('spliceOrderResultContent').innerHTML = html;
    table($('spliceOrderResultTable'), ['编号', '材料', '是否拼接', '基础用量 m', '下料用量 m', '说明'], rows);
    state.spliceOrderDiagramPlans = validResults.map(r => {
      const code = r.item.item_code || '';
      const name = r.item.product_name || '';
      const size = `${fmt(Number(r.item.width_in) || 0, 0)}×${fmt(Number(r.item.length_in) || 0, 0)} inch`;
      const parts = [code, name, size].filter(Boolean);
      return { label: parts.join(' | '), mainPlan: r.mainPlan, liningPlan: r.liningPlan };
    });
    const hasAnySvg = validResults.some(r => renderCuttingDiagram(r.mainPlan, r.liningPlan));
    if ($('spliceOrderDiagramBtn')) {
      $('spliceOrderDiagramBtn').classList.toggle('hidden', !hasAnySvg);
    }
  } catch (e) {
    toast('订单拼接计算失败: ' + e.message, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function loadArchivedProducts() {
  const content = $('archivedProductsContent');
  const modal = $('archivedProductsModal');
  if (!content || !modal) return;
  content.innerHTML = '<p class="muted">加载中...</p>';
  modal.classList.remove('hidden');
  try {
    const products = await api.json(`/api/products/archived?channel=${ORDER_CHANNEL}`);
    if (!products.length) {
      content.innerHTML = '<p class="muted">没有已归档的产品。</p>';
      return;
    }
    content.innerHTML = `<div class="archived-products-list">${products.map(p => `
      <div class="archived-product-item">
        <div class="archived-product-info">
          <strong>${esc(p.name)}</strong>
          <span class="muted">${esc(p.id)}</span>
        </div>
        <button class="btn small primary" data-unarchive="${esc(p.id)}">恢复</button>
      </div>
    `).join('')}</div>`;
    content.querySelectorAll('[data-unarchive]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.unarchive;
        if (!confirm('确认恢复此产品？')) return;
        try {
          await api.json(`/api/products/${id}/unarchive?channel=${ORDER_CHANNEL}`, { method: 'PUT' });
          toast('产品已恢复');
          await loadArchivedProducts();
          await loadAll();
        } catch (e) { toast(e.message, 'bad'); }
      };
    });
  } catch (e) {
    content.innerHTML = `<p class="bad">加载失败: ${esc(e.message)}</p>`;
  }
}
function renderProductEditor() {
  if ($('editProductSelect')) fillSelect($('editProductSelect'), state.products.map(p => ({ value: p.id, label: p.name })), $('editProductSelect').value || state.products[0]?.id);
  if ($('editDefaultFabric')) fillSelect($('editDefaultFabric'), state.fabrics.map(f => ({ value: f.id, label: f.name })));
  renderProductListPanel();
  loadProductEditor();
}
function renderProductListPanel(filter = '') {
  const panel = $('productListPanel');
  if (!panel) return;
  const currentId = $('editProductSelect')?.value || state.products[0]?.id || '';
  const q = String(filter || $('productSearchInput')?.value || '').trim().toLowerCase();
  const filtered = state.products.filter(p => !q || (p.name || '').toLowerCase().includes(q));
  if (!filtered.length) {
    panel.innerHTML = `<div class="product-list-empty">${q ? '无匹配产品' : '暂无产品'}</div>`;
    return;
  }
  panel.innerHTML = filtered.map(p => `<button type="button" class="product-list-item${p.id === currentId ? ' active' : ''}" data-product-id="${esc(p.id)}">${esc(p.name)}${p.enabled === false ? ' <span class="muted">(已禁用)</span>' : ''}</button>`).join('');
  panel.querySelectorAll('.product-list-item').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.productId;
      if ($('editProductSelect')) $('editProductSelect').value = id;
      renderProductListPanel();
      loadProductEditor();
    };
  });
}
function priceRows(tableId, rows = []) {
  table($(tableId), ['尺寸 inch', '价格 USD', '操作'], rows.map(r => `<tr><td><input type="number" step="0.01" value="${r.size_in ?? r.size ?? ''}"></td><td><input type="number" step="0.01" value="${r.price_usd ?? r.price ?? 0}"></td><td><button class="btn small danger" onclick="this.closest('tr').remove()">删除</button></td></tr>`));
}
function loadProductEditor() {
  const p = state.products.find(x => x.id === $('editProductSelect')?.value) || state.products[0];
  if (!p) return;
  if ($('editName')) $('editName').value = p.name || '';
  if ($('editDefaultFabric')) $('editDefaultFabric').value = p.default_fabric_id || p.defaultFabricId || '';
  if ($('editBasePrice')) $('editBasePrice').value = p.base_price || p.basePrice || 0;
  if ($('widthPriceTable')) priceRows('widthPriceTable', p.width_prices || p.widthPrices);
  if ($('lengthPriceTable')) priceRows('lengthPriceTable', p.length_prices || p.lengthPrices);
  renderOptionGroups(p.options || []);
}
function collectPriceRows(tableId) {
  const el = $(tableId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('tbody tr')).map(tr => ({ size_in: Number(tr.children[0]?.querySelector('input')?.value), price_usd: Number(tr.children[1]?.querySelector('input')?.value) })).filter(r => r.size_in > 0);
}
function renderOptionGroups(options) {
  optionEditor.groups = (options || []).map((o, idx) => ({
    option_key: o.option_key || o.key || `option_${idx + 1}`,
    label: o.label || '',
    type: 'dropdown',
    factory: true,
    required: true,
    priceable: true,
    costable: true,
    values: (o.values || []).map(v => ({
      label: v.label || '',
      price_usd: Number(v.price_usd ?? v.price) || 0,
      cost_rmb: Number(v.cost_rmb ?? v.costRmb) || 0
    }))
  }));
  optionEditor.activeIndex = Math.min(optionEditor.activeIndex || 0, Math.max(optionEditor.groups.length - 1, 0));
  renderOptionGroupsEditor();
}
function renderOptionGroupsEditor() {
  const root = $('optionGroupsEditor');
  if (!root) return;
  const list = optionEditor.groups.map((g, i) => `
    <div class="option-group-list-item ${i === optionEditor.activeIndex ? 'active' : ''}" data-option-group="${i}" draggable="true">
      <button class="btn small secondary option-drag-handle" type="button" data-option-drag-handle="${i}" title="拖动排序">⠿</button>
      <input class="option-group-label" data-option-label="${i}" value="${esc(g.label || '')}" placeholder="选项组名称">
      <div class="option-group-actions">
        <button class="btn small secondary" type="button" data-option-select="${i}">编辑</button>
        <button class="btn small danger" type="button" data-option-del-group="${i}">删除</button>
      </div>
    </div>
  `).join('');
  root.innerHTML = `
    <div class="option-group-list">${list || '<div class="option-group-detail-empty">暂无选项组</div>'}</div>
    <div class="option-group-detail">${renderOptionValuesEditor()}</div>
  `;
  root.querySelectorAll('[data-option-label]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = Number(e.target.dataset.optionLabel);
      if (optionEditor.groups[idx]) optionEditor.groups[idx].label = e.target.value;
    });
  });
  root.querySelectorAll('[data-option-select]').forEach(btn => {
    btn.onclick = () => {
      optionEditor.activeIndex = Number(btn.dataset.optionSelect);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-del-group]').forEach(btn => {
    btn.onclick = () => {
      if (!confirm('确认删除此选项组？')) return;
      const idx = Number(btn.dataset.optionDelGroup);
      optionEditor.groups.splice(idx, 1);
      if (optionEditor.activeIndex >= optionEditor.groups.length) optionEditor.activeIndex = Math.max(optionEditor.groups.length - 1, 0);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-add-value]').forEach(btn => {
    btn.onclick = () => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      if (!group) return;
      group.values.push({ label: '', price_usd: 0, cost_rmb: 0 });
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-del-value]').forEach(btn => {
    btn.onclick = () => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      const row = Number(btn.dataset.optionDelValue);
      if (!group) return;
      group.values.splice(row, 1);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-value-field]').forEach(input => {
    input.addEventListener('input', e => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      if (!group) return;
      const row = Number(e.target.dataset.optionRow);
      const field = e.target.dataset.optionValueField;
      if (!group.values[row]) return;
      if (field === 'label') group.values[row].label = e.target.value;
      if (field === 'price_usd') group.values[row].price_usd = Number(e.target.value) || 0;
      if (field === 'cost_rmb') group.values[row].cost_rmb = Number(e.target.value) || 0;
    });
  });
  root.querySelectorAll('.option-group-list-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      const idx = Number(item.dataset.optionGroup);
      optionDragState.fromIndex = idx;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      }
    });
    item.addEventListener('dragend', () => {
      optionDragState.fromIndex = null;
      item.classList.remove('dragging');
      root.querySelectorAll('.option-group-list-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const toIndex = Number(item.dataset.optionGroup);
      const fromIndex = optionDragState.fromIndex == null ? Number(e.dataTransfer?.getData('text/plain')) : optionDragState.fromIndex;
      if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || fromIndex === toIndex) return;
      const [moved] = optionEditor.groups.splice(fromIndex, 1);
      optionEditor.groups.splice(toIndex, 0, moved);
      if (optionEditor.activeIndex === fromIndex) optionEditor.activeIndex = toIndex;
      else if (fromIndex < optionEditor.activeIndex && optionEditor.activeIndex <= toIndex) optionEditor.activeIndex -= 1;
      else if (toIndex <= optionEditor.activeIndex && optionEditor.activeIndex < fromIndex) optionEditor.activeIndex += 1;
      renderOptionGroupsEditor();
    });
  });
}
function renderOptionValuesEditor() {
  const group = optionEditor.groups[optionEditor.activeIndex];
  if (!group) return '<div class="option-group-detail-empty">请选择或新增选项组</div>';
  const rows = (group.values || []).map((v, i) => `<tr>
      <td><input data-option-value-field="label" data-option-row="${i}" value="${esc(v.label || '')}" placeholder="选项值"></td>
      <td><input data-option-value-field="price_usd" data-option-row="${i}" type="number" step="0.01" value="${Number(v.price_usd || 0)}"></td>
      <td><input data-option-value-field="cost_rmb" data-option-row="${i}" type="number" step="0.01" value="${Number(v.cost_rmb || 0)}"></td>
      <td><button class="btn small danger" type="button" data-option-del-value="${i}">删除</button></td>
    </tr>`).join('');
  return `
    <div class="option-values-toolbar">
      <button class="btn small secondary" type="button" data-option-add-value="1">新增选项值</button>
    </div>
    <div class="table-wrap option-values-table">
      <table>
         <thead><tr><th>选项</th><th>售价 USD</th><th>成本 RMB</th><th>操作</th></tr></thead>
         <tbody>${rows || '<tr><td colspan="4">暂无选项值</td></tr>'}</tbody>
      </table>
    </div>
  `;
}
function collectOptions() {
  return optionEditor.groups.map(g => {
    const labelText = String(g.label || '').trim();
    return {
      option_key: g.option_key || optionKeyFromLabel(labelText),
      label: labelText,
      type: 'dropdown',
      factory: true,
      required: true,
      priceable: true,
      costable: true,
      values: (g.values || []).map(v => ({
        label: String(v.label || '').trim(),
        price_usd: Number(v.price_usd) || 0,
        cost_rmb: Number(v.cost_rmb) || 0
      })).filter(v => v.label)
    };
  }).filter(o => o.label);
}
async function saveProduct() {
  try {
    const id = $('editProductSelect')?.value;
    if (!id) return;
    const existing = state.products.find(x => x.id === id) || {};
    const body = { id, channel: ORDER_CHANNEL, name: $('editName')?.value || '', factory_name: $('editName')?.value || '', default_fabric_id: $('editDefaultFabric')?.value || '', base_price: Number($('editBasePrice')?.value) || 0, default_fullness: existing.default_fullness || existing.defaultFullness || 2, enabled: true, width_prices: collectPriceRows('widthPriceTable'), length_prices: collectPriceRows('lengthPriceTable'), options: collectOptions() };
    await api.json(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadAll();
    if ($('editProductSelect')) $('editProductSelect').value = id;
    toast('产品已保存');
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderAll() {
  try { renderOrderForm(); } catch(e) { console.error('renderOrderForm', e); }
  try { renderProductEditor(); } catch(e) { console.error('renderProductEditor', e); }
  try { if ($('optionGroupsEditor')) renderOptionGroupsEditor(); } catch(e) { console.error('renderOptionGroupsEditor', e); }
}
function switchTab(tabName) {
  document.querySelectorAll('nav button[data-tab]').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  const btn = document.querySelector(`nav button[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const targetPage = $(`page-${tabName}`);
  if (targetPage) {
    targetPage.classList.add('active');
    targetPage.style.display = '';
  }
  if (tabName === 'orders') loadOrders();
  if (tabName === 'analytics') loadAnalytics();
  if (tabName === 'tax') loadTaxRates();
}

function openCalculator(tool) {
  document.querySelectorAll('nav button[data-tab]').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const targetPage = $(`page-${tool}`);
  if (targetPage) {
    targetPage.classList.add('active');
    targetPage.style.display = '';
  }
  if (tool === 'splice') loadSpliceOrderList();
  if (tool === 'profit') loadProfitOrderList();
  $('toolsDropdownMenu')?.classList.add('hidden');
  document.querySelector('.tools-dropdown-btn')?.setAttribute('aria-expanded', 'false');
}

// ===== Filter Helpers =====
function updateFilterFieldState(el) {
  const field = el.closest('.filter-field');
  if (!field) return;
  field.classList.toggle('has-value', !!el.value);
}

function initFilterFields() {
  document.querySelectorAll('.filter-field input, .filter-field select').forEach(el => {
    updateFilterFieldState(el);
    el.closest('.filter-field')?.querySelector('.filter-clear')?.addEventListener('click', () => {
      el.value = '';
      updateFilterFieldState(el);
      el.dispatchEvent(new Event(el.type === 'search' ? 'input' : 'change', { bubbles: true }));
    });
  });
}

function renderOrdersFilterChips() {
  const container = $('ordersFilterChips');
  if (!container) return;
  const chips = [];
  const search = $('ordersSearchInput')?.value?.trim();
  const dateFrom = $('ordersDateFrom')?.value;
  const dateTo = $('ordersDateTo')?.value;
  const status = $('ordersStatusFilter')?.value;
  const product = $('ordersProductFilter')?.value;
  const prodCost = $('ordersProdCostFilter')?.value;
  const logCost = $('ordersLogisticsCostFilter')?.value;
  if (search) chips.push({ label: `搜索: ${search}`, clear: () => { $('ordersSearchInput').value = ''; } });
  if (dateFrom) chips.push({ label: `从 ${dateFrom}`, clear: () => { $('ordersDateFrom').value = ''; } });
  if (dateTo) chips.push({ label: `至 ${dateTo}`, clear: () => { $('ordersDateTo').value = ''; } });
  if (status) chips.push({ label: `状态: ${$('ordersStatusFilter').selectedOptions[0]?.text}`, clear: () => { $('ordersStatusFilter').value = ''; } });
  if (product) chips.push({ label: `产品: ${$('ordersProductFilter').selectedOptions[0]?.text}`, clear: () => { $('ordersProductFilter').value = ''; } });
  if (prodCost) chips.push({ label: `生产成本: ${$('ordersProdCostFilter').selectedOptions[0]?.text}`, clear: () => { $('ordersProdCostFilter').value = ''; } });
  if (logCost) chips.push({ label: `物流成本: ${$('ordersLogisticsCostFilter').selectedOptions[0]?.text}`, clear: () => { $('ordersLogisticsCostFilter').value = ''; } });
  if (!chips.length) { container.innerHTML = ''; return; }
  container.innerHTML = chips.map((c, i) =>
    `<span class="filter-chip">${esc(c.label)}<button class="filter-chip-remove" data-idx="${i}">&times;</button></span>`
  ).join('') + `<button class="filter-chips-clear">清除全部</button>`;
  container.querySelectorAll('.filter-chip-remove').forEach((btn, i) => {
    btn.addEventListener('click', () => { chips[i].clear(); state.ordersPage = 1; loadOrders(); renderOrdersFilterChips(); });
  });
  container.querySelector('.filter-chips-clear')?.addEventListener('click', () => {
    ['ordersSearchInput', 'ordersDateFrom', 'ordersDateTo', 'ordersStatusFilter', 'ordersProductFilter', 'ordersProdCostFilter', 'ordersLogisticsCostFilter'].forEach(id => {
      const el = $(id); if (el) { el.value = ''; updateFilterFieldState(el); }
    });
    state.ordersPage = 1; loadOrders(); renderOrdersFilterChips();
  });
}

function setOrdersPeriod(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let from = "";
  let to = "";
  if (period === "month") {
    from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "lastMonth") {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    from = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
    to = `${ly}-${String(lm + 1).padStart(2, "0")}-${String(new Date(ly, lm + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "3months") {
    const d = new Date(y, m - 2, 1);
    from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  } else if (period === "6months") {
    const d = new Date(y, m - 5, 1);
    from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    to = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  }
  const fromEl = $("ordersDateFrom");
  const toEl = $("ordersDateTo");
  if (fromEl) { fromEl.value = from; updateFilterFieldState(fromEl); }
  if (toEl) { toEl.value = to; updateFilterFieldState(toEl); }
}

function renderAnalyticsFilterChips() {
  const container = $('analyticsFilterChips');
  if (!container) return;
  const chips = [];
  const dateFrom = $('analyticsDateFrom')?.value;
  const dateTo = $('analyticsDateTo')?.value;
  const product = $('analyticsProductFilter')?.value;
  if (dateFrom) chips.push({ label: `从 ${dateFrom}`, clear: () => { $('analyticsDateFrom').value = ''; } });
  if (dateTo) chips.push({ label: `至 ${dateTo}`, clear: () => { $('analyticsDateTo').value = ''; } });
  if (product) chips.push({ label: `产品: ${$('analyticsProductFilter').selectedOptions[0]?.text}`, clear: () => { $('analyticsProductFilter').value = ''; } });
  if (!chips.length) { container.innerHTML = ''; return; }
  container.innerHTML = chips.map((c, i) =>
    `<span class="filter-chip">${esc(c.label)}<button class="filter-chip-remove" data-idx="${i}">&times;</button></span>`
  ).join('') + `<button class="filter-chips-clear">清除全部</button>`;
  container.querySelectorAll('.filter-chip-remove').forEach((btn, i) => {
    btn.addEventListener('click', () => { chips[i].clear(); loadAnalytics(); renderAnalyticsFilterChips(); });
  });
  container.querySelector('.filter-chips-clear')?.addEventListener('click', () => {
    resetAnalyticsFilters();
  });
}

// ===== Analytics =====
function analyticsParams(channel) {
  const params = new URLSearchParams();
  const pairs = [
    ['date_from', $('analyticsDateFrom')?.value || ''],
    ['date_to', $('analyticsDateTo')?.value || ''],
    ['channel', channel],
    ['product_id', $('analyticsProductFilter')?.value || '']
  ];
  for (const [key, value] of pairs) if (value) params.set(key, value);
  return params.toString();
}

function analyticsMetric(label, value, hint = '', borderClass = '', trend = null) {
  const trendHtml = trend != null
    ? `<span class="metric-trend ${trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'}">${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(trend).toFixed(1)}%</span>`
    : '';
  return `<div class="analytics-metric-card ${borderClass}">
    <span>${esc(label)}</span>
    <b class="animate-count-up">${esc(value)}</b>
    ${hint ? `<small>${esc(hint)}</small>` : ''}
    ${trendHtml}
  </div>`;
}

// SVG Area Chart renderer
function renderAreaChart(data, color, height = 200) {
  if (!data.length) return '<div class="empty" style="min-height:160px;display:flex;align-items:center;justify-content:center;color:var(--muted)">暂无数据 — 完成订单后数据将显示在此处</div>';
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const w = 100, h = 100;
  const points = data.map((d, i) => {
    const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
    const y = h - (d.value / max) * (h - 10);
    return `${x},${y}`;
  });
  const linePoints = points.join(' ');
  const areaPoints = `0,${h} ${linePoints} ${w},${h}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="analytics-area-chart">
    <defs>
      <linearGradient id="grad-${color.replace('#', '')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity=".02"/>
      </linearGradient>
    </defs>
    <polygon points="${areaPoints}" fill="url(#grad-${color.replace('#', '')})" class="area-fill"/>
    <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="1.5" class="area-line"/>
    ${data.map((d, i) => {
      const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
      const y = h - (d.value / max) * (h - 10);
      return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--card)" stroke="${color}" stroke-width="1.5" class="area-dot">
        <title>${esc(d.label)}: ${esc(d.display)}</title>
      </circle>`;
    }).join('')}
  </svg>`;
}

// SVG Donut Chart renderer
function renderDonutChart(data, total) {
  if (!data.length || total <= 0) return '<div class="empty" style="min-height:160px;display:flex;align-items:center;justify-content:center;color:var(--muted)">暂无数据 — 完成订单后数据将显示在此处</div>';
  const colors = ['#2563eb', '#f59e0b', '#0f766e', '#9333ea', '#ef4444', '#06b6d4'];
  let cumulative = 0;
  const r = 38, c = 2 * Math.PI * r;
  const segments = data.map((d, i) => {
    const pct = num(d.amountRmb) / total;
    const dashLen = pct * c;
    const offset = -(cumulative / total) * c;
    cumulative += num(d.amountRmb);
    return `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="18"
      stroke-dasharray="${dashLen} ${c - dashLen}" stroke-dashoffset="${offset}" class="donut-segment">
      <title>${esc(d.label)}: ${rmb(d.amountRmb)} (${(pct * 100).toFixed(1)}%)</title>
    </circle>`;
  }).join('');
  const legend = data.map((d, i) => {
    const pct = total > 0 ? (num(d.amountRmb) / total * 100).toFixed(1) : 0;
    return `<div class="donut-legend-item">
      <span class="donut-legend-color" style="background:${colors[i % colors.length]}"></span>
      <span class="donut-legend-label">${esc(d.label)}</span>
      <span class="donut-legend-value">${rmb(d.amountRmb)}</span>
    </div>`;
  }).join('');
  return `<div class="analytics-donut-wrap">
    <div class="analytics-donut">
      <svg viewBox="0 0 100 100">${segments}</svg>
      <div class="analytics-donut-center">
        <span class="donut-total">${rmb(total)}</span>
        <span class="donut-label">总支出</span>
      </div>
    </div>
    <div class="analytics-donut-legend">${legend}</div>
  </div>`;
}

// Sparkline renderer
function renderSparkline(values, color = 'var(--chart-profit)') {
  if (!values.length) return '';
  const max = Math.max(1, ...values.map(Math.abs));
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? 30 : (i / (values.length - 1)) * 60;
    const y = 18 - (v / max) * 16;
    return `${x},${y}`;
  }).join(' ');
  return `<span class="sparkline"><svg viewBox="0 0 60 20" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
  </svg></span>`;
}

// Skeleton loaders
function skeletonCards(count = 7) {
  return Array(count).fill('<div class="skeleton skeleton-card"></div>').join('');
}
function skeletonChart() {
  return '<div class="skeleton skeleton-chart"></div>';
}
function skeletonRows(count = 4) {
  return Array(count).fill('<div class="skeleton skeleton-row"></div>').join('');
}

async function loadAnalyticsProducts() {
  if (state.analytics.products?.length) return;
  try {
    const bootstrap = await api.json('/api/bootstrap');
    const active = Array.isArray(bootstrap.products) ? bootstrap.products : [];
    const archived = await api.json(`/api/products/archived?channel=${ORDER_CHANNEL}`).catch(() => []);
    const archivedList = Array.isArray(archived) ? archived : [];
    const all = [...active, ...archivedList];
    state.analytics.products = all;
    const select = $('analyticsProductFilter');
    if (select) {
      const current = select.value;
      select.innerHTML = '<option value="">全部产品</option>' + all
        .map(p => `<option value="${esc(p.id)}">${esc(p.name || p.id)}${p.archived ? ' (已归档)' : ''}</option>`)
        .join('');
      select.value = current;
    }
  } catch (e) { /* ignore */ }
}

async function loadAnalytics() {
  await loadAnalyticsProducts();
  const status = $('analyticsStatus');
  if (status) { status.textContent = '正在加载分析数据...'; status.classList.remove('hidden'); }
  try {
    const channel = ORDER_CHANNEL;
    const data = await api.json('/api/analytics/overview?' + analyticsParams(channel));
    state.analytics[channel] = data;
    renderChannelAnalytics(channel);
    if (status) status.classList.add('hidden');
  } catch (e) {
    if (status) { status.textContent = e.message; status.classList.remove('hidden'); }
    toast(e.message, 'bad');
  }
}

function renderChannelSummary(channel, summary = {}) {
  const el = $(channel === 'shopify' ? 'shopifyAnalyticsSummary' : 'amazonAnalyticsSummary');
  if (!el) return;
  const profitRate = num(summary.profitRate);
  const profitClass = profitRate > 20 ? 'border-green' : profitRate > 10 ? 'border-amber' : profitRate > 0 ? '' : 'border-red';
  const cards = [
    analyticsMetric('订单数', String(summary.orderCount || 0), '', 'border-blue'),
    analyticsMetric('收入 RMB', rmb(summary.incomeRmb), '', 'border-blue'),
    analyticsMetric('生产成本', rmb(summary.productionCostRmb), '', 'border-amber'),
    analyticsMetric('物流成本', rmb(summary.logisticsCostRmb), '', 'border-amber'),
    analyticsMetric('利润', rmb(summary.profitRmb), '', profitClass),
    analyticsMetric('利润率', pct(summary.profitRate), '', profitClass),
    analyticsMetric('客单价', rmb(summary.averageOrderValueRmb), '', 'border-teal')
  ];
  if (channel === 'shopify') {
    cards.splice(4, 0, analyticsMetric('PayPal 手续费', rmb(summary.paypalFeeRmb), '', 'border-red'));
  } else {
    const commission = (summary.incomeRmb || 0) * 0.15;
    cards.splice(4, 0, analyticsMetric('平台佣金 (15%)', rmb(commission), '', 'border-red'));
  }
  el.innerHTML = cards.join('');
}

function renderChannelTrendChart(channel, rows = []) {
  const el = $(channel === 'shopify' ? 'shopifyTrendChart' : 'amazonTrendChart');
  if (!el) return;
  if (!rows.length) {
    el.className = 'analytics-chart empty';
    el.textContent = '暂无数据';
    return;
  }
  const sorted = [...rows].sort((a, b) => a.month < b.month ? -1 : 1);
  const maxValues = sorted.flatMap(r => [num(r.incomeRmb), num(r.totalCostRmb), Math.abs(num(r.profitRmb))]);
  const max = Math.max(1, ...maxValues);
  el.className = 'analytics-chart';
  el.innerHTML = sorted.map(row => {
    const incomeH = Math.max(2, Math.round(num(row.incomeRmb) / max * 100));
    const costH = Math.max(2, Math.round(num(row.totalCostRmb) / max * 100));
    const profitH = Math.max(2, Math.round(Math.abs(num(row.profitRmb)) / max * 100));
    const bars = `<span class="trend-bar income" style="height:${incomeH}%"></span>
      <span class="trend-bar cost" style="height:${costH}%"></span>
      <span class="trend-bar profit" style="height:${profitH}%"></span>`;
    const tip = `${esc(row.month)} 收入 ${rmb(row.incomeRmb)} / 支出 ${rmb(row.totalCostRmb)} / 利润 ${rmb(row.profitRmb)}`;
    return `<div class="trend-month"><div class="trend-bars" title="${tip}">${bars}</div><b>${esc(row.month)}</b></div>`;
  }).join('');
}

function renderChannelExpenseChart(channel, expenseBreakdown = []) {
  const el = $(channel === 'shopify' ? 'shopifyExpenseChart' : 'amazonExpenseChart');
  if (!el) return;
  let rows;
  if (channel === 'shopify') {
    rows = expenseBreakdown.filter(r => r.key !== 'amazon_commission');
  } else {
    const income = state.analytics.amazon?.summary?.incomeRmb || 0;
    rows = [
      { key: 'production', label: '生产成本', amountRmb: expenseBreakdown.find(r => r.key === 'production')?.amountRmb || 0 },
      { key: 'logistics', label: '物流成本', amountRmb: expenseBreakdown.find(r => r.key === 'logistics')?.amountRmb || 0 },
      { key: 'commission', label: '平台佣金 (15%)', amountRmb: income * 0.15 }
    ];
  }
  const total = rows.reduce((sum, r) => sum + num(r.amountRmb), 0);
  if (!rows.length || total <= 0) {
    el.className = 'analytics-expense-chart empty';
    el.textContent = '暂无数据';
    return;
  }
  el.className = 'analytics-expense-chart';
  el.innerHTML = rows.map(row => {
    const percent = total > 0 ? num(row.amountRmb) / total : 0;
    return `<div class="expense-row">
      <div class="expense-row-head"><span>${esc(row.label)}</span><b>${rmb(row.amountRmb)}</b></div>
      <div class="expense-track"><span style="width:${Math.round(percent * 100)}%"></span></div>
      <small>${pct(percent)}</small>
    </div>`;
  }).join('');
}

function sortedChannelProducts(channel) {
  const data = state.analytics[channel];
  const rows = data?.productComparison || [];
  const sort = $(`.analytics-product-sort[data-channel="${channel}"]`)?.value || state.analytics.productSort[channel] || 'income';
  state.analytics.productSort[channel] = sort;
  const keyMap = { income: 'incomeRmb', profit: 'profitRmb', rate: 'profitRate', qty: 'qty' };
  const key = keyMap[sort] || 'incomeRmb';
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]));
}

function renderChannelProductTable(channel) {
  const tableId = channel === 'shopify' ? 'shopifyProductTable' : 'amazonProductTable';
  table($(tableId), ['产品', '订单', '项目', '销量', '收入', '成本', '利润', '利润率'], sortedChannelProducts(channel).map(row => {
    const rate = num(row.profitRate);
    const rateClass = rate > 20 ? 'good' : rate > 10 ? 'warn' : rate > 0 ? '' : 'bad';
    return `<tr>
      <td><strong>${esc(row.productName)}</strong><small>${esc(row.productId || '')}</small></td>
      <td>${row.orderCount || 0}</td>
      <td>${row.itemCount || 0}</td>
      <td>${fmt(row.qty, 0)}</td>
      <td>${rmb(row.incomeRmb)}</td>
      <td>${rmb(row.costRmb)}</td>
      <td>${rmb(row.profitRmb)}</td>
      <td><span class="status-pill ${rateClass}">${pct(row.profitRate)}</span></td>
    </tr>`;
  }));
}

function renderChannelAnalytics(channel) {
  const data = state.analytics[channel] || {};
  renderChannelSummary(channel, data.summary || {});
  renderChannelTrendChart(channel, data.monthlyTrend || []);
  renderChannelExpenseChart(channel, data.expenseBreakdown || []);
  renderChannelProductTable(channel);
  renderLogisticsAnalysis(channel, data.logisticsAnalysis || {});
}

function renderLogisticsAnalysis(channel, la) {
  const el = $(channel === 'shopify' ? 'shopifyLogisticsAnalysis' : 'amazonLogisticsAnalysis');
  if (!el) return;
  const byCarrier = la.byCarrier || [];
  if (!byCarrier.length) { el.innerHTML = '<div class="empty">暂无物流分析数据</div>'; return; }
  const summaryCards = [
    `<div class="logistics-kpi"><span>物流总成本</span><b>${rmb(la.totalCostRmb || 0)}</b></div>`,
    `<div class="logistics-kpi"><span>平均物流成本</span><b>${rmb(la.avgCostRmb || 0)}</b></div>`,
    `<div class="logistics-kpi"><span>平均重量</span><b>${fmt(la.avgWeightKg || 0, 2)} kg</b></div>`,
    `<div class="logistics-kpi"><span>有物流订单数</span><b>${la.orderCount || 0}</b></div>`
  ];
  const rows = byCarrier.map(c => `<tr>
    <td>${esc(c.carrier)}</td>
    <td>${c.orderCount}</td>
    <td>${fmt(c.totalWeight, 2)} kg</td>
    <td>${fmt(c.avgWeightKg, 2)} kg</td>
    <td>${rmb(c.totalCostRmb)}</td>
    <td>${rmb(c.avgCostRmb)}</td>
  </tr>`).join('');
  el.innerHTML = `<div class="logistics-kpi-grid">${summaryCards.join('')}</div>
    <div class="table-wrap analytics-table-wrap"><table>
      <thead><tr><th>物流渠道</th><th>订单数</th><th>总重量</th><th>平均重量</th><th>总物流成本</th><th>平均物流成本</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function resetAnalyticsFilters() {
  ['analyticsDateFrom', 'analyticsDateTo', 'analyticsProductFilter'].forEach(id => {
    const el = $(id);
    if (el) { el.value = ''; updateFilterFieldState(el); }
  });
  document.querySelectorAll('.analytics-time-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.analytics-time-btn[data-range="all"]')?.classList.add('active');
  loadAnalytics();
  renderAnalyticsFilterChips();
}

function loadTaxRates() {
  const tbody = $('taxRatesBody');
  if (!tbody) return;
  const rates = (state.taxRates || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
  tbody.innerHTML = rates.map(r =>
    `<tr>
      <td><input class="tax-code" value="${esc(r.code || '')}" maxlength="2"></td>
      <td><input class="tax-state" value="${esc(r.state || '')}"></td>
      <td><input class="tax-rate" type="number" step="0.01" min="0" value="${r.rate != null ? r.rate : ''}"></td>
    </tr>`
  ).join('');
}

function saveTaxRates() {
  const rows = Array.from($('taxRatesBody')?.querySelectorAll('tr') || []).map(tr => ({
    code: tr.querySelector('.tax-code')?.value?.trim().toUpperCase() || '',
    state: tr.querySelector('.tax-state')?.value?.trim() || '',
    rate: parseFloat(tr.querySelector('.tax-rate')?.value) || 0,
    note: ''
  })).filter(r => r.code);
  api.json('/api/tax-rates', {
    method: 'PUT',
    body: JSON.stringify({ rates: rows })
  }).then(res => {
    state.taxRates = rows;
    toast('税率已保存');
  }).catch(e => toast(e.message, 'bad'));
}

function activateTabFromHash() {
  const hash = location.hash.replace('#', '');
  const validTabs = ['order', 'orders', 'products', 'analytics', 'tax'];
  switchTab(validTabs.includes(hash) ? hash : 'order');
}
function renderNotifyPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today + 'T00:00:00');
  const orders = state.ordersCache || [];
  const logistics = orders.filter(o => {
    if (!o.order_date) return false;
    const deadline = new Date(o.order_date + 'T00:00:00');
    deadline.setDate(deadline.getDate() + 10);
    return deadline <= todayDate && !Number(o.logistics_cost_rmb);
  });
  const isEarlyMonth = todayDate.getDate() <= 7;
  let production = [];
  if (isEarlyMonth) {
    const lastMonth = todayDate.getMonth() === 0 ? 12 : todayDate.getMonth();
    const lastMonthYear = todayDate.getMonth() === 0 ? todayDate.getFullYear() - 1 : todayDate.getFullYear();
    production = orders.filter(o => {
      if (!o.order_date) return false;
      const d = new Date(o.order_date + 'T00:00:00');
      return d.getMonth() + 1 === lastMonth && d.getFullYear() === lastMonthYear && o.production_cost_override_rmb == null;
    });
  }
  const reminders = orders.filter(o => o.reminder);
  const total = logistics.length + production.length + reminders.length;
  const badge = $('notifyBadge');
  if (badge) {
    if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
  const countEl = $('notifyPanelCount');
  if (countEl) {
    if (total > 0) { countEl.textContent = total + ' 项待处理'; countEl.classList.remove('hidden'); }
    else countEl.classList.add('hidden');
  }
  let html = '';
  if (logistics.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot warn"></span><h4>物流成本（${logistics.length}）</h4></div>`;
    html += logistics.map(o => `<div class="notify-row" data-goto-order="${o.id}"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.customer_name || '')}</span><span class="notify-order-date">${o.order_date || ''}</span></div>`).join('');
    html += '</div>';
  }
  if (isEarlyMonth && production.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot bad"></span><h4>生产成本（${production.length}）</h4></div>`;
    html += production.map(o => `<div class="notify-row" data-goto-order="${o.id}"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.customer_name || '')}</span><span class="notify-order-date">${o.order_date || ''}</span></div>`).join('');
    html += '</div>';
  }
  if (reminders.length) {
    html += `<div class="notify-section"><div class="notify-section-header"><span class="notify-section-dot brand"></span><h4>管理端提醒（${reminders.length}）</h4></div>`;
    html += reminders.map(o => `<div class="notify-row"><span class="notify-order-no">${esc(o.order_no || '#' + o.id)}</span><span>${esc(o.reminder_text || '需要更新')}</span><span class="notify-order-date">${o.order_date || ''}</span><button class="notify-clear-btn" data-clear-reminder="${o.id}" title="标记已读">已读</button></div>`).join('');
    html += '</div>';
  }
  if (!html) html = '<div class="notify-empty"><svg class="notify-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>暂无待处理项</div>';
  const content = $('notifyContent');
  if (content) content.innerHTML = html;
}

// ===== Production Photos =====
async function loadProductionPhotos(orderItemId) {
  try {
    const photos = await api.json(`/api/production-photos/${orderItemId}`);
    renderProductionPhotos(orderItemId, photos);
  } catch {}
}

function renderProductionPhotos(orderItemId, photos) {
  const grid = document.querySelector(`[data-photos-for="${orderItemId}"]`);
  if (!grid) return;
  if (!photos.length) { grid.innerHTML = '<div class="production-photos-empty">暂无照片</div>'; return; }
  grid.innerHTML = photos.map(p => `<div class="production-photo-thumb" data-photo-id="${p.id}">
    <img src="/api/production-photos/file/${encodeURIComponent(p.filename)}" alt="${esc(p.original_name || '')}" loading="lazy" onclick="window.open(this.src,'_blank')">
    <button class="production-photo-delete" data-delete-photo="${p.id}" title="删除照片">&times;</button>
  </div>`).join('');
  grid.querySelectorAll('[data-delete-photo]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('确认删除此照片？')) return;
      try {
        await api.json(`/api/production-photos/${btn.dataset.deletePhoto}`, { method: 'DELETE' });
        loadProductionPhotos(orderItemId);
      } catch (err) { toast(err.message, 'bad'); }
    };
  });
}

async function uploadProductionPhotos(orderItemId, files) {
  const fd = new FormData();
  for (const file of files) fd.append('photos', file);
  try {
    toast('正在上传照片...');
    await api.json(`/api/production-photos/${orderItemId}`, { method: 'POST', body: fd });
    toast('照片已上传');
    loadProductionPhotos(orderItemId);
  } catch (e) { toast('上传失败: ' + e.message, 'bad'); }
}

// ===== Real-time Profit Preview (edit mode) =====
function setupProfitPreview(form, order) {
  if (!form || !order) return;
  const container = document.createElement('div');
  container.className = 'profit-preview-bar';
  container.innerHTML = '<div class="profit-preview-label">实时利润预览 <small>根据当前输入实时估算，保存后才会写入订单</small></div><div class="profit-preview-grid"></div>';
  const firstSection = form.querySelector('.detail-section');
  if (firstSection) firstSection.parentNode.insertBefore(container, firstSection.nextSibling);

  const update = () => {
    const salesOverride = Number(form.querySelector('[data-order-actual-paid]')?.value) || 0;
    const discountApply = form.querySelector('[data-order-discount-apply]')?.checked !== false;
    const discountMode = form.querySelector('[data-order-discount-mode]')?.value || 'percent';
    const discountValue = Number(form.querySelector('[data-order-discount-value]')?.value || 0);
    const prodCostInput = form.querySelector('[data-order-production-cost]');
    const logisticsInput = form.querySelector('[data-edit-field="logistics_cost_rmb"]');

    let totalSalesUsd = 0;
    const items = order.items || [];
    for (const it of items) {
      const sysPrice = Number(it.system_price_usd) || 0;
      let finalPrice = sysPrice;
      if (discountApply && discountValue > 0) {
        if (discountMode === 'percent') finalPrice = Math.max(0, sysPrice - sysPrice * Math.min(discountValue, 100) / 100);
        else finalPrice = Math.max(0, sysPrice - Math.min(discountValue, sysPrice));
      }
      totalSalesUsd += finalPrice * (Number(it.qty) || 1);
    }
    if (salesOverride > 0) totalSalesUsd = salesOverride;

    const usdRmb = USD_RMB_RATE || 6.9;
    const paypalRate = PAYPAL_FEE_RATE || 0.044;
    const incomeRmb = totalSalesUsd * (1 - paypalRate) * usdRmb;
    const productionCost = prodCostInput ? (Number(prodCostInput.value) || 0) : (order.production_cost_override_rmb != null ? Number(order.production_cost_override_rmb) : items.reduce((s, it) => s + (Number(it.final_cost_rmb) || 0), 0));
    const logisticsCost = logisticsInput ? (Number(logisticsInput.value) || 0) : (Number(order.logistics_cost_rmb) || 0);
    const totalCost = productionCost + logisticsCost;
    const profit = incomeRmb - totalCost;
    const profitRate = incomeRmb > 0 ? profit / incomeRmb : 0;

    const grid = container.querySelector('.profit-preview-grid');
    if (grid) grid.innerHTML = `
      <div class="profit-preview-cell"><span>预计销售额</span><b>${rmb(totalSalesUsd * usdRmb)}</b></div>
      <div class="profit-preview-cell"><span>生产成本</span><b>${rmb(productionCost)}</b></div>
      <div class="profit-preview-cell"><span>物流成本</span><b>${rmb(logisticsCost)}</b></div>
      <div class="profit-preview-cell"><span>预计利润</span><b class="${profit >= 0 ? 'good' : 'bad'}">${rmb(profit)}</b></div>
      <div class="profit-preview-cell"><span>利润率</span><b class="${profitRate < 0 ? 'bad' : profitRate < 0.3 ? 'warn' : 'good'}">${fmt(profitRate * 100, 1)}%</b></div>
    `;
  };

  form.addEventListener('input', (e) => {
    if (e.target.matches('[data-order-production-cost], [data-edit-field="logistics_cost_rmb"], [data-order-actual-paid], [data-order-discount-apply], [data-order-discount-mode], [data-order-discount-value]')) {
      update();
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-order-discount-apply], [data-order-discount-mode]')) update();
  });
  update();
}

function bind() {
  bindOrdersTableDelegation();
  document.querySelectorAll('nav button[data-tab]').forEach(btn => btn.onclick = () => {
    location.hash = btn.dataset.tab;
  });
  window.addEventListener('hashchange', activateTabFromHash);

  // Tools dropdown
  const toolsBtn = document.querySelector('.tools-dropdown-btn');
  const toolsMenu = $('toolsDropdownMenu');
  if (toolsBtn && toolsMenu) {
    toolsBtn.onclick = (e) => {
      e.stopPropagation();
      const opening = toolsMenu.classList.contains('hidden');
      if (opening) {
        const rect = toolsBtn.getBoundingClientRect();
        toolsMenu.style.top = rect.bottom + 6 + 'px';
        toolsMenu.style.left = rect.left + 'px';
      }
      toolsMenu.classList.toggle('hidden');
      toolsBtn.setAttribute('aria-expanded', opening);
    };
    toolsMenu.querySelectorAll('button[data-tool]').forEach(btn => {
      btn.onclick = () => openCalculator(btn.dataset.tool);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tools-dropdown')) {
        toolsMenu.classList.add('hidden');
        toolsBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Analytics
  document.querySelectorAll('.analytics-product-sort').forEach(sel => {
    sel.addEventListener('change', () => renderChannelProductTable(sel.dataset.channel));
  });
  $('analyticsRefreshBtn')?.addEventListener('click', () => loadAnalytics());
  $('analyticsResetBtn')?.addEventListener('click', () => resetAnalyticsFilters());
  ['analyticsDateFrom', 'analyticsDateTo', 'analyticsProductFilter'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      updateFilterFieldState(el);
      loadAnalytics();
      renderAnalyticsFilterChips();
    });
  });
  document.querySelectorAll('.analytics-time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.analytics-time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.dataset.range;
      const now = new Date();
      let dateFrom = '';
      if (range === '1m') dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().slice(0, 10);
      else if (range === '3m') dateFrom = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);
      else if (range === '6m') dateFrom = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().slice(0, 10);
      else if (range === '1y') dateFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      if ($('analyticsDateFrom')) { $('analyticsDateFrom').value = dateFrom; updateFilterFieldState($('analyticsDateFrom')); }
      if ($('analyticsDateTo')) { $('analyticsDateTo').value = now.toISOString().slice(0, 10); updateFilterFieldState($('analyticsDateTo')); }
      loadAnalytics();
      renderAnalyticsFilterChips();
    });
  });
  initFilterFields();
  renderAnalyticsFilterChips();
  if ($('orderDate')) $('orderDate').onchange = () => { if ($('orderDate').value && $('deliveryDate')) $('deliveryDate').value = addDays($('orderDate').value, 4); updatePreview(); };
  const updateDiscountLabel = () => {
    const percent = $('discountMode')?.value === 'percent';
    if ($('discountUsd')) { $('discountUsd').step = percent ? '0.1' : '0.01'; $('discountUsd').max = percent ? '100' : ''; }
    updatePreview();
  };
  if ($('toggleInfoMatcherBtn')) $('toggleInfoMatcherBtn').onclick = () => {
    const panel = $('infoMatcherPanel');
    if (!panel) return;
    const nowHidden = panel.classList.toggle('hidden');
    $('toggleInfoMatcherBtn').setAttribute('aria-expanded', String(!nowHidden));
    if (!nowHidden) $('bulkCustomerInfoInput')?.focus();
  };
  if ($('pasteFromClipboardBtn')) $('pasteFromClipboardBtn').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        $('bulkCustomerInfoInput').value = text;
        applyMatchedCustomerInfo();
      }
    } catch { toast('无法访问剪贴板，请手动粘贴', 'warn'); }
  };
  if ($('clearInfoMatcherBtn')) $('clearInfoMatcherBtn').onclick = () => {
    if ($('bulkCustomerInfoInput')) $('bulkCustomerInfoInput').value = '';
  };
  if ($('applyInfoMatcherBtn')) $('applyInfoMatcherBtn').onclick = applyMatchedCustomerInfo;
  ['itemProduct', 'itemQty', 'itemWidth', 'itemLength', 'itemFullness', 'itemRemark', 'discountUsd', 'applyDiscountToggle'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const handler = id === 'itemProduct' ? renderDynamicOptions : updatePreview;
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
  if ($('discountMode')) $('discountMode').addEventListener('change', updateDiscountLabel);
  if ($('quoteToggleBtn')) $('quoteToggleBtn').onclick = openQuoteModal;
  if ($('closeQuoteModalBtn')) $('closeQuoteModalBtn').onclick = () => $('quoteModal')?.classList.add('hidden');
  if ($('closeQuoteModal')) $('closeQuoteModal').onclick = () => $('quoteModal')?.classList.add('hidden');
  if ($('viewCostDetailBtn')) $('viewCostDetailBtn').onclick = async () => {
    await updatePreview();
    if (state.preview) renderCostDetailModal(state.preview);
    $('costDetailModal')?.classList.remove('hidden');
  };
  if ($('closeCostDetailBtn')) $('closeCostDetailBtn').onclick = () => $('costDetailModal')?.classList.add('hidden');
  if ($('closeCostDetailModal')) $('closeCostDetailModal').onclick = () => $('costDetailModal')?.classList.add('hidden');
  if ($('notifyBtn')) $('notifyBtn').onclick = () => {
    const panel = $('notifyPanel');
    if (panel.classList.contains('hidden')) { renderNotifyPanel(); panel.classList.remove('hidden'); }
    else panel.classList.add('hidden');
  };
  document.addEventListener('click', async e => {
    if (!e.target.closest('.notify-wrap')) $('notifyPanel')?.classList.add('hidden');
    const gotoOrder = e.target.closest('[data-goto-order]');
    if (gotoOrder) {
      const orderId = gotoOrder.dataset.gotoOrder;
      $('notifyPanel')?.classList.add('hidden');
      viewOrderModal(Number(orderId));
      return;
    }
    const clearBtn = e.target.closest('[data-clear-reminder]');
    if (clearBtn) {
      const orderId = clearBtn.dataset.clearReminder;
      try {
        await api.json(`/api/orders/${orderId}/reminder`, { method: 'PUT', body: JSON.stringify({ reminder: 0, reminder_text: null }) });
        renderNotifyPanel();
        loadOrders();
      } catch (err) { toast(err.message, 'bad'); }
    }
  });
  if ($('addItemBtn')) $('addItemBtn').onclick = addItem;
  if ($('saveOrderBtn')) $('saveOrderBtn').onclick = saveOrder;
  if ($('resetItemBtn')) $('resetItemBtn').onclick = () => {
    ['itemWidth', 'itemLength', 'itemRemark'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    if ($('itemQty')) $('itemQty').value = 1;
    if ($('actualPaidUsd')) $('actualPaidUsd').value = 0;
    resetBuilderDiscountState();
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    updatePreview();
    toast('\u5f53\u524d\u9879\u76ee\u5df2\u6e05\u7a7a');
  };
  if ($('closeEditOrderBtn')) $('closeEditOrderBtn').onclick = () => $('editOrderModal')?.classList.add('hidden');
  if ($('closeEditOrderModal')) $('closeEditOrderModal').onclick = () => $('editOrderModal')?.classList.add('hidden');
  if ($('calcSpliceBtn')) $('calcSpliceBtn').onclick = calcSplice;
  // Splice order search
  if ($('spliceOrderSearchInput')) {
    const ensureSpliceOrders = async () => {
      if (!state.spliceOrderChoices.length) await loadSpliceOrderList();
    };
    const renderSpliceOrderResults = async (query = '') => {
      await ensureSpliceOrders();
      const results = $('spliceOrderSearchResults');
      if (!results) return;
      const q = String(query || '').trim().toLowerCase();
      if (!q) {
        results.classList.add('hidden');
        return;
      }
      const orders = state.spliceOrderChoices.length ? state.spliceOrderChoices : state.ordersCache;
      const matches = (orders || []).filter(o => {
        const text = `${o.id || ''} ${o.order_no || ''} ${o.customer_name || ''} ${o.order_date || ''}`.toLowerCase();
        return text.includes(q);
      }).slice(0, 20);
      if (!matches.length) {
        results.innerHTML = '<div class="profit-order-empty">未找到匹配订单</div>';
        results.classList.remove('hidden');
        return;
      }
      results.innerHTML = matches.map(o => `
        <button type="button" class="profit-order-option" data-splice-order-id="${o.id}" role="option">
          <span>${esc(o.order_no || '#' + o.id)}</span>
          <small>${esc(o.customer_name || '未知')} | ${esc(o.order_date || '')}</small>
        </button>
      `).join('');
      results.classList.remove('hidden');
      results.querySelectorAll('[data-splice-order-id]').forEach(btn => {
        btn.onclick = () => selectSpliceOrder(matches.find(o => String(o.id) === btn.dataset.spliceOrderId));
      });
    };
    $('spliceOrderSearchInput').addEventListener('input', async () => {
      state.spliceSelectedOrderId = '';
      syncSpliceOrderSelect('');
      if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = '未选择订单';
      $('spliceOrderItems')?.classList.add('hidden');
      $('spliceOrderResults')?.classList.add('hidden');
      updateSpliceSelectionState();
      await renderSpliceOrderResults($('spliceOrderSearchInput').value);
    });
    $('spliceOrderSearchInput').addEventListener('focus', async () => {
      await renderSpliceOrderResults($('spliceOrderSearchInput').value);
    });
    $('spliceOrderSearchInput').addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        $('spliceOrderSearchResults')?.classList.add('hidden');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        await ensureSpliceOrders();
        const q = $('spliceOrderSearchInput').value.trim().toLowerCase();
        if (!q) return;
        const orders = state.spliceOrderChoices.length ? state.spliceOrderChoices : state.ordersCache;
        const first = (orders || []).find(o => `${o.id || ''} ${o.order_no || ''} ${o.customer_name || ''} ${o.order_date || ''}`.toLowerCase().includes(q));
        if (first) selectSpliceOrder(first);
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.splice-order-search')) $('spliceOrderSearchResults')?.classList.add('hidden');
    });
  }
  if ($('spliceCalcOrderBtn')) $('spliceCalcOrderBtn').onclick = calcSpliceForOrder;
  if ($('spliceSelectAllBtn')) $('spliceSelectAllBtn').onclick = () => {
    const all = Array.from(document.querySelectorAll('.splice-item-check'));
    const checkedCount = all.filter(cb => cb.checked).length;
    const nextChecked = checkedCount !== all.length;
    all.forEach(cb => { cb.checked = nextChecked; });
    updateSpliceSelectionState();
  };
  if ($('profitOrderSearchInput')) {
    $('profitOrderSearchInput').addEventListener('input', () => {
      if ($('profitOrderSelect')) $('profitOrderSelect').value = '';
      renderProfitOrderSearchResults($('profitOrderSearchInput').value);
    });
    $('profitOrderSearchInput').addEventListener('focus', () => {
      renderProfitOrderSearchResults($('profitOrderSearchInput').value);
    });
    $('profitOrderSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeProfitOrderResults();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = $('profitOrderSearchInput').value.trim().toLowerCase();
        if (!q) return;
        const first = state.profitOrderChoices.find(order => q && profitOrderSearchText(order).includes(q));
        if (first) selectProfitOrder(first);
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.profit-order-search')) closeProfitOrderResults();
    });
  }
  $('profitLoadBtn').onclick = loadProfitDetail;
  $('refreshOrdersBtn').onclick = loadOrders;
  const debouncedLoadOrders = debounce(() => { state.ordersPage = 1; loadOrders(); }, 300);
  ['ordersSearchInput', 'ordersDateFrom', 'ordersDateTo', 'ordersStatusFilter', 'ordersProductFilter', 'ordersProdCostFilter', 'ordersLogisticsCostFilter'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(id === 'ordersSearchInput' ? 'input' : 'change', () => {
      updateFilterFieldState(el);
      if (id === 'ordersSearchInput') debouncedLoadOrders();
      else { state.ordersPage = 1; loadOrders(); }
      renderOrdersFilterChips();
    });
  });
  renderOrdersFilterChips();
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setOrdersPeriod(btn.dataset.period);
      state.ordersPage = 1; loadOrders();
      renderOrdersFilterChips();
    });
  });
  if ($('ordersBulkFactoryExportBtn')) $('ordersBulkFactoryExportBtn').onclick = exportSelectedOrdersFactory;
  if ($('ordersBulkFullExportBtn')) $('ordersBulkFullExportBtn').onclick = exportSelectedOrdersFull;
  if ($('ordersBulkDeleteBtn')) $('ordersBulkDeleteBtn').onclick = async () => {
    const ids = Array.from(state.selectedOrderIds || []);
    if (!ids.length) return toast('请先选择订单', 'bad');
    if (!confirm(`确认删除 ${ids.length} 个订单？此操作不可撤销。`)) return;
    for (const id of ids) await api.json(`/api/orders/${id}`, { method: 'DELETE' });
    state.selectedOrderIds.clear();
    toast(`已删除 ${ids.length} 个订单`);
    await loadOrders();
  };
  if ($('ordersTable')) $('ordersTable').addEventListener('click', e => { const el = e.target.closest('.order-item-expand'); if (el) el.classList.toggle('open'); });
  if ($('ordersImportCsvInput')) {
    $('ordersImportCsvInput').onchange = async () => {
      const file = $('ordersImportCsvInput').files[0];
      if (!file) return;
      try {
        const res = await api.upload('/api/import/orders-csv', file);
        $('ordersImportStatus').textContent = `导入完成：${file.name}，新增订单 ${res.importedOrders || 0} 个，新增项目 ${res.importedItems || 0} 条，跳过 ${res.skippedRows || 0} 行。`;
        if (res.errors?.length) $('ordersImportStatus').textContent += ` 错误示例：${res.errors.slice(0, 3).join('；')}`;
        $('ordersImportCsvInput').value = '';
        await loadOrders();
        toast('订单 CSV 导入完成');
      } catch (e) {
        $('ordersImportStatus').textContent = `导入失败：${e.message}`;
        toast(e.message, 'bad');
      }
    };
  }
  if ($('exportFactoryBtn')) $('exportFactoryBtn').onclick = () => exportCurrentItemsFactory();

  if ($('editProductSelect')) $('editProductSelect').onchange = () => { renderProductListPanel(); loadProductEditor(); };
  if ($('productSearchInput')) $('productSearchInput').oninput = () => renderProductListPanel();
  if ($('addProductBtn')) $('addProductBtn').onclick = () => {
    const modal = $('newProductModal');
    const nameInput = $('newProductName');
    if (!modal || !nameInput) return;
    nameInput.value = '';
    modal.classList.remove('hidden');
    nameInput.focus();
    const doCreate = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      modal.classList.add('hidden');
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'product_' + Date.now();
      const body = { id, channel: ORDER_CHANNEL, name, factory_name: name, default_fabric_id: '', base_price: 0, default_fullness: 2, enabled: true, width_prices: [], length_prices: [], options: [] };
      try {
        await api.json('/api/products/' + id, { method: 'PUT', body: JSON.stringify(body) });
        await loadAll();
        if ($('editProductSelect')) $('editProductSelect').value = id;
        loadProductEditor();
        toast('产品已创建');
      } catch (e) { toast(e.message, 'bad'); }
    };
    $('confirmNewProductBtn').onclick = doCreate;
    $('cancelNewProductBtn').onclick = () => modal.classList.add('hidden');
    $('closeNewProductModal').onclick = () => modal.classList.add('hidden');
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') modal.classList.add('hidden'); };
  };
  if ($('saveProductBtn')) $('saveProductBtn').onclick = saveProduct;
  if ($('copyProductBtn')) $('copyProductBtn').onclick = async () => { await api.json(`/api/products/${$('editProductSelect').value}/copy`, { method: 'POST' }); await loadAll(); toast('产品已复制'); };
  if ($('deleteProductBtn')) $('deleteProductBtn').onclick = async () => { if (confirm('确认删除产品？')) { await api.json(`/api/products/${$('editProductSelect').value}`, { method: 'DELETE' }); await loadAll(); } };
  if ($('archiveProductBtn')) $('archiveProductBtn').onclick = async () => {
    const id = $('editProductSelect')?.value;
    if (!id) return;
    if (!confirm('确认归档此产品？归档后产品将不再显示，但可随时恢复。')) return;
    try { await api.json(`/api/products/${id}/archive?channel=${ORDER_CHANNEL}`, { method: 'PUT' }); toast('产品已归档'); await loadAll(); } catch (e) { toast(e.message, 'bad'); }
  };
  if ($('viewArchivedBtn')) $('viewArchivedBtn').onclick = loadArchivedProducts;
  if ($('closeArchivedProductsBtn')) $('closeArchivedProductsBtn').onclick = () => $('archivedProductsModal')?.classList.add('hidden');
  if ($('closeArchivedProductsModal')) $('closeArchivedProductsModal').onclick = () => $('archivedProductsModal')?.classList.add('hidden');
  document.querySelectorAll('[data-add-price]').forEach(b => b.onclick = () => { const t = $(b.dataset.addPrice === 'width' ? 'widthPriceTable' : 'lengthPriceTable'); if (t?.querySelector('tbody')) t.querySelector('tbody').insertAdjacentHTML('beforeend', '<tr><td><input type="number" step="0.01"></td><td><input type="number" step="0.01" value="0"></td><td><button class="btn small danger" onclick="this.closest(\'tr\').remove()">删除</button></td></tr>'); });
  if ($('addOptionGroupBtn')) $('addOptionGroupBtn').onclick = () => {
    optionEditor.groups.push({
      option_key: `option_${Date.now()}`,
      label: `新选项组 ${optionEditor.groups.length + 1}`,
      type: 'dropdown',
      factory: true,
      required: true,
      priceable: true,
      costable: true,
      values: [{ label: '选项 1', price_usd: 0, cost_rmb: 0 }]
    });
    optionEditor.activeIndex = optionEditor.groups.length - 1;
    renderOptionGroupsEditor();
  };
  if ($('importProductTemplateBtn')) $('importProductTemplateBtn').onclick = async () => {
    const f = $('productTemplateInput')?.files[0];
    if (!f) return toast('请选择 CSV', 'bad');
    try {
      const r = await api.upload('/api/import/product-csv', f);
      await loadAll();
      toast(`产品已导入：${r.changed || 0} 个`);
      $('productImportModal')?.classList.add('hidden');
    } catch (e) { toast(e.message, 'bad'); }
  };
  if ($('exportAllProductsBtn')) $('exportAllProductsBtn').onclick = () => location.href = '/api/export/product-template-csv';
  if ($('openProductImportModal')) $('openProductImportModal').onclick = () => $('productImportModal')?.classList.remove('hidden');
  if ($('closeProductImportModalBtn')) $('closeProductImportModalBtn').onclick = () => $('productImportModal')?.classList.add('hidden');
  if ($('closeProductImportModal')) $('closeProductImportModal').onclick = () => $('productImportModal')?.classList.add('hidden');
  if ($('closeCuttingDiagramBtn')) $('closeCuttingDiagramBtn').onclick = () => $('cuttingDiagramModal')?.classList.add('hidden');
  if ($('closeCuttingDiagramModal')) $('closeCuttingDiagramModal').onclick = () => $('cuttingDiagramModal')?.classList.add('hidden');
  if ($('manualSpliceDiagramBtn')) $('manualSpliceDiagramBtn').onclick = () => {
    const s = state.spliceDiagramPlans;
    if (s) openCuttingDiagram(s.mainPlan, s.liningPlan, '手动试算 — 裁剪示意图', s.label);
  };
  if ($('spliceOrderDiagramBtn')) $('spliceOrderDiagramBtn').onclick = () => {
    const s = state.spliceOrderDiagramPlans;
    if (s?.length) openCuttingDiagramMulti(s, '订单裁剪示意图');
  };
  if ($('productTemplateInput')) $('productTemplateInput').onchange = function () {
    const name = this.files[0]?.name || '';
    const el = $('productImportFileName');
    if (el) el.textContent = name;
  };
  if ($('saveTaxRatesBtn')) $('saveTaxRatesBtn').onclick = saveTaxRates;

  // Production photos - event delegation on modal body
  document.addEventListener('change', (e) => {
    const fileInput = e.target.closest('.production-photos-file-input');
    if (!fileInput) return;
    const itemId = fileInput.dataset.itemId;
    if (!itemId || !fileInput.files.length) return;
    uploadProductionPhotos(Number(itemId), fileInput.files);
    fileInput.value = '';
  });

  // Ensure preview panel has an initial binding-refresh even if some controls did not emit input events yet.
  updatePreview();

  // Global Escape key closes any visible modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  applyChannelChrome();
  const authReady = await window.TwodrapesAuthUI?.init({
    toast,
    verifyChannel: ORDER_CHANNEL,
    currentApp: APP_CONTEXT.app || ORDER_CHANNEL,
    allowAccess: () => true
  });
  if (!authReady) return;

  bind();
  try { await loadAll(); renderCurrentItems(); await calcSplice(); toast('已连接服务器数据库'); } catch (e) { toast(e.message, 'bad'); }
  if (ORDER_CHANNEL === 'amazon') {
    const taxTab = document.querySelector('nav button[data-tab="tax"]');
    if (taxTab) taxTab.style.display = 'none';
    const shopifySection = $('analyticsShopifySection');
    const amazonSection = $('analyticsAmazonSection');
    if (shopifySection) shopifySection.style.display = 'none';
    if (amazonSection) amazonSection.style.display = '';
  } else {
    const shopifySection = $('analyticsShopifySection');
    const amazonSection = $('analyticsAmazonSection');
    if (shopifySection) shopifySection.style.display = '';
    if (amazonSection) amazonSection.style.display = 'none';
  }
  activateTabFromHash();
});